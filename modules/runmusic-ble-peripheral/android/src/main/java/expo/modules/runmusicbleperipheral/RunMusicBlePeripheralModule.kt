package expo.modules.runmusicbleperipheral

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.content.Context
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.os.PowerManager
import android.util.Base64
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList

class RunMusicBlePeripheralModule : Module() {
  companion object {
    val SERVICE_UUID: UUID = UUID.fromString("0000feed-0000-1000-8000-00805f9b34fb")
    val CHAR_STATE_NOTIFY_UUID: UUID = UUID.fromString("0000fee1-0000-1000-8000-00805f9b34fb")
    val CHAR_COMMAND_WRITE_UUID: UUID = UUID.fromString("0000fee2-0000-1000-8000-00805f9b34fb")
    val CHAR_QUEUE_LYRICS_UUID: UUID = UUID.fromString("0000fee3-0000-1000-8000-00805f9b34fb")
    val CHAR_DEVICE_INFO_UUID: UUID = UUID.fromString("0000fee4-0000-1000-8000-00805f9b34fb")
    val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
  }

  private var bluetoothManager: BluetoothManager? = null
  private var bluetoothAdapter: BluetoothAdapter? = null
  private var gattServer: BluetoothGattServer? = null
  private var advertiser: BluetoothLeAdvertiser? = null

  private var stateNotifyChar: BluetoothGattCharacteristic? = null
  private var commandWriteChar: BluetoothGattCharacteristic? = null
  private var queueLyricsChar: BluetoothGattCharacteristic? = null
  private var deviceInfoChar: BluetoothGattCharacteristic? = null

  private val connectedDevices = CopyOnWriteArrayList<BluetoothDevice>()
  private var currentDeviceName: String = "RunMusic Device"
  @Volatile
  private var isAdvertising = false
  private var multicastLock: WifiManager.MulticastLock? = null
  private var applicationContext: Context? = null
  private var wakeLock: PowerManager.WakeLock? = null

  // Native heartbeat: React Native pauses JS timers when the activity goes to
  // the background, so the host must be ticked from Android instead.
  private val heartbeatHandler = Handler(Looper.getMainLooper())
  private val notificationHandler = Handler(Looper.getMainLooper())
  @Volatile
  private var heartbeatRunnable: Runnable? = null

  // Promise queue for notification pacing
  private val pendingNotificationPromises = ConcurrentHashMap<String, Promise>()

  private val advertiseCallback = object : AdvertiseCallback() {
    override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
      isAdvertising = true
    }

    override fun onStartFailure(errorCode: Int) {
      isAdvertising = false
      stopHeartbeat()
      applicationContext?.let { RunMusicBleHostService.stop(it) }
      Log.w("RunMusicBlePeripheral", "BLE advertising failed with error code $errorCode")
    }
  }

  private val gattServerCallback = object : BluetoothGattServerCallback() {
    override fun onConnectionStateChange(device: BluetoothDevice?, status: Int, newState: Int) {
      if (device == null) return

      try {
        if (newState == BluetoothProfile.STATE_CONNECTED) {
          if (!connectedDevices.any { it.address == device.address }) {
            connectedDevices.add(device)
          }
          ensureHeartbeat()
          updateHostServiceClients()
          sendEvent("onClientConnected", mapOf("deviceAddress" to device.address))
        } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
          connectedDevices.removeAll { it.address == device.address }
          if (connectedDevices.isEmpty()) {
            stopHeartbeat()
          }
          updateHostServiceClients()
          sendEvent("onClientDisconnected", mapOf("deviceAddress" to device.address))
        }
      } catch (e: SecurityException) {
        // Permission check fallback
      }
    }

    override fun onCharacteristicReadRequest(
      device: BluetoothDevice?,
      requestId: Int,
      offset: Int,
      characteristic: BluetoothGattCharacteristic?
    ) {
      if (device == null || characteristic == null) return

      var responseData = byteArrayOf()
      if (characteristic.uuid == CHAR_DEVICE_INFO_UUID) {
        val nameBytes = currentDeviceName.toByteArray(Charsets.UTF_8)
        responseData = if (offset < nameBytes.size) {
          nameBytes.copyOfRange(offset, nameBytes.size)
        } else {
          byteArrayOf()
        }
      } else {
        val charVal = characteristic.value
        if (charVal != null && offset < charVal.size) {
          responseData = charVal.copyOfRange(offset, charVal.size)
        }
      }

      try {
        gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, responseData)
      } catch (e: SecurityException) {
        // Permission fallback
      }
    }

    override fun onCharacteristicWriteRequest(
      device: BluetoothDevice?,
      requestId: Int,
      characteristic: BluetoothGattCharacteristic?,
      preparedWrite: Boolean,
      responseNeeded: Boolean,
      offset: Int,
      value: ByteArray?
    ) {
      if (device == null || characteristic == null) return

      if (!connectedDevices.any { it.address == device.address }) {
        connectedDevices.add(device)
        ensureHeartbeat()
        updateHostServiceClients()
      }

      // Rule 1: Always send response if responseNeeded is true so client's FIFO queue never hangs
      if (responseNeeded) {
        try {
          gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
        } catch (e: SecurityException) {
          // Permission fallback
        }
      }

      if (value != null && value.isNotEmpty()) {
        val base64Str = Base64.encodeToString(value, Base64.NO_WRAP)
        sendEvent(
          "onCharacteristicWrite",
          mapOf(
            "uuid" to characteristic.uuid.toString(),
            "valueBase64" to base64Str,
            "deviceAddress" to device.address
          )
        )
      }
    }

    override fun onDescriptorWriteRequest(
      device: BluetoothDevice?,
      requestId: Int,
      descriptor: BluetoothGattDescriptor?,
      preparedWrite: Boolean,
      responseNeeded: Boolean,
      offset: Int,
      value: ByteArray?
    ) {
      if (device == null || descriptor == null) return

      if (!connectedDevices.any { it.address == device.address }) {
        connectedDevices.add(device)
        ensureHeartbeat()
        updateHostServiceClients()
      }

      // Update descriptor value in GATT server so Android internal BLE stack recognizes subscriptions
      if (descriptor.uuid == CCCD_UUID && value != null) {
        descriptor.value = value
        if (value.isNotEmpty() && (value[0].toInt() and 1) != 0) {
          val charUuid = descriptor.characteristic?.uuid?.toString()
            ?: if (stateNotifyChar?.descriptors?.any { it.uuid == descriptor.uuid } == true) CHAR_STATE_NOTIFY_UUID.toString()
            else if (queueLyricsChar?.descriptors?.any { it.uuid == descriptor.uuid } == true) CHAR_QUEUE_LYRICS_UUID.toString()
            else CHAR_STATE_NOTIFY_UUID.toString()

          sendEvent(
            "onClientSubscribed",
            mapOf(
              "deviceAddress" to device.address,
              "charUuid" to charUuid
            )
          )
        }
      }

      // Rule 1: Always send response inside onDescriptorWriteRequest
      if (responseNeeded) {
        try {
          gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
        } catch (e: SecurityException) {
          // Permission fallback
        }
      }
    }

    override fun onNotificationSent(device: BluetoothDevice?, status: Int) {
      // Rule 3: Host Notification Pacing - resolve any pending notification promise
      sendEvent("onNotificationSent", mapOf("status" to status))

      // Resolve all pending promises waiting for this notification chunk.
      // Keep a tiny native inter-chunk gap for the Android BLE RF buffer. The
      // old JS implementation used a timer here, which stopped when the app
      // was backgrounded and left messages partially transmitted.
      val keys = pendingNotificationPromises.keys().toList()
      notificationHandler.postDelayed({
        for (key in keys) {
          pendingNotificationPromises.remove(key)?.resolve(status == BluetoothGatt.GATT_SUCCESS)
        }
      }, 15)
    }
  }

  override fun definition() = ModuleDefinition {
    Name("RunMusicBlePeripheral")

    Events("onClientConnected", "onClientDisconnected", "onCharacteristicWrite", "onNotificationSent", "onClientSubscribed", "onHeartbeat")

    OnCreate {
      val context = appContext.reactContext ?: return@OnCreate
      applicationContext = context.applicationContext
      bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
      bluetoothAdapter = bluetoothManager?.adapter
    }

    OnDestroy {
      stopHeartbeat()
      stopGattServerAndAdvertising()
      releaseWakeLock()
      try {
        if (multicastLock?.isHeld == true) {
          multicastLock?.release()
        }
      } catch (e: Exception) {}
      multicastLock = null
      applicationContext = null
    }

    Function("acquireMulticastLock") {
      val context = appContext.reactContext ?: return@Function false
      try {
        val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        if (multicastLock == null) {
          multicastLock = wifiManager?.createMulticastLock("RunMusicUdpMulticastLock")?.apply {
            setReferenceCounted(true)
          }
        }
        multicastLock?.acquire()
        true
      } catch (e: Exception) {
        false
      }
    }

    Function("releaseMulticastLock") {
      try {
        if (multicastLock?.isHeld == true) {
          multicastLock?.release()
        }
        true
      } catch (e: Exception) {
        false
      }
    }

    Function("getSubnetBroadcastAddresses") {
      val addresses = mutableListOf<String>()
      try {
        val interfaces = NetworkInterface.getNetworkInterfaces()
        while (interfaces.hasMoreElements()) {
          val networkInterface = interfaces.nextElement()
          if (networkInterface.isLoopback || !networkInterface.isUp) continue
          for (interfaceAddress in networkInterface.interfaceAddresses) {
            val broadcast = interfaceAddress.broadcast
            if (broadcast != null && broadcast is Inet4Address) {
              val host = broadcast.hostAddress
              if (!host.isNullOrEmpty() && !addresses.contains(host)) {
                addresses.add(host)
              }
            }
          }
        }
      } catch (e: Exception) {
        // ignore
      }
      addresses
    }

    Function("isSupported") {
      val adapter = bluetoothAdapter ?: return@Function false
      adapter.isEnabled && adapter.bluetoothLeAdvertiser != null
    }

    Function("setCustomDeviceName") { name: String ->
      currentDeviceName = name
    }

    AsyncFunction("startAdvertising") { deviceName: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("NO_CONTEXT", "ReactContext is null", null)
        return@AsyncFunction
      }

      currentDeviceName = deviceName
      val adapter = bluetoothAdapter
      if (adapter == null || !adapter.isEnabled) {
        promise.reject("BLUETOOTH_DISABLED", "Bluetooth is turned off", null)
        return@AsyncFunction
      }

      advertiser = adapter.bluetoothLeAdvertiser
      if (advertiser == null) {
        promise.reject("BLE_NOT_SUPPORTED", "BLE Advertising is not supported on this device", null)
        return@AsyncFunction
      }

      try {
        // Setup GATT Server if not already setup
        if (gattServer == null) {
          gattServer = bluetoothManager?.openGattServer(context, gattServerCallback)
          setupGattServices()
        }

        // Setup 31-byte compliant Advertising:
        // Primary: ONLY Service UUID 0xFEED and flags (NO device name to prevent 31-byte limit error)
        val settings = AdvertiseSettings.Builder()
          .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
          .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
          .setConnectable(true)
          .build()

        val pUuid = ParcelUuid(SERVICE_UUID)
        val adData = AdvertiseData.Builder()
          .addServiceUuid(pUuid)
          .setIncludeDeviceName(false)
          .setIncludeTxPowerLevel(false)
          .build()

        // Scan Response: Device name goes into scan response!
        val scanResponse = AdvertiseData.Builder()
          .setIncludeDeviceName(true)
          .build()

        advertiser?.stopAdvertising(advertiseCallback)
        advertiser?.startAdvertising(settings, adData, scanResponse, advertiseCallback)

        isAdvertising = true
        try {
          applicationContext?.let { RunMusicBleHostService.start(it) }
        } catch (e: Exception) {
          // Advertising still works without the foreground service; the host
          // may only lose screen-off updates on aggressive Android versions.
          Log.w("RunMusicBlePeripheral", "Foreground service start failed", e)
        }
        promise.resolve(true)
      } catch (e: Exception) {
        promise.reject("ADVERTISE_ERROR", e.message ?: "Failed to start advertising", e)
      }
    }

    AsyncFunction("stopAdvertising") { promise: Promise ->
      try {
        stopGattServerAndAdvertising()
        promise.resolve(true)
      } catch (e: Exception) {
        promise.reject("STOP_ERROR", e.message ?: "Failed to stop advertising", e)
      }
    }

    AsyncFunction("sendNotification") { charUuidStr: String, valueBase64: String, promise: Promise ->
      val server = gattServer
      if (server == null || connectedDevices.isEmpty()) {
        promise.resolve(false)
        return@AsyncFunction
      }

      val targetChar = when (charUuidStr.lowercase()) {
        CHAR_STATE_NOTIFY_UUID.toString().lowercase() -> stateNotifyChar
        CHAR_QUEUE_LYRICS_UUID.toString().lowercase() -> queueLyricsChar
        else -> null
      }

      if (targetChar == null) {
        promise.reject("CHAR_NOT_FOUND", "Target characteristic $charUuidStr not found", null)
        return@AsyncFunction
      }

      val rawBytes = Base64.decode(valueBase64, Base64.NO_WRAP)
      val promiseId = UUID.randomUUID().toString()
      pendingNotificationPromises[promiseId] = promise

      // Safety fallback timeout. Normal BLE stacks resolve this from
      // onNotificationSent; the fallback is deliberately generous because the
      // JS side no longer uses a timer (React Native pauses timers in the
      // background, which used to stall multi-chunk messages).
      notificationHandler.postDelayed({
        pendingNotificationPromises.remove(promiseId)?.resolve(true)
      }, 80)

      try {
        @Suppress("DEPRECATION")
        targetChar.value = rawBytes

        var notifyTriggered = false
        for (device in connectedDevices) {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val res = server.notifyCharacteristicChanged(device, targetChar, false, rawBytes)
            if (res == android.bluetooth.BluetoothStatusCodes.SUCCESS) {
              notifyTriggered = true
            }
          } else {
            @Suppress("DEPRECATION")
            val res = server.notifyCharacteristicChanged(device, targetChar, false)
            if (res) {
              notifyTriggered = true
            }
          }
        }

        if (!notifyTriggered) {
          // If BLE stack did not accept the notification, resolve promise
          pendingNotificationPromises.remove(promiseId)?.resolve(false)
        }
      } catch (e: Exception) {
        pendingNotificationPromises.remove(promiseId)
        promise.reject("NOTIFY_ERROR", e.message ?: "Failed to notify characteristic", e)
      }
    }
  }

  private fun ensureHeartbeat() {
    if (heartbeatRunnable != null) return

    val runnable = object : Runnable {
      override fun run() {
        if (!isAdvertising || connectedDevices.isEmpty()) {
          heartbeatRunnable = null
          return
        }

        try {
          sendEvent("onHeartbeat", mapOf("timestamp" to System.currentTimeMillis()))
        } catch (_: Exception) {
          // The JS runtime may be tearing down; stop quietly.
        }

        heartbeatHandler.postDelayed(this, 1500)
      }
    }

    heartbeatRunnable = runnable
    heartbeatHandler.postDelayed(runnable, 1500)
  }

  private fun stopHeartbeat() {
    heartbeatRunnable?.let { heartbeatHandler.removeCallbacks(it) }
    heartbeatRunnable = null
  }

  @SuppressLint("WakelockTimeout")
  @Synchronized
  private fun updateHostServiceClients() {
    val context = applicationContext ?: appContext.reactContext?.applicationContext ?: return

    try {
      if (connectedDevices.isNotEmpty()) {
        if (wakeLock == null) {
          val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
            ?: return
          wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "RunMusic:BleRemoteHost"
          ).apply {
            setReferenceCounted(false)
          }
        }
        if (wakeLock?.isHeld != true) {
          wakeLock?.acquire()
        }
      } else {
        releaseWakeLock()
      }
    } catch (e: Exception) {
      Log.w("RunMusicBlePeripheral", "Unable to update BLE host wake lock", e)
    }

    // Notification text is cosmetic; the wake lock above is the part that
    // must survive even if the service intent is rejected while backgrounded.
    RunMusicBleHostService.updateClientCount(context, connectedDevices.size)
  }

  @Synchronized
  private fun releaseWakeLock() {
    try {
      if (wakeLock?.isHeld == true) {
        wakeLock?.release()
      }
    } catch (_: Exception) {
      // Ignore release failures during teardown.
    }
    wakeLock = null
  }

  private fun setupGattServices() {
    val server = gattServer ?: return

    val service = BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)

    // 0xfee1: State Notify (NOTIFY, READ) with CCCD 0x2902
    stateNotifyChar = BluetoothGattCharacteristic(
      CHAR_STATE_NOTIFY_UUID,
      BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_READ,
      BluetoothGattCharacteristic.PERMISSION_READ
    ).apply {
      addDescriptor(BluetoothGattDescriptor(CCCD_UUID, BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE))
    }
    service.addCharacteristic(stateNotifyChar)

    // 0xfee2: Command Write (WRITE, WRITE_NO_RESPONSE)
    commandWriteChar = BluetoothGattCharacteristic(
      CHAR_COMMAND_WRITE_UUID,
      BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
      BluetoothGattCharacteristic.PERMISSION_WRITE
    )
    service.addCharacteristic(commandWriteChar)

    // 0xfee3: Queue & Lyrics (NOTIFY, WRITE, READ) with CCCD 0x2902
    queueLyricsChar = BluetoothGattCharacteristic(
      CHAR_QUEUE_LYRICS_UUID,
      BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_READ,
      BluetoothGattCharacteristic.PERMISSION_READ or BluetoothGattCharacteristic.PERMISSION_WRITE
    ).apply {
      addDescriptor(BluetoothGattDescriptor(CCCD_UUID, BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE))
    }
    service.addCharacteristic(queueLyricsChar)

    // 0xfee4: Device Info Read-Only (READ)
    deviceInfoChar = BluetoothGattCharacteristic(
      CHAR_DEVICE_INFO_UUID,
      BluetoothGattCharacteristic.PROPERTY_READ,
      BluetoothGattCharacteristic.PERMISSION_READ
    )
    service.addCharacteristic(deviceInfoChar)

    server.clearServices()
    server.addService(service)
  }

  private fun stopGattServerAndAdvertising() {
    try {
      stopHeartbeat()
      applicationContext?.let { RunMusicBleHostService.stop(it) }
      if (isAdvertising) {
        advertiser?.stopAdvertising(advertiseCallback)
        isAdvertising = false
      }
      gattServer?.clearServices()
      gattServer?.close()
      gattServer = null
      connectedDevices.clear()
      releaseWakeLock()
      pendingNotificationPromises.clear()
    } catch (e: Exception) {
      // Cleanup
    }
  }
}
