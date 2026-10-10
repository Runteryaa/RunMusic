import TrackPlayer, { Event, State } from 'react-native-track-player';

let MusicWidgetModule: any = null;
try {
  MusicWidgetModule = require('../modules/music-widget/src/MusicWidgetModule').default;
} catch (e) {
  // Ignored
}

export default async function playbackService() {
  TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteNext, () => TrackPlayer.skipToNext());
  TrackPlayer.addEventListener(Event.RemotePrevious, () => TrackPlayer.skipToPrevious());

  if (MusicWidgetModule && MusicWidgetModule.addListener) {
    MusicWidgetModule.addListener('onWidgetAction', async (event: { action: string }) => {
      try {
        if (event.action === 'play_pause') {
          const state = await TrackPlayer.getPlaybackState();
          if (state.state === State.Playing) {
            await TrackPlayer.pause();
          } else {
            await TrackPlayer.play();
          }
        } else if (event.action === 'next') {
          await TrackPlayer.skipToNext();
        } else if (event.action === 'prev') {
          await TrackPlayer.skipToPrevious();
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
