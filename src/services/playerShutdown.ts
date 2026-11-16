import TrackPlayer from 'react-native-track-player';
import { clearPlaybackQueue, clearUpNextQueue } from './queueController';
import { clearQueueSnapshot } from './playbackStorage';
import { useOptimisticPlayerStore } from '../store/useOptimisticPlayerStore';
import { usePlayerUIStore } from '../store/usePlayerUIStore';
import { useSleepTimerStore } from '../store/useSleepTimerStore';
import { useStore } from '../store/useStore';
import { useThemeStore } from '../store/useThemeStore';

/**
 * Oynatıcıyı **tamamen** kapatır.
 *
 * Daha önce bu davranış Android'in geri tuşuna bağlıydı: ikincil bir ekrandan
 * geri dönüldüğünde uygulama kapanıyor, mini oynatıcı kayboluyor ve şarkı
 * kesiliyordu. Artık geri tuşu yalnızca kütüphaneye dönüyor; oynatıcıyı
 * gerçekten kapatmak isteyenler Ayarlar > Bellek Tanılama bölümündeki düğmeyi
 * kullanıyor.
 *
 * Yapılanlar:
 *  - çalma durdurulur ve native kuyruk boşaltılır (mini oynatıcı kaybolur),
 *  - bekleyen "sırada" öğeleri ve kütüphane bağlamı temizlenir,
 *  - kaydedilmiş kuyruk anlık görüntüsü silinir (uygulama tekrar açıldığında
 *    eski kuyruk geri gelmez),
 *  - uyku zamanlayıcısı iptal edilir,
 *  - tam ekran oynatıcı kapatılır ve kapak renginden türetilen tema varsayılana
 *    döner.
 */
export async function shutdownPlayback(): Promise<void> {
  try {
    useSleepTimerStore.getState().stopTimer();
    usePlayerUIStore.getState().closeFullscreenPlayer();
    useStore.getState().clearPlayedHistory();
    useOptimisticPlayerStore.getState().clearOptimisticTrack();

    // Önce stilleri sıfırla: reset() bekleyen native işleri de temizler.
    await TrackPlayer.stop().catch(() => {});
    await TrackPlayer.reset().catch(() => {});

    await clearPlaybackQueue().catch(() => {});
    await clearUpNextQueue().catch(() => {});
    await clearQueueSnapshot().catch(() => {});

    useThemeStore.getState().resetTheme();
  } catch (error) {
    console.warn('[playerShutdown] failed to shut down playback:', error);
  }
}
