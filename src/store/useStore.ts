import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import * as MediaLibrary from 'expo-media-library/legacy';
import { RepeatMode } from 'react-native-track-player';
import {
  LyricsResult,
  getLyricsCacheKeys,
  type LyricsSourcePreference,
} from '../services/lyricsService';
import type { SortOption } from '../services/librarySort';
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

/** Şarkı sözü kaynağı tercihi, tanımı lyricsService'te (native'siz modül). */
export type { LyricsSourcePreference };

export type AppLanguage = 'system' | 'en' | 'tr';

/**
 * Kullanıcı tercihleri (Ayarlar ekranı).
 *
 * `settings`'ten ayrı tutulur: `settings` kitaplık TARAMASINI filtreler,
 * `preferences` ise uygulamanın davranışını/görünümünü yönetir.
 */
export interface AppPreferences {
  /** Uygulama dili tercihi ('system' | 'en' | 'tr'). */
  appLanguage: AppLanguage;
  /** Kitaplık açılışındaki sıralama. */
  defaultSortOption: SortOption;
  /**
   * Açılışta son kuyruk ve konum geri yüklensin mi. Kapatılırsa yalnızca son
   * parça yüklenir (daha hafif).
   */
  restoreQueueOnLaunch: boolean;
  /**
   * Uygulama son kullanılanlardan kaydırılıp kapatıldığında müzik çalmaya
   * devam etsin mi (native `appKilledPlaybackBehavior`).
   */
  keepPlayingWhenAppKilled: boolean;
  /** Parça çalınca sözler otomatik aransın mı. Kapalıysa yalnızca kayıtlı sözler kullanılır. */
  autoFetchLyrics: boolean;
  /** Çevrimiçi söz ararken kaynak sırası. */
  lyricsSourcePreference: LyricsSourcePreference;
  /** Player açıldığında doğrudan sözler görünümüyle başlasın mı. */
  openPlayerWithLyrics: boolean;
  /** Tema renkleri albüm kapağından türetilsin mi (kapalıysa sabit tema). */
  dynamicColorFromArtwork: boolean;
  /** Dinamik renk kapalıyken veya kapak yokken kullanılacak hazır tema vurgu rengi (hex kodu). */
  presetThemeColor: string;
  /** Bazı animasyonları (duraklatma ölçeği, söz geçişi) kapatır. */
  reduceMotion: boolean;
  /** Reklam izlenerek veya varsayılan olarak açılmış hazır tema renkleri (hex kodları). */
  unlockedThemes: string[];
  /** Reklam izlenerek albüm kapağından dinamik renk türetme özelliği açıldı mı. */
  isDynamicColorUnlocked: boolean;
  /** Oynatıcıdaki dinamik renk tanıtım kartı kullanıcı tarafından kapatıldı mı. */
  hasDismissedDynamicColorBanner: boolean;
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  appLanguage: 'system',
  defaultSortOption: 'date_desc',
  restoreQueueOnLaunch: true,
  keepPlayingWhenAppKilled: true,
  autoFetchLyrics: true,
  lyricsSourcePreference: 'lrclib_first',
  openPlayerWithLyrics: false,
  dynamicColorFromArtwork: false,
  presetThemeColor: '#3b82f6',
  reduceMotion: false,
  unlockedThemes: ['#3b82f6'],
  isDynamicColorUnlocked: false,
  hasDismissedDynamicColorBanner: false,
};

export interface TrackMetadata {
  title?: string;
  artist?: string;
  album?: string;
  artwork?: string;
}

interface AppState {
  settings: FilterSettings;
  updateSettings: (settings: Partial<FilterSettings>) => void;

  preferences: AppPreferences;
  updatePreferences: (patch: Partial<AppPreferences>) => void;
  unlockTheme: (colorHex: string) => void;
  unlockDynamicColor: () => void;
  dismissDynamicColorBanner: () => void;
  resetPreferences: () => void;

  /** Kapak önbelleğini (dosyalar + harita) temizler. */
  clearArtworkCache: () => void;

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
  resetTrackMetadata: (id: string) => void;

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

  /**
   * Manuel "Sırada" (Up Next) kuyruğu: parça kimlikleri, çalınma sırasına göre.
   *
   * Bu öğeler kütüphane bağlamından AYRI tutulur; bağlam devam etmeden önce
   * bunlar çalınır (Apple Music / Spotify "Next in queue" davranışı).
   */
  upNextIds: string[];
  /**
   * Kütüphane bağlamının KARIŞTIRILMAMIŞ kimlik sırası. Shuffle kapatıldığında
   * orijinal sıraya dönebilmek için saklanır.
   */
  contextIds: string[];

  setUpNextIds: (ids: string[]) => void;
  setContextIds: (ids: string[]) => void;
  clearUpNext: () => void;

  library: MediaLibrary.Asset[];
  setLibrary: (assets: MediaLibrary.Asset[]) => void;
  isScanning: boolean;
  setIsScanning: (isScanning: boolean) => void;

  isShuffle: boolean;
  setIsShuffle: (isShuffle: boolean) => void;
  isSmartShuffle: boolean;
  setIsSmartShuffle: (isSmartShuffle: boolean) => void;
  repeatMode: RepeatMode;
  setRepeatMode: (mode: RepeatMode) => void;

  isHydrated: boolean;
  setIsHydrated: (isHydrated: boolean) => void;

  /** Kuyruk içeriği her değiştiğinde artırılır; UI ekranlarının anında senkronize olmasını sağlar. */
  queueRevision: number;
  bumpQueueRevision: () => void;
}

/** Kalıcı depolama şema sürümü. Alanı olmayan eski kayıtlar sürüm 0 sayılır. */
const PERSIST_VERSION = 7;

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
      resetTrackMetadata: (id) =>
        set((state) => {
          const nextMeta = { ...state.metadataMap };
          delete nextMeta[id];
          const nextArt = { ...state.artworkMap };
          delete nextArt[id];
          return {
            metadataMap: nextMeta,
            artworkMap: nextArt,
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

      upNextIds: [],
      contextIds: [],
      setUpNextIds: (upNextIds) => set({ upNextIds }),
      setContextIds: (contextIds) => set({ contextIds }),
      clearUpNext: () => set({ upNextIds: [] }),

      settings: {
        minLengthSec: null,
        maxLengthSec: null,
        minSizeMB: null,
        maxSizeMB: null,
      },
      updateSettings: (newSettings) =>
        set((state) => ({ settings: { ...state.settings, ...newSettings } })),

      preferences: { ...DEFAULT_PREFERENCES },
      updatePreferences: (patch) =>
        set((state) => ({ preferences: { ...state.preferences, ...patch } })),
      unlockTheme: (colorHex) =>
        set((state) => {
          const current = state.preferences.unlockedThemes || ['#3b82f6'];
          const normalized = colorHex.toLowerCase();
          if (current.some((c) => c.toLowerCase() === normalized)) {
            return state;
          }
          return {
            preferences: {
              ...state.preferences,
              unlockedThemes: [...current, colorHex],
            },
          };
        }),
      unlockDynamicColor: () =>
        set((state) => ({
          preferences: {
            ...state.preferences,
            isDynamicColorUnlocked: true,
            dynamicColorFromArtwork: true,
          },
        })),
      dismissDynamicColorBanner: () =>
        set((state) => ({
          preferences: {
            ...state.preferences,
            hasDismissedDynamicColorBanner: true,
          },
        })),
      resetPreferences: () =>
        set((state) => ({
          preferences: {
            ...DEFAULT_PREFERENCES,
            unlockedThemes: state.preferences.unlockedThemes ?? DEFAULT_PREFERENCES.unlockedThemes,
            isDynamicColorUnlocked: state.preferences.isDynamicColorUnlocked ?? false,
            dynamicColorFromArtwork: state.preferences.isDynamicColorUnlocked ?? false,
          },
        })),

      clearArtworkCache: () => set({ artworkMap: {} }),

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
      isSmartShuffle: false,
      setIsSmartShuffle: (isSmartShuffle) => set({ isSmartShuffle }),
      repeatMode: RepeatMode.Off,
      setRepeatMode: (repeatMode) => set({ repeatMode }),

      isHydrated: false,
      setIsHydrated: (isHydrated) => set({ isHydrated }),

      queueRevision: 0,
      bumpQueueRevision: () => set((state) => ({ queueRevision: state.queueRevision + 1 })),
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

        const incomingPrefs = (incoming.preferences && typeof incoming.preferences === 'object')
          ? incoming.preferences
          : {};

        const activePreset = incomingPrefs.presetThemeColor || '#3b82f6';
        const existingUnlocked = Array.isArray(incomingPrefs.unlockedThemes)
          ? incomingPrefs.unlockedThemes
          : [];
        const mergedUnlocked = Array.from(new Set(['#3b82f6', activePreset, ...existingUnlocked]));

        const isDynamicUnlocked = Boolean(incomingPrefs.isDynamicColorUnlocked);

        const migrated = {
          ...incoming,
          // Tercihler eksik/yarım olabilir (v1 kayıtlarında hiç yoktu). Varsayılanlarla
          // birleştirilir ki ileride eklenecek yeni anahtarlar da güvenle dolsun.
          preferences: {
            ...DEFAULT_PREFERENCES,
            ...incomingPrefs,
            unlockedThemes: mergedUnlocked,
            isDynamicColorUnlocked: isDynamicUnlocked,
            dynamicColorFromArtwork: isDynamicUnlocked ? Boolean(incomingPrefs.dynamicColorFromArtwork ?? true) : false,
            hasDismissedDynamicColorBanner: Boolean(incomingPrefs.hasDismissedDynamicColorBanner),
          },
          isSmartShuffle: Boolean(incoming.isSmartShuffle),
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
        preferences: state.preferences,
        isShuffle: state.isShuffle,
        isSmartShuffle: state.isSmartShuffle,
        repeatMode: state.repeatMode,
        hiddenTrackIds: state.hiddenTrackIds,
        artworkMap: state.artworkMap,
        metadataMap: state.metadataMap,
        // Söz önbelleği tekilleştirilmiş + hafifletilmiş olarak yazılır.
        lyricsCache: normalizeLyricsCache(state.lyricsCache),
        // Kuyruk modeli: bağlam sırası + manuel "Sırada" listesi (yalnızca kimlikler).
        contextIds: state.contextIds,
        upNextIds: state.upNextIds,
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

