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

  isSleepTimerMode: boolean;
  toggleSleepTimerMode: () => void;
  setSleepTimerMode: (val: boolean) => void;

  isDeviceSelectorOpen: boolean;
  openDeviceSelector: () => void;
  closeDeviceSelector: () => void;
}

export const usePlayerUIStore = create<PlayerUIState>((set) => ({
  isFullscreenPlayerOpen: false,
  openFullscreenPlayer: () => set({ isFullscreenPlayerOpen: true }),
  closeFullscreenPlayer: () =>
    set({
      isFullscreenPlayerOpen: false,
      isSleepTimerMode: false,
    }),

  isDeviceSelectorOpen: false,
  openDeviceSelector: () => set({ isDeviceSelectorOpen: true }),
  closeDeviceSelector: () => set({ isDeviceSelectorOpen: false }),

  isLyricsMode: false,
  toggleLyricsMode: () =>
    set((state) => ({
      isLyricsMode: !state.isLyricsMode,
      isQueueMode: false,
      isSleepTimerMode: false,
    })),
  setLyricsMode: (val: boolean) =>
    set((state) => ({
      isLyricsMode: val,
      isQueueMode: val ? false : state.isQueueMode,
      isSleepTimerMode: val ? false : state.isSleepTimerMode,
    })),

  isQueueMode: false,
  toggleQueueMode: () =>
    set((state) => ({
      isQueueMode: !state.isQueueMode,
      isLyricsMode: false,
      isSleepTimerMode: false,
    })),
  setQueueMode: (val: boolean) =>
    set((state) => ({
      isQueueMode: val,
      isLyricsMode: val ? false : state.isLyricsMode,
      isSleepTimerMode: val ? false : state.isSleepTimerMode,
    })),

  isSleepTimerMode: false,
  toggleSleepTimerMode: () =>
    set((state) => ({
      isSleepTimerMode: !state.isSleepTimerMode,
      isLyricsMode: false,
      isQueueMode: false,
    })),
  setSleepTimerMode: (val: boolean) =>
    set((state) => ({
      isSleepTimerMode: val,
      isLyricsMode: val ? false : state.isLyricsMode,
      isQueueMode: val ? false : state.isQueueMode,
    })),
}));
