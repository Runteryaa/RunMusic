import { useRemoteConnectStore } from '../store/useRemoteConnectStore';
import { useOptimisticPlayerStore } from '../store/useOptimisticPlayerStore';
import { useIsAppActive } from './useIsAppActive';
import { useSharedProgress } from './useSharedProgress';

export interface ActiveProgress {
  position: number;
  duration: number;
}

/**
 * Çalma konumu (paylaşılan tek yoklayıcı üzerinden).
 *
 * ÖNEMLİ: bu kanca saniyede birkaç kez yeniden çizim tetikler; yalnızca
 * konuma duyarlı bileşenler kullanmalı:
 * - ilerleme çubuğu / kaydırıcı
 * - süre etiketleri
 * - senkron söz görünümü
 * Düğmeler, liste satırları ve modallar `useActivePlayer()` kullanmalı.
 *
 * @param enabled Ekran gizliyken `false`: hiç abone olunmaz, dolayısıyla
 *   görünmeyen oynatıcı arka planda native köprü çağrısı üretmez.
 * @param intervalMs İstenen güncelleme aralığı. Varsayılan 250 ms (söz
 *   senkronu ve kaydırıcı için). İnce bir ilerleme çubuğu gibi hassas olmayan
 *   yerlerde 1000 ms verilerek CPU/batarya tasarrufu sağlanır.
 */
export function useActiveProgress(enabled = true, intervalMs = 250): ActiveProgress {
  const isRemote = useRemoteConnectStore(
    (s) => s.mode === 'client' && s.connectionStatus === 'connected'
  );

  const optimisticTrack = useOptimisticPlayerStore((s) => s.optimisticTrack);
  const isAppActive = useIsAppActive();

  // Uzak modda konum ayrı bir interpolasyon akışından gelir; yerel yoklama
  // gereksizdir (0 = abone olma). Arka planda da arayüz görünmez.
  const localInterval = enabled && isAppActive && !isRemote ? intervalMs : 0;
  const localProgress = useSharedProgress(localInterval);

  // `enabled=false` iken uzak interpolasyon akışına da abone olunmaz.
  const interpolatedRemotePosition = useRemoteConnectStore((s) =>
    enabled ? s.interpolatedPosition : 0
  );
  const remoteDuration = useRemoteConnectStore(
    (s) => s.remoteState.activeTrack?.duration ?? 0
  );

  if (optimisticTrack) {
    return {
      position: 0,
      duration: optimisticTrack.duration || 0,
    };
  }

  if (isRemote) {
    return {
      position: interpolatedRemotePosition,
      duration: remoteDuration,
    };
  }

  return {
    position: localProgress.position,
    duration: localProgress.duration,
  };
}
