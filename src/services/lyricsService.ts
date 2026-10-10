export interface LyricWord {
  time: number;
  endTime?: number;
  text: string;
}

export interface LyricLine {
  time: number;
  endTime?: number;
  text: string;
  words?: LyricWord[];
}

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
  source: 'lrclib' | 'genius';
  geniusUrl?: string;
}

export interface LyricsResult {
  id?: string;
  trackName: string;
  artistName: string;
  syncedLyrics: string | null;
  plainLyrics: string | null;
  lyricsfile?: string | null;
  hasWordSync?: boolean;
  parsedLines: LyricLine[];
  source: 'lrclib' | 'genius' | 'custom';
  candidates?: LyricsCandidate[];
  isUserSelected?: boolean;
  selectedCandidateId?: string;
}

/**
 * Parse an LRC string into an array of { time: number, text: string, words?: LyricWord[] } objects.
 * Supports mm:ss.xx, mm:ss.xxx, mm:ss:xx, mm:ss, and enhanced LRC with <mm:ss.xx> word tags.
 */
export function parseLRC(lrc: string): LyricLine[] {
  if (!lrc) return [];
  const lines = lrc.split('\n');
  const result: LyricLine[] = [];
  const lineTimeRegex = /\[(\d{1,3}):(\d{2})(?:[\.:](\d{1,3}))?\]/g;

  for (const line of lines) {
    const times: number[] = [];
    let match: RegExpExecArray | null;
    lineTimeRegex.lastIndex = 0;

    while ((match = lineTimeRegex.exec(line)) !== null) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const centiseconds = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0;
      times.push(minutes * 60 + seconds + centiseconds / 1000);
    }

    if (times.length === 0) continue;

    const content = line.replace(/\[\d{1,3}:\d{2}(?:[\.:]\d{1,3})?\]/g, '').trim();
    if (!content) continue;

    // Check for Enhanced LRC format (<mm:ss.xx> word timestamps)
    let words: LyricWord[] = [];
    if (/<\d{1,3}:\d{2}/.test(content)) {
      const tokens = content.split(/(<\d{1,3}:\d{2}(?:[\.:]\d{1,3})?>)/g).filter(Boolean);
      let currentWordTime = times[0];
      for (const token of tokens) {
        const timeMatch = token.match(/<(\d{1,3}):(\d{2})(?:[\.:](\d{1,3}))?>/);
        if (timeMatch) {
          const m = parseInt(timeMatch[1], 10);
          const s = parseInt(timeMatch[2], 10);
          const cs = timeMatch[3] ? parseInt(timeMatch[3].padEnd(3, '0').slice(0, 3), 10) : 0;
          currentWordTime = m * 60 + s + cs / 1000;
        } else if (token.length > 0) {
          words.push({
            time: currentWordTime,
            text: token,
          });
        }
      }

      for (let i = 0; i < words.length - 1; i++) {
        words[i].endTime = words[i + 1].time;
      }
    }

    const cleanText = content
      .replace(/<\d{1,3}:\d{2}(?:[\.:]\d{1,3})?>/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    for (const t of times) {
      result.push({
        time: t,
        text: cleanText,
        words: words.length > 0 ? words : undefined,
      });
    }
  }

  return result.filter((l) => l.text.length > 0).sort((a, b) => a.time - b.time);
}

/**
 * Parses LRCLIB's YAML lyricsfile format into LyricLine[] with word-by-word timestamps.
 */
export function parseLyricsFile(yaml: string): LyricLine[] {
  if (!yaml) return [];
  const rawLines = yaml.split('\n');
  const result: LyricLine[] = [];
  let currentLine: LyricLine | null = null;
  let currentWords: LyricWord[] = [];
  let lineIndent = -1;
  let inWords = false;

  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Detect indentation
    const listItemMatch = raw.match(/^(\s*)-\s+(.*)$/);
    if (listItemMatch) {
      const itemIndent = listItemMatch[1].length;
      const rest = listItemMatch[2].trim();

      // If we were inside words, check if indent dropped back to line-level
      if (inWords && lineIndent >= 0 && itemIndent <= lineIndent) {
        inWords = false;
      }

      if (inWords) {
        let wordText = '';
        const wordTextMatch = rest.match(/^text:\s*(.*)$/);
        if (wordTextMatch) {
          wordText = wordTextMatch[1].trim().replace(/^['"]|['"]$/g, '');
        }
        currentWords.push({ text: wordText, time: 0 });
      } else {
        if (currentLine) {
          if (currentWords.length > 0) currentLine.words = currentWords;
          result.push(currentLine);
        }
        lineIndent = itemIndent;
        inWords = false;
        currentWords = [];

        let lineText = '';
        const lineTextMatch = rest.match(/^text:\s*(.*)$/);
        if (lineTextMatch) {
          lineText = lineTextMatch[1].trim().replace(/^['"]|['"]$/g, '');
        }
        currentLine = { text: lineText, time: 0 };
      }
      continue;
    }

    if (trimmed.startsWith('words:')) {
      inWords = true;
      continue;
    }

    if (trimmed.startsWith('text:')) {
      const val = trimmed.replace(/^text:\s*/, '').replace(/^['"]|['"]$/g, '');
      if (inWords && currentWords.length > 0) {
        currentWords[currentWords.length - 1].text = val;
      } else if (currentLine) {
        currentLine.text = val;
      }
      continue;
    }

    if (trimmed.startsWith('start_ms:')) {
      const ms = parseInt(trimmed.replace(/^start_ms:\s*/, ''), 10);
      const timeSec = isNaN(ms) ? 0 : ms / 1000;
      if (inWords && currentWords.length > 0) {
        currentWords[currentWords.length - 1].time = timeSec;
      } else if (currentLine) {
        currentLine.time = timeSec;
      }
      continue;
    }

    if (trimmed.startsWith('end_ms:')) {
      const ms = parseInt(trimmed.replace(/^end_ms:\s*/, ''), 10);
      const timeSec = isNaN(ms) ? 0 : ms / 1000;
      if (inWords && currentWords.length > 0) {
        currentWords[currentWords.length - 1].endTime = timeSec;
      } else if (currentLine) {
        currentLine.endTime = timeSec;
      }
      continue;
    }

    if (trimmed.startsWith('plain:') || trimmed.startsWith('metadata:') || trimmed.startsWith('lines:')) {
      inWords = false;
    }
  }

  if (currentLine) {
    if (currentWords.length > 0) currentLine.words = currentWords;
    result.push(currentLine);
  }

  return result.filter((l) => l.text && l.text.length > 0).sort((a, b) => a.time - b.time);
}

/**
 * Parses either LRCLIB YAML lyricsfile or LRC string, prioritizing whichever has word-level sync.
 */
export function parseAnySyncedLyrics(
  lyricsfile?: string | null,
  syncedLyrics?: string | null
): LyricLine[] {
  let fromYaml: LyricLine[] = [];
  if (lyricsfile && lyricsfile.trim()) {
    fromYaml = parseLyricsFile(lyricsfile);
    const yamlHasWords = fromYaml.some((l) => l.words && l.words.length > 0);
    if (yamlHasWords) {
      return fromYaml;
    }
  }

  let fromLrc: LyricLine[] = [];
  if (syncedLyrics && syncedLyrics.trim()) {
    fromLrc = parseLRC(syncedLyrics);
    const lrcHasWords = fromLrc.some((l) => l.words && l.words.length > 0);
    if (lrcHasWords) {
      return fromLrc;
    }
  }

  if (fromYaml.length > 0) return fromYaml;
  if (fromLrc.length > 0) return fromLrc;
  return [];
}

/**
 * Common YouTube suffix/noise patterns to strip from track & artist strings.
 * Order matters: strip compound phrases before individual words.
 * Ported directly from Runteryaa/YT-LyricPopup background.js.
 */
export const YT_NOISE_PATTERNS = [
  // Video type labels (inside or outside brackets)
  /official\s*(music\s*)?video/gi,
  /official\s*audio/gi,
  /official\s*lyric\s*video/gi,
  /official\s*visualizer/gi,
  /official\s*clip/gi,
  /lyric\s*video/gi,
  /lyrics?\s*video/gi,
  /audio\s*only/gi,
  /music\s*video/gi,
  /official\s*mv/gi,
  /\bmv\b/gi,
  /\bm\/v\b/gi,
  /visuali[sz]er/gi,
  /\bvideo\s*clip\b/gi,
  /\bofficial\b/gi,

  // Quality / format tags
  /\b(4k|8k|hd|hq|full\s*hd|1080p|720p|explicit)\b/gi,

  // "Prod." credits
  /prod\.?\s*(by\s*)?[^,\-\[\]()\n]+/gi,

  // Features — must come AFTER prod. strip
  /[\(\[]\s*feat\.?.*?[\)\]]/gi,     // (feat. x) or [feat. x]
  /[\(\[]\s*ft\.?.*?[\)\]]/gi,       // (ft. x)
  /,?\s*feat(uring)?\.?\s+[^,\-\[\]()\n]+/gi,
  /,?\s*ft\.?\s+[^,\-\[\]()\n]+/gi,

  // Bracketed/parenthesised leftovers (generic — run last)
  /\([^)]*\)/g,
  /\[[^\]]*\]/g,
];

export const AUDIO_EXTENSIONS_REGEX =
  /\.(mp3|m4a|wav|flac|aac|ogg|opus|wma|aiff|alac|ape|mp4|webm)$/i;

/**
 * Strip YouTube noise from a title segment (track name or full title).
 * Preserves the core song/artist name without breaking titles containing dots (like feat. or ft.).
 * Ported directly from Runteryaa/YT-LyricPopup background.js.
 */
export function cleanYouTubeTitle(str: string): string {
  let s = str || '';

  // Remove audio file extension if present (for local audio files!)
  s = s.replace(AUDIO_EXTENSIONS_REGEX, '');

  // Remove wrapping or standalone double quotes
  s = s.replace(/"/g, '');

  for (const pat of YT_NOISE_PATTERNS) {
    s = s.replace(pat, ' ');
  }
  // Collapse multiple spaces / trim trailing punctuation
  return s.replace(/\s+/g, ' ').replace(/[\s,\-–—|]+$/, '').trim();
}

// Alias for backwards compatibility
export const cleanTrackTitle = cleanYouTubeTitle;

/**
 * Başlık içerisindeki mükerrer sanatçı adını temizler.
 * Örneğin:
 * - "Duman - Kırmış Kalbini" (artist="Duman") -> "Kırmış Kalbini"
 * - "Duman : Kırmış Kalbini" (artist="Duman") -> "Kırmış Kalbini"
 * - "Duman Kırmış Kalbini" (artist="Duman") -> "Kırmış Kalbini"
 * - "Kırmış Kalbini - Duman" (artist="Duman") -> "Kırmış Kalbini"
 * - "Kırmış Kalbini by Duman" (artist="Duman") -> "Kırmış Kalbini"
 * - "Kırmış Kalbini (Duman)" (artist="Duman") -> "Kırmış Kalbini"
 */
export function stripArtistFromTitle(title: string, artist?: string): string {
  if (!title) return '';
  let result = title.trim();
  const cleanArt = cleanYouTubeTitle(artist || '').trim();

  if (
    !cleanArt ||
    cleanArt.toLowerCase() === 'local audio' ||
    cleanArt.toLowerCase() === 'bilinmeyen sanatci' ||
    cleanArt.toLowerCase() === 'bilinmeyen sanatçı'
  ) {
    return result;
  }

  // Yardımcı: Eğer ayıklama sonucu "&", "+", "feat" gibi işaretlerle başlıyorsa,
  // şarkıda birden fazla kişi vardır (örn: "Keskin & KÖKSVL - Yapma Gadaşım").
  // Bu durumda eğer tire (-) varsa tireden sonrasını (gerçek şarkı adını) al,
  // yoksa orijinal başlığı bozmadan iade et.
  const sanitizeRemainder = (stripped: string): string => {
    const s = stripped.trim();
    if (!s) return result;
    if (/^([&+,/|~_-]|(feat|ft|with|x)\b)/i.test(s)) {
      const dashMatch = s.match(/[-–—]\s*(.+)$/);
      if (dashMatch && dashMatch[1]?.trim()) {
        return dashMatch[1].trim();
      }
      return result;
    }
    return s;
  };

  const escapedArt = cleanArt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // 1. Başlığın başında sanatçı ve ayırıcı varsa: "Artist - Title", "Artist : Title", "Artist / Title", "Artist _ Title"
  const prefixSeparatorRegex = new RegExp(`^${escapedArt}\\s*[-–—:|~_/]\\s*`, 'i');
  if (prefixSeparatorRegex.test(result)) {
    const stripped = sanitizeRemainder(result.replace(prefixSeparatorRegex, ''));
    if (stripped.length > 0) return stripped;
  }

  // 2. Başlığın başında boşlukla ayrılmış sanatçı varsa: "Artist Title"
  const prefixSpaceRegex = new RegExp(`^${escapedArt}\\s+`, 'i');
  if (prefixSpaceRegex.test(result)) {
    const stripped = sanitizeRemainder(result.replace(prefixSpaceRegex, ''));
    if (stripped.length > 0) return stripped;
  }

  // 3. Başlığın sonunda sanatçı ve ayırıcı varsa: "Title - Artist", "Title : Artist", vb.
  const suffixSeparatorRegex = new RegExp(`\\s*[-–—:|~_/]\\s*${escapedArt}$`, 'i');
  if (suffixSeparatorRegex.test(result)) {
    const stripped = sanitizeRemainder(result.replace(suffixSeparatorRegex, ''));
    if (stripped.length > 0) return stripped;
  }

  // 4. "Title by Artist"
  const suffixByRegex = new RegExp(`\\s+by\\s+${escapedArt}$`, 'i');
  if (suffixByRegex.test(result)) {
    const stripped = sanitizeRemainder(result.replace(suffixByRegex, ''));
    if (stripped.length > 0) return stripped;
  }

  // 5. Parantez içi sanatçı: "Title (Artist)" veya "Title [Artist]"
  const bracketRegex = new RegExp(`\\s*[\\[\\(]\\s*${escapedArt}\\s*[\\]\\)]`, 'i');
  if (bracketRegex.test(result)) {
    const stripped = sanitizeRemainder(result.replace(bracketRegex, ''));
    if (stripped.length > 0) return stripped;
  }

  // 6. Normalizasyon karşılaştırması (Türkçe karakter veya boşluk farkı durumu için)
  const normArt = normalise(cleanArt);
  const normRes = normalise(result);
  if (normArt && normRes.startsWith(normArt + ' ')) {
    const artWordCount = normArt.split(' ').filter(Boolean).length;
    const titleWords = result.split(/\s+/);
    if (titleWords.length > artWordCount) {
      const stripped = sanitizeRemainder(
        titleWords
          .slice(artWordCount)
          .join(' ')
          .replace(/^[-–—:|~_/]\s*/, '')
      );
      if (stripped.length > 0) return stripped;
    }
  }

  return result;
}

/**
 * Extracts and cleans search keywords from a video / audio title.
 * Ported directly from Runteryaa/YT-LyricPopup background.js.
 */
export function getSearchKeywords(videoTitle: string, channelName = '') {
  // Strip audio extension and anything after a pipe character since it's usually just metadata
  let titleBeforePipe = (videoTitle || '')
    .replace(AUDIO_EXTENSIONS_REGEX, '')
    .split('|')[0]
    .trim();

  // Strip leading track numbers like "01 - ", "01. ", "1 - ", etc.
  titleBeforePipe = titleBeforePipe.replace(/^\d{1,3}\s*[\.\-–—]\s*/, '');

  // Parse "Artist - Title" (lazy on artist side to handle "A & B - Song")
  const dashMatch = titleBeforePipe.match(/^(.+?)\s*[-–—]\s*(.+)$/);

  // Clean both halves: strip "Official Music Video", "ft. x", "4K", etc.
  const rawArtist = dashMatch ? dashMatch[1].trim() : '';
  const rawTrack = dashMatch ? dashMatch[2].trim() : titleBeforePipe.trim();

  let expectedArtist = cleanYouTubeTitle(rawArtist || channelName);
  let expectedTrack = cleanYouTubeTitle(rawTrack);

  // Başlık içinde kalan sanatçı ismini ayıkla (mükerrerliği önler)
  if (expectedArtist) {
    expectedTrack = stripArtistFromTitle(expectedTrack, expectedArtist);
  }
  if (channelName && channelName !== expectedArtist) {
    expectedTrack = stripArtistFromTitle(expectedTrack, channelName);
  }

  const cleanChannel = cleanYouTubeTitle(channelName);

  let cleanedFullTitle = expectedTrack;
  if (dashMatch && expectedArtist) {
    cleanedFullTitle = `${expectedArtist} ${expectedTrack}`;
  } else if (expectedArtist && expectedTrack) {
    cleanedFullTitle = `${expectedArtist} ${expectedTrack}`;
  }

  return { expectedArtist, expectedTrack, cleanChannel, cleanedFullTitle, dashMatch, titleBeforePipe };
}

export function parseArtistAndTitle(rawTitle: string, defaultArtist = ''): { artist: string; title: string } {
  const safeDefaultArtist =
    defaultArtist && defaultArtist !== 'Local Audio' && defaultArtist !== 'Bilinmeyen Sanatçı'
      ? defaultArtist
      : '';

  const { expectedArtist, expectedTrack } = getSearchKeywords(rawTitle, safeDefaultArtist);

  return {
    artist: expectedArtist || cleanYouTubeTitle(safeDefaultArtist),
    title: expectedTrack || cleanYouTubeTitle(rawTitle),
  };
}

export function createLyricsLookupKey(title?: string, artist?: string): string {
  const normTitle = normalise(cleanYouTubeTitle(title || ''));
  const normArtist = normalise(cleanYouTubeTitle(artist || ''));
  if (normArtist && normArtist !== 'local audio' && normArtist !== 'bilinmeyen sanatci') {
    return `art_${normArtist}___tit_${normTitle}`;
  }
  return `tit_${normTitle}`;
}

export function getLyricsCacheKeys(params: {
  id?: string;
  url?: string;
  title?: string;
  artist?: string;
  rawTitle?: string;
}): string[] {
  const keys = new Set<string>();
  if (params.id) keys.add(params.id);
  if (params.url) {
    keys.add(params.url);
    try {
      const filename = decodeURIComponent(params.url.split('/').pop() || '');
      if (filename) {
        const cleanFn = filename.replace(AUDIO_EXTENSIONS_REGEX, '');
        keys.add(`fn_${cleanFn}`);
        keys.add(`fn_${cleanYouTubeTitle(cleanFn)}`);
      }
    } catch {}
  }

  const { expectedArtist, expectedTrack, cleanedFullTitle } = getSearchKeywords(
    params.title || params.rawTitle || '',
    params.artist || ''
  );

  if (expectedTrack) {
    keys.add(createLyricsLookupKey(expectedTrack, expectedArtist));
    keys.add(createLyricsLookupKey(expectedTrack));
  }
  if (cleanedFullTitle) {
    keys.add(createLyricsLookupKey(cleanedFullTitle));
  }
  if (params.title) {
    keys.add(createLyricsLookupKey(params.title, params.artist));
    keys.add(createLyricsLookupKey(params.title));
  }
  if (params.rawTitle && params.rawTitle !== params.title) {
    keys.add(createLyricsLookupKey(params.rawTitle, params.artist));
    keys.add(createLyricsLookupKey(params.rawTitle));
  }

  return Array.from(keys).filter(Boolean);
}

function normalise(str: string): string {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(a: string, b: string): number {
  const setA = new Set(normalise(a).split(' ').filter(Boolean));
  const setB = new Set(normalise(b).split(' ').filter(Boolean));
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const w of setA) {
    if (setB.has(w)) intersection++;
  }
  return intersection / (setA.size + setB.size - intersection);
}

function scoreResult(result: any, expectedArtist: string, expectedTrack: string): number {
  const artistSim = expectedArtist ? similarity(result.artistName, expectedArtist) : 0.8;
  const trackSim = expectedTrack ? similarity(result.trackName, expectedTrack) : 0.8;
  const score = expectedArtist ? artistSim * 0.65 + trackSim * 0.35 : trackSim;
  const hasWord = !!result.hasWordSync || (typeof result.lyricsfile === 'string' && result.lyricsfile.includes('words:'));
  const wordBonus = hasWord ? 0.003 : 0;
  const syncBonus = result.syncedLyrics ? 0.001 : 0;
  return score + wordBonus + syncBonus;
}

function pickBest(results: any[], expectedArtist: string, expectedTrack: string): any | null {
  const isWordSync = (r: any) =>
    !!r.hasWordSync || (typeof r.lyricsfile === 'string' && r.lyricsfile.includes('words:'));

  if (!expectedArtist && !expectedTrack) {
    return results.find(isWordSync) || results.find((r) => r.syncedLyrics) || results[0] || null;
  }
  const scored = results
    .map((r) => ({ r, score: scoreResult(r, expectedArtist, expectedTrack) }))
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0 || scored[0].score < 0.1) return null;
  const threshold = scored[0].score - 0.15;
  const topTier = scored.filter((s) => s.score >= threshold).map((s) => s.r);
  return topTier.find(isWordSync) || topTier.find((r) => r.syncedLyrics) || topTier[0] || null;
}

export const LRCLIB_HEADERS: HeadersInit = {
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Lrclib-Client': 'LyricPopup v1.0.0 (https://github.com/Runteryaa/RunMusic)',
  Accept: 'application/json',
};

export function buildLrclibSearchUrl(params: Record<string, string>): string {
  const query = Object.entries(params)
    .filter(([_, v]) => Boolean(v && v.trim()))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v.trim())}`)
    .join('&');
  return `https://lrclib.net/api/search?${query}`;
}

export async function searchLrclib(title: string, artist = ''): Promise<LyricsResult | null> {
  try {
    const { expectedArtist, expectedTrack, cleanedFullTitle, dashMatch } = getSearchKeywords(
      title,
      artist
    );

    let directFallbackResult: LyricsResult | null = null;
    let directCandidate: LyricsCandidate | null = null;

    // 1. Doğrudan exact /api/get endpoint'ini dene (En hızlı, 503 yükünden etkilenmez)
    if (expectedArtist && expectedTrack) {
      try {
        const getUrl = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(
          expectedArtist
        )}&track_name=${encodeURIComponent(expectedTrack)}`;
        const getRes = await fetch(getUrl, {
          headers: LRCLIB_HEADERS,
        });
        if (getRes.ok) {
          const directData = await getRes.json();
          if (directData) {
            const hasWord =
              !!directData.hasWordSync ||
              (typeof directData.lyricsfile === 'string' && directData.lyricsfile.includes('words:'));
            const parsed = parseAnySyncedLyrics(directData.lyricsfile, directData.syncedLyrics);
            const actuallyHasWords = hasWord || parsed.some((l) => !!l.words && l.words.length > 0);

            directCandidate = {
              id: `lrclib-${directData.id}`,
              trackName: directData.trackName,
              artistName: directData.artistName,
              albumName: directData.albumName || '',
              duration: directData.duration || 0,
              hasSynced: !!directData.syncedLyrics || parsed.length > 0,
              hasWordSync: actuallyHasWords,
              syncedLyrics: directData.syncedLyrics || null,
              plainLyrics: directData.plainLyrics || null,
              lyricsfile: directData.lyricsfile || null,
              source: 'lrclib',
            };

            if (directData.syncedLyrics || parsed.length > 0) {
              return {
                id: `lrclib-${directData.id}`,
                trackName: directData.trackName,
                artistName: directData.artistName,
                syncedLyrics: directData.syncedLyrics || null,
                plainLyrics: directData.plainLyrics || null,
                lyricsfile: directData.lyricsfile || null,
                hasWordSync: actuallyHasWords,
                parsedLines: parsed,
                source: 'lrclib',
                candidates: [directCandidate],
              };
            } else if (directData.plainLyrics) {
              directFallbackResult = {
                id: `lrclib-${directData.id}`,
                trackName: directData.trackName,
                artistName: directData.artistName,
                syncedLyrics: null,
                plainLyrics: directData.plainLyrics,
                lyricsfile: null,
                hasWordSync: false,
                parsedLines: [],
                source: 'lrclib',
                candidates: [directCandidate],
              };
            }
          }
        }
      } catch {
        // Doğrudan get başarısız olursa arama stratejileriyle devam et
      }
    }

    // 2. Çoklu arama stratejileri (/api/search)
    const strategies: Record<string, string>[] = [];
    if (expectedArtist && expectedTrack) {
      strategies.push({ track_name: expectedTrack, artist_name: expectedArtist });
      strategies.push({ q: `${expectedArtist} ${expectedTrack}` });
    }
    if (dashMatch && cleanedFullTitle) {
      strategies.push({ q: cleanedFullTitle });
    }
    if (cleanedFullTitle && cleanedFullTitle !== expectedTrack) {
      strategies.push({ q: cleanedFullTitle });
    }
    if (expectedTrack) {
      strategies.push({ q: expectedTrack });
    }
    if (title && title !== expectedTrack) {
      strategies.push({ q: title });
    }
    const norm = normalise(title);
    if (norm && norm !== title.toLowerCase()) {
      strategies.push({ q: norm });
    }

    const allCandidatesMap = new Map<number, { r: any; score: number }>();

    for (const params of strategies) {
      const searchUrl = buildLrclibSearchUrl(params);
      let res: Response;
      try {
        res = await fetch(searchUrl, {
          headers: LRCLIB_HEADERS,
        });
      } catch {
        continue;
      }

      // 503 Server Overloaded durumunda bir kez kısa bekleme ile tekrar dene
      if (res.status === 503) {
        await new Promise((resolve) => setTimeout(resolve, 350));
        try {
          res = await fetch(searchUrl, {
            headers: LRCLIB_HEADERS,
          });
        } catch {
          continue;
        }
      }

      if (!res.ok) continue;
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) continue;

      for (const r of data) {
        if (!allCandidatesMap.has(r.id)) {
          allCandidatesMap.set(r.id, { r, score: scoreResult(r, expectedArtist, expectedTrack) });
        }
      }

      const bestLocal = pickBest(data, expectedArtist, expectedTrack);
      if (bestLocal && (bestLocal.syncedLyrics || bestLocal.lyricsfile)) {
        const sortedCandidates: LyricsCandidate[] = Array.from(allCandidatesMap.values())
          .sort((a, b) => {
            const aWord =
              a.r.hasWordSync || (typeof a.r.lyricsfile === 'string' && a.r.lyricsfile.includes('words:'))
                ? 2
                : a.r.syncedLyrics
                ? 1
                : 0;
            const bWord =
              b.r.hasWordSync || (typeof b.r.lyricsfile === 'string' && b.r.lyricsfile.includes('words:'))
                ? 2
                : b.r.syncedLyrics
                ? 1
                : 0;
            if (aWord !== bWord) return bWord - aWord;
            return b.score - a.score;
          })
          .map(({ r }) => {
            const hasWord =
              !!r.hasWordSync || (typeof r.lyricsfile === 'string' && r.lyricsfile.includes('words:'));
            return {
              id: `lrclib-${r.id}`,
              trackName: r.trackName,
              artistName: r.artistName,
              albumName: r.albumName || '',
              duration: r.duration || 0,
              hasSynced: !!r.syncedLyrics || hasWord,
              hasWordSync: hasWord,
              syncedLyrics: r.syncedLyrics || null,
              plainLyrics: r.plainLyrics || null,
              lyricsfile: r.lyricsfile || null,
              source: 'lrclib' as const,
            };
          });

        const parsed = parseAnySyncedLyrics(bestLocal.lyricsfile, bestLocal.syncedLyrics);
        const actuallyHasWords =
          !!bestLocal.hasWordSync || parsed.some((l) => !!l.words && l.words.length > 0);

        return {
          id: `lrclib-${bestLocal.id}`,
          trackName: bestLocal.trackName,
          artistName: bestLocal.artistName,
          syncedLyrics: bestLocal.syncedLyrics || null,
          plainLyrics: bestLocal.plainLyrics || null,
          lyricsfile: bestLocal.lyricsfile || null,
          hasWordSync: actuallyHasWords,
          parsedLines: parsed,
          source: 'lrclib',
          candidates: sortedCandidates,
        };
      }
    }

    const allResults = Array.from(allCandidatesMap.values()).map((x) => x.r);
    const lrclibCandidates: LyricsCandidate[] = Array.from(allCandidatesMap.values())
      .sort((a, b) => {
        const aWord =
          a.r.hasWordSync || (typeof a.r.lyricsfile === 'string' && a.r.lyricsfile.includes('words:'))
            ? 2
            : a.r.syncedLyrics
            ? 1
            : 0;
        const bWord =
          b.r.hasWordSync || (typeof b.r.lyricsfile === 'string' && b.r.lyricsfile.includes('words:'))
            ? 2
            : b.r.syncedLyrics
            ? 1
            : 0;
        if (aWord !== bWord) return bWord - aWord;
        return b.score - a.score;
      })
      .map(({ r }) => {
        const hasWord =
          !!r.hasWordSync || (typeof r.lyricsfile === 'string' && r.lyricsfile.includes('words:'));
        return {
          id: `lrclib-${r.id}`,
          trackName: r.trackName,
          artistName: r.artistName,
          albumName: r.albumName || '',
          duration: r.duration || 0,
          hasSynced: !!r.syncedLyrics || hasWord,
          hasWordSync: hasWord,
          syncedLyrics: r.syncedLyrics || null,
          plainLyrics: r.plainLyrics || null,
          lyricsfile: r.lyricsfile || null,
          source: 'lrclib' as const,
        };
      });

    if (allResults.length === 0) {
      if (directFallbackResult) {
        return directFallbackResult;
      }
      return null;
    }

    const best = pickBest(allResults, expectedArtist, expectedTrack);
    if (best && (best.syncedLyrics || best.lyricsfile || best.plainLyrics)) {
      const parsed = parseAnySyncedLyrics(best.lyricsfile, best.syncedLyrics);
      const actuallyHasWords = !!best.hasWordSync || parsed.some((l) => !!l.words && l.words.length > 0);

      return {
        id: `lrclib-${best.id}`,
        trackName: best.trackName,
        artistName: best.artistName,
        syncedLyrics: best.syncedLyrics || null,
        plainLyrics: best.plainLyrics || null,
        lyricsfile: best.lyricsfile || null,
        hasWordSync: actuallyHasWords,
        parsedLines: parsed,
        source: 'lrclib',
        candidates: lrclibCandidates,
      };
    }

    if (directFallbackResult) {
      return directFallbackResult;
    }
    return null;
  } catch (e) {
    console.warn('LRCLIB fetch error:', e);
  }
  return null;
}

function removeElementAndChildren(rawHtml: string, prefix: string): string {
  let html = rawHtml;
  let idx = html.indexOf(prefix);
  while (idx !== -1) {
    let openDivs = 0;
    let endIdx = idx;
    let i = idx;
    while (i < html.length) {
      if (html.startsWith('<div', i)) {
        openDivs++;
        i += 4;
      } else if (html.startsWith('</div', i)) {
        openDivs--;
        if (openDivs === 0) {
          endIdx = i + 6;
          break;
        }
        i += 6;
      } else {
        i++;
      }
    }
    if (endIdx === idx) endIdx = idx + prefix.length;
    html = html.substring(0, idx) + html.substring(endIdx);
    idx = html.indexOf(prefix);
  }
  return html;
}

function extractGeniusLyrics(rawHtml: string): string {
  let html = removeElementAndChildren(rawHtml, '<div data-exclude-from-selection="true"');
  let lyrics = '';
  const prefix = '<div data-lyrics-container="true"';
  let idx = html.indexOf(prefix);

  while (idx !== -1) {
    let openDivs = 0;
    let endIdx = idx;
    let i = idx;
    while (i < html.length) {
      if (html.startsWith('<div', i)) {
        openDivs++;
        i += 4;
      } else if (html.startsWith('</div', i)) {
        openDivs--;
        if (openDivs === 0) {
          endIdx = i + 6;
          break;
        }
        i += 6;
      } else {
        i++;
      }
    }

    if (endIdx > idx) {
      let chunk = html.substring(idx, endIdx);
      chunk = chunk.replace(/<br\s*\/?>/gi, '\n');
      chunk = chunk.replace(/<[^>]+>/g, '');
      lyrics += chunk.trim() + '\n\n';
    }

    idx = html.indexOf(prefix, endIdx);
  }

  return lyrics
    .trim()
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x200B;/g, '');
}

export async function fetchGeniusLyricsByUrl(songUrl: string): Promise<string | null> {
  try {
    const htmlRes = await fetch(songUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    if (!htmlRes.ok) return null;
    const html = await htmlRes.text();
    return extractGeniusLyrics(html);
  } catch (e) {
    console.warn('Genius URL lyrics fetch error:', e);
    return null;
  }
}

export async function searchGenius(title: string, artist = ''): Promise<LyricsResult | null> {
  try {
    const { expectedArtist, expectedTrack, cleanedFullTitle } = getSearchKeywords(title, artist);
    const query = expectedArtist && expectedTrack ? `${expectedArtist} ${expectedTrack}` : cleanedFullTitle;
    if (!query.trim()) return null;

    const searchUrl = `https://genius.com/api/search/multi?per_page=5&q=${encodeURIComponent(query.trim())}`;
    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const sections = data?.response?.sections || [];
    const songSection = sections.find((s: any) => s.type === 'song');
    if (!songSection || !songSection.hits || songSection.hits.length === 0) return null;

    const geniusCandidates: LyricsCandidate[] = songSection.hits.map((h: any) => ({
      id: `genius-${h.result.id}`,
      trackName: h.result.title,
      artistName: h.result.primary_artist?.name || 'Genius',
      hasSynced: false,
      source: 'genius' as const,
      geniusUrl: h.result.url,
    }));

    const bestHit = songSection.hits[0].result;
    const songUrl = bestHit.url;
    if (!songUrl) return null;

    const plainLyrics = await fetchGeniusLyricsByUrl(songUrl);
    if (!plainLyrics || plainLyrics.length < 10) return null;

    return {
      id: `genius-${bestHit.id}`,
      trackName: bestHit.title,
      artistName: bestHit.primary_artist?.name || expectedArtist || 'Genius',
      syncedLyrics: null,
      plainLyrics,
      parsedLines: [],
      source: 'genius',
      candidates: geniusCandidates,
    };
  } catch (e) {
    console.warn('Genius fetch error:', e);
    return null;
  }
}

/**
 * 1. ÖNCELİK KESİNLİKLE LRCLIB:
 * Önce LRCLIB sorgulanır. LRCLIB'de herhangi bir şarkı sözü bulunursa (senkronize veya düz),
 * doğrudan LRCLIB döner.
 * 2. YALNIZCA LRCLIB'de hiçbir sonuç bulunamazsa Genius fallback olarak devreye girer.
 */
export async function fetchLyricsOnline(title: string, artist = ''): Promise<LyricsResult | null> {
  // 1. Mutlak öncelik LRCLIB
  const lrclibRes = await searchLrclib(title, artist);
  if (lrclibRes) {
    return lrclibRes;
  }

  // 2. Yalnızca LRCLIB tamamen boş dönerse Genius'a sor
  const geniusRes = await searchGenius(title, artist);
  if (geniusRes) {
    return geniusRes;
  }

  return null;
}

/**
 * Kullanıcı elle arama yaptığında veya alternatifleri görmek istediğinde
 * tüm adayları (LRCLIB senkronize/düz sonuçları en üstte, Genius sonuçları altta) toplar.
 */
export async function searchAllCandidates(query: string, artist = ''): Promise<LyricsCandidate[]> {
  const candidates: LyricsCandidate[] = [];
  const seenIds = new Set<string>();
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  // 1. Mutlak Öncelik: LRCLIB Sonuçları
  try {
    const { expectedArtist, expectedTrack, cleanedFullTitle } = getSearchKeywords(trimmedQuery, artist);
    const strategies: Record<string, string>[] = [
      { q: trimmedQuery },
    ];

    if (expectedArtist && expectedTrack) {
      strategies.push({ track_name: expectedTrack, artist_name: expectedArtist });
      strategies.push({ q: `${expectedArtist} ${expectedTrack}` });
    }
    if (cleanedFullTitle && cleanedFullTitle !== trimmedQuery) {
      strategies.push({ q: cleanedFullTitle });
    }
    if (expectedTrack && expectedTrack !== trimmedQuery) {
      strategies.push({ q: expectedTrack });
    }
    const cleanArtist = cleanYouTubeTitle(artist);
    if (cleanArtist && cleanArtist !== 'Local Audio' && cleanArtist !== 'Bilinmeyen Sanatçı') {
      strategies.push({ q: `${cleanArtist} ${trimmedQuery}` });
    }
    const norm = normalise(trimmedQuery);
    if (norm && norm !== trimmedQuery.toLowerCase()) {
      strategies.push({ q: norm });
    }

    for (const params of strategies) {
      const searchUrl = buildLrclibSearchUrl(params);
      let res: Response;
      try {
        res = await fetch(searchUrl, {
          headers: LRCLIB_HEADERS,
        });
      } catch {
        continue;
      }

      if (res.status === 503) {
        await new Promise((resolve) => setTimeout(resolve, 350));
        try {
          res = await fetch(searchUrl, {
            headers: LRCLIB_HEADERS,
          });
        } catch {
          continue;
        }
      }

      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data)) {
        for (const r of data) {
          const cid = `lrclib-${r.id}`;
          if (!seenIds.has(cid)) {
            seenIds.add(cid);
            const hasWord =
              !!r.hasWordSync || (typeof r.lyricsfile === 'string' && r.lyricsfile.includes('words:'));
            candidates.push({
              id: cid,
              trackName: r.trackName,
              artistName: r.artistName,
              albumName: r.albumName || '',
              duration: r.duration || 0,
              hasSynced: !!r.syncedLyrics || hasWord,
              hasWordSync: hasWord,
              syncedLyrics: r.syncedLyrics || null,
              plainLyrics: r.plainLyrics || null,
              lyricsfile: r.lyricsfile || null,
              source: 'lrclib',
            });
          }
        }
      }
      if (candidates.filter((c) => c.hasSynced).length >= 10) break;
    }
  } catch (e) {
    console.warn('LRCLIB candidate search error:', e);
  }

  // 2. Genius Adayları (Seçenek olarak listeye ekle)
  try {
    const searchUrl = `https://genius.com/api/search/multi?per_page=5&q=${encodeURIComponent(trimmedQuery)}`;
    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    if (res.ok) {
      const data = await res.json();
      const songSection = data?.response?.sections?.find((s: any) => s.type === 'song');
      if (songSection?.hits) {
        for (const h of songSection.hits) {
          const hit = h.result;
          const cid = `genius-${hit.id}`;
          if (!seenIds.has(cid)) {
            seenIds.add(cid);
            candidates.push({
              id: cid,
              trackName: hit.title,
              artistName: hit.primary_artist?.name || 'Genius',
              hasSynced: false,
              source: 'genius',
              geniusUrl: hit.url,
            });
          }
        }
      }
    }
  } catch (e) {
    console.warn('Genius candidate search error:', e);
  }

  // LRCLIB adaylarını kelime senkronizasyonlu ve senkronize olanlar üstte olacak şekilde sırala, Genius altta
  candidates.sort((a, b) => {
    const aWord = a.hasWordSync ? 3 : a.hasSynced ? 2 : 1;
    const bWord = b.hasWordSync ? 3 : b.hasSynced ? 2 : 1;
    if (aWord !== bWord) {
      return bWord - aWord;
    }
    if (a.source !== b.source) {
      return a.source === 'lrclib' ? -1 : 1;
    }
    return 0;
  });

  return candidates;
}

/**
 * Kullanıcı listeden bir adaya dokunduğunda o adayı tam LyricsResult nesnesine dönüştürür.
 */
export async function resolveCandidateToLyricsResult(
  candidate: LyricsCandidate,
  allCandidates?: LyricsCandidate[]
): Promise<LyricsResult | null> {
  if (candidate.source === 'lrclib') {
    let synced = candidate.syncedLyrics || null;
    let plain = candidate.plainLyrics || null;
    let lyricsfile = candidate.lyricsfile || null;
    let hasWordSync = !!candidate.hasWordSync;

    if (!synced && !plain && !lyricsfile) {
      const rawId = candidate.id.replace('lrclib-', '');
      try {
        const res = await fetch(`https://lrclib.net/api/get/${rawId}`, {
          headers: LRCLIB_HEADERS,
        });
        if (res.ok) {
          const d = await res.json();
          synced = d.syncedLyrics || null;
          plain = d.plainLyrics || null;
          lyricsfile = d.lyricsfile || null;
          hasWordSync =
            !!d.hasWordSync || (typeof d.lyricsfile === 'string' && d.lyricsfile.includes('words:'));
        }
      } catch {}
    }

    const parsedLines = parseAnySyncedLyrics(lyricsfile, synced);
    const actuallyHasWords = hasWordSync || parsedLines.some((l) => !!l.words && l.words.length > 0);

    return {
      id: candidate.id,
      trackName: candidate.trackName,
      artistName: candidate.artistName,
      syncedLyrics: synced,
      plainLyrics: plain,
      lyricsfile,
      hasWordSync: actuallyHasWords,
      parsedLines,
      source: 'lrclib',
      candidates: allCandidates,
    };
  }

  if (candidate.source === 'genius' && candidate.geniusUrl) {
    const plainLyrics = await fetchGeniusLyricsByUrl(candidate.geniusUrl);
    if (!plainLyrics || plainLyrics.length < 10) return null;
    return {
      id: candidate.id,
      trackName: candidate.trackName,
      artistName: candidate.artistName,
      syncedLyrics: null,
      plainLyrics,
      parsedLines: [],
      source: 'genius',
      candidates: allCandidates,
    };
  }

  return null;
}
