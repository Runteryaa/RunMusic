import * as FileSystem from 'expo-file-system/legacy';
import TrackPlayer, {
  Event,
  State,
  type Track,
} from 'react-native-track-player';
import { tcpHostServer, type PendingPairChallenge } from './tcpHostServer';
import { tcpClient, type ClientConnectionStatus } from './tcpClient';
import { udpDiscoveryService } from './udpDiscovery';
import { useRemoteConnectStore } from '../../store/useRemoteConnectStore';
import { useStore } from '../../store/useStore';
import { useThemeStore } from '../../store/useThemeStore';
import { getArtworkAsync } from '../../../modules/audio-artwork/src';
import {
  skipToPreviousTrack,
  moveUpNext,
  removeQueueItem,
  setShuffle,
  startPlaybackFromLibrary,
  type QueueTrack,
} from '../queueController';
import { findLyricsInCache } from '../persistSanitize';
import {
  parseAnySyncedLyrics,
  getLyricsCacheKeys,
  fetchLyricsOnline,
  resolveCandidateToLyricsResult,
  cleanDisplayTitle,
  getSearchKeywords,
  type LyricLine,
} from '../lyricsService';
import { remoteMediaNotification } from './remoteMediaNotification';
import { blePeripheralService } from './blePeripheralService';
import { bleCentralService } from './bleCentralService';
import type { DiscoveredPeer } from './IRemoteTransport';
import type {
  RemoteMessage,
  RemoteTrackSummary,
  RemoteLyricsSummary,
  InitialStateMessage,
  PositionSyncMessage,
  StateChangeMessage,
  TrackChangeMessage,
  LyricsSyncMessage,
  ActiveArtworkSyncMessage,
  QueueSyncMessage,
  LibraryQueryMessage,
  LibraryResultMessage,
  CommandSelectLyricsMessage,
  CommandPlayTrackMessage,
  DiscoveredHost,
  TrustedClient,
} from './remoteTypes';
import { wsRoomClient } from './wsRoomClient';

class RemoteSyncManager {
  private isHostActive = false;
  private activeClientTransport: 'wifi' | 'ble' | 'internet' = 'wifi';
  private hostSubscriptions: (() => void)[] = [];
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pendingLibraryQueries: Map<
    string,
    { resolve: (res: LibraryResultMessage) => void; reject: (err: any) => void; timer: ReturnType<typeof setTimeout> }
  > = new Map();

  private broadcastToAll(message: RemoteMessage): void {
    tcpHostServer.broadcast(message);
    if (message.type !== 'ACTIVE_ARTWORK_SYNC' && message.type !== 'QUEUE_SYNC') {
      if (message.type === 'TRACK_CHANGE') {
        const bleMsg = { ...message, lyrics: null };
        blePeripheralService.broadcast(bleMsg).catch(() => {});
      } else {
        blePeripheralService.broadcast(message).catch(() => {});
      }
    }
    if (wsRoomClient.isConnected() && wsRoomClient.getRole() === 'host') {
      wsRoomClient.sendFromHost(message);
    }
  }

  // ==========================================
  // HOST MANAGEMENT
  // ==========================================

  public getIsHostActive(): boolean {
    return this.isHostActive;
  }

  public getActiveClientTransport(): 'wifi' | 'ble' | 'internet' {
    return this.activeClientTransport;
  }

  public async startHostService(): Promise<void> {
    if (this.isHostActive) return;

    const deviceName = useRemoteConnectStore.getState().customDeviceName;
    const deviceId = useRemoteConnectStore.getState().localDeviceId;

    // Configure TCP Server Handlers
    tcpHostServer.setHandlers({
      validateToken: (token: string, clientDeviceId: string) => {
        const trusted = useRemoteConnectStore.getState().trustedDevices;
        return trusted.some((c) => c.token === token && (c.deviceId === clientDeviceId || !c.deviceId));
      },

      generateToken: (clientDeviceId: string, clientDeviceName: string) => {
        const token = `token_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const client: TrustedClient = {
          deviceId: clientDeviceId,
          deviceName: clientDeviceName,
          token,
          lastConnected: Date.now(),
        };
        useRemoteConnectStore.getState().addTrustedDevice(client);
        return token;
      },

      onPairChallenge: (challenge: PendingPairChallenge) => {
        useRemoteConnectStore.getState().setPendingPairChallenge(challenge);
      },

      onClientAuthorized: async (clientSocket, clientInfo) => {
        useRemoteConnectStore.getState().addConnectedClient({
          id: clientInfo.id,
          deviceId: clientInfo.deviceId,
          deviceName: clientInfo.deviceName,
          transport: 'wifi',
          connectedAt: Date.now(),
        });

        // Send initial state dump immediately
        const initialState = await this.buildHostInitialState();
        tcpHostServer.sendToClient(clientSocket, initialState);

        // Also send active artwork if present
        const activeTrack = await TrackPlayer.getActiveTrack();
        if (activeTrack) {
          const artworkBase64 = await this.getCompressedArtworkBase64(activeTrack.id, activeTrack.url);
          if (artworkBase64) {
            const artworkMsg: ActiveArtworkSyncMessage = {
              type: 'ACTIVE_ARTWORK_SYNC',
              trackId: activeTrack.id,
              base64: artworkBase64,
            };
            tcpHostServer.sendToClient(clientSocket, artworkMsg);
          }
        }
      },

      onClientDisconnected: (clientId) => {
        useRemoteConnectStore.getState().removeConnectedClient(clientId);
      },

      onCommand: (message, clientSocket) => {
        this.handleHostCommand(message, clientSocket);
      },
    });

    // Start TCP server & UDP beacon & BLE peripheral
    tcpHostServer.startServer();
    udpDiscoveryService.startHostBeacon(deviceId, deviceName);

    blePeripheralService.setHandlers({
      onCommand: (msg) => {
        this.handleHostCommand(msg, null);
      },
      onClientSubscribed: async () => {
        useRemoteConnectStore.getState().addConnectedClient({
          id: 'ble_client',
          deviceId: 'ble_central',
          deviceName: 'Bluetooth Kumandası',
          transport: 'ble',
          connectedAt: Date.now(),
        });
        const initialState = await this.buildHostInitialState(true);
        blePeripheralService.broadcast(initialState).catch(() => {});
      },
    });

    blePeripheralService.startHost(deviceName).catch((err) => {
      console.warn('[RemoteSyncManager] BLE peripheral startHost failed:', err);
    });

    // Start internet host room if code exists or generate one
    const roomCode = useRemoteConnectStore.getState().internetRoomCode || `RUN-${Math.floor(1000 + Math.random() * 9000)}`;
    this.startInternetHostRoom(roomCode).catch((err) => {
      console.warn('[RemoteSyncManager] Internet host start failed:', err);
    });

    useRemoteConnectStore.getState().setMode('host');
    this.isHostActive = true;

    // Attach Host playback listeners
    this.attachHostListeners();
  }

  public stopHostService(): void {
    if (!this.isHostActive) return;

    this.detachHostListeners();
    tcpHostServer.stopServer();
    udpDiscoveryService.stopHostBeacon();
    blePeripheralService.stopHost().catch(() => {});
    this.stopInternetHostRoom();

    useRemoteConnectStore.getState().clearConnectedClients();
    useRemoteConnectStore.getState().setMode('idle');
    this.isHostActive = false;
  }

  private attachHostListeners(): void {
    this.detachHostListeners();

    // 1. Track change
    const subTrack = TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, async (event) => {
      if (!this.isHostActive || useRemoteConnectStore.getState().mode === 'client') return;
      const track = event.track ?? null;
      if (track?.id?.startsWith('remote_')) return;
      const trackSummary = track ? this.formatTrackSummary(track) : null;
      const lyricsSummary = track ? this.formatLyricsSummary(track) : null;

      const trackChangeMsg: TrackChangeMessage = {
        type: 'TRACK_CHANGE',
        track: trackSummary,
        lyrics: lyricsSummary,
      };
      this.broadcastToAll(trackChangeMsg);

      // Immediately synchronize position 0 on track change so client slider advances in real time without lag
      if (trackSummary) {
        const initialPosMsg: PositionSyncMessage = {
          type: 'POSITION_SYNC',
          position: 0,
          duration: trackSummary.duration > 0 ? trackSummary.duration : undefined,
          isPlaying: true,
          playbackRate: 1.0,
        };
        this.broadcastToAll(initialPosMsg);
      }

      this.broadcastQueueSync();

      if (track) {
        // If lyrics not in cache and autoFetchLyrics is enabled, fetch in background and broadcast
        if (!lyricsSummary && useStore.getState().preferences?.autoFetchLyrics) {
          const meta = useStore.getState().metadataMap[track.id];
          const title = meta?.title || track.title || '';
          const artist = meta?.artist || track.artist || '';
          if (title) {
            fetchLyricsOnline(title, artist, useStore.getState().preferences.lyricsSourcePreference)
              .then((result) => {
                if (result) {
                  const altKeys = getLyricsCacheKeys({
                    id: track.id,
                    url: track.url,
                    title,
                    artist,
                    rawTitle: track.title,
                  });
                  useStore.getState().setLyrics(track.id, result, altKeys);
                  const updated = this.formatLyricsSummary(track);
                  if (updated) {
                    const lyricsMsg: LyricsSyncMessage = {
                      type: 'LYRICS_SYNC',
                      trackId: track.id,
                      lyrics: updated,
                    };
                    this.broadcastToAll(lyricsMsg);
                  }
                }
              })
              .catch((err) => {
                console.warn('[RemoteSyncManager] Background host lyrics fetch error:', err);
              });
          }
        }

        const artworkBase64 = await this.getCompressedArtworkBase64(track.id, track.url);
        if (artworkBase64) {
          const artMsg: ActiveArtworkSyncMessage = {
            type: 'ACTIVE_ARTWORK_SYNC',
            trackId: track.id,
            base64: artworkBase64,
          };
          this.broadcastToAll(artMsg);
        }
      }
    });

    // 2. Playback state change
    const subState = TrackPlayer.addEventListener(Event.PlaybackState, async (event) => {
      if (!this.isHostActive || useRemoteConnectStore.getState().mode === 'client') return;
      const isPlaying = event.state === State.Playing;
      const progress = await TrackPlayer.getProgress();
      const repeatMode = await TrackPlayer.getRepeatMode();
      const isShuffle = useStore.getState().isShuffle;

      const stateMsg: StateChangeMessage = {
        type: 'STATE_CHANGE',
        isPlaying,
        repeatMode,
        isShuffle,
      };
      this.broadcastToAll(stateMsg);

      const posMsg: PositionSyncMessage = {
        type: 'POSITION_SYNC',
        position: progress.position,
        duration: progress.duration > 0 ? progress.duration : undefined,
        isPlaying,
        playbackRate: 1.0,
      };
      this.broadcastToAll(posMsg);
    });

    // 3. Store change listener for isShuffle & repeatMode on Host
    let lastShuffle = useStore.getState().isShuffle;
    let lastRepeat = useStore.getState().repeatMode;
    const unsubStore = useStore.subscribe((state) => {
      if (!this.isHostActive) return;
      if (state.isShuffle !== lastShuffle || state.repeatMode !== lastRepeat) {
        lastShuffle = state.isShuffle;
        lastRepeat = state.repeatMode;
        this.broadcastStateChange();
        this.broadcastQueueSync();
      }
    });

    this.hostSubscriptions = [
      () => subTrack.remove(),
      () => subState.remove(),
      () => unsubStore(),
    ];

    // 3. High-accuracy position heartbeat (every 1500ms while active)
    this.heartbeatTimer = setInterval(async () => {
      if (!this.isHostActive || useRemoteConnectStore.getState().mode === 'client') return;
      try {
        const playback = await TrackPlayer.getPlaybackState();
        const isPlaying = playback.state === State.Playing;
        if (isPlaying) {
          const progress = await TrackPlayer.getProgress();
          const posMsg: PositionSyncMessage = {
            type: 'POSITION_SYNC',
            position: progress.position,
            duration: progress.duration > 0 ? progress.duration : undefined,
            isPlaying: true,
            playbackRate: 1.0,
          };
          this.broadcastToAll(posMsg);
        }
      } catch {
        // ignore
      }
    }, 1500);
  }

  private detachHostListeners(): void {
    for (const unsub of this.hostSubscriptions) {
      try {
        unsub();
      } catch {
        // ignore
      }
    }
    this.hostSubscriptions = [];

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async buildHostInitialState(isBle = false): Promise<InitialStateMessage> {
    const activeTrack = await TrackPlayer.getActiveTrack();
    const playback = await TrackPlayer.getPlaybackState();
    const progress = await TrackPlayer.getProgress();
    const repeatMode = await TrackPlayer.getRepeatMode();
    const isShuffle = useStore.getState().isShuffle;

    const trackSummary = activeTrack ? this.formatTrackSummary(activeTrack) : null;
    if (trackSummary && trackSummary.duration <= 0 && progress.duration > 0) {
      trackSummary.duration = progress.duration;
    }

    // BLE is a dedicated media remote: omit queue and lyrics payloads (< 200 bytes per message)
    if (isBle) {
      return {
        type: 'INITIAL_STATE',
        activeTrack: trackSummary,
        isPlaying: playback.state === State.Playing,
        playbackRate: 1.0,
        position: progress.position,
        repeatMode,
        isShuffle,
        queue: [],
        upNext: [],
        lyrics: null,
      };
    }

    const lyricsSummary = activeTrack ? this.formatLyricsSummary(activeTrack) : null;

    // Build queue summaries for Wi-Fi (TCP) clients
    const queueTracks = await TrackPlayer.getQueue();
    const queueSummaries = queueTracks.map((t) => this.formatTrackSummary(t));

    const allAssets = useStore.getState().allAssets;
    const upNextIds = useStore.getState().upNextIds;
    const upNextSummaries: RemoteTrackSummary[] = [];

    for (const id of upNextIds) {
      const asset = allAssets.find((a) => a.id === id);
      if (asset) {
        upNextSummaries.push(this.formatAssetSummary(asset));
      } else {
        const qTrack = queueTracks.find((t) => t.id === id);
        if (qTrack) {
          upNextSummaries.push(this.formatTrackSummary(qTrack));
        }
      }
    }

    return {
      type: 'INITIAL_STATE',
      activeTrack: trackSummary,
      isPlaying: playback.state === State.Playing,
      playbackRate: 1.0,
      position: progress.position,
      repeatMode,
      isShuffle,
      queue: queueSummaries,
      upNext: upNextSummaries,
      lyrics: lyricsSummary,
    };
  }

  public async broadcastStateChange(): Promise<void> {
    if (!this.isHostActive) return;
    try {
      const playback = await TrackPlayer.getPlaybackState();
      const isPlaying = playback.state === State.Playing;
      const repeatMode = await TrackPlayer.getRepeatMode();
      const isShuffle = useStore.getState().isShuffle;

      const stateMsg: StateChangeMessage = {
        type: 'STATE_CHANGE',
        isPlaying,
        repeatMode,
        isShuffle,
      };
      this.broadcastToAll(stateMsg);
    } catch (e) {
      console.warn('[RemoteSyncManager] broadcastStateChange error:', e);
    }
  }

  public broadcastQueueSync(): void {
    if (!this.isHostActive) return;
    TrackPlayer.getQueue().then((queueTracks) => {
      const queueSummaries = queueTracks.map((t) => this.formatTrackSummary(t));
      const allAssets = useStore.getState().allAssets;
      const upNextIds = useStore.getState().upNextIds;
      const upNextSummaries: RemoteTrackSummary[] = [];

      for (const id of upNextIds) {
        const asset = allAssets.find((a) => a.id === id);
        if (asset) {
          upNextSummaries.push(this.formatAssetSummary(asset));
        } else {
          const qTrack = queueTracks.find((t) => t.id === id);
          if (qTrack) {
            upNextSummaries.push(this.formatTrackSummary(qTrack));
          }
        }
      }

      const queueSync: QueueSyncMessage = {
        type: 'QUEUE_SYNC',
        queue: queueSummaries,
        upNext: upNextSummaries,
      };
      this.broadcastToAll(queueSync);
    });
  }

  private handleHostCommand(msg: RemoteMessage, clientSocket: any, wsClientId?: string): void {
    switch (msg.type) {
      case 'COMMAND_PLAY':
        TrackPlayer.play();
        break;

      case 'COMMAND_PAUSE':
        TrackPlayer.pause();
        break;

      case 'COMMAND_SKIP_NEXT':
        TrackPlayer.skipToNext()
          .then(() => TrackPlayer.play())
          .catch((err) => {
            console.warn('[RemoteSyncManager] Host skipToNext error:', err);
          });
        break;

      case 'COMMAND_SKIP_PREVIOUS':
        skipToPreviousTrack()
          .then(() => TrackPlayer.play())
          .catch((err) => {
            console.warn('[RemoteSyncManager] Host skipToPrevious error:', err);
          });
        break;

      case 'COMMAND_SEEK':
        TrackPlayer.seekTo(msg.position);
        break;

      case 'COMMAND_SET_SHUFFLE':
        setShuffle(msg.enabled)
          .then(() => {
            this.broadcastStateChange();
            this.broadcastQueueSync();
          })
          .catch((err) => {
            console.warn('[RemoteSyncManager] Host setShuffle error:', err);
          });
        break;

      case 'COMMAND_SET_REPEAT':
        TrackPlayer.setRepeatMode(msg.mode)
          .then(() => {
            useStore.getState().setRepeatMode(msg.mode);
            this.broadcastStateChange();
          })
          .catch((err) => {
            console.warn('[RemoteSyncManager] Host setRepeatMode error:', err);
          });
        break;

      case 'COMMAND_QUEUE_MOVE':
        moveUpNext(msg.fromIndex, msg.toIndex)
          .then(() => {
            this.broadcastQueueSync();
          })
          .catch((err) => {
            console.warn('[RemoteSyncManager] Host moveUpNext error:', err);
          });
        break;

      case 'COMMAND_QUEUE_REMOVE':
        if (msg.trackId) {
          TrackPlayer.getQueue().then(async (queueTracks) => {
            const index = queueTracks.findIndex(
              (t) => t.id === msg.trackId || (t as any).url === msg.trackId
            );
            if (index !== -1) {
              await removeQueueItem(index);
              this.broadcastQueueSync();
            }
          });
        } else if (typeof msg.trackIndex === 'number') {
          removeQueueItem(msg.trackIndex).then(() => {
            this.broadcastQueueSync();
          });
        }
        break;

      case 'COMMAND_PLAY_TRACK':
        this.handlePlayTrackCommand(msg);
        break;

      case 'COMMAND_PLAY_LIBRARY_TRACK':
        this.playHostLibraryTrack(msg.trackId, msg.title, msg.artist);
        break;

      case 'LIBRARY_QUERY':
        this.handleLibraryQuery(msg, clientSocket, wsClientId);
        break;

      case 'REQUEST_ARTWORK':
        this.handleArtworkRequest(msg.trackId, clientSocket, wsClientId);
        break;

      case 'COMMAND_SELECT_LYRICS':
        this.handleClientSelectLyrics(msg);
        break;

      case 'COMMAND_GET_STATE':
        if (wsClientId) {
          this.buildHostInitialState(false).then((state) => {
            wsRoomClient.sendFromHost(state, wsClientId);
          });
        } else if (clientSocket) {
          this.buildHostInitialState(false).then((state) => {
            tcpHostServer.sendToClient(clientSocket, state);
          });
        } else {
          this.buildHostInitialState(true).then((state) => {
            blePeripheralService.broadcast(state).catch(() => {});
          });
        }
        break;
    }
  }

  private handleClientSelectLyrics(msg: CommandSelectLyricsMessage): void {
    resolveCandidateToLyricsResult(msg.candidate as any).then((result) => {
      if (result) {
        const allAssets = useStore.getState().allAssets;
        const track = allAssets.find((a) => a.id === msg.trackId);
        const meta = useStore.getState().metadataMap[msg.trackId];
        const altKeys = getLyricsCacheKeys({
          id: msg.trackId,
          url: track?.uri,
          title: meta?.title || msg.candidate.trackName,
          artist: meta?.artist || msg.candidate.artistName,
          rawTitle: track?.filename,
        });
        useStore.getState().setLyrics(msg.trackId, result, altKeys);
        this.broadcastLyricsUpdate(msg.trackId);
      }
    });
  }

  private handleLibraryQuery(msg: LibraryQueryMessage, clientSocket: any, wsClientId?: string): void {
    const store = useStore.getState();
    const allAssets = store.allAssets.length > 0 ? store.allAssets : store.library;
    const metadataMap = store.metadataMap;
    const search = (msg.search || '').trim().toLowerCase();

    let filtered = allAssets;
    if (search) {
      filtered = allAssets.filter((a) => {
        const meta = metadataMap[a.id];
        const title = (meta?.title || a.filename || '').toLowerCase();
        const artist = (meta?.artist || '').toLowerCase();
        return title.includes(search) || artist.includes(search);
      });
    }

    const totalCount = filtered.length;
    const sliced = filtered.slice(msg.offset, msg.offset + msg.limit);
    const summaries = sliced.map((a) => this.formatAssetSummary(a));

    const response: LibraryResultMessage = {
      type: 'LIBRARY_RESULT',
      requestId: msg.requestId,
      tracks: summaries,
      totalCount,
      hasMore: msg.offset + msg.limit < totalCount,
    };

    if (wsClientId) {
      wsRoomClient.sendFromHost(response, wsClientId);
    } else if (clientSocket) {
      tcpHostServer.sendToClient(clientSocket, response);
    }
  }

  private async handlePlayTrackCommand(msg: CommandPlayTrackMessage): Promise<void> {
    try {
      const queue = await TrackPlayer.getQueue();
      let targetIndex = -1;

      // 1. Try to find track in active queue by ID
      if (msg.trackId) {
        targetIndex = queue.findIndex(
          (t) => t.id === msg.trackId || (t as any).url === msg.trackId
        );
      }

      // 2. Try to find by title & artist match (if IDs differ between devices)
      if (targetIndex === -1 && msg.title) {
        const normTitle = msg.title.trim().toLowerCase();
        const normArtist = (msg.artist || '').trim().toLowerCase();
        targetIndex = queue.findIndex((t) => {
          const tTitle = (t.title || '').trim().toLowerCase();
          const tArtist = (t.artist || '').trim().toLowerCase();
          return tTitle === normTitle && (!normArtist || tArtist === normArtist);
        });
      }

      // 3. Fallback to trackIndex if within bounds
      if (
        targetIndex === -1 &&
        typeof msg.trackIndex === 'number' &&
        msg.trackIndex >= 0 &&
        msg.trackIndex < queue.length
      ) {
        targetIndex = msg.trackIndex;
      }

      if (targetIndex >= 0) {
        await TrackPlayer.skip(targetIndex);
        await TrackPlayer.play();
        return;
      }

      // 4. If not found in active queue, check if it exists in host's library
      if (msg.trackId) {
        await this.playHostLibraryTrack(msg.trackId, msg.title, msg.artist);
      }
    } catch (e) {
      console.warn('[RemoteSyncManager] handlePlayTrackCommand error:', e);
    }
  }

  private async playHostLibraryTrack(trackId: string, title?: string, artist?: string): Promise<void> {
    const store = useStore.getState();
    const assets = store.allAssets.length > 0 ? store.allAssets : store.library;
    const metadataMap = store.metadataMap;
    const artworkMap = store.artworkMap;

    let asset = assets.find((a) => a.id === trackId || a.uri === trackId);

    // If ID didn't match, search by title & artist
    if (!asset && title) {
      const normTitle = title.trim().toLowerCase();
      const normArtist = (artist || '').trim().toLowerCase();
      asset = assets.find((a) => {
        const meta = metadataMap[a.id];
        const aTitle = (meta?.title || a.filename || '').trim().toLowerCase();
        const aArtist = (meta?.artist || '').trim().toLowerCase();
        return aTitle === normTitle && (!normArtist || aArtist === normArtist);
      });
    }

    if (!asset) {
      console.warn('[RemoteSyncManager] playHostLibraryTrack: Track not found on host:', trackId, title);
      return;
    }

    const tracks: QueueTrack[] = assets.map((a) => ({
      id: a.id,
      url: a.uri,
      title: metadataMap[a.id]?.title || a.filename,
      artist: metadataMap[a.id]?.artist || 'Unknown Artist',
      artwork: metadataMap[a.id]?.artwork || artworkMap[a.id] || undefined,
      duration: a.duration,
    }));

    await startPlaybackFromLibrary({
      tracks,
      startId: asset.id,
      shuffle: store.isShuffle,
      smartShuffle: store.isShuffle ? store.isSmartShuffle : false,
    });

    const selectedSummary = this.formatAssetSummary(asset);
    const immediateTrackChange: TrackChangeMessage = {
      type: 'TRACK_CHANGE',
      track: selectedSummary,
      lyrics: null,
    };
    this.broadcastToAll(immediateTrackChange);
    this.broadcastStateChange();
    this.broadcastQueueSync();
  }

  private async handleArtworkRequest(trackId: string, clientSocket: any, wsClientId?: string): Promise<void> {
    const base64 = await this.getCompressedArtworkBase64(trackId);
    const resp: RemoteMessage = {
      type: 'ARTWORK_RESPONSE',
      trackId,
      base64,
    };
    if (wsClientId) {
      wsRoomClient.sendFromHost(resp, wsClientId);
    } else if (clientSocket) {
      tcpHostServer.sendToClient(clientSocket, resp);
    }
  }

  // ==========================================
  // CLIENT MANAGEMENT
  // ==========================================

  public async connectToHost(host: DiscoveredHost | DiscoveredPeer): Promise<void> {
    // 1. Local Audio Suppression: Pause local TrackPlayer if playing
    try {
      await TrackPlayer.pause();
    } catch {
      // ignore
    }

    // Stop & detach Host service so this device does not broadcast TrackPlayer events while in Client mode
    if (this.isHostActive) {
      this.detachHostListeners();
      blePeripheralService.stopHost().catch(() => {});
      udpDiscoveryService.stopHostBeacon();
      tcpHostServer.stopServer();
      this.isHostActive = false;
    }

    useRemoteConnectStore.getState().setMode('client');
    useRemoteConnectStore.getState().setConnectedDeviceName(host.deviceName);
    useRemoteConnectStore.getState().setConnectionStatus('connecting');

    // Bluetooth Low Energy (BLE) Client connection
    if ((host as DiscoveredPeer).transport === 'ble') {
      this.activeClientTransport = 'ble';
      tcpClient.disconnect();

      bleCentralService.setCallbacks({
        onStatusChange: (status: ClientConnectionStatus, error?: string) => {
          useRemoteConnectStore.getState().setConnectionStatus(status, error);
          if (status === 'disconnected' || status === 'error') {
            remoteMediaNotification.cleanupRemoteMediaNotification().catch(() => {});
            useRemoteConnectStore.getState().setMode('idle');
            // Resume host service if enabled
            if (useRemoteConnectStore.getState().isServiceEnabled) {
              this.startHostService().catch(() => {});
            }
          }
        },
        onMessage: (message: RemoteMessage) => {
          this.handleClientIncomingMessage(message);
        },
      });

      await bleCentralService.connect(host as DiscoveredPeer);
      return;
    }

    // Wi-Fi (TCP) Client connection
    this.activeClientTransport = 'wifi';
    bleCentralService.disconnect().catch(() => {});

    const clientDeviceId = useRemoteConnectStore.getState().localDeviceId;
    const clientDeviceName = useRemoteConnectStore.getState().customDeviceName;
    const hostIp = (host as DiscoveredHost).hostIp;
    const hostDeviceId = (host as DiscoveredHost).deviceId;
    const savedToken =
      (hostDeviceId ? useRemoteConnectStore.getState().pairedHosts[hostDeviceId] : undefined) ||
      (hostIp ? useRemoteConnectStore.getState().pairedHosts[hostIp] : undefined) ||
      useRemoteConnectStore.getState().lastConnectedToken ||
      undefined;

    tcpClient.setCallbacks({
      onStatusChange: (status: ClientConnectionStatus, error?: string) => {
        useRemoteConnectStore.getState().setConnectionStatus(status, error);
        if (status === 'disconnected' || status === 'error') {
          remoteMediaNotification.cleanupRemoteMediaNotification().catch(() => {});
          useRemoteConnectStore.getState().setMode('idle');
          // Resume host service if enabled
          if (useRemoteConnectStore.getState().isServiceEnabled) {
            this.startHostService().catch(() => {});
          }
        }
      },

      onPinRequired: (verifyCallback) => {
        useRemoteConnectStore.getState().setPendingPinVerification(verifyCallback);
      },

      onPairSuccess: (token: string) => {
        if (hostDeviceId) {
          useRemoteConnectStore.getState().savePairedHostToken(hostDeviceId, token);
        }
        if (hostIp) {
          useRemoteConnectStore.getState().savePairedHostToken(hostIp, token);
        }
        useRemoteConnectStore.setState({
          lastConnectedHostIp: hostIp,
          lastConnectedToken: token,
        });
      },

      onMessage: (message: RemoteMessage) => {
        this.handleClientIncomingMessage(message);
      },
    });

    tcpClient.connect({
      hostIp,
      port: (host as DiscoveredHost).port,
      clientDeviceId,
      clientDeviceName,
      token: savedToken,
    });
  }

  public async startInternetHostRoom(customCode?: string): Promise<string> {
    const code = (
      customCode ||
      useRemoteConnectStore.getState().internetRoomCode ||
      `RUN-${Math.floor(1000 + Math.random() * 9000)}`
    )
      .toUpperCase()
      .trim();

    useRemoteConnectStore.getState().setInternetRoomCode(code);

    const deviceId = useRemoteConnectStore.getState().localDeviceId;
    const deviceName = useRemoteConnectStore.getState().customDeviceName;

    wsRoomClient.startHostRoom(code, deviceId, deviceName, {
      onHosted: (roomCode) => {
        useRemoteConnectStore.getState().setInternetRoomCode(roomCode);
      },
      onClientConnected: async (client) => {
        useRemoteConnectStore.getState().addConnectedClient({
          id: client.clientId,
          deviceId: client.deviceId,
          deviceName: client.deviceName || 'İnternet Kumandası',
          transport: 'internet',
          connectedAt: Date.now(),
        });

        const initialState = await this.buildHostInitialState(false);
        wsRoomClient.sendFromHost(initialState, client.clientId);

        const activeTrack = await TrackPlayer.getActiveTrack();
        if (activeTrack) {
          const artworkBase64 = await this.getCompressedArtworkBase64(activeTrack.id, activeTrack.url);
          if (artworkBase64) {
            const artworkMsg: ActiveArtworkSyncMessage = {
              type: 'ACTIVE_ARTWORK_SYNC',
              trackId: activeTrack.id,
              base64: artworkBase64,
            };
            wsRoomClient.sendFromHost(artworkMsg, client.clientId);
          }
        }
      },
      onClientDisconnected: (clientId) => {
        useRemoteConnectStore.getState().removeConnectedClient(clientId);
      },
      onMessage: (message, clientId) => {
        this.handleHostCommand(message, null, clientId);
      },
      onError: (err) => {
        console.warn('[RemoteSyncManager] Internet Host Error:', err);
      },
      onClosed: () => {
        console.log('[RemoteSyncManager] Internet Host Room closed');
      },
    });

    return code;
  }

  public stopInternetHostRoom(): void {
    wsRoomClient.disconnect();
    useRemoteConnectStore.getState().setInternetHostStatus('idle');
  }

  public async connectToInternetRoom(roomCode: string): Promise<void> {
    const formattedCode = roomCode.trim().toUpperCase();
    if (!formattedCode) return;

    try {
      await TrackPlayer.pause();
    } catch {
      // ignore
    }

    if (this.isHostActive) {
      this.detachHostListeners();
      blePeripheralService.stopHost().catch(() => {});
      udpDiscoveryService.stopHostBeacon();
      tcpHostServer.stopServer();
      this.stopInternetHostRoom();
      this.isHostActive = false;
    }

    tcpClient.disconnect();
    bleCentralService.disconnect().catch(() => {});

    this.activeClientTransport = 'internet';
    useRemoteConnectStore.getState().setMode('client');
    useRemoteConnectStore.getState().setConnectedDeviceName(`Oda: ${formattedCode}`);
    useRemoteConnectStore.getState().setConnectionStatus('connecting');

    const deviceId = useRemoteConnectStore.getState().localDeviceId;
    const deviceName = useRemoteConnectStore.getState().customDeviceName;

    wsRoomClient.joinClientRoom(formattedCode, deviceId, deviceName, {
      onJoined: (info) => {
        useRemoteConnectStore.getState().setConnectionStatus('connected');
        useRemoteConnectStore.getState().setConnectedDeviceName(info.hostName || `Oda: ${info.roomCode}`);
        useRemoteConnectStore.getState().addRecentRoom(info.roomCode);
      },
      onHostTemporarilyOffline: () => {
        useRemoteConnectStore.getState().setConnectionStatus('connecting', 'Host yeniden bağlanıyor...');
      },
      onHostReconnected: () => {
        useRemoteConnectStore.getState().setConnectionStatus('connected');
        this.sendClientCommand({ type: 'COMMAND_GET_STATE' });
      },
      onMessage: (message) => {
        this.handleClientIncomingMessage(message);
      },
      onError: (error) => {
        useRemoteConnectStore.getState().setConnectionStatus('error', error);
        remoteMediaNotification.cleanupRemoteMediaNotification().catch(() => {});
        useRemoteConnectStore.getState().setMode('idle');
        if (useRemoteConnectStore.getState().isServiceEnabled) {
          this.startHostService().catch(() => {});
        }
      },
      onClosed: () => {
        useRemoteConnectStore.getState().setConnectionStatus('disconnected');
        remoteMediaNotification.cleanupRemoteMediaNotification().catch(() => {});
        useRemoteConnectStore.getState().setMode('idle');
        if (useRemoteConnectStore.getState().isServiceEnabled) {
          this.startHostService().catch(() => {});
        }
      },
    });
  }

  public disconnectConnectedClient(clientId: string): void {
    if (clientId === 'ble_client') {
      useRemoteConnectStore.getState().removeConnectedClient('ble_client');
    } else if (clientId.startsWith('client_')) {
      wsRoomClient.kickClient(clientId);
      useRemoteConnectStore.getState().removeConnectedClient(clientId);
    } else {
      tcpHostServer.disconnectClient(clientId);
    }
  }

  public disconnectClient(): void {
    remoteMediaNotification.cleanupRemoteMediaNotification().catch(() => {});
    if (this.activeClientTransport === 'ble') {
      bleCentralService.disconnect().catch(() => {});
    } else if (this.activeClientTransport === 'internet') {
      wsRoomClient.disconnect();
    } else {
      tcpClient.disconnect();
    }
    useRemoteConnectStore.getState().resetRemoteState();

    // If host service was enabled in settings, resume host service
    if (useRemoteConnectStore.getState().isServiceEnabled) {
      this.startHostService().catch(() => {});
    }

    // Send an immediate probe on disconnect so other available hosts immediately reappear in discovery
    udpDiscoveryService.sendProbe();
  }

  public sendClientCommand(message: RemoteMessage): void {
    if (this.activeClientTransport === 'ble') {
      bleCentralService.sendCommand(message).catch((err) => {
        console.warn('[RemoteSyncManager] BLE sendCommand failed:', err);
      });
    } else if (this.activeClientTransport === 'internet') {
      wsRoomClient.sendFromClient(message);
    } else {
      tcpClient.sendMessage(message);
    }
  }

  public sendPlay(): void {
    this.sendClientCommand({ type: 'COMMAND_PLAY' });
  }

  public sendPause(): void {
    this.sendClientCommand({ type: 'COMMAND_PAUSE' });
  }

  public sendSkipToNext(): void {
    this.sendClientCommand({ type: 'COMMAND_SKIP_NEXT' });
  }

  public sendSkipToPrevious(): void {
    this.sendClientCommand({ type: 'COMMAND_SKIP_PREVIOUS' });
  }

  public sendSeek(position: number): void {
    this.sendClientCommand({ type: 'COMMAND_SEEK', position });
  }

  public sendSelectLyrics(trackId: string, candidate: any): void {
    const msg: CommandSelectLyricsMessage = {
      type: 'COMMAND_SELECT_LYRICS',
      trackId,
      candidate: {
        id: candidate.id,
        source: candidate.source,
        trackName: candidate.trackName,
        artistName: candidate.artistName,
        hasSynced: candidate.hasSynced,
        hasWordSync: candidate.hasWordSync,
        syncedLyrics: candidate.syncedLyrics,
        plainLyrics: candidate.plainLyrics,
        lyricsfile: candidate.lyricsfile,
        geniusUrl: candidate.geniusUrl,
      },
    };
    this.sendClientCommand(msg);
  }

  private async handleClientIncomingMessage(msg: RemoteMessage): Promise<void> {
    switch (msg.type) {
      case 'INITIAL_STATE':
        useRemoteConnectStore.getState().setRemoteInitialState(msg);
        remoteMediaNotification
          .syncRemoteTrackToLocalPlayer(msg.activeTrack, msg.isPlaying, null, msg.position)
          .catch(() => {});
        if (this.activeClientTransport === 'wifi' || this.activeClientTransport === 'internet') {
          this.fetchRemoteLibrary().catch(() => {});
        }
        break;

      case 'POSITION_SYNC':
        useRemoteConnectStore.getState().setRemotePositionSync(msg);
        remoteMediaNotification.syncRemotePosition(msg.position).catch(() => {});
        break;

      case 'TRACK_CHANGE':
        useRemoteConnectStore.getState().setRemoteTrackChange(msg);
        {
          const resolvedArtwork =
            msg.track?.id
              ? useStore.getState().artworkMap[msg.track.id] ||
                useStore.getState().metadataMap[msg.track.id]?.artwork ||
                useRemoteConnectStore.getState().remoteState.artworkUri ||
                null
              : null;
          remoteMediaNotification
            .syncRemoteTrackToLocalPlayer(
              msg.track,
              useRemoteConnectStore.getState().remoteState.isPlaying,
              resolvedArtwork,
              0
            )
            .catch(() => {});
        }
        if (msg.track?.id && msg.track.hasArtwork && (this.activeClientTransport === 'wifi' || this.activeClientTransport === 'internet')) {
          this.sendClientCommand({ type: 'REQUEST_ARTWORK', trackId: msg.track.id });
        }
        break;

      case 'STATE_CHANGE':
        useRemoteConnectStore.getState().setRemoteStateChange(msg);
        if (msg.isPlaying !== undefined) {
          remoteMediaNotification.syncRemotePlaybackState(msg.isPlaying).catch(() => {});
        }
        break;

      case 'LYRICS_SYNC':
        useRemoteConnectStore.getState().setRemoteLyrics(msg.lyrics);
        break;

      case 'QUEUE_SYNC':
        useRemoteConnectStore.getState().setRemoteQueueSync(msg);
        break;

      case 'ACTIVE_ARTWORK_SYNC':
      case 'ARTWORK_RESPONSE':
        if (msg.base64) {
          const fileUri = await this.saveRemoteArtworkToFile(msg.trackId, msg.base64);
          if (fileUri) {
            useRemoteConnectStore.getState().setRemoteArtworkUri(fileUri);
            useStore.getState().setArtwork(msg.trackId, fileUri);
            remoteMediaNotification.syncRemoteArtwork(fileUri).catch(() => {});
            if (useStore.getState().preferences.dynamicColorFromArtwork) {
              useThemeStore.getState().updateThemeFromArtwork(fileUri);
            }
          }
        }
        break;

      case 'LIBRARY_RESULT': {
        const pending = this.pendingLibraryQueries.get(msg.requestId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingLibraryQueries.delete(msg.requestId);
          pending.resolve(msg);
        }
        break;
      }
    }
  }

  public async fetchRemoteLibrary(search = ''): Promise<void> {
    if (this.activeClientTransport !== 'wifi' && this.activeClientTransport !== 'internet') return;
    try {
      useRemoteConnectStore.getState().setRemoteLibraryLoading(true);
      const result = await this.queryRemoteLibrary(search, 0, 2000);
      useRemoteConnectStore.getState().setRemoteLibrary(result.tracks || []);
    } catch (e) {
      console.warn('[RemoteSyncManager] fetchRemoteLibrary error:', e);
    } finally {
      useRemoteConnectStore.getState().setRemoteLibraryLoading(false);
    }
  }

  public queryRemoteLibrary(search = '', offset = 0, limit = 50): Promise<LibraryResultMessage> {
    return new Promise((resolve, reject) => {
      const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const timer = setTimeout(() => {
        this.pendingLibraryQueries.delete(requestId);
        reject(new Error('Library query timed out'));
      }, 8000);

      this.pendingLibraryQueries.set(requestId, { resolve, reject, timer });

      const queryMsg: LibraryQueryMessage = {
        type: 'LIBRARY_QUERY',
        requestId,
        search,
        offset,
        limit,
      };

      this.sendClientCommand(queryMsg);
    });
  }

  // ==========================================
  // HELPERS & DATA FORMATTERS
  // ==========================================

  private formatTrackSummary(track: Track): RemoteTrackSummary {
    const artworkMap = useStore.getState().artworkMap;
    const metadata = useStore.getState().metadataMap[track.id] || useStore.getState().metadataMap[(track as any).url];
    const hasArtwork = !!(track.artwork || artworkMap[track.id] || metadata?.artwork);

    let duration = track.duration || 0;
    if (duration <= 0) {
      const allAssets = useStore.getState().allAssets;
      const asset = allAssets.find((a) => a.id === track.id || a.uri === (track as any).url);
      if (asset && asset.duration > 0) {
        duration = asset.duration;
      }
    }

    const keywords = getSearchKeywords(track.title || '');
    const artist =
      (metadata?.artist?.trim() && metadata.artist !== 'Local Audio' && metadata.artist !== 'Bilinmeyen Sanatçı'
        ? metadata.artist.trim()
        : '') ||
      (track.artist?.trim() && track.artist !== 'Local Audio' && track.artist !== 'Bilinmeyen Sanatçı' && track.artist !== 'Unknown Artist'
        ? track.artist.trim()
        : '') ||
      (keywords.expectedArtist && keywords.expectedArtist !== 'Local Audio' && keywords.expectedArtist !== 'Bilinmeyen Sanatçı'
        ? keywords.expectedArtist
        : '') ||
      'Unknown Artist';

    const rawTitle =
      (metadata?.title?.trim() ? metadata.title.trim() : '') ||
      track.title ||
      keywords.expectedTrack ||
      'Unknown Title';

    const title = cleanDisplayTitle(rawTitle, artist !== 'Unknown Artist' ? artist : undefined) || rawTitle;

    return {
      id: track.id,
      title,
      artist,
      duration,
      hasArtwork,
    };
  }

  private formatAssetSummary(asset: any): RemoteTrackSummary {
    const meta = useStore.getState().metadataMap[asset.id] || useStore.getState().metadataMap[asset.uri];
    const keywords = getSearchKeywords(asset.filename || '');
    const artist =
      (meta?.artist?.trim() && meta.artist !== 'Local Audio' && meta.artist !== 'Bilinmeyen Sanatçı'
        ? meta.artist.trim()
        : '') ||
      (keywords.expectedArtist && keywords.expectedArtist !== 'Local Audio' && keywords.expectedArtist !== 'Bilinmeyen Sanatçı'
        ? keywords.expectedArtist
        : '') ||
      'Unknown Artist';

    const rawTitle =
      (meta?.title?.trim() ? meta.title.trim() : '') ||
      keywords.expectedTrack ||
      asset.filename ||
      'Unknown Title';

    const title = cleanDisplayTitle(rawTitle, artist !== 'Unknown Artist' ? artist : undefined) || rawTitle;
    const artworkMap = useStore.getState().artworkMap;

    return {
      id: asset.id,
      title,
      artist,
      duration: asset.duration || 0,
      hasArtwork: !!(meta?.artwork || artworkMap[asset.id]),
    };
  }

  public formatLyricsSummary(track: Track | null): RemoteLyricsSummary | null {
    if (!track) return null;
    const meta = useStore.getState().metadataMap[track.id];
    const title = meta?.title || track.title || '';
    const artist = meta?.artist || track.artist || '';
    const keys = getLyricsCacheKeys({
      id: track.id,
      url: track.url,
      title,
      artist,
      rawTitle: track.title,
    });
    const result = findLyricsInCache(useStore.getState().lyricsCache, keys);
    if (!result) return null;

    let lines: LyricLine[] = result.parsedLines || [];
    if (lines.length === 0 && (result.syncedLyrics || result.lyricsfile)) {
      lines = parseAnySyncedLyrics(result.lyricsfile, result.syncedLyrics);
    }

    let lrclibId: string | number | null = null;
    let geniusId: string | number | null = null;
    let geniusUrl: string | null = null;

    if (result.source === 'lrclib' && result.id) {
      lrclibId = result.id.replace('lrclib-', '');
    } else if (result.source === 'genius') {
      if (result.id) geniusId = result.id.replace('genius-', '');
      const candidate = result.candidates?.find((c) => c.id === result.id);
      if (candidate?.geniusUrl) geniusUrl = candidate.geniusUrl;
    }

    return {
      trackId: track.id,
      lines,
      source: result.source || null,
      isSynced: (!!result.syncedLyrics || !!result.lyricsfile) && lines.length > 0,
      plainLyrics: result.plainLyrics || undefined,
      syncedLyrics: result.syncedLyrics || undefined,
      lyricsfile: result.lyricsfile || undefined,
      lrclibId,
      geniusId,
      geniusUrl,
    };
  }

  public broadcastLyricsUpdate(trackId: string): void {
    if (!this.isHostActive) return;
    TrackPlayer.getActiveTrack().then((activeTrack) => {
      if (activeTrack && activeTrack.id === trackId) {
        const updated = this.formatLyricsSummary(activeTrack);
        if (updated) {
          const lyricsMsg: LyricsSyncMessage = {
            type: 'LYRICS_SYNC',
            trackId,
            lyrics: updated,
          };
          this.broadcastToAll(lyricsMsg);
        }
      }
    });
  }

  private async getCompressedArtworkBase64(trackId: string, trackUrl?: string): Promise<string | null> {
    try {
      const store = useStore.getState();
      let uri = store.artworkMap[trackId] || store.metadataMap[trackId]?.artwork;

      if (!uri) {
        const active = await TrackPlayer.getActiveTrack();
        if (active && (active.id === trackId || active.url === trackUrl) && typeof active.artwork === 'string') {
          uri = active.artwork;
        }
      }

      if (!uri) {
        let url = trackUrl;
        if (!url) {
          const allAssets = store.allAssets.length > 0 ? store.allAssets : store.library;
          const found = allAssets.find((a) => a.id === trackId || a.uri === trackId);
          if (found) url = found.uri;
        }
        if (url) {
          try {
            const extracted = await getArtworkAsync(url, trackId);
            if (extracted) {
              uri = extracted;
              store.setArtwork(trackId, extracted);
            }
          } catch {
            // ignore
          }
        }
      }

      if (!uri) return null;

      if (uri.startsWith('data:image')) {
        // Already a base64 string
        return uri;
      }

      let fileUri = uri;
      if (!fileUri.startsWith('file://') && !fileUri.startsWith('content://') && !fileUri.startsWith('http')) {
        fileUri = `file://${fileUri}`;
      }

      if (fileUri.startsWith('file://') || fileUri.startsWith('content://')) {
        const base64 = await FileSystem.readAsStringAsync(fileUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        return `data:image/jpeg;base64,${base64}`;
      }
    } catch (e) {
      console.warn('[RemoteSyncManager] Failed to read artwork base64:', e);
    }
    return null;
  }

  private async saveRemoteArtworkToFile(trackId: string, base64Data: string): Promise<string | null> {
    try {
      const cleanBase64 = base64Data.replace(/^data:image\/[a-z]+;base64,/, '');
      const path = `${FileSystem.cacheDirectory}remote_art_${trackId}.jpg`;
      await FileSystem.writeAsStringAsync(path, cleanBase64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      return path;
    } catch (e) {
      console.warn('[RemoteSyncManager] Failed to save remote artwork:', e);
      return null;
    }
  }
}

export const remoteSyncManager = new RemoteSyncManager();
