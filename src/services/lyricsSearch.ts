import type { LyricsCacheEntry } from './persistSanitize';
import type { LyricsResult } from './lyricsTypes';
import { normalizeSearchText } from './searchUtils';

/**
 * Söz önbelleğinde arama (saf, native'siz).
 *
 * Kitaplıktaki parçaların kayıtlı sözleri tek tek taranır. Önbellekte bir
 * anahtar içerik yerine yalnızca kanonik anahtara referans tutabildiği için
 * (`{ ref }`) referanslar burada çözülür.
 */

export interface LyricsSearchTrack {
  id: string;
  uri?: string;
  title: string;
  artist?: string;
}

export interface LyricsSearchHit {
  track: LyricsSearchTrack;
  /** Eşleşmenin bulunduğu satır (kısaltılmış). */
  snippet: string;
}

const LRC_TAG = /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g;
const MAX_SNIPPET_LENGTH = 90;

function resolveEntry(
  cache: Record<string, LyricsCacheEntry>,
  key: string
): { entry: LyricsResult; canonicalKey: string } | null {
  const entry = cache[key];
  if (!entry) return null;
  if ('ref' in entry && typeof entry.ref === 'string') {
    const target = cache[entry.ref];
    if (target && !('ref' in target)) {
      return { entry: target as LyricsResult, canonicalKey: entry.ref };
    }
    return null;
  }
  return { entry: entry as LyricsResult, canonicalKey: key };
}

/** Söz metnini satırlara ayırır; LRC zaman etiketleri atılır. */
function lyricsLines(entry: LyricsResult): string[] {
  const raw =
    entry.plainLyrics ||
    (entry.syncedLyrics ? entry.syncedLyrics.replace(LRC_TAG, '') : '') ||
    '';
  if (raw) {
    return raw
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }
  // Son çare: ayrıştırılmış satırlar (ör. yalnızca TTML varsa).
  return (entry.parsedLines || [])
    .map((line) => (line.text || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function clip(text: string): string {
  return text.length <= MAX_SNIPPET_LENGTH
    ? text
    : `${text.slice(0, MAX_SNIPPET_LENGTH - 1).trimEnd()}…`;
}

/**
 * Sorguyla eşleşen söz satırlarını döner.
 *
 * Aynı parça birden çok anahtarla önbellekte olabileceği için her parça en
 * fazla bir kez listelenir. Parça kimliği/eşleşmesi kitaplık kaydı üzerinden
 * yapılır; böylece sonuç doğrudan çalınabilir.
 */
export function searchLyricsCache(
  cache: Record<string, LyricsCacheEntry>,
  tracks: LyricsSearchTrack[],
  query: string,
  limit = 6
): LyricsSearchHit[] {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length < 2 || tracks.length === 0) return [];

  const terms = normalizedQuery.split(' ').filter(Boolean);
  const hits: LyricsSearchHit[] = [];
  const seen = new Set<string>();

  for (const track of tracks) {
    if (seen.has(track.id)) continue;
    const keys = [track.id, track.uri].filter(Boolean) as string[];
    let found: string | null = null;
    let canonicalKey: string | null = null;

    for (const key of keys) {
      const resolved = resolveEntry(cache, key);
      if (!resolved) continue;
      // Aynı söz kanonik kaydı zaten listelendiyse bu anahtar atlanır (ref/kopya).
      if (seen.has(resolved.canonicalKey)) continue;
      const lines = lyricsLines(resolved.entry);
      const line = lines.find((candidate) => {
        const normalizedLine = normalizeSearchText(candidate);
        return terms.every((term) => normalizedLine.includes(term));
      });
      if (line) {
        found = clip(line);
        canonicalKey = resolved.canonicalKey;
        break;
      }
    }

    if (found) {
      hits.push({ track, snippet: found });
      seen.add(track.id);
      keys.forEach((key) => seen.add(key));
      // Aynı sözü paylaşan diğer anahtarlar (kopya/ref) tekrar listelenmesin.
      if (canonicalKey) seen.add(canonicalKey);
      if (hits.length >= limit) break;
    }
  }

  return hits;
}
