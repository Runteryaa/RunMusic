import { useCallback } from 'react';
import TrackPlayer, {
  useActiveTrack,
  useIsPlaying,
  RepeatMode,
} from 'react-native-track-player';
import { useRemoteConnectStore } from '../store/useRemoteConnectStore';
import { useStore } from '../store/useStore';
import { remoteSyncManager } from '../services/remote/remoteSyncManager';
import { skipToPreviousTrack, setShuffle as setLocalShuffle } from '../services/queueController';
import { findLyricsInCache } from '../services/persistSanitize';
import { parseAnySyncedLyrics, type LyricLine } from '../services/lyricsService';
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

  // Controls
  play: () => Promise<void>;
  pause: () => Promise<void>;
  togglePlayPause: () => Promise<void>;
  skipToNext: () => Promise<void>;
  skipToPrevious: () => Promise<void>;
  seekTo: (position: number) => Promise<void>;
  setRepeatMode: (mode: RepeatMode) => Promise<void>;
  setShuffle: (enabled: boolean) => Promise<void>;
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

  // Local Player hooks (only subscribed when not remote)
  const localActiveTrack = useActiveTrack();
  const { playing: localIsPlaying } = useIsPlaying();
  const localArtworkMap = useStore((s) => s.artworkMap);
  const localIsShuffle = useStore((s) => s.isShuffle);
  const localRepeatMode = useStore((s) => s.repeatMode);
  const setStoreRepeatMode = useStore((s) => s.setRepeatMode);

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
    remoteSyncManager.sendClientCommand({ type: 'COMMAND_SKIP_NEXT' });
  }, []);

  const remoteSkipPrevious = useCallback(async () => {
    remoteSyncManager.sendClientCommand({ type: 'COMMAND_SKIP_PREVIOUS' });
  }, []);

  const remoteSeekTo = useCallback(async (position: number) => {
    useRemoteConnectStore.getState().setOptimisticPosition(position);
    remoteSyncManager.sendClientCommand({ type: 'COMMAND_SEEK', position });
  }, []);

  const remoteSetRepeatMode = useCallback(async (mode: RepeatMode) => {
    useRemoteConnectStore.getState().setOptimisticRepeatMode(mode);
    remoteSyncManager.sendClientCommand({ type: 'COMMAND_SET_REPEAT', mode });
  }, []);

  const remoteSetShuffle = useCallback(async (enabled: boolean) => {
    useRemoteConnectStore.getState().setOptimisticShuffle(enabled);
    remoteSyncManager.sendClientCommand({ type: 'COMMAND_SET_SHUFFLE', enabled });
  }, []);

  const remoteDisconnect = useCallback(() => {
    remoteSyncManager.disconnectClient();
  }, []);

  // ==========================================
  // LOCAL CONTROLS & STATE
  // ==========================================
  const localPlay = useCallback(async () => {
    await TrackPlayer.play();
  }, []);

  const localPause = useCallback(async () => {
    await TrackPlayer.pause();
  }, []);

  const localTogglePlayPause = useCallback(async () => {
    if (localIsPlaying) {
      await TrackPlayer.pause();
    } else {
      await TrackPlayer.play();
    }
  }, [localIsPlaying]);

  const localSkipNext = useCallback(async () => {
    await TrackPlayer.skipToNext();
  }, []);

  const localSkipPrevious = useCallback(async () => {
    await skipToPreviousTrack();
  }, []);

  const localSeekTo = useCallback(async (position: number) => {
    await TrackPlayer.seekTo(position);
  }, []);

  const localSetRepeatMode = useCallback(async (mode: RepeatMode) => {
    await TrackPlayer.setRepeatMode(mode);
    setStoreRepeatMode(mode);
  }, [setStoreRepeatMode]);

  const localSetShuffle = useCallback(async (enabled: boolean) => {
    await setLocalShuffle(enabled);
  }, []);

  if (isRemote) {
    return {
      isRemote: true,
      remoteDeviceName,
      activeTrack: remoteState.activeTrack,
      isPlaying: remoteState.isPlaying,
      duration: remoteState.activeTrack?.duration ?? 0,
      lyrics: remoteState.lyrics,
      artworkUri: remoteState.artworkUri,
      repeatMode: remoteState.repeatMode,
      isShuffle: remoteState.isShuffle,

      play: remotePlay,
      pause: remotePause,
      togglePlayPause: remoteTogglePlayPause,
      skipToNext: remoteSkipNext,
      skipToPrevious: remoteSkipPrevious,
      seekTo: remoteSeekTo,
      setRepeatMode: remoteSetRepeatMode,
      setShuffle: remoteSetShuffle,
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

    const cached = findLyricsInCache(useStore.getState().lyricsCache, [localActiveTrack.id]);
    if (cached) {
      let lines: LyricLine[] = cached.parsedLines || [];
      if (lines.length === 0 && cached.syncedLyrics) {
        lines = parseAnySyncedLyrics(cached.syncedLyrics);
      }
      localLyricsSummary = {
        lines,
        source: cached.source || null,
        isSynced: !!cached.syncedLyrics && lines.length > 0,
        plainLyrics: cached.plainLyrics || undefined,
      };
    }
  }

  return {
    isRemote: false,
    remoteDeviceName: null,
    activeTrack: localSummary,
    isPlaying: localIsPlaying ?? false,
    duration: localActiveTrack?.duration ?? 0,
    lyrics: localLyricsSummary,
    artworkUri: localArtworkUri,
    repeatMode: localRepeatMode,
    isShuffle: localIsShuffle,

    play: localPlay,
    pause: localPause,
    togglePlayPause: localTogglePlayPause,
    skipToNext: localSkipNext,
    skipToPrevious: localSkipPrevious,
    seekTo: localSeekTo,
    setRepeatMode: localSetRepeatMode,
    setShuffle: localSetShuffle,
    disconnect: () => {},
  };
}
