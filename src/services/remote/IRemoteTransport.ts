import type { RemoteMessage } from './remoteTypes';
import type { ClientConnectionStatus } from './tcpClient';

export type TransportType = 'wifi' | 'ble';

export interface DiscoveredPeer {
  id: string; // IP for Wi-Fi, BLE device ID for BLE
  deviceName: string;
  transport: TransportType;
  lastSeen: number;
  hostIp?: string;
  port?: number;
  rssi?: number;
}

export interface ClientCallbacks {
  onStatusChange: (status: ClientConnectionStatus, error?: string) => void;
  onPinRequired?: (verifyCallback: (pin: string) => void) => void;
  onPairSuccess?: (token: string) => void;
  onMessage: (message: RemoteMessage) => void;
}

export interface HostHandlers {
  onCommand: (message: RemoteMessage, clientInfo?: { deviceId: string; deviceName: string }) => void;
  onPairChallenge?: (challenge: any) => void;
  onClientConnected?: (clientInfo: { deviceId: string; deviceName: string }) => void;
}

export interface IRemoteTransport {
  readonly transportType: TransportType;

  // Host operations
  startHost(deviceName: string): Promise<void>;
  stopHost(): Promise<void>;
  broadcastState(message: RemoteMessage): Promise<void>;

  // Client operations
  startDiscovery(onPeersUpdated: (peers: DiscoveredPeer[]) => void): () => void;
  connect(peer: DiscoveredPeer, token?: string | null): Promise<void>;
  disconnect(): Promise<void>;
  sendCommand(message: RemoteMessage): Promise<void>;

  // Status accessors
  isHostActive(): boolean;
  getConnectionStatus(): ClientConnectionStatus;
  getConnectedDeviceName(): string | null;

  // Callback setters
  setClientCallbacks(callbacks: ClientCallbacks): void;
  setHostHandlers(handlers: HostHandlers): void;
}
