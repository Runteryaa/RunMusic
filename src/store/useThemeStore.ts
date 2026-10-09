import { create } from 'zustand';
import {
  ThemeColors,
  DEFAULT_THEME,
  extractThemeFromImageUri,
} from '../services/colorThemeService';

interface ThemeState {
  theme: ThemeColors;
  currentArtworkUri: string | null;
  updateThemeFromArtwork: (uri: string | null | undefined) => Promise<void>;
  resetTheme: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: DEFAULT_THEME,
  currentArtworkUri: null,

  updateThemeFromArtwork: async (uri) => {
    if (!uri) {
      if (get().currentArtworkUri !== null) {
        set({ theme: DEFAULT_THEME, currentArtworkUri: null });
      }
      return;
    }

    if (get().currentArtworkUri === uri) {
      return;
    }

    set({ currentArtworkUri: uri });

    try {
      const extractedTheme = await extractThemeFromImageUri(uri);
      // Şarkı değiştiyse sadece aktif olana uygula
      if (get().currentArtworkUri === uri) {
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
