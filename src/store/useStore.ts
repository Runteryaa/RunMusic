import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as MediaLibrary from 'expo-media-library/legacy';
import { RepeatMode } from 'react-native-track-player';
import { LyricsResult, getLyricsCacheKeys } from '../services/lyricsService';

export interface FilterSettings {
  minLengthSec: number | null;
  maxLengthSec: number | null;
  minSizeMB: number | null;
  maxSizeMB: number | null;
}

export interface TrackMetadata {
  title?: string;
  artist?: string;
  album?: string;
  artwork?: string;
}

export interface PlaybackTrackItem {
  id: string;
  url: string;
  title?: string;
  artist?: string;
  artwork?: string;
}

export interface LastPlaybackState {
  trackId: string;
  position?: number;
  trackIndex?: number;
  track?: PlaybackTrackItem;
  queue?: PlaybackTrackItem[];
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

  metadataMap: Record<string, TrackMetadata>;
  setTrackMetadata: (id: string, metadata: TrackMetadata) => void;
  setBatchTrackMetadata: (batch: Record<string, TrackMetadata>) => void;

  lyricsCache: Record<string, LyricsResult>;
  setLyrics: (id: string, lyrics: LyricsResult, alternateKeys?: string[]) => void;
  getLyricsFromCache: (params: {
    id?: string;
    url?: string;
    title?: string;
    artist?: string;
    rawTitle?: string;
  }) => LyricsResult | null;
  clearLyricsCache: () => void;

  library: MediaLibrary.Asset[];
  setLibrary: (assets: MediaLibrary.Asset[]) => void;
  isScanning: boolean;
  setIsScanning: (isScanning: boolean) => void;

  isShuffle: boolean;
  setIsShuffle: (isShuffle: boolean) => void;
  repeatMode: RepeatMode;
  setRepeatMode: (mode: RepeatMode) => void;

  lastPlaybackState: LastPlaybackState | null;
  setLastPlaybackState: (state: LastPlaybackState | null) => void;
  setLastPlaybackPosition: (position: number) => void;
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      artworkMap: {},
      setArtwork: (id, uri) =>
        set((state) => ({
          artworkMap: { ...state.artworkMap, [id]: uri },
        })),
      setBatchArtworks: (artworks) =>
        set((state) => ({
          artworkMap: { ...state.artworkMap, ...artworks },
        })),

      metadataMap: {},
      setTrackMetadata: (id, metadata) =>
        set((state) => {
          const artworkUpdate = metadata.artwork ? { [id]: metadata.artwork } : {};
          return {
            metadataMap: { ...state.metadataMap, [id]: metadata },
            artworkMap: { ...state.artworkMap, ...artworkUpdate },
          };
        }),
      setBatchTrackMetadata: (batch) =>
        set((state) => {
          const artworkUpdates: Record<string, string> = {};
          for (const [id, meta] of Object.entries(batch)) {
            if (meta.artwork) {
              artworkUpdates[id] = meta.artwork;
            }
          }
          return {
            metadataMap: { ...state.metadataMap, ...batch },
            artworkMap: { ...state.artworkMap, ...artworkUpdates },
          };
        }),

      lyricsCache: {},
      setLyrics: (id, lyrics, alternateKeys) =>
        set((state) => {
          const updated = { ...state.lyricsCache, [id]: lyrics };
          if (alternateKeys && alternateKeys.length > 0) {
            for (const key of alternateKeys) {
              if (key) updated[key] = lyrics;
            }
          }
          return { lyricsCache: updated };
        }),
      getLyricsFromCache: (params) => {
        const state = get();
        const cache = state.lyricsCache;
        if (!cache) return null;
        const keys = getLyricsCacheKeys(params);
        for (const k of keys) {
          if (cache[k]) return cache[k];
        }
        return null;
      },
      clearLyricsCache: () => set({ lyricsCache: {} }),

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

      lastPlaybackState: null,
      setLastPlaybackState: (lastPlaybackState) => set({ lastPlaybackState }),
      setLastPlaybackPosition: (position) =>
        set((state) => ({
          lastPlaybackState: state.lastPlaybackState
            ? { ...state.lastPlaybackState, position }
            : null,
        })),
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
        metadataMap: state.metadataMap,
        lyricsCache: state.lyricsCache,
        lastPlaybackState: state.lastPlaybackState,
      }),
      onRehydrateStorage: () => (state) => {
        if (state && state.allAssets) {
          state.library = state.allAssets.filter((a) => !(state.hiddenTrackIds || []).includes(a.id));
        }
      },
    }
  )
);
