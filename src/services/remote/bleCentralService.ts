import { Buffer } from 'buffer';
import { BleManager, Device, Subscription } from 'react-native-ble-plx';
import { NDJSONParser, serializeNDJSON } from './ndjsonFramer';
import { requestBlePermissions } from './blePermissions';
import {
  BLE_RUNMUSIC_SERVICE_UUID,
  BLE_CHAR_STATE_NOTIFY_UUID,
  BLE_CHAR_COMMAND_WRITE_UUID,
  BLE_CHAR_DEVICE_INFO_UUID,
} from './blePeripheralService';
import type { RemoteMessage } from './remoteTypes';
import type { ClientConnectionStatus } from './tcpClient';
import type { DiscoveredPeer } from './IRemoteTransport';

export interface BleCentralCallbacks {
  onStatusChange: (status: ClientConnectionStatus, error?: string) => void;
  onMessage: (message: RemoteMessage) => void;
}

class BleCentralService {
  private bleManager: BleManager | null = null;
  private connectedDevice: Device | null = null;
  private status: ClientConnectionStatus = 'idle';
  private callbacks: BleCentralCallbacks | null = null;
  private isExplicitDisconnect: boolean = false;

  // Rule 2: Dedicated NDJSON parser instance per characteristic to avoid chunk interleaving
  private stateStreamParser: NDJSONParser = new NDJSONParser();
  private lyricsStreamParser: NDJSONParser = new NDJSONParser();

  // Subscriptions for monitoring
  private monitorSubs: Subscription[] = [];

  // Effective negotiated MTU minus 3 bytes ATT header
  private effectiveChunkSize = 180;

  // FIFO Send Queue (Mutex) to prevent Android GATT_BUSY / Status 133 errors
  private sendQueue: (() => Promise<void>)[] = [];
  private isProcessingQueue = false;

  private getManager(): BleManager {
    if (!this.bleManager) {
      this.bleManager = new BleManager();
    }
    return this.bleManager;
  }

  public setCallbacks(callbacks: BleCentralCallbacks): void {
    this.callbacks = callbacks;
  }

  public getStatus(): ClientConnectionStatus {
    return this.status;
  }

  public getConnectedDeviceName(): string | null {
    return this.connectedDevice?.name || null;
  }

  private setStatus(status: ClientConnectionStatus, error?: string): void {
    this.status = status;
    this.callbacks?.onStatusChange(status, error);
  }

  /**
   * Starts scanning for RunMusic BLE Peripherals.
   */
  public startDiscovery(onPeersUpdated: (peers: DiscoveredPeer[]) => void): () => void {
    const manager = this.getManager();
    const discoveredMap = new Map<string, DiscoveredPeer>();

    let isScanning = true;

    requestBlePermissions().then((hasPermissions) => {
      if (!hasPermissions || !isScanning) return;

      try {
        manager.startDeviceScan(
          [BLE_RUNMUSIC_SERVICE_UUID],
          { allowDuplicates: false },
          (error, device) => {
            if (error) {
              console.warn('[BleCentralService] Scan error:', error);
              return;
            }

            if (!device || !device.id) return;

            const peer: DiscoveredPeer = {
              id: device.id,
              deviceName: device.name || device.localName || `RunMusic BLE (${device.id.slice(-5)})`,
              transport: 'ble',
              lastSeen: Date.now(),
              rssi: device.rssi ?? undefined,
            };

            discoveredMap.set(device.id, peer);
            onPeersUpdated(Array.from(discoveredMap.values()));
          }
        );
      } catch (err) {
        console.warn('[BleCentralService] startDeviceScan threw:', err);
      }
    });

    return () => {
      isScanning = false;
      try {
        manager.stopDeviceScan();
      } catch {
        // Ignore cleanup error
      }
    };
  }

  /**
   * Connects to a target BLE peripheral and negotiates MTU.
   */
  public async connect(peer: DiscoveredPeer): Promise<void> {
    const manager = this.getManager();

    if (this.connectedDevice) {
      try {
        await this.connectedDevice.cancelConnection();
      } catch {
        // ignore
      }
      this.cleanup();
    }

    try {
      manager.stopDeviceScan();
    } catch {
      // Ignore
    }

    this.isExplicitDisconnect = false;
    this.setStatus('connecting');

    try {
      const hasPermissions = await requestBlePermissions();
      if (!hasPermissions) {
        throw new Error('Bluetooth izinleri verilmedi');
      }

      // Connect to device
      const device = await manager.connectToDevice(peer.id, {
        autoConnect: false,
        timeout: 10000,
      });

      this.connectedDevice = device;

      // Discover services & characteristics
      await device.discoverAllServicesAndCharacteristics();

      // Negotiate MTU (request 512 bytes on Android)
      try {
        const negotiated = await device.requestMTU(512);
        this.effectiveChunkSize = Math.max(20, (negotiated.mtu || 23) - 3);
      } catch {
        // Fallback for iOS (iOS automatically negotiates ~185 MTU)
        this.effectiveChunkSize = 180;
      }

      // Read device name from 0xfee4 if advertisement name was truncated or generic
      try {
        const nameChar = await device.readCharacteristicForService(
          BLE_RUNMUSIC_SERVICE_UUID,
          BLE_CHAR_DEVICE_INFO_UUID
        );
        if (nameChar?.value) {
          const rawName = Buffer.from(nameChar.value, 'base64').toString('utf8');
          if (rawName && rawName.trim()) {
            peer.deviceName = rawName.trim();
          }
        }
      } catch {
        // Fallback to advertised name
      }

      // Listen for disconnects
      device.onDisconnected((error) => {
        if (this.isExplicitDisconnect) {
          console.log('[BleCentralService] Explicit disconnect - ignoring onDisconnected callback');
          return;
        }
        console.warn('[BleCentralService] BLE Device disconnected:', error?.message);
        this.cleanup();
        this.setStatus('disconnected', error?.message);
      });

      // Start monitoring state & lyrics characteristics
      this.setupMonitors(device);

      this.setStatus('connected');

      // Request fresh initial state from Host now that monitors are active
      setTimeout(() => {
        this.sendCommand({ type: 'COMMAND_GET_STATE' } as any).catch(() => {});
      }, 400);
    } catch (err: any) {
      console.error('[BleCentralService] Connection error:', err);
      this.cleanup();
      this.setStatus('error', err?.message || 'Failed to connect via BLE');
    }
  }

  public async disconnect(): Promise<void> {
    this.isExplicitDisconnect = true;
    const device = this.connectedDevice;
    this.cleanup();
    if (device) {
      try {
        await device.cancelConnection();
      } catch {
        // Ignore
      }
    }
    this.callbacks = null;
    this.setStatus('idle');
  }

  /**
   * Sends a command to the connected Host using the FIFO write queue.
   */
  public async sendCommand(message: RemoteMessage): Promise<void> {
    const device = this.connectedDevice;
    if (!device || this.status !== 'connected') {
      console.warn('[BleCentralService] Cannot send command; not connected');
      return;
    }

    const serialized = serializeNDJSON(message);
    const rawBuffer = Buffer.from(serialized, 'utf8');

    // Slice into chunks adhering to effective negotiated MTU
    const chunks: Buffer[] = [];
    let offset = 0;
    while (offset < rawBuffer.length) {
      const end = Math.min(offset + this.effectiveChunkSize, rawBuffer.length);
      chunks.push(Buffer.from(rawBuffer.subarray(offset, end)));
      offset = end;
    }

    // High frequency SEEK can use writeWithoutResponse, while discrete commands use writeWithResponse
    const isSeek = (message as any)?.type === 'COMMAND_SEEK';

    for (const chunk of chunks) {
      const base64Chunk = chunk.toString('base64');
      this.enqueueWrite(async () => {
        if (!this.connectedDevice) return;
        if (isSeek) {
          await this.connectedDevice.writeCharacteristicWithoutResponseForService(
            BLE_RUNMUSIC_SERVICE_UUID,
            BLE_CHAR_COMMAND_WRITE_UUID,
            base64Chunk
          );
        } else {
          await this.connectedDevice.writeCharacteristicWithResponseForService(
            BLE_RUNMUSIC_SERVICE_UUID,
            BLE_CHAR_COMMAND_WRITE_UUID,
            base64Chunk
          );
        }
      });
    }
  }

  private enqueueWrite(task: () => Promise<void>): void {
    this.sendQueue.push(task);
    if (!this.isProcessingQueue) {
      this.processWriteQueue();
    }
  }

  private async processWriteQueue(): Promise<void> {
    this.isProcessingQueue = true;
    while (this.sendQueue.length > 0) {
      const task = this.sendQueue.shift();
      if (task) {
        try {
          const writePromise = task();
          const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 3000));
          await Promise.race([writePromise, timeoutPromise]);
        } catch (err) {
          console.warn('[BleCentralService] Error in write queue task:', err);
        }
      }
    }
    this.isProcessingQueue = false;
  }

  private setupMonitors(device: Device): void {
    this.cleanupMonitors();

    // Monitor 0xfee1: Media Control State Stream
    const stateSub = device.monitorCharacteristicForService(
      BLE_RUNMUSIC_SERVICE_UUID,
      BLE_CHAR_STATE_NOTIFY_UUID,
      (error, characteristic) => {
        if (error) {
          console.warn('[BleCentralService] Monitor error on state char:', error);
          return;
        }
        if (!characteristic?.value) return;

        const rawBytes = Buffer.from(characteristic.value, 'base64');
        this.stateStreamParser.feed(rawBytes, (msg) => {
          this.callbacks?.onMessage(msg);
        });
      }
    );

    this.monitorSubs.push(stateSub);
  }

  private cleanupMonitors(): void {
    for (const sub of this.monitorSubs) {
      try {
        sub.remove();
      } catch {
        // Ignore
      }
    }
    this.monitorSubs = [];
    this.stateStreamParser.reset();
    this.lyricsStreamParser.reset();
  }

  private cleanup(): void {
    this.cleanupMonitors();
    this.connectedDevice = null;
    this.sendQueue = [];
    this.isProcessingQueue = false;
  }
}

export const bleCentralService = new BleCentralService();
