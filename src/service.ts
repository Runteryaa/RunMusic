import TrackPlayer, { Event } from 'react-native-track-player';

export default async function playbackService() {
  TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteNext, () => TrackPlayer.skipToNext());
  TrackPlayer.addEventListener(Event.RemotePrevious, () => TrackPlayer.skipToPrevious());

  // `Event.RemoteStop` bilinçli olarak dinlenmiyor.
  //
  // Eskiden burada `TrackPlayer.reset()` çağrılıyordu; bu, kuyruğu ve konumu
  // tamamen sildiği için müziği geri döndürülemez şekilde durduruyordu.
  // Durdurma yeteneği (`Capability.Stop`) kaldırıldı, ancak bazı OEM'ler veya
  // harici cihazlar (Bluetooth, araç ünitesi) yine de stop gönderebilir.
  // Böyle bir sinyal gelirse çalmaya devam etmek, müziği öldürmekten iyidir.
}
