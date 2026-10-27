import { useCallback, useEffect } from 'react';
import TrackPlayer, {
  useActiveTrack,
  useIsPlaying,
  RepeatMode,
} from 'react-native-track-player';
import { useRemoteConnectStore } from '../store/useRemoteConnectStore';
import { useStore } from '../store/useStore';
import { useThemeStore } from '../store/useThemeStore';
import { useOptimisticPlayerStore } from '../store/useOptimisticPlayerStore';
import { remoteSyncManager } from '../services/remote/remoteSyncManager';
import {
  skipToPreviousTrack,
  cyclePlaybackMode as cycleLocalPlaybackMode,
  setShuffle as setLocalShuffle,
  handlePlaybackError,
  getPlaybackMode,
  trackKey,
  resolveTrackId,
  type PlaybackMode,
} from '../services/queueController';
import { findLyricsInCache } from '../services/persistSanitize';
import { parseAnySyncedLyrics, getLyricsCacheKeys, type LyricLine } from '../services/lyricsService';
import type { RemoteTrackSummary, RemoteLyricsSummary } from '../services/remote/remoteTypes';

export interface ActivePlayerState {
  isRemote: boolean;
  remoteDeviceName: string | null;
  activeTrack: RemoteTrackSummary | null;
  isPlaying: boolean;
  duration: number;
  lyrics: RemoteLyricsSummary | null;
  artworkUri: string | null;
  repeatMode: RepeatMode;
  isShuffle: boolean;
  isSmartShuffle: boolean;
  playbackMode: PlaybackMode;

  // Controls
  play: () => Promise<void>;
  pause: () => Promise<void>;
  togglePlayPause: () => Promise<void>;
  skipToNext: () => Promise<void>;
  skipToPrevious: () => Promise<void>;
  seekTo: (position: number) => Promise<void>;
  setRepeatMode: (mode: RepeatMode) => Promise<void>;
  setShuffle: (enabled: boolean, smart?: boolean) => Promise<void>;
  cyclePlaybackMode: () => Promise<void>;
  disconnect: () => void;
}

/**
 * Unified player facade hook for LOW-FREQUENCY state and actions.
 *
 * Does NOT subscribe to 4Hz position ticks to avoid re-rendering
 * buttons, cards, and queue lists.
 * For progress/seek bar and lyrics synchronization, use `useActiveProgress()`.
 */
export function useActivePlayer(): ActivePlayerState {
  const isRemote = useRemoteConnectStore(
    (s) => s.mode === 'client' && s.connectionStatus === 'connected'
  );
  const remoteDeviceName = useRemoteConnectStore((s) => s.connectedDeviceName);
  const remoteState = useRemoteConnectStore((s) => s.remoteState);
  const remotePlaybackMode = remoteState.playbackMode;
  const remoteIsShuffle =
    remotePlaybackMode === 'shuffle' || remotePlaybackMode === 'smart';
  const remoteIsSmartShuffle = remotePlaybackMode === 'smart';
  const remoteRepeatMode =
    remotePlaybackMode === 'repeat-one'
      ? RepeatMode.Track
      : remotePlaybackMode === 'repeat-all'
        ? RepeatMode.Queue
        : RepeatMode.Off;

  const optimisticTrack = useOptimisticPlayerStore((s) => s.optimisticTrack);
  const optimisticArtwork = useOptimisticPlayerStore((s) => s.optimisticArtworkUri);

  // Local Player hooks (only subscribed when not remote)
  const localActiveTrack = useActiveTrack();
  const { playing: localIsPlaying } = useIsPlaying();
  const localArtworkMap = useStore((s) => s.artworkMap);
  const localIsShuffle = useStore((s) => s.isShuffle);
  const localIsSmartShuffle = useStore((s) => s.isSmartShuffle);
  const localRepeatMode = useStore((s) => s.repeatMode);
  const setStoreRepeatMode = useStore((s) => s.setRepeatMode);

  // Clear optimistic track ONLY when real active track reconciles to the optimistic track
  useEffect(() => {
    if (
      localActiveTrack?.id &&
      optimisticTrack?.id &&
      (localActiveTrack.id === optimisticTrack.id || localActiveTrack.url === optimisticTrack.id)
    ) {
      useOptimisticPlayerStore.getState().clearOptimisticTrack();
    }
  }, [localActiveTrack?.id, localActiveTrack?.url, optimisticTrack?.id]);

  useEffect(() => {
    if (
      remoteState.activeTrack?.id &&
      optimisticTrack?.id &&
      remoteState.activeTrack.id === optimisticTrack.id
    ) {
      useOptimisticPlayerStore.getState().clearOptimisticTrack();
    }
  }, [remoteState.activeTrack?.id, optimisticTrack?.id]);

  // ==========================================
  // REMOTE CONTROLS & STATE
  // ==========================================
  const remotePlay = useCallback(async () => {
    useRemoteConnectStore.getState().setOptimisticIsPlaying(true);
    remoteSyncManager.sendClientCommand({ type: 'COMMAND_PLAY' });
  }, []);

  const remotePause = useCallback(async () => {
    useRemoteConnectStore.getState().setOptimisticIsPlaying(false);
    remoteSyncManager.sendClientCommand({ type: 'COMMAND_PAUSE' });
  }, []);

  const remoteTogglePlayPause = useCallback(async () => {
    if (remoteState.isPlaying) {
      await remotePause();
    } else {
      await remotePlay();
    }
  }, [remoteState.isPlaying, remotePause, remotePlay]);

  const remoteSkipNext = useCallback(async () => {
    const q = Array.isArray(remoteState.queue) ? remoteState.queue : [];
    const currentId = optimisticTrack?.id || remoteState.activeTrack?.id;
    const currentIdx = q.findIndex((t) => t.id === currentId);
    let next: RemoteTrackSummary | null = null;
    if (currentIdx >= 0 && currentIdx < q.length - 1) {
      next = q[currentIdx + 1];
    } else if (remoteRepeatMode === RepeatMode.Queue && q.length > 0) {
      next = q[0];
    }
    if (next) {
      useOptimisticPlayerStore.getState().setOptimisticTrack(next, null);
    }
    remoteSyncManager.sendClientCommand({ type: 'COMMAND_SKIP_NEXT' });
  }, [remoteState.queue, remoteState.activeTrack?.id, remoteRepeatMode, optimisticTrack?.id]);

  const remoteSkipPrevious = useCallback(async () => {
    const q = Array.isArray(remoteState.queue) ? remoteState.queue : [];
    const currentId = optimisticTrack?.id || remoteState.activeTrack?.id;
    const currentIdx = q.findIndex((t) => t.id === currentId);
    let prev: RemoteTrackSummary | null = null;
    if (currentIdx > 0) {
      prev = q[currentIdx - 1];
    } else if (remoteRepeatMode === RepeatMode.Queue && q.length > 0) {
      prev = q[q.length - 1];
    }
    if (prev) {
      useOptimisticPlayerStore.getState().setOptimisticTrack(prev, null);
    }
    remoteSyncManager.sendClientCommand({ type: 'COMMAND_SKIP_PREVIOUS' });
  }, [remoteState.queue, remoteState.activeTrack?.id, remoteRepeatMode, optimisticTrack?.id]);

  const remoteSeekTo = useCallback(async (position: number) => {
    useRemoteConnectStore.getState().setOptimisticPosition(position);
    remoteSyncManager.sendClientCommand({ type: 'COMMAND_SEEK', position });
  }, []);

  const remoteSetRepeatMode = useCallback(async (mode: RepeatMode) => {
    useRemoteConnectStore.getState().setOptimisticRepeatMode(mode);
    remoteSyncManager.sendClientCommand({ type: 'COMMAND_SET_REPEAT', mode });
  }, []);

  const remoteSetShuffle = useCallback(async (enabled: boolean) => {
    useRemoteConnectStore.getState().setOptimisticShuffle(enabled, false);
    remoteSyncManager.sendClientCommand({ type: 'COMMAND_SET_SHUFFLE', enabled });
  }, []);

  const remoteCyclePlaybackMode = useCallback(async () => {
    // Host tek doğruluk kaynağı: sadece "butona basıldı" bilgisini gönder.
    // Host sıradaki modu seçer ve güncel modu STATE_CHANGE ile yayınlar.
    remoteSyncManager.sendClientCommand({ type: 'COMMAND_CYCLE_PLAYBACK_MODE' });
  }, []);

  const remoteDisconnect = useCallback(() => {
    remoteSyncManager.disconnectClient();
  }, []);

  // ==========================================
  // LOCAL CONTROLS & STATE
  // ==========================================
  const localPlay = useCallback(async () => {
    try {
      await TrackPlayer.play();
    } catch (err) {
      console.warn('[useActivePlayer] localPlay error:', err);
      await handlePlaybackError(err);
    }
  }, []);

  const localPause = useCallback(async () => {
    try {
      await TrackPlayer.pause();
    } catch {
      // ignore
    }
  }, []);

  const localTogglePlayPause = useCallback(async () => {
    try {
      if (localIsPlaying) {
        await TrackPlayer.pause();
      } else {
        await TrackPlayer.play();
      }
    } catch (err) {
      console.warn('[useActivePlayer] localTogglePlayPause error:', err);
      await handlePlaybackError(err);
    }
  }, [localIsPlaying]);

  const localSkipNext = useCallback(async () => {
    try {
      const queue = await TrackPlayer.getQueue();
      const activeTrack = await TrackPlayer.getActiveTrack().catch(() => null);
      const activeKey = trackKey(activeTrack || localActiveTrack);
      let resolvedIdx = -1;
      if (activeKey) {
        resolvedIdx = queue.findIndex((t) => trackKey(t) === activeKey);
      }
      if (resolvedIdx < 0) {
        const currentIdx = await TrackPlayer.getActiveTrackIndex().catch(() => null);
        resolvedIdx = typeof currentIdx === 'number' && currentIdx >= 0 ? currentIdx : 0;
      }

      let nextIndex = -1;
      if (resolvedIdx < queue.length - 1) {
        nextIndex = resolvedIdx + 1;
      } else if (localRepeatMode === RepeatMode.Queue && queue.length > 0) {
        nextIndex = 0;
      }

      if (nextIndex >= 0 && nextIndex < queue.length) {
        const next = queue[nextIndex];
        const allAssets = useStore.getState().allAssets;
        const canonicalId = resolveTrackId(next, allAssets);
        const meta =
          (canonicalId && useStore.getState().metadataMap[canonicalId]) ||
          useStore.getState().metadataMap[next.id];
        const art =
          meta?.artwork ||
          (canonicalId && useStore.getState().artworkMap[canonicalId]) ||
          useStore.getState().artworkMap[next.id] ||
          (typeof next.artwork === 'string' ? next.artwork : null);
        const summary: RemoteTrackSummary = {
          id: canonicalId || next.id,
          title: meta?.title || next.title || 'Unknown Title',
          artist: meta?.artist || next.artist || 'Unknown Artist',
          duration: next.duration || 0,
          hasArtwork: !!art,
        };
        useOptimisticPlayerStore.getState().setOptimisticTrack(summary, art);
        if (useStore.getState().preferences.dynamicColorFromArtwork && art) {
          useThemeStore.getState().updateThemeFromArtwork(art);
        }
        await TrackPlayer.skip(nextIndex);
        await TrackPlayer.play();
      } else {
        await TrackPlayer.skipToNext();
      }
    } catch (err) {
      console.warn('[useActivePlayer] localSkipNext error:', err);
      await handlePlaybackError(err);
    }
  }, [localActiveTrack, localRepeatMode]);

  const localSkipPrevious = useCallback(async () => {
    try {
      const { position } = await TrackPlayer.getProgress().catch(() => ({ position: 0 }));
      if (position > 3) {
        await TrackPlayer.seekTo(0);
        return;
      }

      const playedHistory = useStore.getState().playedHistory;
      let prev: any = null;
      if (playedHistory.length > 0) {
        prev = playedHistory[playedHistory.length - 1];
      } else {
        const queue = await TrackPlayer.getQueue();
        const activeTrack = await TrackPlayer.getActiveTrack().catch(() => null);
        const activeKey = trackKey(activeTrack || localActiveTrack);
        let resolvedIdx = -1;
        if (activeKey) {
          resolvedIdx = queue.findIndex((t) => trackKey(t) === activeKey);
        }
        if (resolvedIdx < 0) {
          const currentIdx = await TrackPlayer.getActiveTrackIndex().catch(() => null);
          resolvedIdx = typeof currentIdx === 'number' && currentIdx >= 0 ? currentIdx : 0;
        }
        if (resolvedIdx > 0) {
          prev = queue[resolvedIdx - 1];
        } else if (localRepeatMode === RepeatMode.Queue && queue.length > 0) {
          prev = queue[queue.length - 1];
        }
      }
      if (prev) {
        const allAssets = useStore.getState().allAssets;
        const canonicalId = resolveTrackId(prev, allAssets);
        const meta =
          (canonicalId && useStore.getState().metadataMap[canonicalId]) ||
          useStore.getState().metadataMap[prev.id];
        const art =
          meta?.artwork ||
          (canonicalId && useStore.getState().artworkMap[canonicalId]) ||
          useStore.getState().artworkMap[prev.id] ||
          (typeof prev.artwork === 'string' ? prev.artwork : null);
        const summary: RemoteTrackSummary = {
          id: canonicalId || prev.id,
          title: meta?.title || prev.title || 'Unknown Title',
          artist: meta?.artist || prev.artist || 'Unknown Artist',
          duration: prev.duration || 0,
          hasArtwork: !!art,
        };
        useOptimisticPlayerStore.getState().setOptimisticTrack(summary, art);
        if (useStore.getState().preferences.dynamicColorFromArtwork && art) {
          useThemeStore.getState().updateThemeFromArtwork(art);
        }
      }
      await skipToPreviousTrack();
    } catch (err) {
      console.warn('[useActivePlayer] localSkipPrevious error:', err);
      await handlePlaybackError(err);
    }
  }, [localActiveTrack, localRepeatMode]);

  const localSeekTo = useCallback(async (position: number) => {
    await TrackPlayer.seekTo(position);
  }, []);

  const localSetRepeatMode = useCallback(async (mode: RepeatMode) => {
    await TrackPlayer.setRepeatMode(mode);
    setStoreRepeatMode(mode);
  }, [setStoreRepeatMode]);

  const localSetShuffle = useCallback(async (enabled: boolean, smart = false) => {
    await setLocalShuffle(enabled, smart);
  }, []);

  const localCyclePlaybackMode = useCallback(async () => {
    await cycleLocalPlaybackMode();
  }, []);

  if (isRemote) {
    const effectiveActive = optimisticTrack ?? remoteState.activeTrack;
    const effectiveArtwork = optimisticArtwork ?? remoteState.artworkUri;
    const effectiveDuration = optimisticTrack ? (optimisticTrack.duration || 0) : (remoteState.activeTrack?.duration ?? 0);

    return {
      isRemote: true,
      remoteDeviceName,
      activeTrack: effectiveActive,
      isPlaying: remoteState.isPlaying,
      duration: effectiveDuration,
      lyrics: remoteState.lyrics,
      artworkUri: effectiveArtwork,
      repeatMode: remoteRepeatMode,
      isShuffle: remoteIsShuffle,
      isSmartShuffle: remoteIsSmartShuffle,
      playbackMode: remotePlaybackMode,

      play: remotePlay,
      pause: remotePause,
      togglePlayPause: remoteTogglePlayPause,
      skipToNext: remoteSkipNext,
      skipToPrevious: remoteSkipPrevious,
      seekTo: remoteSeekTo,
      setRepeatMode: remoteSetRepeatMode,
      setShuffle: remoteSetShuffle,
      cyclePlaybackMode: remoteCyclePlaybackMode,
      disconnect: remoteDisconnect,
    };
  }

  // Format local track summary
  let localSummary: RemoteTrackSummary | null = null;
  let localLyricsSummary: RemoteLyricsSummary | null = null;
  let localArtworkUri: string | null = null;

  if (localActiveTrack) {
    const hasArtwork = !!(localActiveTrack.artwork || localArtworkMap[localActiveTrack.id]);
    localSummary = {
      id: localActiveTrack.id,
      title: localActiveTrack.title || 'Unknown Title',
      artist: localActiveTrack.artist || 'Unknown Artist',
      duration: localActiveTrack.duration || 0,
      hasArtwork,
    };
    localArtworkUri = localActiveTrack.artwork || localArtworkMap[localActiveTrack.id] || null;

    const keys = getLyricsCacheKeys({
      id: localActiveTrack.id,
      url: localActiveTrack.url,
      title: localActiveTrack.title,
      artist: localActiveTrack.artist,
      rawTitle: localActiveTrack.title,
    });
    const cached = findLyricsInCache(useStore.getState().lyricsCache, keys);
    if (cached) {
      let lines: LyricLine[] = cached.parsedLines || [];
      if (lines.length === 0 && (cached.syncedLyrics || cached.lyricsfile)) {
        lines = parseAnySyncedLyrics(cached.lyricsfile, cached.syncedLyrics);
      }
      let lrclibId: string | number | null = null;
      let geniusId: string | number | null = null;
      let geniusUrl: string | null = null;

      if (cached.source === 'lrclib' && cached.id) {
        lrclibId = cached.id.replace('lrclib-', '');
      } else if (cached.source === 'genius') {
        if (cached.id) geniusId = cached.id.replace('genius-', '');
        const candidate = cached.candidates?.find((c) => c.id === cached.id);
        if (candidate?.geniusUrl) geniusUrl = candidate.geniusUrl;
      }

      localLyricsSummary = {
        trackId: localActiveTrack.id,
        lines,
        source: cached.source || null,
        isSynced: (!!cached.syncedLyrics || !!cached.lyricsfile) && lines.length > 0,
        plainLyrics: cached.plainLyrics || undefined,
        syncedLyrics: cached.syncedLyrics || undefined,
        lyricsfile: cached.lyricsfile || undefined,
        lrclibId,
        geniusId,
        geniusUrl,
      };
    }
  }

  const effectiveLocalActive = optimisticTrack ?? localSummary;
  const effectiveLocalArtwork = optimisticArtwork ?? localArtworkUri;
  const effectiveLocalDuration = optimisticTrack ? (optimisticTrack.duration || 0) : (localActiveTrack?.duration ?? 0);

  return {
    isRemote: false,
    remoteDeviceName: null,
    activeTrack: effectiveLocalActive,
    isPlaying: localIsPlaying ?? false,
    duration: effectiveLocalDuration,
    lyrics: localLyricsSummary,
    artworkUri: effectiveLocalArtwork,
    repeatMode: localRepeatMode,
    isShuffle: localIsShuffle,
    isSmartShuffle: localIsShuffle ? localIsSmartShuffle : false,
    playbackMode: getPlaybackMode({
      isShuffle: localIsShuffle,
      isSmartShuffle: localIsSmartShuffle,
      isRepeatOne: localRepeatMode === RepeatMode.Track,
    }),

    play: localPlay,
    pause: localPause,
    togglePlayPause: localTogglePlayPause,
    skipToNext: localSkipNext,
    skipToPrevious: localSkipPrevious,
    seekTo: localSeekTo,
    setRepeatMode: localSetRepeatMode,
    setShuffle: localSetShuffle,
    cyclePlaybackMode: localCyclePlaybackMode,
    disconnect: () => {},
  };
}
