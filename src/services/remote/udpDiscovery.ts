import dgram from 'react-native-udp';
import { Buffer } from 'buffer';
import RunMusicBlePeripheralModule from '../../../modules/runmusic-ble-peripheral';
import {
  RUNMUSIC_BEACON_PORT,
  RUNMUSIC_TCP_PORT,
  PROTOCOL_VERSION,
  type BeaconMessage,
  type DiscoveredHost,
} from './remoteTypes';

export const RUNMUSIC_MULTICAST_GROUP = '239.255.255.250';

export type DiscoveredHostsListener = (hosts: DiscoveredHost[]) => void;

let multicastLockCount = 0;

function acquireWifiMulticastLock(): void {
  multicastLockCount++;
  if (multicastLockCount === 1) {
    try {
      RunMusicBlePeripheralModule?.acquireMulticastLock();
    } catch (err) {
      console.warn('[UDPDiscovery] Failed to acquire native multicast lock:', err);
    }
  }
}

function releaseWifiMulticastLock(): void {
  if (multicastLockCount > 0) {
    multicastLockCount--;
    if (multicastLockCount === 0) {
      try {
        RunMusicBlePeripheralModule?.releaseMulticastLock();
      } catch (err) {
        console.warn('[UDPDiscovery] Failed to release native multicast lock:', err);
      }
    }
  }
}

function getBroadcastTargets(): string[] {
  const targets = new Set<string>();
  // 1. Multicast Group (works across APs supporting IGMP)
  targets.add(RUNMUSIC_MULTICAST_GROUP);

  // 2. Subnet Directed Broadcast Addresses (e.g. 192.168.1.255)
  try {
    const subnets = RunMusicBlePeripheralModule?.getSubnetBroadcastAddresses() || [];
    for (const s of subnets) {
      if (s && s.trim()) targets.add(s.trim());
    }
  } catch {
    // ignore
  }

  // 3. Fallback limited broadcast
  targets.add('255.255.255.255');
  return Array.from(targets);
}

class UDPDiscoveryService {
  private socket: any = null;
  private isSocketBound = false;
  private beaconIntervalId: ReturnType<typeof setInterval> | null = null;
  private cleanupIntervalId: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  private isHostBeaconDesired = false;
  private savedDeviceId: string | null = null;
  private savedDeviceName: string | null = null;
  private savedPort = RUNMUSIC_TCP_PORT;

  private myDeviceId: string | null = null;
  private latestBeaconPayload: Buffer | null = null;

  private discoveredHosts: Map<string, DiscoveredHost> = new Map();
  private listeners: Set<DiscoveredHostsListener> = new Set();

  private clearRetryTimer(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.isHostBeaconDesired || this.listeners.size > 0) {
        this.ensureSocket();
      }
    }, 1500);
  }

  private syncCleanupInterval(): void {
    const shouldRun = Boolean(this.socket) && this.listeners.size > 0;
    if (shouldRun && !this.cleanupIntervalId) {
      this.cleanupIntervalId = setInterval(() => {
        this.purgeExpiredHosts();
      }, 2000);
    } else if (!shouldRun && this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
  }

  /**
   * Releases the UDP socket, multicast lock and periodic timers once neither
   * host beacon nor client discovery needs them. Without this the socket kept
   * the Wi-Fi radio and a 2-second timer alive for the whole app lifetime.
   */
  private maybeTeardown(): void {
    if (this.isHostBeaconDesired || this.listeners.size > 0) {
      this.syncCleanupInterval();
      return;
    }

    this.clearRetryTimer();
    this.closeSocket();
    this.discoveredHosts.clear();
  }

  /**
   * Ensures the single unified UDP socket on RUNMUSIC_BEACON_PORT (8944)
   * is bound, broadcast enabled, and multicast group joined.
   */
  private ensureSocket(): void {
    if (this.socket) return;

    this.clearRetryTimer();

    try {
      acquireWifiMulticastLock();
      const socket: any = dgram.createSocket({ type: 'udp4', reusePort: true } as any);
      this.socket = socket;
      this.isSocketBound = false;

      socket.on('error', (err: any) => {
        console.warn('[UDPDiscovery] Socket error:', err?.message || err);
        this.closeSocket();

        // Self-heal: retry binding if either host beacon or listeners are still active
        if (this.isHostBeaconDesired || this.listeners.size > 0) {
          this.scheduleRetry();
        }
      });

      socket.on(
        'message',
        (msg: Buffer | Uint8Array | string, rinfo: { address: string; port: number }) => {
          this.handleIncomingDatagram(msg, rinfo.address, rinfo.port);
        }
      );

      socket.bind(RUNMUSIC_BEACON_PORT, () => {
        this.isSocketBound = true;
        try {
          socket.setBroadcast(true);
        } catch (e) {
          console.warn('[UDPDiscovery] Failed to setBroadcast:', e);
        }

        try {
          socket.addMembership(RUNMUSIC_MULTICAST_GROUP);
        } catch (err) {
          console.warn('[UDPDiscovery] addMembership error:', err);
        }

        // If client listeners are awaiting discovery, send an immediate probe
        if (this.listeners.size > 0) {
          this.sendProbe();
        }

        // If host beacon is active, send initial beacon
        if (this.isHostBeaconDesired && this.latestBeaconPayload) {
          this.broadcastBeaconPayload(this.latestBeaconPayload);
        }

        this.syncCleanupInterval();
      });
    } catch (err) {
      console.error('[UDPDiscovery] Failed to create socket:', err);
      // `createSocket` may throw after the multicast lock was acquired.
      this.closeSocket();
      if (this.isHostBeaconDesired || this.listeners.size > 0) {
        this.scheduleRetry();
      }
    }
  }

  private closeSocket(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }

    if (this.socket) {
      try {
        this.socket.dropMembership(RUNMUSIC_MULTICAST_GROUP);
      } catch {
        // ignore
      }
      try {
        this.socket.close();
      } catch {
        // ignore
      }
      this.socket = null;
    }
    this.isSocketBound = false;
    releaseWifiMulticastLock();
  }

  /**
   * START HOST BEACON BROADCASTER
   */
  public startHostBeacon(deviceId: string, deviceName: string, tcpPort = RUNMUSIC_TCP_PORT): void {
    this.isHostBeaconDesired = true;
    this.savedDeviceId = deviceId;
    this.savedDeviceName = deviceName;
    this.savedPort = tcpPort;
    this.myDeviceId = deviceId;

    const beaconData: BeaconMessage = {
      type: 'RUNMUSIC_BEACON',
      version: PROTOCOL_VERSION,
      deviceId,
      deviceName,
      port: tcpPort,
    };

    const payloadStr = JSON.stringify(beaconData);
    this.latestBeaconPayload = Buffer.from(payloadStr, 'utf8');

    this.ensureSocket();

    if (this.beaconIntervalId) {
      clearInterval(this.beaconIntervalId);
    }

    // Broadcast immediately and every 2 seconds
    if (this.isSocketBound && this.latestBeaconPayload) {
      this.broadcastBeaconPayload(this.latestBeaconPayload);
    }

    this.beaconIntervalId = setInterval(() => {
      if (this.isSocketBound && this.latestBeaconPayload) {
        this.broadcastBeaconPayload(this.latestBeaconPayload);
      }
    }, 2000);
  }

  /**
   * STOP HOST BEACON BROADCASTER
   */
  public stopHostBeacon(): void {
    this.isHostBeaconDesired = false;
    this.savedDeviceId = null;
    this.savedDeviceName = null;
    this.latestBeaconPayload = null;

    if (this.beaconIntervalId) {
      clearInterval(this.beaconIntervalId);
      this.beaconIntervalId = null;
    }

    this.maybeTeardown();
  }

  /**
   * START CLIENT LISTENER
   */
  public startClientListener(onHostsChanged?: DiscoveredHostsListener): () => void {
    if (onHostsChanged) {
      this.listeners.add(onHostsChanged);
      onHostsChanged(Array.from(this.discoveredHosts.values()));
    }

    this.ensureSocket();
    this.syncCleanupInterval();

    if (this.isSocketBound) {
      this.sendProbe();
    }

    return () => {
      if (onHostsChanged) {
        this.listeners.delete(onHostsChanged);
      }
      this.maybeTeardown();
    };
  }

  /**
   * STOP CLIENT LISTENER
   */
  public stopClientListener(): void {
    this.listeners.clear();
    this.maybeTeardown();
  }

  /**
   * Sends probe datagram to multicast group, subnet directed broadcast, and limited broadcast.
   */
  public sendProbe(): void {
    if (!this.socket || !this.isSocketBound) return;

    try {
      const probeBuf = Buffer.from(JSON.stringify({ type: 'RUNMUSIC_DISCOVERY_PROBE' }), 'utf8');
      const targets = getBroadcastTargets();

      for (const target of targets) {
        try {
          this.socket.send(probeBuf, 0, probeBuf.length, RUNMUSIC_BEACON_PORT, target, () => {});
        } catch {
          // ignore send error
        }
      }
    } catch {
      // ignore
    }
  }

  /**
   * Broadcasts the host beacon payload to all target broadcast addresses.
   */
  private broadcastBeaconPayload(payloadBuf: Buffer): void {
    if (!this.socket || !this.isSocketBound) return;

    const targets = getBroadcastTargets();
    for (const target of targets) {
      try {
        this.socket.send(payloadBuf, 0, payloadBuf.length, RUNMUSIC_BEACON_PORT, target, () => {});
      } catch {
        // ignore send error
      }
    }
  }

  private handleIncomingDatagram(
    rawMsg: Buffer | Uint8Array | string,
    remoteAddress: string,
    remotePort: number
  ): void {
    try {
      const text = typeof rawMsg === 'string' ? rawMsg : Buffer.from(rawMsg).toString('utf8');
      const data = JSON.parse(text);

      if (data && data.type === 'RUNMUSIC_DISCOVERY_PROBE') {
        // A client is probing. If this device is acting as a Host, reply IMMEDIATELY:
        if (this.isHostBeaconDesired && this.latestBeaconPayload && this.socket && this.isSocketBound) {
          // 1. Direct UNICAST reply to client's IP on RUNMUSIC_BEACON_PORT (bypasses all router broadcast blocks!)
          try {
            this.socket.send(
              this.latestBeaconPayload,
              0,
              this.latestBeaconPayload.length,
              RUNMUSIC_BEACON_PORT,
              remoteAddress,
              () => {}
            );
          } catch {
            // ignore
          }
          // 2. Also send to multicast group
          try {
            this.socket.send(
              this.latestBeaconPayload,
              0,
              this.latestBeaconPayload.length,
              RUNMUSIC_BEACON_PORT,
              RUNMUSIC_MULTICAST_GROUP,
              () => {}
            );
          } catch {
            // ignore
          }
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
      // Ignore malformed packets from other network services
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
        console.warn('[UDPDiscovery] Listener error:', err);
      }
    }
  }
}

export const udpDiscoveryService = new UDPDiscoveryService();
