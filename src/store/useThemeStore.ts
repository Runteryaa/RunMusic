import { create } from 'zustand';
import {
  ThemeColors,
  DEFAULT_THEME,
  extractThemeFromImageUri,
} from '../services/colorThemeService';
import { useStore } from './useStore';

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
    // "Kapaktan renk türet" kapalıysa her zaman sabit tema kullanılır.
    const dynamic = useStore.getState().preferences.dynamicColorFromArtwork;

    if (!uri || !dynamic) {
      if (get().currentArtworkUri !== null || get().theme !== DEFAULT_THEME) {
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
