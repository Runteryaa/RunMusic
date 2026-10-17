import { AppState, type AppStateStatus } from 'react-native';
import { useRemoteConnectStore } from '../../store/useRemoteConnectStore';
import type { RemoteMessage } from './remoteTypes';

export const DEFAULT_RELAY_URL = 'wss://connectorelay.onrender.com/runmusic';

export interface WSHostCallbacks {
  onHosted?: (roomCode: string) => void;
  onClientConnected?: (client: { clientId: string; deviceId: string; deviceName: string }) => void;
  onClientDisconnected?: (clientId: string) => void;
  onMessage?: (message: RemoteMessage, clientId: string) => void;
  onError?: (error: string) => void;
  onClosed?: () => void;
}

export interface WSClientCallbacks {
  onJoined?: (info: { roomCode: string; hostName: string; clientId: string }) => void;
  onMessage?: (message: RemoteMessage) => void;
  onHostTemporarilyOffline?: () => void;
  onHostReconnected?: () => void;
  onError?: (error: string) => void;
  onClosed?: () => void;
}

class WSRoomClient {
  private ws: WebSocket | null = null;
  private role: 'host' | 'client' | null = null;
  private roomCode: string | null = null;
  private hostCallbacks: WSHostCallbacks | null = null;
  private clientCallbacks: WSClientCallbacks | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private isExplicitDisconnect = false;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private lastJoinPayload: any = null;

  constructor() {
    AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        this.handleAppStateActive();
      }
    });
  }

  private handleAppStateActive(): void {
    if (this.isExplicitDisconnect) return;
    if ((this.role === 'host' || this.role === 'client') && !this.isConnected()) {
      console.log('[WSRoomClient] App foregrounded & socket closed. Triggering immediate reconnect.');
      this.reconnectImmediately();
    }
  }

  private getRelayUrl(): string {
    const custom = useRemoteConnectStore.getState().customRelayUrl;
    if (custom && custom.trim().length > 0) {
      let url = custom.trim();
      if (url.startsWith('https://')) {
        url = url.replace('https://', 'wss://');
      } else if (url.startsWith('http://')) {
        url = url.replace('http://', 'ws://');
      } else if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
        url = `wss://${url}`;
      }
      try {
        const parsed = new URL(url);
        if (parsed.pathname === '/' || parsed.pathname === '') {
          parsed.pathname = '/runmusic';
        }
        return parsed.toString();
      } catch {
        if (!url.includes('/runmusic')) {
          url = url.replace(/\/+$/, '') + '/runmusic';
        }
        return url;
      }
    }
    return DEFAULT_RELAY_URL;
  }

  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  public getRole(): 'host' | 'client' | null {
    return this.role;
  }

  public getRoomCode(): string | null {
    return this.roomCode;
  }

  // ==========================================
  // HOST ROOM MANAGEMENT
  // ==========================================
  public startHostRoom(
    roomCode: string,
    deviceId: string,
    deviceName: string,
    callbacks: WSHostCallbacks
  ): void {
    this.disconnect();
    this.isExplicitDisconnect = false;
    this.role = 'host';
    this.roomCode = roomCode.toUpperCase().trim();
    this.hostCallbacks = callbacks;
    this.reconnectAttempts = 0;

    useRemoteConnectStore.getState().setInternetHostStatus('connecting');

    const payload = {
      type: 'JOIN_ROOM',
      roomCode: this.roomCode,
      role: 'host',
      deviceId,
      deviceName,
    };
    this.lastJoinPayload = payload;
    this.connectAndRegister(payload);
  }

  // ==========================================
  // CLIENT ROOM MANAGEMENT
  // ==========================================
  public joinClientRoom(
    roomCode: string,
    deviceId: string,
    deviceName: string,
    callbacks: WSClientCallbacks
  ): void {
    this.disconnect();
    this.isExplicitDisconnect = false;
    this.role = 'client';
    this.roomCode = roomCode.toUpperCase().trim();
    this.clientCallbacks = callbacks;
    this.reconnectAttempts = 0;

    const payload = {
      type: 'JOIN_ROOM',
      roomCode: this.roomCode,
      role: 'client',
      deviceId,
      deviceName,
    };
    this.lastJoinPayload = payload;
    this.connectAndRegister(payload);
  }

  private connectAndRegister(joinPayload: any): void {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }

    const url = this.getRelayUrl();

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.reconnectAttempts = 0;
          this.ws.send(JSON.stringify(joinPayload));
          this.startHeartbeat();
          if (this.role === 'host') {
            useRemoteConnectStore.getState().setInternetHostStatus('connected');
          }
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string);
          this.handleIncoming(data);
        } catch (e) {
          console.warn('[WSRoomClient] Failed to parse message:', e);
        }
      };

      this.ws.onerror = (err: any) => {
        console.warn('[WSRoomClient] Socket error:', err?.message || err);
        const errMsg = err?.message || 'İnternet bağlantı sunucusuna ulaşılamadı.';
        if (this.role === 'host') {
          useRemoteConnectStore.getState().setInternetHostStatus('connecting');
          this.hostCallbacks?.onError?.(errMsg);
        } else if (this.role === 'client') {
          this.clientCallbacks?.onError?.(errMsg);
        }
      };

      this.ws.onclose = () => {
        this.stopHeartbeat();
        this.ws = null;
        if (!this.isExplicitDisconnect) {
          if (this.role === 'host') {
            useRemoteConnectStore.getState().setInternetHostStatus('connecting');
            this.scheduleReconnect();
          } else if (this.role === 'client') {
            useRemoteConnectStore.getState().setConnectionStatus('connecting');
            this.scheduleReconnect();
          }
        }
      };
    } catch (err: any) {
      console.warn('[WSRoomClient] Connection failed to start:', err);
      if (!this.isExplicitDisconnect) {
        this.scheduleReconnect();
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.isExplicitDisconnect || !this.lastJoinPayload) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1500 * Math.pow(1.5, Math.min(this.reconnectAttempts - 1, 5)), 10000);
    console.log(`[WSRoomClient] Will attempt reconnect #${this.reconnectAttempts} in ${delay}ms`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isExplicitDisconnect && this.lastJoinPayload && !this.isConnected()) {
        console.log(`[WSRoomClient] Reconnecting now (attempt #${this.reconnectAttempts})...`);
        this.connectAndRegister(this.lastJoinPayload);
      }
    }, delay);
  }

  public reconnectImmediately(): void {
    if (this.isExplicitDisconnect || !this.lastJoinPayload) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (!this.isConnected()) {
      console.log('[WSRoomClient] Executing immediate reconnect');
      this.connectAndRegister(this.lastJoinPayload);
    }
  }

  private handleIncoming(data: any): void {
    switch (data.type) {
      case 'PONG':
        // Heartbeat ack from relay server
        break;

      case 'ROOM_HOSTED':
        useRemoteConnectStore.getState().setInternetHostStatus('connected');
        this.hostCallbacks?.onHosted?.(data.roomCode);
        break;

      case 'CLIENT_CONNECTED':
        this.hostCallbacks?.onClientConnected?.({
          clientId: data.clientId,
          deviceId: data.deviceId,
          deviceName: data.deviceName,
        });
        break;

      case 'CLIENT_DISCONNECTED':
        this.hostCallbacks?.onClientDisconnected?.(data.clientId);
        break;

      case 'ROOM_JOINED':
        this.clientCallbacks?.onJoined?.({
          roomCode: data.roomCode,
          hostName: data.hostName,
          clientId: data.clientId,
        });
        break;

      case 'HOST_TEMPORARILY_OFFLINE':
        this.clientCallbacks?.onHostTemporarilyOffline?.();
        break;

      case 'HOST_RECONNECTED':
        this.clientCallbacks?.onHostReconnected?.();
        break;

      case 'RELAY_MESSAGE':
        if (this.role === 'host') {
          this.hostCallbacks?.onMessage?.(data.payload, data.clientId);
        } else if (this.role === 'client') {
          this.clientCallbacks?.onMessage?.(data.payload);
        }
        break;

      case 'ROOM_ERROR':
        if (this.role === 'host') {
          this.hostCallbacks?.onError?.(data.error);
        } else {
          this.clientCallbacks?.onError?.(data.error);
        }
        break;

      case 'ROOM_CLOSED':
        if (this.role === 'client') {
          this.isExplicitDisconnect = true;
          this.clientCallbacks?.onClosed?.();
        }
        break;
    }
  }

  // ==========================================
  // SEND MESSAGE
  // ==========================================
  public sendFromHost(payload: RemoteMessage, targetClientId?: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(
        JSON.stringify({
          type: 'RELAY_MESSAGE',
          targetClientId,
          payload,
        })
      );
    } catch (e) {
      console.warn('[WSRoomClient] sendFromHost error:', e);
    }
  }

  public sendFromClient(payload: RemoteMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(
        JSON.stringify({
          type: 'RELAY_MESSAGE',
          payload,
        })
      );
    } catch (e) {
      console.warn('[WSRoomClient] sendFromClient error:', e);
    }
  }

  public kickClient(targetClientId: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(
        JSON.stringify({
          type: 'KICK_CLIENT',
          targetClientId,
        })
      );
    } catch (e) {
      console.warn('[WSRoomClient] kickClient error:', e);
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'PING' }));
        } catch {
          // ignore
        }
      }
    }, 20000);
  }

  private stopHeartbeat(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  public disconnect(): void {
    this.isExplicitDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    this.lastJoinPayload = null;
    this.stopHeartbeat();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    if (this.role === 'host') {
      useRemoteConnectStore.getState().setInternetHostStatus('idle');
    }
    this.role = null;
    this.roomCode = null;
    this.hostCallbacks = null;
    this.clientCallbacks = null;
  }
}

export const wsRoomClient = new WSRoomClient();
