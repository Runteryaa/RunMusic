import { Platform, PermissionsAndroid } from 'react-native';
import TrackPlayer, {
  Capability,
  AppKilledPlaybackBehavior,
  Track,
  Event,
  State,
} from 'react-native-track-player';
import { getQueueSnapshot, getLastPlayback } from './playbackStorage';
import { toPlayableTrack, toPlayableTracks } from './playbackUri';
import { useStore } from '../store/useStore';
import { useThemeStore } from '../store/useThemeStore';
import { useRemoteConnectStore } from '../store/useRemoteConnectStore';
import { handlePlaybackError } from './queueController';
import { initAudioEffects } from './audioEffectsService';

let MusicWidgetModule: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  MusicWidgetModule = require('../../modules/music-widget/src/MusicWidgetModule').default;
} catch {
  // Ignored
}

export const PLAYBACK_CAPABILITIES: Capability[] = [
  Capability.Play,
  Capability.Pause,
  Capability.SkipToNext,
  Capability.SkipToPrevious,
  Capability.SeekTo,
];

export const NOTIFICATION_CAPABILITIES: Capability[] = [
  Capability.Play,
  Capability.Pause,
  Capability.SkipToNext,
  Capability.SkipToPrevious,
  Capability.SeekTo,
];

export const COMPACT_CAPABILITIES: Capability[] = [
  Capability.Play,
  Capability.Pause,
  Capability.SkipToNext,
  Capability.SkipToPrevious,
];

export function getTrackPlayerOptions(keepPlaying?: boolean) {
  const shouldKeepPlaying =
    keepPlaying !== undefined
      ? keepPlaying
      : useStore.getState().preferences?.keepPlayingWhenAppKilled ?? true;

  const behavior = shouldKeepPlaying
    ? AppKilledPlaybackBehavior.ContinuePlayback
    : AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification;

  return {
    capabilities: PLAYBACK_CAPABILITIES,
    notificationCapabilities: NOTIFICATION_CAPABILITIES,
    compactCapabilities: COMPACT_CAPABILITIES,
    progressUpdateEventInterval: 2,
    appKilledPlaybackBehavior: behavior,
    android: {
      appKilledPlaybackBehavior: behavior,
    },
  };
}

export async function syncAppKilledPlaybackBehavior(keepPlaying?: boolean): Promise<void> {
  try {
    const isReady = await setupTrackPlayerIfNeeded();
    if (!isReady) return;
    await TrackPlayer.updateOptions(getTrackPlayerOptions(keepPlaying));
  } catch (e) {
    console.warn('[playerBootstrap] syncAppKilledPlaybackBehavior error:', e);
  }
}

let isPlayerInitializing = false;
let isPlayerInitialized = false;
let isGlobalListenersAttached = false;

export function attachGlobalPlayerEventListeners(): void {
  if (isGlobalListenersAttached) return;
  isGlobalListenersAttached = true;

  TrackPlayer.addEventListener(Event.PlaybackError, async (event) => {
    if (useRemoteConnectStore.getState().isRemoteConnected()) {
      return;
    }
    console.warn('[playerBootstrap] PlaybackError event received:', event);
    const activeTrack = await TrackPlayer.getActiveTrack().catch(() => null);
    const activeIndex = await TrackPlayer.getActiveTrackIndex().catch(() => null);
    await handlePlaybackError(event, activeTrack, typeof activeIndex === 'number' ? activeIndex : undefined);
  });

  TrackPlayer.addEventListener(Event.PlaybackState, async (event) => {
    if (event.state === State.Error) {
      if (useRemoteConnectStore.getState().isRemoteConnected()) {
        return;
      }
      console.warn('[playerBootstrap] PlaybackState is Error:', event);
      const activeTrack = await TrackPlayer.getActiveTrack().catch(() => null);
      const activeIndex = await TrackPlayer.getActiveTrackIndex().catch(() => null);
      await handlePlaybackError(event, activeTrack, typeof activeIndex === 'number' ? activeIndex : undefined);
    }
  });
}

export async function setupTrackPlayerIfNeeded(): Promise<boolean> {
  if (isPlayerInitialized) return true;
  if (isPlayerInitializing) {
    while (isPlayerInitializing) {
      await new Promise((res) => setTimeout(res, 50));
    }
    return isPlayerInitialized;
  }

  isPlayerInitializing = true;
  try {
    try {
      await TrackPlayer.setupPlayer();
    } catch {
      // Zaten başlatılmışsa devam et
    }

    if (Platform.OS === 'android' && Platform.Version >= 33) {
      // İzin diyaloğu oynatıcının kurulmasını bekletmesin. Medya bildirimi
      // POST_NOTIFICATIONS verilmese de gösterilebilir; sonucu beklemeye gerek yok.
      PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS' as any).catch(() => {
        // ignore
      });
    }

    try {
      await TrackPlayer.updateOptions(getTrackPlayerOptions());

      const savedRepeatMode = useStore.getState().repeatMode;
      if (savedRepeatMode != null) {
        await TrackPlayer.setRepeatMode(savedRepeatMode);
      }
    } catch {
      // ignore
    }

    attachGlobalPlayerEventListeners();

    isPlayerInitialized = true;
    // Kayıtlı EQ / preamp / ReplayGain ayarlarını oynatıcıya bağla.
    initAudioEffects();
    return true;
  } catch (e) {
    console.warn('[playerBootstrap] setup error:', e);
    return false;
  } finally {
    isPlayerInitializing = false;
  }
}

let restoreQueuePromise: Promise<boolean> | null = null;

/**
 * Aynı anda birden fazla yerden (arayüz, widget servisi, derin bağlantı)
 * çağrıldığında kuyruğu iki kez kurmaya çalışmayı engeller.
 */
export function restoreQueueIfNeeded(): Promise<boolean> {
  if (!restoreQueuePromise) {
    restoreQueuePromise = doRestoreQueueIfNeeded()
      .then((restored) => {
        // Boş/başarısız sonuçta sonraki çağrı yeniden deneyebilsin.
        if (!restored) restoreQueuePromise = null;
        return restored;
      })
      .catch((err) => {
        restoreQueuePromise = null;
        throw err;
      });
  }
  return restoreQueuePromise;
}

async function doRestoreQueueIfNeeded(): Promise<boolean> {
  await setupTrackPlayerIfNeeded();

  try {
    const playbackState = await TrackPlayer.getPlaybackState().catch(() => null);
    const isPlayingOrBuffering =
      playbackState?.state === State.Playing || playbackState?.state === State.Buffering;
    if (isPlayingOrBuffering) {
      return true; // Asla aktif çalan kuyruğu ezme!
    }

    const currentQueue = await TrackPlayer.getQueue();
    if (currentQueue && currentQueue.length > 0) {
      const snapshot = await getQueueSnapshot().catch(() => null);
      if (snapshot && useStore.getState().contextIds.length === 0) {
        useStore.setState({
          contextIds: snapshot.contextIds ?? currentQueue.map((t) => t.id),
          upNextIds: snapshot.upNextIds ?? [],
          isShuffle: Boolean(snapshot.isShuffle),
        });
      }
      return true; // Zaten yüklü
    }
  } catch {
    // ignore
  }

  try {
    const [snapshot, lastPlayback] = await Promise.all([
      getQueueSnapshot(),
      getLastPlayback(),
    ]);

    const restoreQueue = useStore.getState().preferences?.restoreQueueOnLaunch ?? true;

    if (restoreQueue && snapshot && snapshot.queue && snapshot.queue.length > 0) {
      // Kullanıcı biz yüklerken bir parçaya dokunduysa eski kuyruğu geri
      // getirip onun seçimini ezmeyelim.
      const queueBeforeRestore = await TrackPlayer.getQueue().catch(() => []);
      const playbackBeforeRestore = await TrackPlayer.getPlaybackState().catch(() => null);
      const isPlayingBeforeRestore =
        playbackBeforeRestore?.state === State.Playing ||
        playbackBeforeRestore?.state === State.Buffering;
      if (queueBeforeRestore.length > 0 || isPlayingBeforeRestore) {
        return true;
      }

      await TrackPlayer.setQueue(toPlayableTracks(snapshot.queue as Track[]));

      let targetIndex = -1;
      if (lastPlayback?.trackId) {
        targetIndex = snapshot.queue.findIndex(
          (t) => (t.id && t.id === lastPlayback.trackId) || (t.url && t.url === lastPlayback.trackId)
        );
      }
      if (targetIndex < 0 && lastPlayback?.track) {
        const pTrack = lastPlayback.track;
        targetIndex = snapshot.queue.findIndex(
          (t) => (t.id && t.id === pTrack.id) || (t.url && t.url === pTrack.url)
        );
      }
      if (
        targetIndex < 0 &&
        typeof lastPlayback?.trackIndex === 'number' &&
        lastPlayback.trackIndex >= 0 &&
        lastPlayback.trackIndex < snapshot.queue.length
      ) {
        targetIndex = lastPlayback.trackIndex;
      }
      if (
        targetIndex < 0 &&
        typeof snapshot.activeIndex === 'number' &&
        snapshot.activeIndex >= 0 &&
        snapshot.activeIndex < snapshot.queue.length
      ) {
        targetIndex = snapshot.activeIndex;
      }
      if (targetIndex < 0) {
        targetIndex = 0;
      }

      if (targetIndex >= 0 && targetIndex < snapshot.queue.length) {
        try {
          await TrackPlayer.skip(targetIndex);
        } catch (skipErr) {
          console.warn('[playerBootstrap] skip error:', skipErr);
        }
      }

      const isMatchedWithLastPlayback =
        targetIndex >= 0 &&
        lastPlayback?.trackId &&
        (snapshot.queue[targetIndex]?.id === lastPlayback.trackId ||
          snapshot.queue[targetIndex]?.url === lastPlayback.trackId);

      const resumeAt = isMatchedWithLastPlayback
        ? (lastPlayback?.position ?? snapshot.position)
        : (snapshot.position ?? lastPlayback?.position ?? 0);

      if (resumeAt && resumeAt > 0) {
        try {
          await TrackPlayer.seekTo(resumeAt);
        } catch (seekErr) {
          console.warn('[playerBootstrap] seek error:', seekErr);
        }
      }

      const restoredContextIds =
        snapshot.contextIds && snapshot.contextIds.length > 0
          ? snapshot.contextIds
          : snapshot.queue.map((t) => t.id);

      useStore.setState({
        upNextIds: snapshot.upNextIds ?? [],
        contextIds: restoredContextIds,
        isShuffle: Boolean(snapshot.isShuffle),
        playedHistory: [],
      });

      // Widget'ı geri yüklenen parçayla güncelle
      const activeTrack = snapshot.queue[targetIndex] || snapshot.queue[0];
      if (MusicWidgetModule && MusicWidgetModule.updateWidget && activeTrack) {
        try {
          const theme = useThemeStore.getState().theme;
          MusicWidgetModule.updateWidget(
            activeTrack.title || 'RunMusic',
            activeTrack.artist || 'RunMusic',
            activeTrack.artwork || null,
            false,
            theme.primary || '#212121'
          );
        } catch {
          // ignore
        }
      }

      return true;
    } else if (lastPlayback && lastPlayback.track) {
      await TrackPlayer.add([toPlayableTrack(lastPlayback.track as Track)]);
      try {
        await TrackPlayer.skip(0);
      } catch {
        // ignore
      }
      if (lastPlayback.position && lastPlayback.position > 0) {
        await TrackPlayer.seekTo(lastPlayback.position);
      }
      if (MusicWidgetModule && MusicWidgetModule.updateWidget && lastPlayback.track) {
        try {
          const theme = useThemeStore.getState().theme;
          MusicWidgetModule.updateWidget(
            lastPlayback.track.title || 'RunMusic',
            lastPlayback.track.artist || 'RunMusic',
            lastPlayback.track.artwork || null,
            false,
            theme.primary || '#212121'
          );
        } catch {
          // ignore
        }
      }
      return true;
    }
  } catch (restoreErr) {
    console.warn('[playerBootstrap] restore error:', restoreErr);
  }
  return false;
}
