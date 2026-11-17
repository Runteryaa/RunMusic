import { useEffect, useState } from 'react';
import { isPlaying as readNativeIsPlaying, useIsPlaying } from 'react-native-track-player';
import { useIsAppActive } from './useIsAppActive';

/**
 * Oynatma durumunu (çalıyor/duraklatıldı) **native oynatıcıdan** doğrular.
 *
 * NEDEN: `react-native-track-player`'ın `useIsPlaying()` kancası yalnızca
 * native olaylara (`PlaybackState`, `PlaybackPlayWhenReadyChanged`) güvenir.
 * İlk okuma `setupPlayer()` tamamlanmadan yapılırsa sessizce reddedilir ve
 * ardından bir olay gelmezse kanca **sonsuza kadar** `undefined` kalır. Aynı
 * şekilde Android'de oynatıcı servisi yeniden başladığında bir olay kaçabilir.
 * Bu durumda arayüz "duraklatıldı" sanır: oynat düğmesine basmak zaten çalan
 * parçayı yeniden başlatmayı dener (hiçbir şey olmaz), duraklat ise hiç
 * çağrılmaz. Kullanıcı açısından "player dondu, tuşlar çalışmıyor" görünür;
 * oysa dokunuşlar algılanıyor, yalnızca bayat duruma göre işlem yapılıyor.
 *
 * Çözüm: kanca değeri bilinmiyorsa veya native gerçek durumla **kalıcı olarak**
 * çelişiyorsa native değer esas alınır. Tek bir çelişki (düğmeye basıldıktan
 * hemen sonraki tur) yok sayılır; böylece normalde olayın güncellemesi beklenir
 * ve ikon gereksiz yere zıplamaz.
 */

/** Native durum yoklamasının aralığı. İki köprü çağrısı, ihmal edilebilir maliyet. */
const POLL_INTERVAL_MS = 2000;

/**
 * Kaç ardışık yoklamada çelişki görülürse native durumun doğru olduğuna karar
 * verilir. 2 → en geç ~4 saniyede kendini onarır.
 */
const DIVERGENCE_THRESHOLD = 2;

/**
 * Native oynatıcıdan "gerçekten çalıyor mu?" bilgisini okur.
 * Oynatıcı hazır değilse `null` döner; çağıran taraf kanca değerine düşebilir.
 */
export async function readNativePlaying(): Promise<boolean | null> {
  try {
    const { playing } = await readNativeIsPlaying();
    return typeof playing === 'boolean' ? playing : null;
  } catch {
    return null;
  }
}

export function useResilientIsPlaying(enabled = true): boolean {
  const { playing } = useIsPlaying();
  const isAppActive = useIsAppActive();
  const [nativePlaying, setNativePlaying] = useState<boolean | undefined>(undefined);
  const [divergence, setDivergence] = useState(0);

  useEffect(() => {
    if (!enabled || !isAppActive) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (cancelled) return;
      timer = setTimeout(read, POLL_INTERVAL_MS);
    };

    const read = async () => {
      if (cancelled) return;
      const native = await readNativePlaying();
      if (cancelled) {
        return;
      }
      if (native !== null) {
        setNativePlaying(native);
        setDivergence((current) =>
          playing === undefined || playing === native
            ? 0
            : Math.min(DIVERGENCE_THRESHOLD, current + 1)
        );
      }
      schedule();
    };

    void read();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // `playing` değişince yoklama sıfırlanır: düğmeye basıldıktan sonra kanca
    // hemen güncellenirse çelişki sayacı da sıfırlanmış olur.
  }, [enabled, isAppActive, playing]);

  if (playing === undefined) {
    return nativePlaying ?? false;
  }
  if (nativePlaying !== undefined && nativePlaying !== playing && divergence >= DIVERGENCE_THRESHOLD) {
    return nativePlaying;
  }
  return playing;
}
