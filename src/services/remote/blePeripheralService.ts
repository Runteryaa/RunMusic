import { Buffer } from 'buffer';
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
  onClientConnected?: (clientInfo: { deviceId: string; deviceName: string }) => void;
  onClientSubscribed?: (clientInfo: { deviceId: string; deviceName: string; charUuid: string }) => void;
  onClientDisconnected?: (deviceId: string) => void;
}

class BlePeripheralService {
  private isAdvertising = false;
  private handlers: BlePeripheralHandlers | null = null;

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
    return RunMusicBlePeripheralModule?.isSupported() ?? false;
  }

  public getIsAdvertising(): boolean {
    return this.isAdvertising;
  }

  public async startHost(deviceName: string): Promise<boolean> {
    if (this.isAdvertising) return true;
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
    if (!this.isAdvertising) return;
    this.removeListeners();
    this.commandWriteParser.reset();
    this.queueLyricsParser.reset();
    this.sendQueue = [];
    this.isProcessingQueue = false;

    try {
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

    // Enqueue each chunk sequentially (Host Notification Pacing)
    for (const chunk of chunks) {
      const base64Chunk = chunk.toString('base64');
      this.enqueueSend(async () => {
        try {
          const sendPromise = RunMusicBlePeripheralModule?.sendNotification(targetUuid, base64Chunk);
          const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(false), 1500));
          await Promise.race([sendPromise, timeoutPromise]);
        } catch (err) {
          console.warn('[BlePeripheralService] Notification chunk failed:', err);
        }
      });
    }
  }

  private enqueueSend(task: () => Promise<void>): void {
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
        this.handlers?.onClientConnected?.({
          deviceId: event.deviceAddress,
          deviceName: `BLE Client (${event.deviceAddress.slice(-5)})`,
        });
      }
    );

    const subSubscribed = RunMusicBlePeripheralModule.addListener(
      'onClientSubscribed',
      (event: { deviceAddress: string; charUuid: string }) => {
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
        this.handlers?.onClientDisconnected?.(event.deviceAddress);
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
