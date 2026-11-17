import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import {
  ensureConnectionSecretsLoaded,
  hasActiveScrobbling,
} from '../store/useConnectionsStore';
import { flushScrobbles } from './connections/scrobbleService';

/**
 * Arka planda scrobble kuyruğunu boşaltan görev.
 *
 * NEDEN: Kullanıcı uygulamayı arka plana attığında veya kapattığında
 * Last.fm/ListenBrainz'e gönderilemeyen dinlemeler kuyrukta kalıyordu. Bu görev
 * WorkManager üzerinden (en erken 15 dakikada bir, sistem uygun gördüğünde)
 * yalnızca AKTİF bir bağlantı varsa kuyruğu boşaltır.
 *
 * ÖNEMLİ: Bu dosya `index.js` giriş noktasından, React ağacı kurulmadan ÖNCE
 * import edilir. `TaskManager.defineTask` global kapsamda tanımlanmazsa görev
 * arka planda sessizce hiç çalışmaz.
 *
 * Uygulamanın kendi istatistiklerine (`statsDatabase`) dokunmaz; scrobble
 * kuyruğu tamamen ayrı bir katmandır.
 */

export const BACKGROUND_SCROBBLE_TASK = 'runmusic-background-scrobble';

/** Android WorkManager'ın izin verdiği en kısa aralık. */
const MIN_INTERVAL_MINUTES = 15;

TaskManager.defineTask(BACKGROUND_SCROBBLE_TASK, async () => {
  try {
    // Arka plan JS bağlamında store henüz hidrasyon yapmamış olabilir.
    await ensureConnectionSecretsLoaded();

    if (!hasActiveScrobbling()) {
      // Bağlantı yoksa ağ isteği atılmaz; görev başarıyla "yapacak iş yok"
      // olarak döner ki sistem gereksiz yeniden deneme yapmasın.
      return BackgroundTask.BackgroundTaskResult.Success;
    }

    await flushScrobbles();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    console.warn('[backgroundScrobble] görev başarısız:', error);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

let registrationPromise: Promise<void> | null = null;
let lastRequestedState: boolean | null = null;

/**
 * Arka plan görevini bağlantı durumuna göre kaydeder/kaldırır (idempotent).
 * Bağlantı kurulduğunda bir kez kaydedilir; tüm bağlantılar kaldırıldığında
 * pil tüketmemek için kaldırılır.
 */
export function syncBackgroundScrobbleRegistration(shouldEnable: boolean): Promise<void> {
  if (lastRequestedState === shouldEnable && registrationPromise) {
    return registrationPromise;
  }
  lastRequestedState = shouldEnable;

  registrationPromise = (async () => {
    try {
      const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SCROBBLE_TASK);

      if (shouldEnable && !registered) {
        const status = await BackgroundTask.getStatusAsync();
        if (status === BackgroundTask.BackgroundTaskStatus.Restricted) {
          return;
        }
        await BackgroundTask.registerTaskAsync(BACKGROUND_SCROBBLE_TASK, {
          minimumInterval: MIN_INTERVAL_MINUTES,
        });
      } else if (!shouldEnable && registered) {
        await BackgroundTask.unregisterTaskAsync(BACKGROUND_SCROBBLE_TASK);
      }
    } catch (error) {
      // Görev kaydı başarısız olsa da uygulama içi scrobble çalışmaya devam eder.
      console.warn('[backgroundScrobble] kayıt durumu güncellenemedi:', error);
    } finally {
      registrationPromise = null;
    }
  })();

  return registrationPromise;
}
