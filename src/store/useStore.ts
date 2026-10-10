import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import * as MediaLibrary from 'expo-media-library/legacy';
import { RepeatMode } from 'react-native-track-player';
import { LyricsResult, getLyricsCacheKeys } from '../services/lyricsService';
import { STORE_STORAGE_KEY, resilientStorage } from '../services/persistStorage';
import {
  findLyricsInCache,
  normalizeLyricsCache,
  type LyricsCacheEntry,
} from '../services/persistSanitize';

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

  lyricsCache: Record<string, LyricsCacheEntry>;
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

  isHydrated: boolean;
  setIsHydrated: (isHydrated: boolean) => void;
}

/** Kalıcı depolama şema sürümü. Alanı olmayan eski kayıtlar sürüm 0 sayılır. */
const PERSIST_VERSION = 1;

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
          // Kanonik kayıt tam içerikle, alternatif anahtarlar yalnızca işaretçi
          // olarak yazılır; aynı içerik diskte tekrar tekrar tutulmaz.
          const updated: Record<string, LyricsCacheEntry> = { ...state.lyricsCache, [id]: lyrics };
          if (alternateKeys && alternateKeys.length > 0) {
            for (const key of alternateKeys) {
              if (key && key !== id) updated[key] = { ref: id };
            }
          }
          return { lyricsCache: updated };
        }),
      // Alternatif anahtarlar `{ ref }` işaretçisi olabileceği için çözümleme
      // `findLyricsInCache` içinde yapılır (paylaşılan, test edilebilir mantık).
      getLyricsFromCache: (params) => findLyricsInCache(get().lyricsCache, getLyricsCacheKeys(params)),
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

      isHydrated: false,
      setIsHydrated: (isHydrated) => set({ isHydrated }),
    }),
    {
      name: STORE_STORAGE_KEY,
      storage: createJSONStorage(() => resilientStorage),
      version: PERSIST_VERSION,
      /**
       * Şema migrasyonu. `version` alanı olmayan eski kayıtlar sürüm 0 kabul
       * edilir ve buraya düşer. Yapılan iş: şişmiş söz önbelleğini (her parça
       * ~8 anahtara tam kopya + aday listeleri) tekilleştirip hafifletmek.
       * Bu, AsyncStorage'ın tek-kayıt boyut sınırının aşılıp yazmaların
       * sessizce durmasını engeller; kullanıcı verisi korunur.
       */
      migrate: (persistedState: unknown, fromVersion: number) => {
        const incoming = (persistedState && typeof persistedState === 'object'
          ? persistedState
          : {}) as Record<string, any>;

        const migrated = {
          ...incoming,
          lyricsCache: normalizeLyricsCache(incoming.lyricsCache),
        };

        console.log(
          `[persist] şema migrasyonu: v${fromVersion} -> v${PERSIST_VERSION} ` +
            `(${Object.keys(migrated.lyricsCache).length} söz anahtarı normalize edildi)`
        );
        return migrated;
      },
      partialize: (state) => ({
        settings: state.settings,
        isShuffle: state.isShuffle,
        repeatMode: state.repeatMode,
        hiddenTrackIds: state.hiddenTrackIds,
        artworkMap: state.artworkMap,
        metadataMap: state.metadataMap,
        // Söz önbelleği tekilleştirilmiş + hafifletilmiş olarak yazılır.
        lyricsCache: normalizeLyricsCache(state.lyricsCache),
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.setIsHydrated(true);
          if ((state as any).lastPlaybackState) {
            delete (state as any).lastPlaybackState;
          }
        }
      },
    }
  )
);

if (typeof useStore.persist?.onFinishHydration === 'function') {
  useStore.persist.onFinishHydration(() => {
    useStore.getState().setIsHydrated(true);
  });
}
if (useStore.persist?.hasHydrated?.()) {
  useStore.getState().setIsHydrated(true);
}

