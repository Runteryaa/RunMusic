/**
 * Şarkı ve albüm kapağı arama servisi.
 *
 * İki kaynak birlikte taranır:
 * - iTunes Search API: ücretsiz, API anahtarı gerektirmez, yüksek çözünürlüklü
 *   kapaklar sunar ama bazı (özellikle yerel/az bilinen) parçalarda boş döner.
 * - Genius: şarkıların neredeyse tamamında kapak bulunur. Arama uç noktası
 *   `song_art_image_url` alanını doğrudan döndürür, sayfa kazımaya gerek yoktur.
 *
 * Sonuçlar aranan sanatçı/parça adına benzerliğe göre sıralanır; böylece aynı
 * adı taşıyan alakasız şarkıların kapağı listenin başına geçmez.
 */

import { getSearchKeywords } from './lyricsService';

export interface OnlineArtworkResult {
  id: string;
  trackName: string;
  artistName: string;
  albumName?: string;
  artworkUrl: string;
  thumbnailUrl: string;
  /** Sonucun hangi kaynaktan geldiği (sıralama ve hata ayıklama için). */
  source: 'itunes' | 'genius';
}

function normalizeForMatch(value?: string | null): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** İki metnin kelime kümesi örtüşmesi (0..1). */
function wordSimilarity(a?: string | null, b?: string | null): number {
  const setA = new Set(normalizeForMatch(a).split(' ').filter(Boolean));
  const setB = new Set(normalizeForMatch(b).split(' ').filter(Boolean));
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  setA.forEach((word) => {
    if (setB.has(word)) intersection++;
  });
  return intersection / Math.max(setA.size, setB.size);
}

/**
 * Bir kapak sonucunun aranan parçayla uyum puanı (0..1).
 * Söz eşleştirmesiyle aynı ağırlıklar: sanatçı %65, parça adı %35.
 */
function scoreArtworkResult(
  result: Pick<OnlineArtworkResult, 'trackName' | 'artistName'>,
  expectedArtist: string,
  expectedTrack: string
): number {
  const trackSim = expectedTrack ? wordSimilarity(result.trackName, expectedTrack) : 0.8;
  if (!expectedArtist) return trackSim;
  const artistSim = wordSimilarity(result.artistName, expectedArtist);
  return artistSim * 0.65 + trackSim * 0.35;
}

function buildQuery(title: string, artist: string): string {
  const cleanTitle = title.replace(/\.[a-zA-Z0-9]+$/, '').trim();
  return [cleanTitle, artist].filter(Boolean).join(' ').trim();
}

/**
 * iTunes Search API üzerinden kapak arar.
 */
async function searchItunesArtwork(
  title: string,
  artist = ''
): Promise<OnlineArtworkResult[]> {
  const query = buildQuery(title, artist);
  if (!query) return [];

  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
    query
  )}&entity=song&limit=12`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'RunMusic/1.0',
    },
  });

  if (!res.ok) return [];

  const data = await res.json();
  if (!data || !Array.isArray(data.results)) return [];

  const seenUrls = new Set<string>();
  const results: OnlineArtworkResult[] = [];

  for (const item of data.results) {
    const art100 = item.artworkUrl100 as string | undefined;
    if (!art100) continue;

    // 100x100 yerine 600x600 veya 1000x1000 yüksek çözünürlüklü URL üret
    const highRes = art100.replace('100x100bb', '600x600bb');
    const thumb = art100.replace('100x100bb', '200x200bb');

    if (seenUrls.has(highRes)) continue;
    seenUrls.add(highRes);

    results.push({
      id: String(item.trackId || item.collectionId || Math.random()),
      trackName: item.trackName || '',
      artistName: item.artistName || '',
      albumName: item.collectionName || undefined,
      artworkUrl: highRes,
      thumbnailUrl: thumb,
      source: 'itunes',
    });
  }

  return results;
}

/**
 * Genius araması üzerinden kapak arar.
 *
 * Genius, şarkıların kapaklarını `song_art_image_url` alanında verir; bu yüzden
 * şarkı sayfasını indirmeye gerek yoktur.
 */
async function searchGeniusArtwork(
  title: string,
  artist = ''
): Promise<OnlineArtworkResult[]> {
  const query = buildQuery(title, artist);
  if (!query) return [];

  const url = `https://genius.com/api/search/multi?per_page=10&q=${encodeURIComponent(
    query
  )}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });

  if (!res.ok) return [];

  const data = await res.json();
  const sections = data?.response?.sections;
  if (!Array.isArray(sections)) return [];

  const songSection = sections.find((section: any) => section?.type === 'song');
  const hits = Array.isArray(songSection?.hits) ? songSection.hits : [];

  const seenUrls = new Set<string>();
  const results: OnlineArtworkResult[] = [];

  for (const hit of hits) {
    const song = hit?.result;
    if (!song) continue;

    const artworkUrl: string | undefined =
      song.song_art_image_url ||
      song.header_image_url ||
      song.song_art_image_thumbnail_url;
    if (!artworkUrl) continue;
    if (seenUrls.has(artworkUrl)) continue;
    seenUrls.add(artworkUrl);

    // `full_title` "Parça by Sanatçı" biçimindedir; eşleştirme puanını
    // bozmaması için yalnızca parça adı kullanılır.
    const fullTitle = typeof song.full_title === 'string' ? song.full_title : '';
    const trackName = song.title || fullTitle.split(' by ')[0] || '';

    results.push({
      id: `genius-${song.id ?? artworkUrl}`,
      trackName,
      artistName: song.primary_artist?.name || '',
      albumName: song.album?.name || undefined,
      artworkUrl,
      thumbnailUrl: song.song_art_image_thumbnail_url || artworkUrl,
      source: 'genius',
    });
  }

  return results;
}

/**
 * Başlık ve sanatçıya göre internetten albüm kapaklarını arar.
 *
 * iTunes ve Genius paralel taranır, sonuçlar tekrarsız birleştirilir ve
 * aranan sanatçı/parçaya uyum puanına göre sıralanır.
 */
export async function searchOnlineArtwork(
  title: string,
  artist = ''
): Promise<OnlineArtworkResult[]> {
  try {
    const [itunesResults, geniusResults] = await Promise.all([
      searchItunesArtwork(title, artist).catch(() => [] as OnlineArtworkResult[]),
      searchGeniusArtwork(title, artist).catch(() => [] as OnlineArtworkResult[]),
    ]);

    const merged: OnlineArtworkResult[] = [];
    const seenUrls = new Set<string>();
    for (const item of [...itunesResults, ...geniusResults]) {
      if (!item.artworkUrl || seenUrls.has(item.artworkUrl)) continue;
      seenUrls.add(item.artworkUrl);
      merged.push(item);
    }

    if (merged.length === 0) return [];

    const { expectedArtist, expectedTrack } = getSearchKeywords(title, artist);
    // Skor eşitse kaynak sırası korunur (iTunes önce).
    const scored = merged.map((item, index) => ({
      item,
      index,
      score: scoreArtworkResult(item, expectedArtist, expectedTrack),
    }));
    scored.sort((a, b) => b.score - a.score || a.index - b.index);

    return scored.map((entry) => entry.item);
  } catch (error) {
    console.warn('[artworkSearchService] error searching artwork:', error);
    return [];
  }
}
