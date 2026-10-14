import TrackPlayer, {
  Capability,
  AppKilledPlaybackBehavior,
  Track,
} from 'react-native-track-player';
import { getQueueSnapshot, getLastPlayback } from './playbackStorage';
import { useStore } from '../store/useStore';
import { useThemeStore } from '../store/useThemeStore';

let MusicWidgetModule: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  MusicWidgetModule = require('../../modules/music-widget/src/MusicWidgetModule').default;
} catch {
  // Ignored
}

export const PLAYBACK_CAPABILITIES = [
  Capability.Play,
  Capability.Pause,
  Capability.SkipToNext,
  Capability.SkipToPrevious,
];

export async function syncAppKilledPlaybackBehavior(keepPlaying?: boolean): Promise<void> {
  try {
    const shouldKeepPlaying =
      keepPlaying !== undefined
        ? keepPlaying
        : useStore.getState().preferences?.keepPlayingWhenAppKilled ?? true;
    await TrackPlayer.updateOptions({
      android: {
        appKilledPlaybackBehavior: shouldKeepPlaying
          ? AppKilledPlaybackBehavior.ContinuePlayback
          : AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
      },
    });
  } catch (e) {
    console.warn('[playerBootstrap] syncAppKilledPlaybackBehavior error:', e);
  }
}

let isPlayerInitializing = false;
let isPlayerInitialized = false;

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

    try {
      const prefs = useStore.getState().preferences;
      await TrackPlayer.updateOptions({
        capabilities: PLAYBACK_CAPABILITIES,
        notificationCapabilities: PLAYBACK_CAPABILITIES,
        compactCapabilities: [Capability.Play, Capability.Pause],
        android: {
          appKilledPlaybackBehavior: prefs?.keepPlayingWhenAppKilled
            ? AppKilledPlaybackBehavior.ContinuePlayback
            : AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
        },
      });

      const savedRepeatMode = useStore.getState().repeatMode;
      if (savedRepeatMode != null) {
        await TrackPlayer.setRepeatMode(savedRepeatMode);
      }
    } catch {
      // ignore
    }

    isPlayerInitialized = true;
    return true;
  } catch (e) {
    console.warn('[playerBootstrap] setup error:', e);
    return false;
  } finally {
    isPlayerInitializing = false;
  }
}

export async function restoreQueueIfNeeded(): Promise<boolean> {
  await setupTrackPlayerIfNeeded();

  try {
    const currentQueue = await TrackPlayer.getQueue();
    if (currentQueue && currentQueue.length > 0) {
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
      await TrackPlayer.setQueue(snapshot.queue as Track[]);

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
      });

      // Widget'ı geri yüklenen parçayla güncelle
      const activeTrack = snapshot.queue[targetIndex] || snapshot.queue[0];
      if (MusicWidgetModule && MusicWidgetModule.updateWidget && activeTrack) {
        try {
          const theme = useThemeStore.getState().theme;
          MusicWidgetModule.updateWidget(
            activeTrack.title || 'RunMusic',
            activeTrack.artist || 'Müzik Çalar',
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
      await TrackPlayer.add([lastPlayback.track]);
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
            lastPlayback.track.artist || 'Müzik Çalar',
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
