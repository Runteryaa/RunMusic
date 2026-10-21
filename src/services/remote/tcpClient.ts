import { AppState, type AppStateStatus } from 'react-native';
import TcpSocket from 'react-native-tcp-socket';
import { serializeNDJSON, NDJSONParser } from './ndjsonFramer';
import {
  RUNMUSIC_TCP_PORT,
  type RemoteMessage,
  type PairInitMessage,
  type PairVerifyMessage,
} from './remoteTypes';

export type ClientConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'pairing'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

export interface TCPClientCallbacks {
  onStatusChange: (status: ClientConnectionStatus, error?: string) => void;
  onPinRequired: (verifyCallback: (pin: string) => void) => void;
  onPairSuccess: (token: string) => void;
  onMessage: (message: RemoteMessage) => void;
}

class TCPClient {
  private socket: any = null;
  private parser: NDJSONParser = new NDJSONParser();

  private hostIp: string | null = null;
  private port: number = RUNMUSIC_TCP_PORT;
  private clientDeviceId: string = '';
  private clientDeviceName: string = '';
  private token: string | undefined = undefined;

  private status: ClientConnectionStatus = 'idle';
  private callbacks: TCPClientCallbacks | null = null;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDeadline: number = 0;
  private isExplicitDisconnect: boolean = false;
  private appStateSubscription: any = null;

  constructor() {
    this.setupAppStateListener();
  }

  private setupAppStateListener(): void {
    this.appStateSubscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active' && !this.isExplicitDisconnect && this.hostIp) {
        if (this.status === 'reconnecting' || this.status === 'disconnected') {
          console.log('[TCPClient] App became active; triggering silent fast-reconnect...');
          this.reconnect();
        }
      }
    });
  }

  public setCallbacks(callbacks: TCPClientCallbacks): void {
    this.callbacks = callbacks;
  }

  public getStatus(): ClientConnectionStatus {
    return this.status;
  }

  private updateStatus(status: ClientConnectionStatus, error?: string): void {
    this.status = status;
    this.callbacks?.onStatusChange(status, error);
  }

  /**
   * CONNECT TO HOST
   */
  public connect(params: {
    hostIp: string;
    port?: number;
    clientDeviceId: string;
    clientDeviceName: string;
    token?: string;
  }): void {
    // `disconnect()` clears the callback table. Preserve it here, otherwise a
    // connection started with `setCallbacks()` followed by `connect()` never
    // reports pairing/connection messages back to the remote manager.
    const callbacks = this.callbacks;
    this.disconnect();
    this.callbacks = callbacks;
    this.isExplicitDisconnect = false;

    this.hostIp = params.hostIp;
    this.port = params.port || RUNMUSIC_TCP_PORT;
    this.clientDeviceId = params.clientDeviceId;
    this.clientDeviceName = params.clientDeviceName;
    this.token = params.token;

    this.updateStatus('connecting');
    this.establishConnection();
  }

  private establishConnection(): void {
    if (!this.hostIp) return;

    try {
      this.parser.reset();
      const currentSocket = TcpSocket.createConnection(
        {
          host: this.hostIp,
          port: this.port,
        },
        () => {
          if (this.socket !== currentSocket) return;
          this.updateStatus('pairing');
          this.sendPairInit();
        }
      );
      this.socket = currentSocket;

      currentSocket.on('data', (chunk: any) => {
        if (this.socket !== currentSocket) return;
        this.parser.feed(chunk, (message: RemoteMessage) => {
          this.handleIncomingMessage(message);
        });
      });

      currentSocket.on('error', (err: any) => {
        if (this.socket !== currentSocket) return;
        console.warn('[TCPClient] Socket error:', err);
        this.handleConnectionLost(err?.message || 'Socket error');
      });

      currentSocket.on('close', () => {
        if (this.socket !== currentSocket) return;
        this.parser.reset();
        this.socket = null;
        if (!this.isExplicitDisconnect) {
          this.handleConnectionLost('Connection closed by remote host');
        }
      });
    } catch (err: any) {
      console.error('[TCPClient] Connection failed:', err);
      this.handleConnectionLost(err?.message || 'Failed to connect');
    }
  }

  private sendPairInit(): void {
    const initMsg: PairInitMessage = {
      type: 'PAIR_INIT',
      clientDeviceId: this.clientDeviceId,
      clientDeviceName: this.clientDeviceName,
      token: this.token,
    };
    this.sendMessage(initMsg);
  }

  public verifyPin(pin: string): void {
    const verifyMsg: PairVerifyMessage = {
      type: 'PAIR_VERIFY',
      clientDeviceId: this.clientDeviceId,
      pin,
    };
    this.sendMessage(verifyMsg);
  }

  private handleIncomingMessage(message: RemoteMessage): void {
    switch (message.type) {
      case 'PAIR_SUCCESS':
        this.token = message.token;
        this.reconnectDeadline = 0;
        this.updateStatus('connected');
        this.callbacks?.onPairSuccess(message.token);
        break;

      case 'PAIR_CHALLENGE_REQUIRED':
        this.updateStatus('pairing');
        this.callbacks?.onPinRequired((pin) => this.verifyPin(pin));
        break;

      case 'PAIR_FAILURE':
        this.updateStatus('error', `Pairing failed: ${message.reason}`);
        this.disconnect();
        break;

      default:
        // Forward all state sync and RPC messages to listener
        this.callbacks?.onMessage(message);
        break;
    }
  }

  private handleConnectionLost(reason: string): void {
    if (this.isExplicitDisconnect) return;

    if (this.status === 'connected') {
      // Start 30s auto-reconnect window
      this.reconnectDeadline = Date.now() + 30000;
      this.updateStatus('reconnecting');
      this.scheduleReconnect();
    } else if (this.status === 'reconnecting') {
      if (Date.now() < this.reconnectDeadline) {
        this.scheduleReconnect();
      } else {
        this.updateStatus('disconnected', 'Reconnection window expired (30s)');
        this.disconnect();
      }
    } else {
      this.updateStatus('error', reason);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnect();
    }, 2500);
  }

  private reconnect(): void {
    if (this.isExplicitDisconnect || !this.hostIp) return;
    this.cleanupSocket();
    this.establishConnection();
  }

  public sendMessage(message: RemoteMessage): void {
    if (!this.socket) {
      console.warn('[TCPClient] Cannot send message; socket not connected');
      return;
    }

    try {
      const data = serializeNDJSON(message);
      this.socket.write(data, 'utf8');
    } catch (err) {
      console.warn('[TCPClient] Write error:', err);
    }
  }

  private cleanupSocket(): void {
    if (this.socket) {
      const s = this.socket;
      this.socket = null;
      try {
        s.removeAllListeners?.();
        s.destroy?.();
      } catch {
        // ignore
      }
    }
    this.parser.reset();
  }

  public disconnect(): void {
    this.isExplicitDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanupSocket();
    this.callbacks = null;
    this.status = 'idle';
  }

  public destroy(): void {
    this.disconnect();
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
  }
}

export const tcpClient = new TCPClient();
