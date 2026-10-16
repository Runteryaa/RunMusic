import { Platform } from 'react-native';
import { tcpHostServer } from './tcpHostServer';
import { tcpClient, type ClientConnectionStatus } from './tcpClient';
import { udpDiscoveryService } from './udpDiscovery';
import { RUNMUSIC_TCP_PORT, type RemoteMessage } from './remoteTypes';
import type {
  IRemoteTransport,
  DiscoveredPeer,
  ClientCallbacks,
  HostHandlers,
  TransportType,
} from './IRemoteTransport';

export class TcpRemoteTransport implements IRemoteTransport {
  public readonly transportType: TransportType = 'wifi';
  private isHosting = false;
  private connectedPeerName: string | null = null;
  private clientCallbacks: ClientCallbacks | null = null;
  private hostHandlers: HostHandlers | null = null;

  public async startHost(deviceName: string): Promise<void> {
    if (this.isHosting) return;

    const deviceId = `device_${Platform.OS}_${Date.now()}`;

    // Configure Host server handlers
    tcpHostServer.setHandlers({
      validateToken: (token, clientDeviceId) => true, // Will be overridden or passed via hostHandlers
      generateToken: (clientDeviceId, clientDeviceName) =>
        `token_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      onPairChallenge: (challenge) => {
        this.hostHandlers?.onPairChallenge?.(challenge);
      },
      onClientAuthorized: (clientSocket, clientInfo) => {
        this.hostHandlers?.onClientConnected?.(clientInfo);
      },
      onCommand: (message, clientSocket, clientInfo) => {
        this.hostHandlers?.onCommand(message, clientInfo);
      },
    });

    tcpHostServer.startServer();
    udpDiscoveryService.startHostBeacon(deviceId, deviceName);
    this.isHosting = true;
  }

  public async stopHost(): Promise<void> {
    if (!this.isHosting) return;
    udpDiscoveryService.stopHostBeacon();
    tcpHostServer.stopServer();
    this.isHosting = false;
  }

  public async broadcastState(message: RemoteMessage): Promise<void> {
    if (!this.isHosting) return;
    tcpHostServer.broadcast(message);
  }

  public startDiscovery(onPeersUpdated: (peers: DiscoveredPeer[]) => void): () => void {
    const unsubscribe = udpDiscoveryService.startClientListener((hosts) => {
      const peers: DiscoveredPeer[] = hosts.map((h) => ({
        id: h.deviceId,
        deviceName: h.deviceName,
        transport: 'wifi' as const,
        lastSeen: h.lastSeen,
        hostIp: h.hostIp,
        port: h.port,
      }));
      onPeersUpdated(peers);
    });

    return () => {
      unsubscribe();
    };
  }

  public async connect(peer: DiscoveredPeer, token?: string | null): Promise<void> {
    const hostIp = peer.hostIp || peer.id;
    const port = peer.port || RUNMUSIC_TCP_PORT;
    const clientDeviceId = `client_${Platform.OS}_${Date.now()}`;
    const clientDeviceName = peer.deviceName;
    this.connectedPeerName = peer.deviceName;

    if (this.clientCallbacks) {
      tcpClient.setCallbacks({
        onStatusChange: (status, error) => {
          this.clientCallbacks?.onStatusChange(status, error);
        },
        onPinRequired: (verifyCb) => {
          this.clientCallbacks?.onPinRequired?.(verifyCb);
        },
        onPairSuccess: (newToken) => {
          this.clientCallbacks?.onPairSuccess?.(newToken);
        },
        onMessage: (message) => {
          this.clientCallbacks?.onMessage(message);
        },
      });
    }

    tcpClient.connect({
      hostIp,
      port,
      clientDeviceId,
      clientDeviceName,
      token: token || undefined,
    });
  }

  public async disconnect(): Promise<void> {
    tcpClient.disconnect();
    this.connectedPeerName = null;
  }

  public async sendCommand(message: RemoteMessage): Promise<void> {
    tcpClient.sendMessage(message);
  }

  public isHostActive(): boolean {
    return this.isHosting;
  }

  public getConnectionStatus(): ClientConnectionStatus {
    return tcpClient.getStatus();
  }

  public getConnectedDeviceName(): string | null {
    return this.connectedPeerName;
  }

  public setClientCallbacks(callbacks: ClientCallbacks): void {
    this.clientCallbacks = callbacks;
  }

  public setHostHandlers(handlers: HostHandlers): void {
    this.hostHandlers = handlers;
  }
}

export const tcpRemoteTransport = new TcpRemoteTransport();
