import { create } from 'zustand';
import {
  ThemeColors,
  DEFAULT_THEME,
  extractThemeFromImageUri,
  createThemeFromHex,
  createThemeFromRgb,
  hexToRgb,
} from '../services/colorThemeService';
import { useStore } from './useStore';

interface ThemeState {
  theme: ThemeColors;
  currentArtworkUri: string | null;
  updateThemeFromArtwork: (uri: string | null | undefined) => Promise<void>;
  applyPresetTheme: (colorHex: string) => void;
  resetTheme: () => void;
}

let activeThemeAnimationId: ReturnType<typeof requestAnimationFrame> | null = null;

function cancelCurrentTransition() {
  if (activeThemeAnimationId !== null) {
    cancelAnimationFrame(activeThemeAnimationId);
    activeThemeAnimationId = null;
  }
}

/**
 * Şarkı değiştiğinde veya tema güncellendiğinde renklerin aniden sıçramasını önler,
 * renkler arasında ~450ms pürüzsüz bir geçiş (cubic ease-out) sağlar.
 */
function animateThemeTransition(
  startTheme: ThemeColors,
  targetTheme: ThemeColors,
  onUpdate: (intermediateTheme: ThemeColors) => void,
  onComplete: () => void,
  duration = 450
) {
  cancelCurrentTransition();

  if (useStore.getState().preferences?.reduceMotion) {
    onComplete();
    return;
  }

  const startRgb = hexToRgb(startTheme.primary);
  const targetRgb = hexToRgb(targetTheme.primary);

  // Renkler zaten hemen hemen aynıysa gereksiz interpolasyon yapma
  if (
    Math.abs(startRgb[0] - targetRgb[0]) < 2 &&
    Math.abs(startRgb[1] - targetRgb[1]) < 2 &&
    Math.abs(startRgb[2] - targetRgb[2]) < 2
  ) {
    onComplete();
    return;
  }

  const startTime = Date.now();
  let lastFrameTime = 0;
  const FRAME_INTERVAL = 30; // ~33 FPS: pürüzsüz görsel akıcılık ve sıfır gecikme

  const step = () => {
    const now = Date.now();
    const elapsed = now - startTime;
    const progress = Math.min(1, elapsed / duration);

    // Yumuşak kübik bitiş eğrisi (cubic ease-out)
    const eased = 1 - Math.pow(1 - progress, 3);

    if (now - lastFrameTime >= FRAME_INTERVAL || progress >= 1) {
      lastFrameTime = now;
      if (progress < 1) {
        const r = Math.round(startRgb[0] + (targetRgb[0] - startRgb[0]) * eased);
        const g = Math.round(startRgb[1] + (targetRgb[1] - startRgb[1]) * eased);
        const b = Math.round(startRgb[2] + (targetRgb[2] - startRgb[2]) * eased);
        onUpdate(createThemeFromRgb(r, g, b));
      } else {
        cancelCurrentTransition();
        onComplete();
        return;
      }
    }

    if (progress < 1) {
      activeThemeAnimationId = requestAnimationFrame(step);
    }
  };

  activeThemeAnimationId = requestAnimationFrame(step);
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: DEFAULT_THEME,
  currentArtworkUri: null,

  updateThemeFromArtwork: async (uri) => {
    // "Kapaktan renk türet" kapalıysa veya kapak yoksa kullanıcının seçtiği hazır tema rengi kullanılır.
    const prefs = useStore.getState().preferences;
    const dynamic = Boolean(prefs?.isDynamicColorUnlocked && prefs?.dynamicColorFromArtwork);
    const activeColor = prefs?.presetThemeColor || '#3b82f6';
    const fallbackTheme = createThemeFromHex(activeColor);

    if (!uri || !dynamic) {
      if (get().currentArtworkUri !== null || get().theme.primary !== fallbackTheme.primary) {
        set({ currentArtworkUri: null });
        animateThemeTransition(
          get().theme,
          fallbackTheme,
          (intermediateTheme) => set({ theme: intermediateTheme }),
          () => set({ theme: fallbackTheme }),
          450
        );
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
      const currentPrefs = useStore.getState().preferences;
      const isDynamicActive = Boolean(currentPrefs?.isDynamicColorUnlocked && currentPrefs?.dynamicColorFromArtwork);
      if (
        get().currentArtworkUri === uri &&
        isDynamicActive
      ) {
        animateThemeTransition(
          get().theme,
          extractedTheme,
          (intermediateTheme) => set({ theme: intermediateTheme }),
          () => set({ theme: extractedTheme }),
          450
        );
      }
    } catch {
      // Hata durumunda seçili hazır temayı koru
      animateThemeTransition(
        get().theme,
        fallbackTheme,
        (intermediateTheme) => set({ theme: intermediateTheme }),
        () => set({ theme: fallbackTheme }),
        450
      );
    }
  },

  applyPresetTheme: (colorHex: string) => {
    const theme = createThemeFromHex(colorHex);
    const prefs = useStore.getState().preferences;
    const dynamic = Boolean(prefs?.isDynamicColorUnlocked && prefs?.dynamicColorFromArtwork);
    if (!dynamic || !get().currentArtworkUri) {
      set({ currentArtworkUri: null });
      animateThemeTransition(
        get().theme,
        theme,
        (intermediateTheme) => set({ theme: intermediateTheme }),
        () => set({ theme }),
        400
      );
    }
  },

  resetTheme: () => {
    cancelCurrentTransition();
    const activeColor = useStore.getState().preferences?.presetThemeColor || '#3b82f6';
    set({ theme: createThemeFromHex(activeColor), currentArtworkUri: null });
  },
}));
