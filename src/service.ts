import TrackPlayer, { Event, State } from 'react-native-track-player';
import { saveLastPlayback, updateQueueSnapshotActiveIndex } from './services/playbackStorage';
import { restoreQueueIfNeeded } from './services/playerBootstrap';
import {
  recordTrackToHistory,
  skipToPreviousTrack,
  getIsNavigatingHistory,
} from './services/queueController';
import { useThemeStore } from './store/useThemeStore';

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
    try {
      await restoreQueueIfNeeded();
      await TrackPlayer.play();
    } catch (e) {
      console.warn('RemotePlay error in service:', e);
    }
  });
  TrackPlayer.addEventListener(Event.RemotePause, async () => {
    try {
      await TrackPlayer.pause();
      await persistCurrentPlaybackOnPause();
    } catch (e) {
      console.warn('RemotePause error in service:', e);
    }
  });
  TrackPlayer.addEventListener(Event.RemoteNext, async () => {
    try {
      await restoreQueueIfNeeded();
      await TrackPlayer.skipToNext();
      await TrackPlayer.play();
    } catch (e) {
      console.warn('RemoteNext error in service:', e);
    }
  });
  TrackPlayer.addEventListener(Event.RemotePrevious, async () => {
    try {
      await restoreQueueIfNeeded();
      await skipToPreviousTrack();
    } catch (e) {
      console.warn('RemotePrevious error in service:', e);
    }
  });
  TrackPlayer.addEventListener(Event.RemoteSeek, async (event) => {
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
    try {
      if (event.lastTrack && !getIsNavigatingHistory()) {
        recordTrackToHistory(event.lastTrack);
      }
      if (event.track && typeof event.index === 'number') {
        const trackId = String(event.track.id ?? event.track.url ?? '');
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
          true
        );
        await updateQueueSnapshotActiveIndex(event.index, 0);

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

  // Çalma durumu değiştiğinde (play/pause) widget simgesini güncelle
  TrackPlayer.addEventListener(Event.PlaybackState, async (event) => {
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
