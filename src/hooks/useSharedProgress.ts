import { useCallback, useEffect, useState } from 'react';
import {
  getProgressSnapshot,
  subscribeProgress,
  type ProgressSnapshot,
} from '../services/progressTicker';

/**
 * Paylaşılan çalma konumu kancası.
 *
 * Tüm tüketiciler tek bir native yoklamayı paylaşır (bkz. `progressTicker`).
 * `intervalMs <= 0` verilirse hiç abone olunmaz (ekran gizliyken gereksiz
 * köprü çağrısı yapılmaz).
 */
export function useSharedProgress(intervalMs: number): ProgressSnapshot {
  const [snapshot, setSnapshot] = useState<ProgressSnapshot>(getProgressSnapshot);

  const apply = useCallback((next: ProgressSnapshot) => {
    setSnapshot((previous) =>
      previous.position === next.position &&
      previous.duration === next.duration &&
      previous.buffered === next.buffered
        ? previous
        : next
    );
  }, []);

  useEffect(() => {
    if (!(intervalMs > 0)) return;
    return subscribeProgress(intervalMs, apply);
  }, [intervalMs, apply]);

  return snapshot;
}
