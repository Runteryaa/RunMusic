import { Buffer } from 'buffer';
import { Platform } from 'react-native';
import RunMusicBlePeripheralModule from '../../../modules/runmusic-ble-peripheral';
import { NDJSONParser, serializeNDJSON } from './ndjsonFramer';
import { requestBlePermissions } from './blePermissions';
import type { RemoteMessage } from './remoteTypes';

export const BLE_RUNMUSIC_SERVICE_UUID = '0000feed-0000-1000-8000-00805f9b34fb';
export const BLE_CHAR_STATE_NOTIFY_UUID = '0000fee1-0000-1000-8000-00805f9b34fb';
export const BLE_CHAR_COMMAND_WRITE_UUID = '0000fee2-0000-1000-8000-00805f9b34fb';
export const BLE_CHAR_QUEUE_LYRICS_UUID = '0000fee3-0000-1000-8000-00805f9b34fb';
export const BLE_CHAR_DEVICE_INFO_UUID = '0000fee4-0000-1000-8000-00805f9b34fb';

// Conservative safe chunk size for BLE notifications
const BLE_SAFE_NOTIFY_CHUNK_SIZE = 180;

export interface BlePeripheralHandlers {
  onCommand: (message: RemoteMessage, clientInfo: { deviceId: string; deviceName: string }) => void;
  onHeartbeat?: () => void;
  onClientConnected?: (clientInfo: { deviceId: string; deviceName: string }) => void;
  onClientSubscribed?: (clientInfo: { deviceId: string; deviceName: string; charUuid: string }) => void;
  onClientDisconnected?: (deviceId: string) => void;
}

class BlePeripheralService {
  private isAdvertising = false;
  private handlers: BlePeripheralHandlers | null = null;
  private connectedClients = new Set<string>();

  // Rule 2: Dedicated NDJSON parser instance per characteristic to avoid chunk interleaving
  private commandWriteParser: NDJSONParser = new NDJSONParser();
  private queueLyricsParser: NDJSONParser = new NDJSONParser();

  // Rule 3: Host Notification Pacing FIFO Queue
  private sendQueue: (() => Promise<void>)[] = [];
  private isProcessingQueue = false;

  private listenerSubscriptions: (() => void)[] = [];

  public setHandlers(handlers: BlePeripheralHandlers): void {
    this.handlers = handlers;
  }

  public isSupported(): boolean {
    if (Platform.OS !== 'android') return false;
    return RunMusicBlePeripheralModule?.isSupported() ?? false;
  }

  public getIsAdvertising(): boolean {
    return this.isAdvertising;
  }

  public getConnectedClientCount(): number {
    return this.connectedClients.size;
  }

  public async startHost(deviceName: string): Promise<boolean> {
    if (this.isAdvertising) return true;
    if (Platform.OS !== 'android') return false;
    if (!RunMusicBlePeripheralModule) {
      console.warn('[BlePeripheralService] RunMusicBlePeripheralModule not installed');
      return false;
    }

    const hasPermissions = await requestBlePermissions();
    if (!hasPermissions) {
      console.warn('[BlePeripheralService] Missing Bluetooth permissions');
      return false;
    }

    this.setupListeners();
    this.connectedClients.clear();
    try {
      RunMusicBlePeripheralModule.setCustomDeviceName(deviceName);
      const success = await RunMusicBlePeripheralModule.startAdvertising(deviceName);
      this.isAdvertising = success;
      return success;
    } catch (err) {
      console.error('[BlePeripheralService] Failed to start advertising:', err);
      this.isAdvertising = false;
      return false;
    }
  }

  public async stopHost(): Promise<void> {
    this.removeListeners();
    this.connectedClients.clear();
    this.commandWriteParser.reset();
    this.queueLyricsParser.reset();
    this.sendQueue = [];
    this.isProcessingQueue = false;

    try {
      // Always ask the native side to tear down. It also stops the foreground
      // service and releases the wake lock if advertising never fully started.
      await RunMusicBlePeripheralModule?.stopAdvertising();
    } catch (err) {
      console.warn('[BlePeripheralService] Error stopping advertising:', err);
    }
    this.isAdvertising = false;
  }

  /**
   * Broadcasts a state or lyrics message to all connected BLE clients.
   * Splits message into MTU-safe chunks and sends each chunk sequentially
   * using the FIFO send queue (Host Notification Pacing).
   */
  public async broadcast(
    message: RemoteMessage,
    charUuid?: string
  ): Promise<void> {
    if (!this.isAdvertising || !RunMusicBlePeripheralModule) return;

    const targetUuid =
      charUuid ||
      (message.type === 'QUEUE_SYNC' || message.type === 'LYRICS_SYNC'
        ? BLE_CHAR_QUEUE_LYRICS_UUID
        : BLE_CHAR_STATE_NOTIFY_UUID);

    const serialized = serializeNDJSON(message);
    const rawBuffer = Buffer.from(serialized, 'utf8');

    // Slice into safe MTU chunks
    const chunks: Buffer[] = [];
    let offset = 0;
    while (offset < rawBuffer.length) {
      const end = Math.min(offset + BLE_SAFE_NOTIFY_CHUNK_SIZE, rawBuffer.length);
      chunks.push(Buffer.from(rawBuffer.subarray(offset, end)));
      offset = end;
    }

    // Enqueue the whole message as one task. Enqueueing chunks individually
    // allowed the backlog cap below to drop chunks from the middle of an
    // NDJSON message, permanently corrupting the client parser.
    this.enqueueSend(async () => {
      for (const chunk of chunks) {
        const base64Chunk = chunk.toString('base64');
        try {
          // Native sendNotification resolves from onNotificationSent (or its
          // own native timeout). Do not use JS timers here: React Native
          // pauses them when the app is backgrounded, which used to leave a
          // partial NDJSON message and wedge this queue while the screen was off.
          await RunMusicBlePeripheralModule?.sendNotification(targetUuid, base64Chunk);
        } catch (err) {
          console.warn('[BlePeripheralService] Notification chunk failed:', err);
        }
      }
    });
  }

  private enqueueSend(task: () => Promise<void>): void {
    // Media controls only need latest state; drop whole stale messages if
    // congested. Never retain only a tail because that could split a message.
    if (this.sendQueue.length >= 15) {
      this.sendQueue.splice(0, this.sendQueue.length - 14);
    }
    this.sendQueue.push(task);
    if (!this.isProcessingQueue) {
      this.processSendQueue();
    }
  }

  private async processSendQueue(): Promise<void> {
    this.isProcessingQueue = true;
    while (this.sendQueue.length > 0) {
      const task = this.sendQueue.shift();
      if (task) {
        try {
          await task();
        } catch (err) {
          console.warn('[BlePeripheralService] Error processing send task:', err);
        }
      }
    }
    this.isProcessingQueue = false;
  }

  private setupListeners(): void {
    this.removeListeners();
    if (!RunMusicBlePeripheralModule) return;

    const subConnect = RunMusicBlePeripheralModule.addListener(
      'onClientConnected',
      (event: { deviceAddress: string }) => {
        this.connectedClients.add(event.deviceAddress);
        this.handlers?.onClientConnected?.({
          deviceId: event.deviceAddress,
          deviceName: `BLE Client (${event.deviceAddress.slice(-5)})`,
        });
      }
    );

    const subSubscribed = RunMusicBlePeripheralModule.addListener(
      'onClientSubscribed',
      (event: { deviceAddress: string; charUuid: string }) => {
        this.connectedClients.add(event.deviceAddress);
        this.handlers?.onClientSubscribed?.({
          deviceId: event.deviceAddress,
          deviceName: `BLE Client (${event.deviceAddress.slice(-5)})`,
          charUuid: event.charUuid,
        });
      }
    );

    const subDisconnect = RunMusicBlePeripheralModule.addListener(
      'onClientDisconnected',
      (event: { deviceAddress: string }) => {
        this.connectedClients.delete(event.deviceAddress);
        this.handlers?.onClientDisconnected?.(event.deviceAddress);
      }
    );

    const subHeartbeat = RunMusicBlePeripheralModule.addListener(
      'onHeartbeat',
      () => {
        this.handlers?.onHeartbeat?.();
      }
    );

    const subWrite = RunMusicBlePeripheralModule.addListener(
      'onCharacteristicWrite',
      (event: { uuid: string; valueBase64: string; deviceAddress: string }) => {
        const rawBytes = Buffer.from(event.valueBase64, 'base64');
        const uuidLower = event.uuid.toLowerCase();

        const parser =
          uuidLower === BLE_CHAR_QUEUE_LYRICS_UUID.toLowerCase()
            ? this.queueLyricsParser
            : this.commandWriteParser;

        parser.feed(rawBytes, (parsedMsg) => {
          this.handlers?.onCommand(parsedMsg, {
            deviceId: event.deviceAddress,
            deviceName: `BLE Client (${event.deviceAddress.slice(-5)})`,
          });
        });
      }
    );

    this.listenerSubscriptions.push(
      () => subConnect.remove(),
      () => subSubscribed.remove(),
      () => subDisconnect.remove(),
      () => subHeartbeat.remove(),
      () => subWrite.remove()
    );
  }

  private removeListeners(): void {
    for (const cleanup of this.listenerSubscriptions) {
      cleanup();
    }
    this.listenerSubscriptions = [];
  }
}

export const blePeripheralService = new BlePeripheralService();
