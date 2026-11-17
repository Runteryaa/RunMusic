import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Son aramalar (en fazla 8).
 *
 * Store persist kaydına yazılmaz: tek bir AsyncStorage değeri küçük tutulur ve
 * arama geçmişi silinirse diğer tercihler etkilenmez.
 */

export const RECENT_SEARCHES_KEY = '@runmusic_recent_searches_v1';
export const MAX_RECENT_SEARCHES = 8;

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export async function loadRecentSearches(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_SEARCHES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

/** Yeni aramayı başa ekler (aynı metin varsa taşınır) ve listeyi döner. */
export async function addRecentSearch(
  query: string,
  existing: string[] = []
): Promise<string[]> {
  const value = normalize(query);
  if (value.length < 2) return existing;
  const next = [value, ...existing.filter((item) => item !== value)].slice(
    0,
    MAX_RECENT_SEARCHES
  );
  try {
    await AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  } catch {
    // Depolama hatası aramayı engellemez.
  }
  return next;
}

export async function clearRecentSearches(): Promise<void> {
  try {
    await AsyncStorage.removeItem(RECENT_SEARCHES_KEY);
  } catch {
    // yoksay
  }
}
