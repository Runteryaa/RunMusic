export interface LyricLine {
  time: number;
  text: string;
}

export interface LyricsCandidate {
  id: string;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  hasSynced: boolean;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  source: 'lrclib' | 'genius';
  geniusUrl?: string;
}

export interface LyricsResult {
  id?: string;
  trackName: string;
  artistName: string;
  syncedLyrics: string | null;
  plainLyrics: string | null;
  parsedLines: LyricLine[];
  source: 'lrclib' | 'genius' | 'custom';
  candidates?: LyricsCandidate[];
}

/**
 * Parse an LRC string into an array of { time: number, text: string } objects.
 * Supports mm:ss.xx, mm:ss.xxx, mm:ss:xx, mm:ss, etc.
 */
export function parseLRC(lrc: string): LyricLine[] {
  if (!lrc) return [];
  const lines = lrc.split('\n');
  const result: LyricLine[] = [];
  const timeRegex = /\[(\d{1,3}):(\d{2})(?:[\.:](\d{1,3}))?\]/g;

  for (const line of lines) {
    const times: number[] = [];
    let match: RegExpExecArray | null;
    timeRegex.lastIndex = 0;

    while ((match = timeRegex.exec(line)) !== null) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const centiseconds = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0;
      times.push(minutes * 60 + seconds + centiseconds / 1000);
    }

    const text = line.replace(/\[\d{1,3}:\d{2}(?:[\.:]\d{1,3})?\]/g, '').trim();
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

  const expectedArtist = cleanYouTubeTitle(rawArtist || channelName);
  const expectedTrack = cleanYouTubeTitle(rawTrack);
  const cleanChannel = cleanYouTubeTitle(channelName);

  let cleanedFullTitle = expectedTrack;
  if (dashMatch && expectedArtist) {
    cleanedFullTitle = `${expectedArtist} - ${expectedTrack}`;
  } else if (expectedArtist && expectedTrack) {
    cleanedFullTitle = `${expectedArtist} - ${expectedTrack}`;
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

const LRCLIB_CLIENT_HEADER = 'LyricPopup Chrome Extension v1.0.0';

export async function searchLrclib(title: string, artist = ''): Promise<LyricsResult | null> {
  try {
    const { expectedArtist, expectedTrack, cleanedFullTitle, dashMatch } = getSearchKeywords(
      title,
      artist
    );

    let directFallbackResult: LyricsResult | null = null;

    // 1. Doğrudan exact /api/get endpoint'ini dene (En hızlı, 503 yükünden etkilenmez)
    if (expectedArtist && expectedTrack) {
      try {
        const getUrl = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(
          expectedArtist
        )}&track_name=${encodeURIComponent(expectedTrack)}`;
        const getRes = await fetch(getUrl, {
          headers: { 'Lrclib-Client': LRCLIB_CLIENT_HEADER },
        });
        if (getRes.ok) {
          const directData = await getRes.json();
          if (directData) {
            if (directData.syncedLyrics) {
              return {
                id: `lrclib-${directData.id}`,
                trackName: directData.trackName,
                artistName: directData.artistName,
                syncedLyrics: directData.syncedLyrics,
                plainLyrics: directData.plainLyrics || null,
                parsedLines: parseLRC(directData.syncedLyrics),
                source: 'lrclib',
              };
            } else if (directData.plainLyrics) {
              directFallbackResult = {
                id: `lrclib-${directData.id}`,
                trackName: directData.trackName,
                artistName: directData.artistName,
                syncedLyrics: null,
                plainLyrics: directData.plainLyrics,
                parsedLines: [],
                source: 'lrclib',
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
      strategies.push({ q: `${expectedArtist} - ${expectedTrack}` });
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

    const allCandidatesMap = new Map<number, { r: any; score: number }>();

    for (const params of strategies) {
      const url = new URL('https://lrclib.net/api/search');
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
      let res = await fetch(url.toString(), {
        headers: { 'Lrclib-Client': LRCLIB_CLIENT_HEADER },
      });

      // 503 Server Overloaded durumunda bir kez kısa bekleme ile tekrar dene
      if (res.status === 503) {
        await new Promise((resolve) => setTimeout(resolve, 350));
        res = await fetch(url.toString(), {
          headers: { 'Lrclib-Client': LRCLIB_CLIENT_HEADER },
        });
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
    const lrclibCandidates: LyricsCandidate[] = Array.from(allCandidatesMap.values())
      .sort((a, b) => {
        const aSynced = a.r.syncedLyrics ? 1 : 0;
        const bSynced = b.r.syncedLyrics ? 1 : 0;
        if (aSynced !== bSynced) return bSynced - aSynced;
        return b.score - a.score;
      })
      .map(({ r }) => ({
        id: `lrclib-${r.id}`,
        trackName: r.trackName,
        artistName: r.artistName,
        albumName: r.albumName || '',
        duration: r.duration || 0,
        hasSynced: !!r.syncedLyrics,
        syncedLyrics: r.syncedLyrics || null,
        plainLyrics: r.plainLyrics || null,
        source: 'lrclib' as const,
      }));

    if (allResults.length === 0) {
      if (directFallbackResult) {
        return {
          ...directFallbackResult,
          candidates: lrclibCandidates,
        };
      }
      return null;
    }

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
        candidates: lrclibCandidates,
      };
    }

    if (directFallbackResult) {
      return {
        ...directFallbackResult,
        candidates: lrclibCandidates,
      };
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

  // 1. Öncelik: LRCLIB Sonuçları
  try {
    const { expectedArtist, expectedTrack, cleanedFullTitle } = getSearchKeywords(query, artist);
    const strategies: Record<string, string>[] = [
      { q: query },
      ...(expectedArtist && expectedTrack ? [{ track_name: expectedTrack, artist_name: expectedArtist }] : []),
      ...(cleanedFullTitle && cleanedFullTitle !== query ? [{ q: cleanedFullTitle }] : []),
    ];

    for (const params of strategies) {
      const url = new URL('https://lrclib.net/api/search');
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
      const res = await fetch(url.toString(), {
        headers: { 'Lrclib-Client': LRCLIB_CLIENT_HEADER },
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data)) {
        for (const r of data) {
          const cid = `lrclib-${r.id}`;
          if (!seenIds.has(cid)) {
            seenIds.add(cid);
            candidates.push({
              id: cid,
              trackName: r.trackName,
              artistName: r.artistName,
              albumName: r.albumName || '',
              duration: r.duration || 0,
              hasSynced: !!r.syncedLyrics,
              syncedLyrics: r.syncedLyrics || null,
              plainLyrics: r.plainLyrics || null,
              source: 'lrclib',
            });
          }
        }
      }
      if (candidates.filter((c) => c.hasSynced).length >= 8) break;
    }
  } catch (e) {
    console.warn('LRCLIB candidate search error:', e);
  }

  // LRCLIB adaylarını senkronize olanlar üstte olacak şekilde sırala
  candidates.sort((a, b) => (b.hasSynced ? 1 : 0) - (a.hasSynced ? 1 : 0));

  // 2. Genius Adayları (Seçenek olarak listeye ekle)
  try {
    const searchUrl = `https://genius.com/api/search/multi?per_page=5&q=${encodeURIComponent(query.trim())}`;
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

    if (!synced && !plain) {
      const rawId = candidate.id.replace('lrclib-', '');
      try {
        const res = await fetch(`https://lrclib.net/api/get/${rawId}`, {
          headers: { 'Lrclib-Client': LRCLIB_CLIENT_HEADER },
        });
        if (res.ok) {
          const d = await res.json();
          synced = d.syncedLyrics || null;
          plain = d.plainLyrics || null;
        }
      } catch {}
    }

    return {
      id: candidate.id,
      trackName: candidate.trackName,
      artistName: candidate.artistName,
      syncedLyrics: synced,
      plainLyrics: plain,
      parsedLines: synced ? parseLRC(synced) : [],
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
