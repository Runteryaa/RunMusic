import { create } from 'zustand';

interface PlayerUIState {
  isFullscreenPlayerOpen: boolean;
  openFullscreenPlayer: () => void;
  closeFullscreenPlayer: () => void;

  isLyricsMode: boolean;
  toggleLyricsMode: () => void;
  setLyricsMode: (val: boolean) => void;
}

export const usePlayerUIStore = create<PlayerUIState>((set) => ({
  isFullscreenPlayerOpen: false,
  openFullscreenPlayer: () => set({ isFullscreenPlayerOpen: true }),
  closeFullscreenPlayer: () => set({ isFullscreenPlayerOpen: false }),

  isLyricsMode: false,
  toggleLyricsMode: () => set((state) => ({ isLyricsMode: !state.isLyricsMode })),
  setLyricsMode: (val: boolean) => set({ isLyricsMode: val }),
}));
