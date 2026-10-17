import { create } from 'zustand';
import type { RemoteTrackSummary } from '../services/remote/remoteTypes';

interface OptimisticPlayerState {
  optimisticTrack: RemoteTrackSummary | null;
  optimisticArtworkUri: string | null;
  setOptimisticTrack: (track: RemoteTrackSummary | null, artworkUri?: string | null) => void;
  clearOptimisticTrack: () => void;
}

let clearTimer: ReturnType<typeof setTimeout> | null = null;

export const useOptimisticPlayerStore = create<OptimisticPlayerState>((set) => ({
  optimisticTrack: null,
  optimisticArtworkUri: null,
  setOptimisticTrack: (track, artworkUri = null) => {
    if (clearTimer) {
      clearTimeout(clearTimer);
      clearTimer = null;
    }
    set({ optimisticTrack: track, optimisticArtworkUri: artworkUri });
    // Safety auto-clear timeout: if real event doesn't fire within 2.5s, revert gracefully
    clearTimer = setTimeout(() => {
      set({ optimisticTrack: null, optimisticArtworkUri: null });
      clearTimer = null;
    }, 2500);
  },
  clearOptimisticTrack: () => {
    if (clearTimer) {
      clearTimeout(clearTimer);
      clearTimer = null;
    }
    set({ optimisticTrack: null, optimisticArtworkUri: null });
  },
}));
