import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as MediaLibrary from 'expo-media-library/legacy';
import { RepeatMode } from 'react-native-track-player';

export interface FilterSettings {
  minLengthSec: number | null;
  maxLengthSec: number | null;
  minSizeMB: number | null;
  maxSizeMB: number | null;
}

interface AppState {
  settings: FilterSettings;
  updateSettings: (settings: Partial<FilterSettings>) => void;

  allAssets: MediaLibrary.Asset[];
  setAllAssets: (assets: MediaLibrary.Asset[]) => void;

  hiddenTrackIds: string[];
  hideTrack: (id: string) => void;
  unhideTrack: (id: string) => void;
  unhideAllTracks: () => void;

  artworkMap: Record<string, string>;
  setArtwork: (id: string, uri: string) => void;
  setBatchArtworks: (artworks: Record<string, string>) => void;

  library: MediaLibrary.Asset[];
  setLibrary: (assets: MediaLibrary.Asset[]) => void;
  isScanning: boolean;
  setIsScanning: (isScanning: boolean) => void;

  isShuffle: boolean;
  setIsShuffle: (isShuffle: boolean) => void;
  repeatMode: RepeatMode;
  setRepeatMode: (mode: RepeatMode) => void;
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      artworkMap: {},
      setArtwork: (id, uri) =>
        set((state) => ({
          artworkMap: { ...state.artworkMap, [id]: uri },
        })),
      setBatchArtworks: (artworks) =>
        set((state) => ({
          artworkMap: { ...state.artworkMap, ...artworks },
        })),

      settings: {
        minLengthSec: null,
        maxLengthSec: null,
        minSizeMB: null,
        maxSizeMB: null,
      },
      updateSettings: (newSettings) =>
        set((state) => ({ settings: { ...state.settings, ...newSettings } })),

      allAssets: [],
      setAllAssets: (assets) =>
        set((state) => ({
          allAssets: assets,
          library: assets.filter((a) => !state.hiddenTrackIds.includes(a.id)),
        })),

      hiddenTrackIds: [],
      hideTrack: (id) =>
        set((state) => {
          const hiddenTrackIds = state.hiddenTrackIds.includes(id)
            ? state.hiddenTrackIds
            : [...state.hiddenTrackIds, id];
          return {
            hiddenTrackIds,
            library: state.allAssets.filter((a) => !hiddenTrackIds.includes(a.id)),
          };
        }),
      unhideTrack: (id) =>
        set((state) => {
          const hiddenTrackIds = state.hiddenTrackIds.filter((x) => x !== id);
          return {
            hiddenTrackIds,
            library: state.allAssets.filter((a) => !hiddenTrackIds.includes(a.id)),
          };
        }),
      unhideAllTracks: () =>
        set((state) => ({
          hiddenTrackIds: [],
          library: state.allAssets,
        })),

      library: [],
      setLibrary: (assets) =>
        set((state) => ({
          allAssets: assets,
          library: assets.filter((a) => !state.hiddenTrackIds.includes(a.id)),
        })),
      isScanning: false,
      setIsScanning: (isScanning) => set({ isScanning }),

      isShuffle: false,
      setIsShuffle: (isShuffle) => set({ isShuffle }),
      repeatMode: RepeatMode.Off,
      setRepeatMode: (repeatMode) => set({ repeatMode }),
    }),
    {
      name: 'runmusic-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        settings: state.settings,
        isShuffle: state.isShuffle,
        repeatMode: state.repeatMode,
        hiddenTrackIds: state.hiddenTrackIds,
        allAssets: state.allAssets,
        artworkMap: state.artworkMap,
      }),
      onRehydrateStorage: () => (state) => {
        if (state && state.allAssets) {
          state.library = state.allAssets.filter((a) => !(state.hiddenTrackIds || []).includes(a.id));
        }
      },
    }
  )
);
