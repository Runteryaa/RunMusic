package expo.modules.runmusicbleperipheral

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log

/**
 * Keeps the BLE peripheral host process alive while the phone screen is off.
 *
 * React Native pauses JS timers when the activity is backgrounded, and Android
 * may also freeze a cached app process. A connected-device foreground service
 * keeps the GATT server alive; the BLE module holds a partial wake lock while
 * a client is connected so its native heartbeat can keep sending media state.
 */
class RunMusicBleHostService : Service() {
  companion object {
    private const val TAG = "RunMusicBleHost"
    private const val CHANNEL_ID = "runmusic_ble_host"
    private const val NOTIFICATION_ID = 4711

    private const val ACTION_START = "expo.modules.runmusicbleperipheral.START"
    private const val ACTION_CLIENT_STATE = "expo.modules.runmusicbleperipheral.CLIENT_STATE"
    private const val EXTRA_CLIENT_COUNT = "clientCount"

    fun start(context: Context) {
      val intent = Intent(context, RunMusicBleHostService::class.java).setAction(ACTION_START)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, RunMusicBleHostService::class.java))
    }

    fun updateClientCount(context: Context, clientCount: Int) {
      // The service is normally already running while advertising. This call
      // only refreshes its notification; if Android rejects a background
      // service start, the BLE module's own wake lock still keeps the host
      // alive.
      val intent = Intent(context, RunMusicBleHostService::class.java)
        .setAction(ACTION_CLIENT_STATE)
        .putExtra(EXTRA_CLIENT_COUNT, clientCount.coerceAtLeast(0))
      try {
        context.startService(intent)
      } catch (_: Exception) {
        // Notification text is cosmetic.
      }
    }
  }

  private var clientCount = 0

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_CLIENT_STATE) {
      clientCount = intent.getIntExtra(EXTRA_CLIENT_COUNT, 0).coerceAtLeast(0)
    }

    return try {
      startForegroundCompat(buildNotification())
      START_NOT_STICKY
    } catch (e: Exception) {
      Log.e(TAG, "Unable to start BLE host foreground service", e)
      stopSelf()
      START_NOT_STICKY
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    stopForegroundCompat()
    super.onDestroy()
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java) ?: return
    val channel = NotificationChannel(
      CHANNEL_ID,
      "RunMusic uzaktan kumanda",
      NotificationManager.IMPORTANCE_LOW
    ).apply {
      description = "Bluetooth ile uzaktan kumanda bağlantısı"
      setShowBadge(false)
    }
    manager.createNotificationChannel(channel)
  }

  @Suppress("DEPRECATION")
  private fun buildNotification(): Notification {
    val icon = applicationInfo.icon.takeIf { it != 0 }
      ?: android.R.drawable.ic_media_play

    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      Notification.Builder(this)
    }

    return builder
      .setSmallIcon(icon)
      .setContentTitle("RunMusic uzaktan kumanda")
      .setContentText(
        if (clientCount > 0) {
          "Bluetooth bağlantısı aktif"
        } else {
          "Bluetooth bağlantısı bekleniyor"
        }
      )
      .setOngoing(true)
      .setShowWhen(false)
      .setCategory(Notification.CATEGORY_SERVICE)
      .setPriority(Notification.PRIORITY_LOW)
      .build()
  }

  private fun startForegroundCompat(notification: Notification) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun stopForegroundCompat() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
  }
}
