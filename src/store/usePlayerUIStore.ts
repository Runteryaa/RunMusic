import { create } from 'zustand';

interface PlayerUIState {
  isFullscreenPlayerOpen: boolean;
  openFullscreenPlayer: () => void;
  closeFullscreenPlayer: () => void;

  isLyricsMode: boolean;
  toggleLyricsMode: () => void;
  setLyricsMode: (val: boolean) => void;

  isQueueMode: boolean;
  toggleQueueMode: () => void;
  setQueueMode: (val: boolean) => void;
}

export const usePlayerUIStore = create<PlayerUIState>((set) => ({
  isFullscreenPlayerOpen: false,
  openFullscreenPlayer: () => set({ isFullscreenPlayerOpen: true }),
  closeFullscreenPlayer: () => set({ isFullscreenPlayerOpen: false }),

  isLyricsMode: false,
  toggleLyricsMode: () =>
    set((state) => ({
      isLyricsMode: !state.isLyricsMode,
      isQueueMode: state.isLyricsMode ? state.isQueueMode : false,
    })),
  setLyricsMode: (val: boolean) =>
    set((state) => ({
      isLyricsMode: val,
      isQueueMode: val ? false : state.isQueueMode,
    })),

  isQueueMode: false,
  toggleQueueMode: () =>
    set((state) => ({
      isQueueMode: !state.isQueueMode,
      isLyricsMode: state.isQueueMode ? state.isLyricsMode : false,
    })),
  setQueueMode: (val: boolean) =>
    set((state) => ({
      isQueueMode: val,
      isLyricsMode: val ? false : state.isLyricsMode,
    })),
}));
