/**
 * Söz veri modeli.
 *
 * `lyricsService` içinde tanımlanmıştı; Apple Music TTML parser'ı ve lrc.red
 * sağlayıcısı da bu tiplere ihtiyaç duyduğu için ayrı bir modüle taşındı.
 * Böylece bu dosyalar birbirini import etmeden (döngüsel bağımlılık olmadan)
 * aynı şekli paylaşır. `lyricsService` tipleri yeniden dışa aktarır; mevcut
 * import'lar değişmeden çalışmaya devam eder.
 */

export interface LyricWord {
  time: number;
  endTime?: number;
  text: string;
}

/**
 * Bir söz satırı.
 *
 * `background`, Apple TTML'deki `ttm:role="x-bg"` cevap vokalini (veya düz
 * metindeki satır sonu parantezini) taşır. `alignment` iki farklı `ttm:agent`
 * varsa satırın hangi tarafa hizalanacağını söyler (duet düzeni).
 */
export interface LyricLine {
  time: number;
  endTime?: number;
  text: string;
  words?: LyricWord[];
  background?: LyricLine;
  agent?: string;
  alignment?: 'start' | 'end';
}

export type LyricsSource = 'lrc.red' | 'lrclib' | 'genius' | 'custom';

export interface LyricsCandidate {
  id: string;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  hasSynced: boolean;
  hasWordSync?: boolean;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  lyricsfile?: string | null;
  source: 'lrc.red' | 'lrclib' | 'genius';
  /** lrc.red sonuçlarında TTML belgesinin adresi bu ISRC üzerinden kurulur. */
  isrc?: string;
  geniusUrl?: string;
}

export interface LyricsResult {
  id?: string;
  trackName: string;
  artistName: string;
  syncedLyrics: string | null;
  plainLyrics: string | null;
  lyricsfile?: string | null;
  /** lrc.red'den gelen ham Apple TTML belgesi; satırlar yeniden bundan üretilir. */
  ttml?: string | null;
  hasWordSync?: boolean;
  parsedLines: LyricLine[];
  source: LyricsSource;
  candidates?: LyricsCandidate[];
  isUserSelected?: boolean;
  selectedCandidateId?: string;
}
