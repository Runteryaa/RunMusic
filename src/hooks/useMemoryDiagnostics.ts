import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import TrackPlayer, { State } from 'react-native-track-player';
import { useStore } from '../store/useStore';
import { usePlayerUIStore } from '../store/usePlayerUIStore';
import {
  ensureMemoryDiagnosticsHydrated,
  recordEvent,
  recordMemorySample,
} from '../services/memoryDiagnostics';

const SAMPLE_INTERVAL_MS = 60_000;

/**
 * Background-safe sampler. It intentionally reads stores through getState()
 * instead of subscribing, so sampling never re-renders the app.
 */
export function useMemoryDiagnostics(): void {
  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    let sampling = false;

    const sampleNow = async (state: AppStateStatus) => {
      if (cancelled || sampling) return;
      sampling = true;
      try {
        await ensureMemoryDiagnosticsHydrated();
        if (cancelled) return;
        let playing = false;
        try {
          const playback = await TrackPlayer.getPlaybackState();
          playing = playback.state === State.Playing;
        } catch {
          // Player may not be ready yet; a sample without playback state is fine.
        }

        const store = useStore.getState();
        const ui = usePlayerUIStore.getState();
        recordMemorySample(state, {
          playing,
          playerOpen: ui.isFullscreenPlayerOpen,
          lyrics: ui.isLyricsMode,
          queueMode: ui.isQueueMode,
          library: store.library.length,
          queue: store.contextIds.length,
          upNext: store.upNextIds.length,
          queueRevision: store.queueRevision,
          devMode: store.preferences.isDevModeActive,
        });
      } finally {
        sampling = false;
      }
    };

    void (async () => {
      await ensureMemoryDiagnosticsHydrated();
      if (cancelled) return;
      await sampleNow(AppState.currentState);
      if (cancelled) return;
      interval = setInterval(() => {
        void sampleNow(AppState.currentState);
      }, SAMPLE_INTERVAL_MS);
    })();

    const subscription = AppState.addEventListener('change', (state) => {
      recordEvent('appstate', state);
      void sampleNow(state);
    });

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      subscription.remove();
    };
  }, []);
}
