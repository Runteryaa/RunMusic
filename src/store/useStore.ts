import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as MediaLibrary from 'expo-media-library';

export interface FilterSettings {
  minLengthSec: number | null;
  maxLengthSec: number | null;
  minSizeMB: number | null;
  maxSizeMB: number | null;
}

interface AppState {
  settings: FilterSettings;
  updateSettings: (settings: Partial<FilterSettings>) => void;
  
  library: MediaLibrary.Asset[];
  setLibrary: (assets: MediaLibrary.Asset[]) => void;
  isScanning: boolean;
  setIsScanning: (isScanning: boolean) => void;
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      settings: {
        minLengthSec: null,
        maxLengthSec: null,
        minSizeMB: null,
        maxSizeMB: null,
      },
      updateSettings: (newSettings) =>
        set((state) => ({ settings: { ...state.settings, ...newSettings } })),
      
      library: [],
      setLibrary: (library) => set({ library }),
      isScanning: false,
      setIsScanning: (isScanning) => set({ isScanning }),
    }),
    {
      name: 'runmusic-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ settings: state.settings }), // only persist settings
    }
  )
);
