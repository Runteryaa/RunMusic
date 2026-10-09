import { create } from 'zustand';
import {
  ThemeColors,
  DEFAULT_THEME,
  extractThemeFromImageUri,
  extractThemeFromSeed,
} from '../services/colorThemeService';

interface ThemeState {
  theme: ThemeColors;
  currentArtworkUri: string | null;
  updateThemeFromArtwork: (uri: string | null | undefined, fallbackSeed?: string) => Promise<void>;
  resetTheme: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: DEFAULT_THEME,
  currentArtworkUri: null,

  updateThemeFromArtwork: async (uri, fallbackSeed) => {
    const key = uri || fallbackSeed || null;
    if (!key) {
      if (get().currentArtworkUri !== null) {
        set({ theme: DEFAULT_THEME, currentArtworkUri: null });
      }
      return;
    }

    if (get().currentArtworkUri === key) {
      return;
    }

    set({ currentArtworkUri: key });

    try {
      const extractedTheme = uri
        ? await extractThemeFromImageUri(uri)
        : extractThemeFromSeed(fallbackSeed || 'default');
      // Şarkı değiştiyse sadece aktif olana uygula
      if (get().currentArtworkUri === key) {
        set({ theme: extractedTheme });
      }
    } catch {
      // Hata durumunda varsayılanı koru
    }
  },

  resetTheme: () => {
    set({ theme: DEFAULT_THEME, currentArtworkUri: null });
  },
}));
