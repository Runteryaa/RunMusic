import AsyncStorage from '@react-native-async-storage/async-storage';
import * as MediaLibrary from 'expo-media-library/legacy';

export const LIBRARY_CACHE_KEY = '@runmusic_library_cache_v1';

export interface CachedTrackAsset {
  id: string;
  filename: string;
  uri: string;
  mediaType: MediaLibrary.Asset['mediaType'];
  modificationTime: number;
  duration: number;
  creationTime?: number;
}

/**
 * Son taranan şarkı listesini bağımsız bir AsyncStorage anahtarında saklar.
 * Zustand store'undan ayrı tutulur; böylece Android'in 2MB tek-değer sınırı
 * asla aşılmaz ve açılışta 0ms'de anında ekrana yansıtılabilir.
 */
export async function getCachedLibrary(): Promise<MediaLibrary.Asset[] | null> {
  try {
    const raw = await AsyncStorage.getItem(LIBRARY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed as MediaLibrary.Asset[];
  } catch (e) {
    console.warn('[libraryStorage] getCachedLibrary error:', e);
    return null;
  }
}

/**
 * Taranmış müzik listesini hafifletilmiş olarak kaydeder.
 */
export async function saveCachedLibrary(assets: MediaLibrary.Asset[]): Promise<void> {
  try {
    if (!assets || assets.length === 0) return;
    const lightweight: CachedTrackAsset[] = assets.map((a) => ({
      id: a.id,
      filename: a.filename,
      uri: a.uri,
      mediaType: a.mediaType,
      modificationTime: a.modificationTime || 0,
      duration: a.duration || 0,
      creationTime: a.creationTime,
    }));
    await AsyncStorage.setItem(LIBRARY_CACHE_KEY, JSON.stringify(lightweight));
  } catch (e) {
    console.warn('[libraryStorage] saveCachedLibrary error:', e);
  }
}
