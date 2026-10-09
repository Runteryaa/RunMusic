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
 * Common noise patterns in audio/video titles to strip before searching.
 */
const NOISE_PATTERNS = [
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
  /\b(4k|8k|hd|hq|full\s*hd|1080p|720p|explicit)\b/gi,
  /prod\.?\s*(by\s*)?[^,\-\[\]()\n]+/gi,
  /[\(\[]\s*feat\.?.*?[\)\]]/gi,
  /[\(\[]\s*ft\.?.*?[\)\]]/gi,
  /,?\s*feat(uring)?\.?\s+[^,\-\[\]()\n]+/gi,
  /,?\s*ft\.?\s+[^,\-\[\]()\n]+/gi,
  /\([^)]*\)/g,
  /\[[^\]]*\]/g,
];

export function cleanTrackTitle(str: string): string {
  let s = (str || '').replace(/\.[^/.]+$/, '').replace(/"/g, '');
  for (const pat of NOISE_PATTERNS) {
    s = s.replace(pat, ' ');
  }
  return s.replace(/\s+/g, ' ').replace(/[\s,\-–—|]+$/, '').trim();
}

export function parseArtistAndTitle(rawTitle: string, defaultArtist = ''): { artist: string; title: string } {
  const clean = rawTitle.replace(/\.[^/.]+$/, '').trim();
  const titleBeforePipe = clean.split('|')[0].trim();
  const dashMatch = titleBeforePipe.match(/^(.+?)\s*[-–—]\s*(.+)$/);

  if (dashMatch) {
    const artist = cleanTrackTitle(dashMatch[1]);
    const title = cleanTrackTitle(dashMatch[2]);
    return {
      artist: artist || cleanTrackTitle(defaultArtist),
      title: title || cleanTrackTitle(titleBeforePipe),
    };
  }

  return {
    artist: cleanTrackTitle(defaultArtist),
    title: cleanTrackTitle(titleBeforePipe),
  };
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
    const clean = parseArtistAndTitle(title, artist);
    const expectedArtist = clean.artist;
    const expectedTrack = clean.title;
    const fullQuery = expectedArtist ? `${expectedArtist} - ${expectedTrack}` : expectedTrack;

    const strategies: Record<string, string>[] = [];
    if (expectedArtist && expectedTrack) {
      strategies.push({ track_name: expectedTrack, artist_name: expectedArtist });
      strategies.push({ q: fullQuery });
    } else {
      strategies.push({ q: expectedTrack });
    }

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

      const best = pickBest(data, expectedArtist, expectedTrack);
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
    const clean = parseArtistAndTitle(title, artist);
    const query = `${clean.artist} ${clean.title}`.trim();
    if (!query) return null;

    const searchUrl = `https://genius.com/api/search/multi?per_page=1&q=${encodeURIComponent(query)}`;
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
      artistName: bestHit.primary_artist?.name || clean.artist,
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
