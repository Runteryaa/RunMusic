import { Platform } from 'react-native';
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
import { skipToPreviousTrack, moveUpNext, removeQueueItem, setShuffle } from '../queueController';
import { findLyricsInCache } from '../persistSanitize';
import {
  parseAnySyncedLyrics,
  getLyricsCacheKeys,
  fetchLyricsOnline,
  resolveCandidateToLyricsResult,
  type LyricLine,
} from '../lyricsService';
import { remoteMediaNotification } from './remoteMediaNotification';
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
  DiscoveredHost,
  TrustedClient,
} from './remoteTypes';

class RemoteSyncManager {
  private isHostActive = false;
  private hostSubscriptions: (() => void)[] = [];
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pendingLibraryQueries: Map<
    string,
    { resolve: (res: LibraryResultMessage) => void; reject: (err: any) => void; timer: ReturnType<typeof setTimeout> }
  > = new Map();

  // ==========================================
  // HOST MANAGEMENT
  // ==========================================

  public getIsHostActive(): boolean {
    return this.isHostActive;
  }

  public async startHostService(): Promise<void> {
    if (this.isHostActive) return;

    const deviceName = useRemoteConnectStore.getState().customDeviceName;
    const deviceId = `device_${Platform.OS}_${Date.now()}`;

    // Configure TCP Server Handlers
    tcpHostServer.setHandlers({
      validateToken: (token: string, clientDeviceId: string) => {
        const trusted = useRemoteConnectStore.getState().trustedDevices;
        return trusted.some((c) => c.token === token && c.deviceId === clientDeviceId);
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

      onClientAuthorized: async (clientSocket) => {
        // Send initial state dump immediately
        const initialState = await this.buildHostInitialState();
        tcpHostServer.sendToClient(clientSocket, initialState);

        // Also send active artwork if present
        const activeTrack = await TrackPlayer.getActiveTrack();
        if (activeTrack) {
          const artworkBase64 = await this.getCompressedArtworkBase64(activeTrack.id);
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

      onCommand: (message, clientSocket) => {
        this.handleHostCommand(message, clientSocket);
      },
    });

    // Start TCP server & UDP beacon
    tcpHostServer.startServer();
    udpDiscoveryService.startHostBeacon(deviceId, deviceName);

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

    useRemoteConnectStore.getState().setMode('idle');
    this.isHostActive = false;
  }

  private attachHostListeners(): void {
    this.detachHostListeners();

    // 1. Track change
    const subTrack = TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, async (event) => {
      if (!this.isHostActive) return;
      const track = event.track ?? null;
      const trackSummary = track ? this.formatTrackSummary(track) : null;
      const lyricsSummary = track ? this.formatLyricsSummary(track) : null;

      const trackChangeMsg: TrackChangeMessage = {
        type: 'TRACK_CHANGE',
        track: trackSummary,
        lyrics: lyricsSummary,
      };
      tcpHostServer.broadcast(trackChangeMsg);

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
                    tcpHostServer.broadcast(lyricsMsg);
                  }
                }
              })
              .catch((err) => {
                console.warn('[RemoteSyncManager] Background host lyrics fetch error:', err);
              });
          }
        }

        const artworkBase64 = await this.getCompressedArtworkBase64(track.id);
        if (artworkBase64) {
          const artMsg: ActiveArtworkSyncMessage = {
            type: 'ACTIVE_ARTWORK_SYNC',
            trackId: track.id,
            base64: artworkBase64,
          };
          tcpHostServer.broadcast(artMsg);
        }
      }
    });

    // 2. Playback state change
    const subState = TrackPlayer.addEventListener(Event.PlaybackState, async (event) => {
      if (!this.isHostActive) return;
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
      tcpHostServer.broadcast(stateMsg);

      const posMsg: PositionSyncMessage = {
        type: 'POSITION_SYNC',
        position: progress.position,
        isPlaying,
        playbackRate: 1.0,
      };
      tcpHostServer.broadcast(posMsg);
    });

    this.hostSubscriptions = [
      () => subTrack.remove(),
      () => subState.remove(),
    ];

    // 3. Low-frequency position heartbeat (every 5000ms while active)
    this.heartbeatTimer = setInterval(async () => {
      if (!this.isHostActive) return;
      try {
        const playback = await TrackPlayer.getPlaybackState();
        const isPlaying = playback.state === State.Playing;
        if (isPlaying) {
          const progress = await TrackPlayer.getProgress();
          const posMsg: PositionSyncMessage = {
            type: 'POSITION_SYNC',
            position: progress.position,
            isPlaying: true,
            playbackRate: 1.0,
          };
          tcpHostServer.broadcast(posMsg);
        }
      } catch {
        // ignore
      }
    }, 5000);
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

  private async buildHostInitialState(): Promise<InitialStateMessage> {
    const activeTrack = await TrackPlayer.getActiveTrack();
    const playback = await TrackPlayer.getPlaybackState();
    const progress = await TrackPlayer.getProgress();
    const repeatMode = await TrackPlayer.getRepeatMode();
    const isShuffle = useStore.getState().isShuffle;

    const trackSummary = activeTrack ? this.formatTrackSummary(activeTrack) : null;
    const lyricsSummary = activeTrack ? this.formatLyricsSummary(activeTrack) : null;

    // Build queue summaries
    const queueTracks = await TrackPlayer.getQueue();
    const queueSummaries = queueTracks.map((t) => this.formatTrackSummary(t));

    const allAssets = useStore.getState().allAssets;
    const upNextIds = useStore.getState().upNextIds;
    const upNextSummaries: RemoteTrackSummary[] = [];

    for (const id of upNextIds) {
      const asset = allAssets.find((a) => a.id === id);
      if (asset) {
        upNextSummaries.push(this.formatAssetSummary(asset));
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
        }
      }

      const queueSync: QueueSyncMessage = {
        type: 'QUEUE_SYNC',
        queue: queueSummaries,
        upNext: upNextSummaries,
      };
      tcpHostServer.broadcast(queueSync);
    });
  }

  private handleHostCommand(msg: RemoteMessage, clientSocket: any): void {
    switch (msg.type) {
      case 'COMMAND_PLAY':
        TrackPlayer.play();
        break;

      case 'COMMAND_PAUSE':
        TrackPlayer.pause();
        break;

      case 'COMMAND_SKIP_NEXT':
        TrackPlayer.skipToNext();
        break;

      case 'COMMAND_SKIP_PREVIOUS':
        skipToPreviousTrack();
        break;

      case 'COMMAND_SEEK':
        TrackPlayer.seekTo(msg.position);
        break;

      case 'COMMAND_SET_SHUFFLE':
        setShuffle(msg.enabled);
        break;

      case 'COMMAND_SET_REPEAT':
        TrackPlayer.setRepeatMode(msg.mode);
        break;

      case 'COMMAND_QUEUE_MOVE':
        moveUpNext(msg.fromIndex, msg.toIndex);
        this.broadcastQueueSync();
        break;

      case 'COMMAND_QUEUE_REMOVE':
        if (typeof msg.trackIndex === 'number') {
          removeQueueItem(msg.trackIndex).then(() => {
            this.broadcastQueueSync();
          });
        } else if (msg.trackId) {
          TrackPlayer.getQueue().then((queueTracks) => {
            const index = queueTracks.findIndex((t) => t.id === msg.trackId);
            if (index !== -1) {
              removeQueueItem(index).then(() => {
                this.broadcastQueueSync();
              });
            }
          });
        }
        break;

      case 'COMMAND_PLAY_TRACK':
        TrackPlayer.skip(msg.trackIndex).then(() => TrackPlayer.play());
        break;

      case 'COMMAND_PLAY_LIBRARY_TRACK':
        this.playHostLibraryTrack(msg.trackId);
        break;

      case 'LIBRARY_QUERY':
        this.handleLibraryQuery(msg, clientSocket);
        break;

      case 'REQUEST_ARTWORK':
        this.handleArtworkRequest(msg.trackId, clientSocket);
        break;

      case 'COMMAND_SELECT_LYRICS':
        this.handleClientSelectLyrics(msg);
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

  private handleLibraryQuery(msg: LibraryQueryMessage, clientSocket: any): void {
    const allAssets = useStore.getState().allAssets;
    const metadataMap = useStore.getState().metadataMap;
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

    tcpHostServer.sendToClient(clientSocket, response);
  }

  private async playHostLibraryTrack(trackId: string): Promise<void> {
    const allAssets = useStore.getState().allAssets;
    const asset = allAssets.find((a) => a.id === trackId);
    if (!asset) return;

    const metadata = useStore.getState().metadataMap[trackId];
    const artwork = useStore.getState().artworkMap[trackId];

    await TrackPlayer.reset();
    await TrackPlayer.add({
      id: asset.id,
      url: asset.uri,
      title: metadata?.title || asset.filename,
      artist: metadata?.artist || 'Unknown Artist',
      artwork: artwork || undefined,
      duration: asset.duration,
    });
    await TrackPlayer.play();
  }

  private async handleArtworkRequest(trackId: string, clientSocket: any): Promise<void> {
    const base64 = await this.getCompressedArtworkBase64(trackId);
    tcpHostServer.sendToClient(clientSocket, {
      type: 'ARTWORK_RESPONSE',
      trackId,
      base64,
    });
  }

  // ==========================================
  // CLIENT MANAGEMENT
  // ==========================================

  public async connectToHost(host: DiscoveredHost): Promise<void> {
    // 1. Local Audio Suppression: Pause local TrackPlayer if playing
    try {
      await TrackPlayer.pause();
    } catch {
      // ignore
    }

    useRemoteConnectStore.getState().setMode('client');
    useRemoteConnectStore.getState().setConnectedDeviceName(host.deviceName);

    const clientDeviceId = `client_${Platform.OS}_${Date.now()}`;
    const clientDeviceName = useRemoteConnectStore.getState().customDeviceName;
    const savedToken = useRemoteConnectStore.getState().lastConnectedToken || undefined;

    tcpClient.setCallbacks({
      onStatusChange: (status: ClientConnectionStatus, error?: string) => {
        useRemoteConnectStore.getState().setConnectionStatus(status, error);
        if (status === 'disconnected' || status === 'error') {
          remoteMediaNotification.cleanupRemoteMediaNotification().catch(() => {});
          useRemoteConnectStore.getState().setMode('idle');
        }
      },

      onPinRequired: (verifyCallback) => {
        useRemoteConnectStore.getState().setPendingPinVerification(verifyCallback);
      },

      onPairSuccess: (token: string) => {
        useRemoteConnectStore.setState({
          lastConnectedHostIp: host.hostIp,
          lastConnectedToken: token,
        });
      },

      onMessage: (message: RemoteMessage) => {
        this.handleClientIncomingMessage(message);
      },
    });

    tcpClient.connect({
      hostIp: host.hostIp,
      port: host.port,
      clientDeviceId,
      clientDeviceName,
      token: savedToken,
    });
  }

  public disconnectClient(): void {
    remoteMediaNotification.cleanupRemoteMediaNotification().catch(() => {});
    tcpClient.disconnect();
    useRemoteConnectStore.getState().resetRemoteState();
  }

  public sendClientCommand(message: RemoteMessage): void {
    tcpClient.sendMessage(message);
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
        break;

      case 'POSITION_SYNC':
        useRemoteConnectStore.getState().setRemotePositionSync(msg);
        remoteMediaNotification.syncRemotePosition(msg.position).catch(() => {});
        break;

      case 'TRACK_CHANGE':
        useRemoteConnectStore.getState().setRemoteTrackChange(msg);
        remoteMediaNotification
          .syncRemoteTrackToLocalPlayer(
            msg.track,
            useRemoteConnectStore.getState().remoteState.isPlaying,
            useRemoteConnectStore.getState().remoteState.artworkUri,
            0
          )
          .catch(() => {});
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
        if (msg.base64) {
          const fileUri = await this.saveRemoteArtworkToFile(msg.trackId, msg.base64);
          useRemoteConnectStore.getState().setRemoteArtworkUri(fileUri);
          if (fileUri) {
            remoteMediaNotification.syncRemoteArtwork(fileUri).catch(() => {});
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
    const hasArtwork = !!(track.artwork || artworkMap[track.id]);

    return {
      id: track.id,
      title: track.title || 'Unknown Title',
      artist: track.artist || 'Unknown Artist',
      duration: track.duration || 0,
      hasArtwork,
    };
  }

  private formatAssetSummary(asset: any): RemoteTrackSummary {
    const metadata = useStore.getState().metadataMap[asset.id];
    const artworkMap = useStore.getState().artworkMap;

    return {
      id: asset.id,
      title: metadata?.title || asset.filename || 'Unknown Title',
      artist: metadata?.artist || 'Unknown Artist',
      duration: asset.duration || 0,
      hasArtwork: !!artworkMap[asset.id],
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
          tcpHostServer.broadcast(lyricsMsg);
        }
      }
    });
  }

  private async getCompressedArtworkBase64(trackId: string): Promise<string | null> {
    try {
      const uri = useStore.getState().artworkMap[trackId];
      if (!uri) return null;

      if (uri.startsWith('data:image')) {
        // Already a base64 string
        return uri;
      }

      if (uri.startsWith('file://')) {
        const base64 = await FileSystem.readAsStringAsync(uri, {
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
