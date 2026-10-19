import TrackPlayer, { Event, State } from 'react-native-track-player';
import { saveLastPlayback, updateQueueSnapshotActiveIndex } from './services/playbackStorage';
import { restoreQueueIfNeeded } from './services/playerBootstrap';
import {
  recordTrackToHistory,
  skipToPreviousTrack,
  getIsNavigatingHistory,
  handlePlaybackError,
  clearSessionFailedTracks,
  recordAttemptedTrack,
  resolveTrackId,
} from './services/queueController';
import { cleanYouTubeTitle, cleanDisplayTitle } from './services/lyricsService';
import { useStore } from './store/useStore';
import { useThemeStore } from './store/useThemeStore';
import { useRemoteConnectStore } from './store/useRemoteConnectStore';
import { useOptimisticPlayerStore } from './store/useOptimisticPlayerStore';
import { remoteSyncManager } from './services/remote/remoteSyncManager';

let MusicWidgetModule: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  MusicWidgetModule = require('../modules/music-widget/src/MusicWidgetModule').default;
} catch {
  // Ignored
}

const persistCurrentPlaybackOnPause = async () => {
  try {
    const activeTrack = await TrackPlayer.getActiveTrack();
    const activeIndex = await TrackPlayer.getActiveTrackIndex();
    const { position } = await TrackPlayer.getProgress();
    if (activeTrack && typeof activeIndex === 'number') {
      const trackId = String(activeTrack.id ?? activeTrack.url ?? '');
      await saveLastPlayback(
        {
          trackId,
          trackIndex: activeIndex,
          position: position > 0 ? position : 0,
          track: {
            id: trackId,
            url: String(activeTrack.url ?? ''),
            title: activeTrack.title,
            artist: activeTrack.artist,
            artwork: typeof activeTrack.artwork === 'string' ? activeTrack.artwork : undefined,
          },
        },
        true
      );
      await updateQueueSnapshotActiveIndex(activeIndex, position > 0 ? position : 0);
    }
  } catch {
    // ignore
  }
};

export default async function playbackService() {
  // Arka planda başlatıldığında (ör. widget veya medya düğmesi) oynatıcının ve kuyruğun hazır olduğundan emin ol
  restoreQueueIfNeeded().catch(() => {});

  TrackPlayer.addEventListener(Event.RemotePlay, async () => {
    if (useRemoteConnectStore.getState().isRemoteConnected()) {
      useRemoteConnectStore.getState().setOptimisticIsPlaying(true);
      TrackPlayer.play().catch(() => {});
      remoteSyncManager.sendPlay();
      return;
    }
    try {
      await restoreQueueIfNeeded();
      await TrackPlayer.play();
    } catch (e) {
      console.warn('RemotePlay error in service:', e);
      const activeTrack = await TrackPlayer.getActiveTrack();
      const activeIndex = await TrackPlayer.getActiveTrackIndex();
      await handlePlaybackError(e, activeTrack, activeIndex);
    }
  });
  TrackPlayer.addEventListener(Event.RemotePause, async () => {
    if (useRemoteConnectStore.getState().isRemoteConnected()) {
      useRemoteConnectStore.getState().setOptimisticIsPlaying(false);
      TrackPlayer.pause().catch(() => {});
      remoteSyncManager.sendPause();
      return;
    }
    try {
      await TrackPlayer.pause();
      await persistCurrentPlaybackOnPause();
    } catch (e) {
      console.warn('RemotePause error in service:', e);
    }
  });
  TrackPlayer.addEventListener(Event.RemoteNext, async () => {
    if (useRemoteConnectStore.getState().isRemoteConnected()) {
      remoteSyncManager.sendSkipToNext();
      return;
    }
    try {
      await restoreQueueIfNeeded();
      await TrackPlayer.skipToNext();
      await TrackPlayer.play();
    } catch (e) {
      console.warn('RemoteNext error in service:', e);
      const activeTrack = await TrackPlayer.getActiveTrack();
      const activeIndex = await TrackPlayer.getActiveTrackIndex();
      await handlePlaybackError(e, activeTrack, activeIndex);
    }
  });
  TrackPlayer.addEventListener(Event.PlaybackError, async (event) => {
    if (useRemoteConnectStore.getState().isRemoteConnected()) {
      return;
    }
    console.warn('[playbackService] PlaybackError event received:', event);
    const activeTrack = await TrackPlayer.getActiveTrack();
    const activeIndex = await TrackPlayer.getActiveTrackIndex();
    await handlePlaybackError(event, activeTrack, activeIndex);
  });
  TrackPlayer.addEventListener(Event.RemotePrevious, async () => {
    if (useRemoteConnectStore.getState().isRemoteConnected()) {
      remoteSyncManager.sendSkipToPrevious();
      return;
    }
    try {
      await restoreQueueIfNeeded();
      await skipToPreviousTrack();
    } catch (e) {
      console.warn('RemotePrevious error in service:', e);
    }
  });
  TrackPlayer.addEventListener(Event.RemoteSeek, async (event) => {
    if (useRemoteConnectStore.getState().isRemoteConnected()) {
      if (typeof event.position === 'number') {
        remoteSyncManager.sendSeek(event.position);
        try {
          await TrackPlayer.seekTo(event.position);
        } catch {
          // ignore
        }
      }
      return;
    }
    try {
      if (typeof event.position === 'number') {
        await TrackPlayer.seekTo(event.position);
      }
    } catch (e) {
      console.warn('RemoteSeek error in service:', e);
    }
  });

  // Parça değiştiğinde (otomatik geçiş, next/prev, remote vb.) konumu ve aktif indeksi anında kaydet.
  // Bu sayede uygulama kapatılıp açıldığında karışık (shuffled) veya düz kuyruk kaldığı yerden devam eder.
  TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, async (event) => {
    if (useRemoteConnectStore.getState().isRemoteConnected()) {
      return; // Uzak bağlantı gölge parçası yerel geçmişe veya son çalınanlara kaydedilmez
    }
    try {
      if (event.lastTrack && !getIsNavigatingHistory()) {
        recordTrackToHistory(event.lastTrack);
      }
      if (event.track && typeof event.index === 'number') {
        clearSessionFailedTracks();
        recordAttemptedTrack(event.track, event.index);
        const rawId = String(event.track.id ?? '').trim();
        const rawUrl = String(event.track.url ?? '').trim();
        const allAssets = useStore.getState().allAssets;
        const canonicalId = resolveTrackId(event.track, allAssets);
        const metadataMap = useStore.getState().metadataMap;
        const artworkMap = useStore.getState().artworkMap;

        const meta =
          (canonicalId && metadataMap[canonicalId]) ||
          (rawId && metadataMap[rawId]) ||
          (rawUrl && metadataMap[rawUrl]) ||
          undefined;

        const art =
          meta?.artwork ||
          (canonicalId && artworkMap[canonicalId]) ||
          (rawId && artworkMap[rawId]) ||
          (rawUrl && artworkMap[rawUrl]) ||
          (typeof event.track.artwork === 'string' ? event.track.artwork : null);

        const rawArtist = meta?.artist || event.track.artist || '';
        const cleanArt =
          rawArtist && rawArtist !== 'Local Audio' && rawArtist !== 'Bilinmeyen Sanatçı'
            ? cleanYouTubeTitle(rawArtist)
            : (rawArtist || 'Bilinmeyen Sanatçı');

        const rawTitle = meta?.title || event.track.title || '';
        const cleanTit =
          cleanDisplayTitle(rawTitle, cleanArt !== 'Bilinmeyen Sanatçı' ? cleanArt : undefined) ||
          rawTitle ||
          'Unknown Title';

        const trackId = canonicalId || rawId || rawUrl;
        const summary = {
          id: trackId,
          title: cleanTit,
          artist: cleanArt,
          duration: event.track.duration || 0,
          hasArtwork: !!art,
        };
        useOptimisticPlayerStore.getState().setOptimisticTrack(summary, art);
        if (art && useStore.getState().preferences.dynamicColorFromArtwork) {
          useThemeStore.getState().updateThemeFromArtwork(art);
        }

        // Native bildirim ve kilit ekranını temizlenmiş meta verilerle senkronize et
        if (
          cleanTit !== event.track.title ||
          cleanArt !== event.track.artist ||
          (art && art !== event.track.artwork)
        ) {
          TrackPlayer.updateMetadataForTrack(event.index, {
            title: cleanTit,
            artist: cleanArt,
            artwork: art || undefined,
          }).catch(() => {});
        }

        await saveLastPlayback(
          {
            trackId,
            trackIndex: event.index,
            position: 0,
            track: {
              id: trackId,
              url: String(event.track.url ?? ''),
              title: event.track.title,
              artist: event.track.artist,
              artwork: typeof event.track.artwork === 'string' ? event.track.artwork : undefined,
            },
          },
          false
        );
        updateQueueSnapshotActiveIndex(event.index, 0).catch(() => {});

        if (MusicWidgetModule && MusicWidgetModule.updateWidget) {
          const isPlaying = (await TrackPlayer.getPlaybackState()).state === State.Playing;
          const theme = useThemeStore.getState().theme;
          MusicWidgetModule.updateWidget(
            event.track.title || 'RunMusic',
            event.track.artist || 'Müzik Çalar',
            typeof event.track.artwork === 'string' ? event.track.artwork : null,
            isPlaying,
            theme.primary || '#212121'
          );
        }
      }
    } catch (e) {
      console.warn('PlaybackActiveTrackChanged listener error in service:', e);
    }
  });

  // Çalma durumu değiştiğinde (play/pause/error)
  TrackPlayer.addEventListener(Event.PlaybackState, async (event) => {
    if (event.state === State.Playing) {
      clearSessionFailedTracks();
    }
    if (event.state === State.Error) {
      if (useRemoteConnectStore.getState().isRemoteConnected()) {
        return;
      }
      console.warn('[playbackService] PlaybackState is Error:', event);
      const activeTrack = await TrackPlayer.getActiveTrack().catch(() => null);
      const activeIndex = await TrackPlayer.getActiveTrackIndex().catch(() => null);
      await handlePlaybackError(event, activeTrack, typeof activeIndex === 'number' ? activeIndex : undefined);
    }
    if (MusicWidgetModule && MusicWidgetModule.updateWidget) {
      try {
        const active = await TrackPlayer.getActiveTrack();
        const isPlaying = event.state === State.Playing;
        const theme = useThemeStore.getState().theme;
        MusicWidgetModule.updateWidget(
          active?.title || 'RunMusic',
          active?.artist || 'Müzik Çalar',
          typeof active?.artwork === 'string' ? active?.artwork : null,
          isPlaying,
          theme.primary || '#212121'
        );
      } catch {
        // ignore
      }
    }
  });

  if (MusicWidgetModule && MusicWidgetModule.addListener) {
    MusicWidgetModule.addListener('onWidgetAction', async (event: { action: string }) => {
      if (useRemoteConnectStore.getState().isRemoteConnected()) {
        if (event.action === 'play_pause') {
          const isPlaying = useRemoteConnectStore.getState().remoteState.isPlaying;
          if (isPlaying) {
            remoteSyncManager.sendPause();
          } else {
            remoteSyncManager.sendPlay();
          }
        } else if (event.action === 'next') {
          remoteSyncManager.sendSkipToNext();
        } else if (event.action === 'prev') {
          remoteSyncManager.sendSkipToPrevious();
        }
        return;
      }
      try {
        await restoreQueueIfNeeded();
        if (event.action === 'play_pause') {
          const state = await TrackPlayer.getPlaybackState();
          if (state.state === State.Playing) {
            await TrackPlayer.pause();
            await persistCurrentPlaybackOnPause();
          } else {
            await TrackPlayer.play();
          }
        } else if (event.action === 'next') {
          await TrackPlayer.skipToNext();
          await TrackPlayer.play();
        } else if (event.action === 'prev') {
          await skipToPreviousTrack();
        }
      } catch (e) {
        console.warn('Widget action error in service:', e);
      }
    });
  }

  // `Event.RemoteStop` bilinçli olarak dinlenmiyor.
  //
  // Eskiden burada `TrackPlayer.reset()` çağrılıyordu; bu, kuyruğu ve konumu
  // tamamen sildiği için müziği geri döndürülemez şekilde durduruyordu.
  // Durdurma yeteneği (`Capability.Stop`) kaldırıldı, ancak bazı OEM'ler veya
  // harici cihazlar (Bluetooth, araç ünitesi) yine de stop gönderebilir.
  // Böyle bir sinyal gelirse çalmaya devam etmek, müziği öldürmekten iyidir.
}
