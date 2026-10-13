import { create } from 'zustand';
import {
  ThemeColors,
  DEFAULT_THEME,
  extractThemeFromImageUri,
  createThemeFromHex,
} from '../services/colorThemeService';
import { useStore } from './useStore';

interface ThemeState {
  theme: ThemeColors;
  currentArtworkUri: string | null;
  updateThemeFromArtwork: (uri: string | null | undefined) => Promise<void>;
  applyPresetTheme: (colorHex: string) => void;
  resetTheme: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: DEFAULT_THEME,
  currentArtworkUri: null,

  updateThemeFromArtwork: async (uri) => {
    // "Kapaktan renk türet" kapalıysa veya kapak yoksa kullanıcının seçtiği hazır tema rengi kullanılır.
    const prefs = useStore.getState().preferences;
    const dynamic = prefs?.dynamicColorFromArtwork ?? true;
    const activeColor = prefs?.presetThemeColor || '#3b82f6';
    const fallbackTheme = createThemeFromHex(activeColor);

    if (!uri || !dynamic) {
      if (get().currentArtworkUri !== null || get().theme.primary !== fallbackTheme.primary) {
        set({ theme: fallbackTheme, currentArtworkUri: null });
      }
      return;
    }

    if (get().currentArtworkUri === uri) {
      return;
    }

    set({ currentArtworkUri: uri });

    try {
      const extractedTheme = await extractThemeFromImageUri(uri);
      // Şarkı veya tercih değişmediyse aktif olana uygula
      if (
        get().currentArtworkUri === uri &&
        (useStore.getState().preferences?.dynamicColorFromArtwork ?? true)
      ) {
        set({ theme: extractedTheme });
      }
    } catch {
      // Hata durumunda seçili hazır temayı koru
      set({ theme: fallbackTheme });
    }
  },

  applyPresetTheme: (colorHex: string) => {
    const theme = createThemeFromHex(colorHex);
    const dynamic = useStore.getState().preferences?.dynamicColorFromArtwork ?? true;
    if (!dynamic || !get().currentArtworkUri) {
      set({ theme, currentArtworkUri: null });
    }
  },

  resetTheme: () => {
    const activeColor = useStore.getState().preferences?.presetThemeColor || '#3b82f6';
    set({ theme: createThemeFromHex(activeColor), currentArtworkUri: null });
  },
}));
