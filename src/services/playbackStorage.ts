import AsyncStorage from '@react-native-async-storage/async-storage';

export const PLAYBACK_STORAGE_KEY = '@runmusic_last_playback_v2';

export interface SavedTrackItem {
  id: string;
  url: string;
  title?: string;
  artist?: string;
  artwork?: string;
}

export interface SavedPlaybackState {
  trackId: string;
  position: number;
  trackIndex?: number;
  track?: SavedTrackItem;
}

let lastSavedTime = 0;
let pendingSaveTimeout: any = null;

/**
 * En son dinlenen şarkı ve konumunu bağımsız, çok küçük (~200 bayt) bir JSON olarak kaydeder.
 * Zustand store'unu ve büyük medya önbelleğini kesinlikle meşgul etmez veya tetiklemez.
 */
export async function saveLastPlayback(data: SavedPlaybackState, immediate = false): Promise<void> {
  const now = Date.now();

  const doSave = async () => {
    try {
      lastSavedTime = Date.now();
      await AsyncStorage.setItem(PLAYBACK_STORAGE_KEY, JSON.stringify(data));
    } catch {
      // ignore
    }
  };

  if (immediate) {
    if (pendingSaveTimeout) {
      clearTimeout(pendingSaveTimeout);
      pendingSaveTimeout = null;
    }
    return doSave();
  }

  // 10 saniye throttling (çok sık disk yazımını önler, UI'yi sıfır gecikmede tutar)
  if (now - lastSavedTime >= 10000) {
    return doSave();
  }

  if (!pendingSaveTimeout) {
    pendingSaveTimeout = setTimeout(() => {
      pendingSaveTimeout = null;
      doSave();
    }, 10000);
  }
}

export async function getLastPlayback(): Promise<SavedPlaybackState | null> {
  try {
    const raw = await AsyncStorage.getItem(PLAYBACK_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
