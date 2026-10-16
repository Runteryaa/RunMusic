import dgram from 'react-native-udp';
import { Buffer } from 'buffer';
import {
  RUNMUSIC_BEACON_PORT,
  RUNMUSIC_TCP_PORT,
  PROTOCOL_VERSION,
  type BeaconMessage,
  type DiscoveredHost,
} from './remoteTypes';

export const RUNMUSIC_MULTICAST_GROUP = '239.255.255.250';

export type DiscoveredHostsListener = (hosts: DiscoveredHost[]) => void;

class UDPDiscoveryService {
  private broadcastSocket: any = null;
  private listenSocket: any = null;
  private beaconIntervalId: ReturnType<typeof setInterval> | null = null;
  private cleanupIntervalId: ReturnType<typeof setInterval> | null = null;
  private delayedCloseTimeout: ReturnType<typeof setTimeout> | null = null;

  private isHostBeaconDesired = false;
  private savedDeviceId: string | null = null;
  private savedDeviceName: string | null = null;
  private savedPort = RUNMUSIC_TCP_PORT;

  private myDeviceId: string | null = null;
  private latestBeaconPayload: Buffer | null = null;

  private discoveredHosts: Map<string, DiscoveredHost> = new Map();
  private listeners: Set<DiscoveredHostsListener> = new Set();

  /**
   * START HOST BEACON BROADCASTER
   * Periodically broadcasts discovery beacon on 239.255.255.250 (Multicast) & 255.255.255.255 (Broadcast)
   */
  public startHostBeacon(deviceId: string, deviceName: string, tcpPort = RUNMUSIC_TCP_PORT): void {
    this.isHostBeaconDesired = true;
    this.savedDeviceId = deviceId;
    this.savedDeviceName = deviceName;
    this.savedPort = tcpPort;

    this.stopHostBeaconSocketOnly();
    this.myDeviceId = deviceId;

    try {
      const socket: any = dgram.createSocket({ type: 'udp4' } as any);
      this.broadcastSocket = socket;

      socket.on('error', (err: any) => {
        console.warn('[UDPDiscovery] Host beacon socket error:', err);
        this.stopHostBeaconSocketOnly();
        // Self-heal: recover socket after 2s if host is still desired
        if (this.isHostBeaconDesired && this.savedDeviceId && this.savedDeviceName) {
          setTimeout(() => {
            if (this.isHostBeaconDesired && this.savedDeviceId && this.savedDeviceName) {
              this.startHostBeacon(this.savedDeviceId, this.savedDeviceName, this.savedPort);
            }
          }, 2000);
        }
      });

      // Bind to random port to broadcast
      socket.bind(0, () => {
        try {
          socket.setBroadcast(true);
        } catch (e) {
          console.warn('[UDPDiscovery] Failed to setBroadcast:', e);
        }

        const beaconData: BeaconMessage = {
          type: 'RUNMUSIC_BEACON',
          version: PROTOCOL_VERSION,
          deviceId,
          deviceName,
          port: tcpPort,
        };

        const payloadStr = JSON.stringify(beaconData);
        const payloadBuf = Buffer.from(payloadStr, 'utf8');
        this.latestBeaconPayload = payloadBuf;

        // Broadcast immediately once
        this.sendBeacon(socket, payloadBuf);

        // Then every 2 seconds
        this.beaconIntervalId = setInterval(() => {
          this.sendBeacon(socket, payloadBuf);
        }, 2000);
      });
    } catch (err) {
      console.error('[UDPDiscovery] Failed to start host beacon:', err);
    }
  }

  public sendBeacon(socket: any, payloadBuf: Buffer): void {
    if (!socket) return;

    // 1. Send via Multicast group (239.255.255.250) - works even if router drops 255.255.255.255
    try {
      socket.send(payloadBuf, 0, payloadBuf.length, RUNMUSIC_BEACON_PORT, RUNMUSIC_MULTICAST_GROUP, (err: any) => {
        if (err) {
          console.warn('[UDPDiscovery] Multicast beacon error:', err?.message || err);
        }
      });
    } catch (err) {
      console.warn('[UDPDiscovery] Multicast beacon exception:', err);
    }

    // 2. Also send via Limited Broadcast (255.255.255.255)
    try {
      socket.send(payloadBuf, 0, payloadBuf.length, RUNMUSIC_BEACON_PORT, '255.255.255.255', (err: any) => {
        if (err) {
          console.warn('[UDPDiscovery] Broadcast beacon error:', err?.message || err);
        }
      });
    } catch (err) {
      console.warn('[UDPDiscovery] Broadcast beacon exception:', err);
    }
  }

  private stopHostBeaconSocketOnly(): void {
    if (this.beaconIntervalId) {
      clearInterval(this.beaconIntervalId);
      this.beaconIntervalId = null;
    }
    if (this.broadcastSocket) {
      try {
        this.broadcastSocket.close();
      } catch {
        // ignore
      }
      this.broadcastSocket = null;
    }
    this.latestBeaconPayload = null;
  }

  /**
   * STOP HOST BEACON BROADCASTER
   */
  public stopHostBeacon(): void {
    this.isHostBeaconDesired = false;
    this.savedDeviceId = null;
    this.savedDeviceName = null;
    this.stopHostBeaconSocketOnly();
  }

  /**
   * START CLIENT LISTENER
   * Listens for beacons on port 8944 and aggregates discovered hosts
   */
  public startClientListener(onHostsChanged?: DiscoveredHostsListener): () => void {
    // Cancel any pending delayed socket teardown
    if (this.delayedCloseTimeout) {
      clearTimeout(this.delayedCloseTimeout);
      this.delayedCloseTimeout = null;
    }

    if (onHostsChanged) {
      this.listeners.add(onHostsChanged);
      onHostsChanged(Array.from(this.discoveredHosts.values()));
    }

    this.ensureListenSocket();

    // Return unbind/unsubscribe callback
    return () => {
      if (onHostsChanged) {
        this.listeners.delete(onHostsChanged);
      }
      if (this.listeners.size === 0) {
        // Keep listen socket warm for 15 seconds to avoid EADDRINUSE on immediate reopen
        if (this.delayedCloseTimeout) {
          clearTimeout(this.delayedCloseTimeout);
        }
        this.delayedCloseTimeout = setTimeout(() => {
          if (this.listeners.size === 0) {
            this.stopClientListener();
          }
        }, 15000);
      }
    };
  }

  private ensureListenSocket(): void {
    if (!this.listenSocket) {
      try {
        const socket: any = dgram.createSocket({ type: 'udp4' } as any);
        this.listenSocket = socket;

        socket.on('error', (err: any) => {
          console.warn('[UDPDiscovery] Client listener socket error:', err);
          try {
            socket.close();
          } catch {
            // ignore
          }
          if (this.listenSocket === socket) {
            this.listenSocket = null;
          }
          // Self-heal: if listeners active, retry binding after 1.5s
          if (this.listeners.size > 0 && !this.listenSocket) {
            setTimeout(() => {
              if (this.listeners.size > 0 && !this.listenSocket) {
                this.ensureListenSocket();
              }
            }, 1500);
          }
        });

        socket.on('message', (msg: Buffer | Uint8Array | string, rinfo: { address: string; port: number }) => {
          this.handleIncomingDatagram(msg, rinfo.address);
        });

        socket.bind(RUNMUSIC_BEACON_PORT, () => {
          try {
            socket.setBroadcast(true);
          } catch {
            // ignore
          }

          try {
            socket.addMembership(RUNMUSIC_MULTICAST_GROUP);
          } catch (err) {
            console.warn('[UDPDiscovery] addMembership error:', err);
          }

          // Probe immediately so active hosts reply without waiting for 2s timer
          this.sendProbe(socket);
        });

        if (!this.cleanupIntervalId) {
          this.cleanupIntervalId = setInterval(() => {
            this.purgeExpiredHosts();
          }, 2000);
        }
      } catch (err) {
        console.error('[UDPDiscovery] Failed to start client listener:', err);
      }
    } else {
      // Listener already open, send an immediate probe
      this.sendProbe(this.listenSocket);
    }
  }

  public sendProbe(socket: any = null): void {
    const s = socket || this.listenSocket || this.broadcastSocket;
    if (!s) return;
    try {
      const probeBuf = Buffer.from(JSON.stringify({ type: 'RUNMUSIC_DISCOVERY_PROBE' }), 'utf8');
      s.send(probeBuf, 0, probeBuf.length, RUNMUSIC_BEACON_PORT, RUNMUSIC_MULTICAST_GROUP, () => {});
      s.send(probeBuf, 0, probeBuf.length, RUNMUSIC_BEACON_PORT, '255.255.255.255', () => {});
    } catch {
      // ignore
    }
  }

  private handleIncomingDatagram(rawMsg: Buffer | Uint8Array | string, remoteAddress: string): void {
    try {
      const text = typeof rawMsg === 'string' ? rawMsg : Buffer.from(rawMsg).toString('utf8');
      const data = JSON.parse(text);

      if (data && data.type === 'RUNMUSIC_DISCOVERY_PROBE') {
        // If this device is acting as a host and has a broadcast socket, respond immediately
        if (this.broadcastSocket && this.latestBeaconPayload) {
          this.sendBeacon(this.broadcastSocket, this.latestBeaconPayload);
        }
        return;
      }

      if (data && data.type === 'RUNMUSIC_BEACON' && data.deviceId) {
        // Ignore self-beacons
        if (this.myDeviceId && data.deviceId === this.myDeviceId) {
          return;
        }

        const host: DiscoveredHost = {
          deviceId: data.deviceId,
          deviceName: data.deviceName || 'RunMusic Host',
          hostIp: remoteAddress,
          port: data.port || RUNMUSIC_TCP_PORT,
          lastSeen: Date.now(),
        };

        this.discoveredHosts.set(host.deviceId, host);
        this.notifyListeners();
      }
    } catch {
      // Ignore malformed packets from other local network services
    }
  }

  private purgeExpiredHosts(): void {
    const now = Date.now();
    let hasChanges = false;

    for (const [id, host] of this.discoveredHosts.entries()) {
      if (now - host.lastSeen > 8000) {
        this.discoveredHosts.delete(id);
        hasChanges = true;
      }
    }

    if (hasChanges) {
      this.notifyListeners();
    }
  }

  private notifyListeners(): void {
    const list = Array.from(this.discoveredHosts.values());
    for (const listener of this.listeners) {
      try {
        listener(list);
      } catch (err) {
        console.warn('[UDPDiscovery] Listener notification error:', err);
      }
    }
  }

  /**
   * STOP CLIENT LISTENER
   */
  public stopClientListener(): void {
    if (this.delayedCloseTimeout) {
      clearTimeout(this.delayedCloseTimeout);
      this.delayedCloseTimeout = null;
    }
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
    if (this.listenSocket) {
      try {
        this.listenSocket.dropMembership(RUNMUSIC_MULTICAST_GROUP);
      } catch {
        // ignore
      }
      try {
        this.listenSocket.close();
      } catch {
        // ignore
      }
      this.listenSocket = null;
    }
    this.discoveredHosts.clear();
    this.notifyListeners();
  }
}

export const udpDiscoveryService = new UDPDiscoveryService();
