import type { LyricsCacheEntry } from './persistSanitize';
import type { LyricsCandidate, LyricsResult } from './lyricsTypes';
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
  /** Eşleşmenin bulunduğu satır (kısaltılmış önizleme). */
  snippet: string;
  /**
   * Eşleşen satır ve komşu satırlar. Kullanıcı önizlemeyi genişlettiğinde
   * gösterilir; böylece sözün bağlamı görülür, arama sonucu kutusu ise ilk
   * bakışta şişmez.
   */
  details: string;
}

const LRC_TAG = /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g;
const MAX_SNIPPET_LENGTH = 90;
/** Genişletildiğinde gösterilecek en fazla karakter. */
const MAX_DETAILS_LENGTH = 600;
/** Eşleşen satırın üstünde/altında gösterilecek satır sayısı. */
const DETAIL_CONTEXT_LINES = 2;

function clip(text: string, limit = MAX_SNIPPET_LENGTH): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

/**
 * Eşleşen satırı komşularıyla birlikte döner: kullanıcı genişlettiğinde
 * sözün bağlamını görür. Boş satırlar korunmaz, toplam uzunluk sınırlanır.
 *
 * Dönen metin **her zaman** önizlemeden uzundur; aksi hâlde "Genişlet" düğmesi
 * hiç görünmez ve sonuç, genişletilemez kısa bir kutu gibi kalır. Sırasıyla:
 * 1. Eşleşen satır + komşuları (bağlam),
 * 2. bağlam yeterli değilse eşleşen satırın kırpılmamış tamamı
 *    (satır 90 karakterden uzunsa önizleme kırpılmış olur),
 * 3. o da yetmezse sözün tamamı (sınırlı uzunlukta).
 */
function buildDetails(lines: string[], matchIndex: number, preview: string): string {
  const start = Math.max(0, matchIndex - DETAIL_CONTEXT_LINES);
  const end = Math.min(lines.length, matchIndex + DETAIL_CONTEXT_LINES + 1);
  const context = clip(lines.slice(start, end).join('\n'), MAX_DETAILS_LENGTH);
  if (context.length > preview.length) return context;

  const fullLine = clip(lines[matchIndex] ?? '', MAX_DETAILS_LENGTH);
  if (fullLine.length > preview.length) return fullLine;

  const wholeSong = clip(lines.join('\n'), MAX_DETAILS_LENGTH);
  return wholeSong.length > preview.length ? wholeSong : context;
}

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
    let found: { snippet: string; details: string } | null = null;
    let canonicalKey: string | null = null;

    for (const key of keys) {
      const resolved = resolveEntry(cache, key);
      if (!resolved) continue;
      // Aynı söz kanonik kaydı zaten listelendiyse bu anahtar atlanır (ref/kopya).
      if (seen.has(resolved.canonicalKey)) continue;
      const lines = lyricsLines(resolved.entry);
      const matchIndex = lines.findIndex((candidate) => {
        const normalizedLine = normalizeSearchText(candidate);
        return terms.every((term) => normalizedLine.includes(term));
      });
      if (matchIndex >= 0) {
        const snippet = clip(lines[matchIndex]);
        found = {
          snippet,
          details: buildDetails(lines, matchIndex, snippet),
        };
        canonicalKey = resolved.canonicalKey;
        break;
      }
    }

    if (found) {
      hits.push({ track, snippet: found.snippet, details: found.details });
      seen.add(track.id);
      keys.forEach((key) => seen.add(key));
      // Aynı sözü paylaşan diğer anahtarlar (kopya/ref) tekrar listelenmesin.
      if (canonicalKey) seen.add(canonicalKey);
      if (hits.length >= limit) break;
    }
  }

  return hits;
}

/** Çevrimdışı aramada seçilebilir, önbellekten çözülmüş bir söz sonucu. */
export interface CachedLyricsCandidate {
  candidate: LyricsCandidate;
  result: LyricsResult;
}

/** Önbellekteki bir kayıt zamanlı (senkron) söz taşıyor mu? */
function entryHasTiming(result: LyricsResult): boolean {
  if (result.syncedLyrics && result.syncedLyrics.trim()) return true;
  if (result.lyricsfile && result.lyricsfile.trim()) return true;
  if (result.ttml && result.ttml.trim()) return true;
  return Array.isArray(result.parsedLines) && result.parsedLines.length > 0;
}

/** Önbellekteki bir kayıt hece (kelime) senkronu taşıyor mu? */
function entryHasWordTiming(result: LyricsResult): boolean {
  if (result.hasWordSync) return true;
  return (
    Array.isArray(result.parsedLines) &&
    result.parsedLines.some((line) => !!line.words && line.words.length > 0)
  );
}

/**
 * Kayıtlı (önbellekteki) sözler arasında arama yapar.
 *
 * Çevrimdışıyken manuel söz araması ağa hiç çıkmaz; bunun yerine daha önce
 * indirilmiş sözler taranır. Sorgu önce parça/sanatçı adında, bulunamazsa söz
 * satırlarının içinde aranır. Dönen kayıtlar doğrudan seçilebilir: seçim
 * sırasında ağ isteği üretilmez.
 */
export function searchCachedLyricsCandidates(
  cache: Record<string, LyricsCacheEntry>,
  query: string,
  limit = 20
): CachedLyricsCandidate[] {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length < 2) return [];
  const terms = normalizedQuery.split(' ').filter(Boolean);

  const seen = new Set<string>();
  const seenResults = new Set<string>();
  const nameMatches: CachedLyricsCandidate[] = [];
  const textMatches: CachedLyricsCandidate[] = [];

  for (const key of Object.keys(cache)) {
    const resolved = resolveEntry(cache, key);
    if (!resolved) continue;
    const { entry: result, canonicalKey } = resolved;
    if (seen.has(canonicalKey)) continue;
    seen.add(canonicalKey);

    // Aynı söz birden çok anahtarla (id, url, arama anahtarı) kopyalanmış
    // olabilir; sonuç kimliği/parça adı üzerinden tekrarı engelle.
    const signature =
      result.id || `${result.trackName || ''}|${result.artistName || ''}`;
    if (seenResults.has(signature)) continue;
    seenResults.add(signature);

    const nameText = normalizeSearchText(
      `${result.trackName || ''} ${result.artistName || ''}`
    );
    const matchesName = terms.every((term) => nameText.includes(term));
    let matchesText = false;
    if (!matchesName) {
      matchesText = lyricsLines(result).some((line) => {
        const normalizedLine = normalizeSearchText(line);
        return terms.every((term) => normalizedLine.includes(term));
      });
    }
    if (!matchesName && !matchesText) continue;

    const source: LyricsCandidate['source'] =
      result.source === 'custom' ? 'genius' : result.source;
    const candidate: LyricsCandidate = {
      id: `cache:${canonicalKey}`,
      trackName: result.trackName || '',
      artistName: result.artistName || '',
      hasSynced: entryHasTiming(result),
      hasWordSync: entryHasWordTiming(result),
      syncedLyrics: result.syncedLyrics ?? null,
      plainLyrics: result.plainLyrics ?? null,
      lyricsfile: result.lyricsfile ?? null,
      source,
    };

    (matchesName ? nameMatches : textMatches).push({ candidate, result });
  }

  // Ada göre eşleşenler daha alakalı; söz metninde bulunanlar onların ardına.
  return [...nameMatches, ...textMatches].slice(0, limit);
}
