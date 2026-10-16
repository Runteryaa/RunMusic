import { blePeripheralService } from './blePeripheralService';
import { bleCentralService } from './bleCentralService';
import type {
  IRemoteTransport,
  DiscoveredPeer,
  ClientCallbacks,
  HostHandlers,
  TransportType,
} from './IRemoteTransport';
import type { RemoteMessage } from './remoteTypes';
import type { ClientConnectionStatus } from './tcpClient';

export class BleRemoteTransport implements IRemoteTransport {
  public readonly transportType: TransportType = 'ble';
  private clientCallbacks: ClientCallbacks | null = null;
  private hostHandlers: HostHandlers | null = null;

  public async startHost(deviceName: string): Promise<void> {
    if (this.hostHandlers) {
      blePeripheralService.setHandlers({
        onCommand: (msg, clientInfo) => {
          this.hostHandlers?.onCommand(msg, clientInfo);
        },
        onClientConnected: (clientInfo) => {
          this.hostHandlers?.onClientConnected?.(clientInfo);
        },
        onClientDisconnected: () => {
          // Disconnected
        },
      });
    }

    await blePeripheralService.startHost(deviceName);
  }

  public async stopHost(): Promise<void> {
    await blePeripheralService.stopHost();
  }

  public async broadcastState(message: RemoteMessage): Promise<void> {
    await blePeripheralService.broadcast(message);
  }

  public startDiscovery(onPeersUpdated: (peers: DiscoveredPeer[]) => void): () => void {
    return bleCentralService.startDiscovery(onPeersUpdated);
  }

  public async connect(peer: DiscoveredPeer, token?: string | null): Promise<void> {
    if (this.clientCallbacks) {
      bleCentralService.setCallbacks({
        onStatusChange: (status, error) => {
          this.clientCallbacks?.onStatusChange(status, error);
        },
        onMessage: (message) => {
          this.clientCallbacks?.onMessage(message);
        },
      });
    }

    await bleCentralService.connect(peer);
  }

  public async disconnect(): Promise<void> {
    await bleCentralService.disconnect();
  }

  public async sendCommand(message: RemoteMessage): Promise<void> {
    await bleCentralService.sendCommand(message);
  }

  public isHostActive(): boolean {
    return blePeripheralService.getIsAdvertising();
  }

  public getConnectionStatus(): ClientConnectionStatus {
    return bleCentralService.getStatus();
  }

  public getConnectedDeviceName(): string | null {
    return bleCentralService.getConnectedDeviceName();
  }

  public setClientCallbacks(callbacks: ClientCallbacks): void {
    this.clientCallbacks = callbacks;
    bleCentralService.setCallbacks({
      onStatusChange: (status, error) => {
        callbacks.onStatusChange(status, error);
      },
      onMessage: (message) => {
        callbacks.onMessage(message);
      },
    });
  }

  public setHostHandlers(handlers: HostHandlers): void {
    this.hostHandlers = handlers;
    blePeripheralService.setHandlers({
      onCommand: (msg, clientInfo) => {
        handlers.onCommand(msg, clientInfo);
      },
      onClientConnected: (clientInfo) => {
        handlers.onClientConnected?.(clientInfo);
      },
    });
  }
}

export const bleRemoteTransport = new BleRemoteTransport();
