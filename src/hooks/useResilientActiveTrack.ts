import { useEffect, useState } from 'react';
import TrackPlayer, {
  Event,
  useTrackPlayerEvents,
  type Track,
} from 'react-native-track-player';
import { useIsAppActive } from './useIsAppActive';

/**
 * Etkin parçayı, oynatıcı henüz hazır değilken kaybolmayacak şekilde okur.
 *
 * `react-native-track-player`'ın `useActiveTrack` kancası ilk değeri **yalnızca
 * bir kez** okur (`getActiveTrack()`) ve hata durumunda sessizce vazgeçer;
 * sonrasında yalnızca `PlaybackActiveTrackChanged` olayını dinler. Uygulama
 * arka plandan dönerken ya da süreç yeniden başlarken `TrackPlayer.setupPlayer()`
 * henüz bitmemişse bu ilk okuma reddedilir ve kanca **sonsuza kadar boş** kalır.
 * MiniPlayer tam olarak bu yüzden, sıradaki şarkıya geçilene kadar (ilk
 * `PlaybackActiveTrackChanged` olayına kadar) görünmüyordu.
 *
 * Bu kanca aynı sözleşmeyi sunar, ancak:
 * - etkin parçayı kısa aralıklarla artan gecikmeyle yeniden dener,
 * - uygulama ön plana her döndüğünde yeniden okur,
 * - olay aboneliğini korur.
 */
export function useResilientActiveTrack(): Track | undefined {
  const [track, setTrack] = useState<Track | undefined>(undefined);
  const isAppActive = useIsAppActive();

  useTrackPlayerEvents([Event.PlaybackActiveTrackChanged], (event) => {
    setTrack(event.track ?? undefined);
  });

  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    /*
     * İlk deneme hemen, sonrakiler artan aralıklarla. Oynatıcı kurulumu normal
     * şartlarda ilk denemede hazır olur; yavaş cihazlarda/soğuk açılışta
     * birkaç saniyeye kadar beklemek yeterli.
     */
    const RETRY_DELAYS = [0, 200, 500, 1000, 2000, 4000];

    const readActiveTrack = async () => {
      if (cancelled) return;
      try {
        const current = await TrackPlayer.getActiveTrack();
        if (cancelled) return;
        if (current) {
          setTrack(current);
          return;
        }
      } catch {
        // Oynatıcı henüz kurulmadı: aşağıda yeniden denenecek.
      }
      if (cancelled) return;
      if (attempt < RETRY_DELAYS.length - 1) {
        attempt += 1;
        timer = setTimeout(readActiveTrack, RETRY_DELAYS[attempt]);
      }
    };

    void readActiveTrack();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isAppActive]);

  return track;
}
