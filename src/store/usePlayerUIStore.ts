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

  isConnectMode: boolean;
  toggleConnectMode: () => void;
  setConnectMode: (val: boolean) => void;

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
      isConnectMode: false,
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
      isConnectMode: false,
    })),
  setLyricsMode: (val: boolean) =>
    set((state) => ({
      isLyricsMode: val,
      isQueueMode: val ? false : state.isQueueMode,
      isSleepTimerMode: val ? false : state.isSleepTimerMode,
      isConnectMode: val ? false : state.isConnectMode,
    })),

  isQueueMode: false,
  toggleQueueMode: () =>
    set((state) => ({
      isQueueMode: !state.isQueueMode,
      isLyricsMode: false,
      isSleepTimerMode: false,
      isConnectMode: false,
    })),
  setQueueMode: (val: boolean) =>
    set((state) => ({
      isQueueMode: val,
      isLyricsMode: val ? false : state.isLyricsMode,
      isSleepTimerMode: val ? false : state.isSleepTimerMode,
      isConnectMode: val ? false : state.isConnectMode,
    })),

  isSleepTimerMode: false,
  toggleSleepTimerMode: () =>
    set((state) => ({
      isSleepTimerMode: !state.isSleepTimerMode,
      isLyricsMode: false,
      isQueueMode: false,
      isConnectMode: false,
    })),
  setSleepTimerMode: (val: boolean) =>
    set((state) => ({
      isSleepTimerMode: val,
      isLyricsMode: val ? false : state.isLyricsMode,
      isQueueMode: val ? false : state.isQueueMode,
      isConnectMode: val ? false : state.isConnectMode,
    })),

  isConnectMode: false,
  toggleConnectMode: () =>
    set((state) => ({
      isConnectMode: !state.isConnectMode,
      isLyricsMode: false,
      isQueueMode: false,
      isSleepTimerMode: false,
    })),
  setConnectMode: (val: boolean) =>
    set((state) => ({
      isConnectMode: val,
      isLyricsMode: val ? false : state.isLyricsMode,
      isQueueMode: val ? false : state.isQueueMode,
      isSleepTimerMode: val ? false : state.isSleepTimerMode,
    })),
}));
