export interface LyricLine {
  time: number;
  text: string;
}

export interface LyricsResult {
  id?: string;
  trackName: string;
  artistName: string;
  syncedLyrics: string | null;
  plainLyrics: string | null;
  parsedLines: LyricLine[];
  source: 'lrclib' | 'genius' | 'custom';
}

/**
 * Parse an LRC string into an array of { time: number, text: string } objects.
 */
export function parseLRC(lrc: string): LyricLine[] {
  if (!lrc) return [];
  const lines = lrc.split('\n');
  const result: LyricLine[] = [];
  const timeRegex = /\[(\d{1,3}):(\d{2})\.(\d{2,3})\]/g;

  for (const line of lines) {
    const times: number[] = [];
    let match: RegExpExecArray | null;
    timeRegex.lastIndex = 0;

    while ((match = timeRegex.exec(line)) !== null) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const centiseconds = parseInt(match[3].padEnd(3, '0').slice(0, 3), 10);
      times.push(minutes * 60 + seconds + centiseconds / 1000);
    }

    const text = line.replace(/\[\d{1,3}:\d{2}\.\d{2,3}\]/g, '').trim();
    for (const t of times) {
      result.push({ time: t, text });
    }
  }

  return result.filter((l) => l.text.length > 0).sort((a, b) => a.time - b.time);
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

/**
 * Strip YouTube noise from a title segment (track name or full title).
 * Preserves the core song/artist name.
 * Ported directly from Runteryaa/YT-LyricPopup background.js.
 */
export function cleanYouTubeTitle(str: string): string {
  let s = str || '';

  // Remove file extension if present (for local audio files!)
  s = s.replace(/\.[^/.]+$/, '');

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
 * Extracts and cleans search keywords from a video / audio title.
 * Ported directly from Runteryaa/YT-LyricPopup background.js.
 */
export function getSearchKeywords(videoTitle: string, channelName = '') {
  // Strip extension and anything after a pipe character since it's usually just metadata
  const titleBeforePipe = (videoTitle || '').replace(/\.[^/.]+$/, '').split('|')[0].trim();

  // Parse "Artist - Title" (lazy on artist side to handle "A & B - Song")
  const dashMatch = titleBeforePipe.match(/^(.+?)\s*[-–—]\s*(.+)$/);

  // Clean both halves: strip "Official Music Video", "ft. x", "4K", etc.
  const rawArtist = dashMatch ? dashMatch[1].trim() : '';
  const rawTrack = dashMatch ? dashMatch[2].trim() : titleBeforePipe.trim();

  const expectedArtist = cleanYouTubeTitle(rawArtist);
  const expectedTrack = cleanYouTubeTitle(rawTrack);
  const cleanChannel = cleanYouTubeTitle(channelName);

  let cleanedFullTitle = expectedTrack;
  if (dashMatch && expectedArtist) {
    cleanedFullTitle = `${expectedArtist} - ${expectedTrack}`;
  } else if (dashMatch && !expectedArtist) {
    cleanedFullTitle = expectedTrack;
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
        const cleanFn = filename.replace(/\.[^/.]+$/, '');
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
  const artistSim = similarity(result.artistName, expectedArtist);
  const trackSim = similarity(result.trackName, expectedTrack);
  const score = artistSim * 0.65 + trackSim * 0.35;
  return score + (result.syncedLyrics ? 0.001 : 0);
}

function pickBest(results: any[], expectedArtist: string, expectedTrack: string): any | null {
  if (!expectedArtist && !expectedTrack) {
    return results.find((r) => r.syncedLyrics) || results[0] || null;
  }
  const scored = results
    .map((r) => ({ r, score: scoreResult(r, expectedArtist, expectedTrack) }))
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0 || scored[0].score < 0.1) return null;
  const threshold = scored[0].score - 0.15;
  const topTier = scored.filter((s) => s.score >= threshold).map((s) => s.r);
  return topTier.find((r) => r.syncedLyrics) || topTier[0] || null;
}

export async function searchLrclib(title: string, artist = ''): Promise<LyricsResult | null> {
  try {
    const { expectedArtist, expectedTrack, cleanedFullTitle, dashMatch } = getSearchKeywords(
      title,
      artist
    );

    const strategies: Record<string, string>[] = [];
    if (dashMatch && expectedArtist) {
      strategies.push({ track_name: expectedTrack, artist_name: expectedArtist });
      strategies.push({ q: cleanedFullTitle });
      if (cleanedFullTitle !== title) {
        strategies.push({ q: title });
      }
    } else {
      strategies.push({ q: cleanedFullTitle });
      if (cleanedFullTitle !== title) {
        strategies.push({ q: title });
      }
    }

    const allCandidatesMap = new Map<number, { r: any; score: number }>();

    for (const params of strategies) {
      const url = new URL('https://lrclib.net/api/search');
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
      const res = await fetch(url.toString(), {
        headers: { 'Lrclib-Client': 'RunMusic Mobile App v1.0.0' },
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) continue;

      for (const r of data) {
        if (!allCandidatesMap.has(r.id)) {
          allCandidatesMap.set(r.id, { r, score: scoreResult(r, expectedArtist, expectedTrack) });
        }
      }

      const bestLocal = pickBest(data, expectedArtist, expectedTrack);
      if (bestLocal && bestLocal.syncedLyrics) {
        return {
          id: `lrclib-${bestLocal.id}`,
          trackName: bestLocal.trackName,
          artistName: bestLocal.artistName,
          syncedLyrics: bestLocal.syncedLyrics,
          plainLyrics: bestLocal.plainLyrics || null,
          parsedLines: parseLRC(bestLocal.syncedLyrics),
          source: 'lrclib',
        };
      }
    }

    const allResults = Array.from(allCandidatesMap.values()).map((x) => x.r);
    if (allResults.length === 0) return null;

    const best = pickBest(allResults, expectedArtist, expectedTrack);
    if (best && (best.syncedLyrics || best.plainLyrics)) {
      return {
        id: `lrclib-${best.id}`,
        trackName: best.trackName,
        artistName: best.artistName,
        syncedLyrics: best.syncedLyrics || null,
        plainLyrics: best.plainLyrics || null,
        parsedLines: best.syncedLyrics ? parseLRC(best.syncedLyrics) : [],
        source: 'lrclib',
      };
    }
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

export async function searchGenius(title: string, artist = ''): Promise<LyricsResult | null> {
  try {
    const { expectedArtist, expectedTrack, cleanedFullTitle } = getSearchKeywords(title, artist);
    const query = expectedArtist && expectedTrack ? `${expectedArtist} ${expectedTrack}` : cleanedFullTitle;
    if (!query.trim()) return null;

    const searchUrl = `https://genius.com/api/search/multi?per_page=1&q=${encodeURIComponent(query.trim())}`;
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

    const bestHit = songSection.hits[0].result;
    const songUrl = bestHit.url;
    if (!songUrl) return null;

    const htmlRes = await fetch(songUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    if (!htmlRes.ok) return null;
    const html = await htmlRes.text();
    const plainLyrics = extractGeniusLyrics(html);
    if (!plainLyrics || plainLyrics.length < 10) return null;

    return {
      id: `genius-${bestHit.id}`,
      trackName: bestHit.title,
      artistName: bestHit.primary_artist?.name || expectedArtist || 'Genius',
      syncedLyrics: null,
      plainLyrics,
      parsedLines: [],
      source: 'genius',
    };
  } catch (e) {
    console.warn('Genius fetch error:', e);
    return null;
  }
}

export async function fetchLyricsOnline(title: string, artist = ''): Promise<LyricsResult | null> {
  // 1. Try LRCLIB first
  const lrclibRes = await searchLrclib(title, artist);
  if (lrclibRes) return lrclibRes;

  // 2. Fallback to Genius
  const geniusRes = await searchGenius(title, artist);
  if (geniusRes) return geniusRes;

  return null;
}
