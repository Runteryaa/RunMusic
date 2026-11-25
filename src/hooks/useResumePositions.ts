import { useEffect, useRef } from 'react';
import TrackPlayer, { useActiveTrack } from 'react-native-track-player';
import { useStore } from '../store/useStore';
import { useRemoteConnectStore } from '../store/useRemoteConnectStore';
import {
  RESUME_MIN_DURATION_SEC,
  RESUME_MIN_REMAINING_SEC,
  getResumeEntry,
  resumeKey,
  saveResumePosition,
} from '../services/resumePositions';
import { useSharedProgress } from './useSharedProgress';

/**
 * Uzun parçalarda (10 dakikadan uzun) kaldığın yerden devam.
 *
 * İki iş yapar:
 * 1. Parça açıldığında kayıtlı konum varsa oraya atlar (parça başına BİR kez).
 * 2. Çalarken konumu ~10 saniyede bir diske yazar.
 *
 * Ayarlar'daki anahtar kapalıysa hiçbir okuma/yazma yapılmaz. Uzak (Connecto
 * client) modda yerel oynatıcı olmadığı için tamamen devre dışıdır.
 */
export function useResumePositions() {
  const activeTrack = useActiveTrack();
  const enabled = useStore((s) => s.preferences.resumeLongTracks);
  const isRemoteConnected = useRemoteConnectStore(
    (s) => s.mode === 'client' && s.connectionStatus === 'connected'
  );
  const isShadowTrack = String(activeTrack?.id ?? '').startsWith('remote_');

  /*
   * Konum yalnızca 10 saniyede bir diske yazıldığı için 2 Hz'e gerek yok:
   * 5 saniyelik örnekleme yeterli. Devre dışıyken (ayar kapalı, uzak mod)
   * paylaşılan yoklayıcıya hiç abone olunmaz.
   */
  const progress = useSharedProgress(
    enabled && !isRemoteConnected && !isShadowTrack ? 5000 : 0
  );

  /** Son geri yüklenen parça; aynı parça için ikinci kez atlanmaz. */
  const restoredKeyRef = useRef<string | null>(null);
  /** Son yazılan konum (gereksiz disk yazımını önler). */
  const lastSavedRef = useRef<{ key: string; position: number } | null>(null);

  const trackKey = resumeKey(activeTrack?.id, activeTrack?.url);
  const duration =
    progress.duration > 0 ? progress.duration : activeTrack?.duration || 0;

  useEffect(() => {
    if (!enabled || isRemoteConnected || isShadowTrack) return;
    if (!trackKey || duration < RESUME_MIN_DURATION_SEC) return;
    if (restoredKeyRef.current === trackKey) return;

    restoredKeyRef.current = trackKey;
    let cancelled = false;

    getResumeEntry(trackKey)
      .then((entry) => {
        if (cancelled || !entry) return;
        if (entry.position < 1) return;
        if (entry.position >= duration - RESUME_MIN_REMAINING_SEC) return;
        // Konumu hemen yazılmasın diye son kayıt olarak işaretle; atlama
        // tamamlanana kadar disk yazımı eski konumu geri getirmesin.
        lastSavedRef.current = { key: trackKey, position: entry.position };
        TrackPlayer.seekTo(entry.position).catch(() => {});
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [enabled, isRemoteConnected, isShadowTrack, trackKey, duration]);

  useEffect(() => {
    if (!enabled || isRemoteConnected || isShadowTrack) return;
    if (!trackKey || duration < RESUME_MIN_DURATION_SEC) return;
    if (progress.position <= 0) return;

    const last = lastSavedRef.current;
    if (last && last.key === trackKey && Math.abs(last.position - progress.position) < 10) {
      return;
    }
    lastSavedRef.current = { key: trackKey, position: progress.position };
    saveResumePosition(trackKey, progress.position, duration).catch(() => {});
  }, [
    enabled,
    isRemoteConnected,
    isShadowTrack,
    trackKey,
    duration,
    progress.position,
  ]);
}
