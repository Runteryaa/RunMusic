/**
 * Şarkı ve albüm kapağı arama servisi.
 *
 * Üç kaynak birlikte taranır:
 * - lrc.red: söz arşivinin arama sonuçları her kayıt için **gerçek albüm
 *   kapağını** (`cover`, ISRC anahtarlı) döndürür. Türkçe/yerel parçalarda en
 *   isabetli kaynaktır; önce denenir.
 * - iTunes Search API: ücretsiz, API anahtarı gerektirmez, yüksek çözünürlüklü
 *   kapaklar sunar ama özellikle yerel/az bilinen parçalarda sık sık boş döner.
 * - Genius: anahtarsız arama; şarkı kaydında kapağı `song_art_image_url`
 *   alanında verir. Cloudflare koruması yüzünden birçok ağdan 403 dönebilir,
 *   bu yüzden yalnızca ek kaynak olarak denenir; hata sessizce yutulur.
 *
 * Deezer bilinçli olarak kullanılmıyor: Türkiye'de hizmet vermediği için
 * cihazdan API'sine ve görsel CDN'ine erişilemiyor, istekler boşa gidiyordu.
 *
 * Sonuçlar aranan sanatçı/parça adına benzerliğe göre sıralanır; böylece aynı
 * adı taşıyan alakasız şarkıların kapağı listenin başına geçmez.
 *
 * NEDEN ZAMAN AŞIMI: isteklerin hiçbirinde süre sınırı yoktu. Genius Cloudflare
 * yüzünden askıda kalınca `Promise.all` hiç dönmüyor, "Kapak Bul" düğmesi
 * sonsuza kadar yükleniyor gibi görünüyordu. Artık her istek ayrı zaman aşımına
 * sahip ve kaynaklar `allSettled` ile birleştirilir: biri takılsa bile diğerleri
 * sonuç döndürür.
 */

import { getSearchKeywords } from './lyricsService';
import { searchLrcRed } from './lrcRed';
import { isNetworkAvailable } from './networkAwareFetch';

export interface OnlineArtworkResult {
  id: string;
  trackName: string;
  artistName: string;
  albumName?: string;
  artworkUrl: string;
  thumbnailUrl: string;
  /** Sonucun hangi kaynaktan geldiği (sıralama ve hata ayıklama için). */
  source: 'lrc.red' | 'itunes' | 'genius';
}

/** Tek bir kapak isteğinin üst sınırı (ms). */
const REQUEST_TIMEOUT_MS = 7000;

/**
 * Zaman aşımlı `fetch`.
 *
 * Kapak aramasında askıda kalan tek bir istek tüm sonucu geciktirmemeli;
 * süre aşılınca istek iptal edilir ve kaynak sonuçsuz sayılır.
 */
async function fetchWithTimeout(url: string, headers: Record<string, string>): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
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
 * Denenecek arama sorguları, en isabetli olandan başlayarak.
 *
 * Tek sorgu ("parça + sanatçı") katalogda eşleşme bulamayınca özellik olarak
 * "hiç sonuç yok" görünüyordu. Sırayla daha gevşek sorgular denenir: önce
 * parça + sanatçı, sonra yalnızca parça, en sonda yalnızca sanatçı. Böylece
 * etiketlenmiş sanatçı adı katalogdakiyle birebir tutmasa da kapak bulunur.
 */
export function buildArtworkQueries(title: string, artist: string): string[] {
  const cleanTitle = title.replace(/\.[a-zA-Z0-9]+$/, '').trim();
  const cleanArtist = (artist || '').trim();

  const queries = [
    buildQuery(cleanTitle, cleanArtist),
    cleanTitle,
    cleanArtist,
  ];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const query of queries) {
    const value = query.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/**
 * iTunes Search API üzerinden kapak arar.
 *
 * Sorgu sırayla daraltılır (parça + sanatçı → parça → sanatçı): ilk sorgu boş
 * dönerse özellik "kapak yok" gibi görünmesin.
 */
async function fetchItunesQuery(query: string): Promise<OnlineArtworkResult[]> {
  if (!query) return [];
  if (!isNetworkAvailable()) return [];

  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
    query
  )}&entity=song&limit=12`;

  const res = await fetchWithTimeout(url, {
    'User-Agent': 'RunMusic/1.0',
    Accept: 'application/json',
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

async function searchItunesArtwork(
  title: string,
  artist = ''
): Promise<OnlineArtworkResult[]> {
  const collected: OnlineArtworkResult[] = [];
  const seen = new Set<string>();

  // Yalnızca ilk iki sorgu (parça+sanatçı, parça) denenir; sanatçı-only sorgu
  // iTunes'ta alakasız sonuç yığını getirdiği için burada kullanılmaz.
  for (const query of buildArtworkQueries(title, artist).slice(0, 2)) {
    let batch: OnlineArtworkResult[] = [];
    try {
      batch = await fetchItunesQuery(query);
    } catch {
      batch = [];
    }
    for (const item of batch) {
      if (seen.has(item.artworkUrl)) continue;
      seen.add(item.artworkUrl);
      collected.push(item);
    }
    // Yeterli sonuç varsa daha gevşek sorguya gerek yok.
    if (collected.length >= 8) break;
  }

  return collected;
}

/**
 * lrc.red aramasından kapak üretir.
 *
 * lrc.red her arama isabeti için kaydın kendi albüm kapağını (`cover`, ISRC
 * anahtarlı `.webp`) döndürür. Kapak `ISRC`ye bağlı olduğu için başka bir
 * sürümün (live/remix) kapağına karışma riski yoktur; bu yüzden ilk kaynak.
 */
async function searchLrcRedArtwork(
  title: string,
  artist = ''
): Promise<OnlineArtworkResult[]> {
  if (!isNetworkAvailable()) return [];

  const hits = await searchLrcRed(title, artist);
  const seen = new Set<string>();
  const results: OnlineArtworkResult[] = [];

  for (const hit of hits) {
    const cover = typeof hit.cover === 'string' ? hit.cover.trim() : '';
    if (!cover) continue;
    if (seen.has(cover)) continue;
    seen.add(cover);

    results.push({
      id: `lrc-${hit.isrc}`,
      trackName: hit.title || '',
      artistName: hit.artist || '',
      albumName: hit.album || undefined,
      artworkUrl: cover,
      thumbnailUrl: cover,
      source: 'lrc.red',
    });

    if (results.length >= 8) break;
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
  // Çevrimdışıyken Genius'a istek atmak yerine boş sonuç dön; kapak arama
  // ekranı "sonuç yok" durumunu zaten gösteriyor.
  if (!isNetworkAvailable()) return [];

  const url = `https://genius.com/api/search/multi?per_page=10&q=${encodeURIComponent(
    query
  )}`;

  const res = await fetchWithTimeout(url, {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'application/json',
    'Accept-Language': 'tr,en;q=0.8',
  });

  if (!res.ok) return [];

  const data = await res.json();
  const sections = data?.response?.sections;
  if (!Array.isArray(sections)) return [];

  const songSection = sections.find((section: any) => section?.type === 'song');
  const albumSection = sections.find((section: any) => section?.type === 'album');
  const songHits = Array.isArray(songSection?.hits) ? songSection.hits : [];
  const albumHits = Array.isArray(albumSection?.hits) ? albumSection.hits : [];

  const seenUrls = new Set<string>();
  const results: OnlineArtworkResult[] = [];

  const push = (entry: OnlineArtworkResult | null) => {
    if (!entry) return;
    if (seenUrls.has(entry.artworkUrl)) return;
    seenUrls.add(entry.artworkUrl);
    results.push(entry);
  };

  for (const hit of songHits) {
    const song = hit?.result;
    if (!song) continue;

    const artworkUrl: string | undefined =
      song.song_art_image_url ||
      song.header_image_url ||
      song.song_art_image_thumbnail_url;
    if (!artworkUrl) continue;

    // `full_title` "Parça by Sanatçı" biçimindedir; eşleştirme puanını
    // bozmaması için yalnızca parça adı kullanılır.
    const fullTitle = typeof song.full_title === 'string' ? song.full_title : '';
    const trackName = song.title || fullTitle.split(' by ')[0] || '';

    push({
      id: `genius-${song.id ?? artworkUrl}`,
      trackName,
      artistName: song.primary_artist?.name || '',
      albumName: song.album?.name || undefined,
      artworkUrl,
      thumbnailUrl: song.song_art_image_thumbnail_url || artworkUrl,
      source: 'genius',
    });
  }

  /*
   * Albüm sonuçları da taranır: şarkı kaydının kapağı yoksa (ya da düşük
   * çözünürlüklüyse) albüm kapağı `cover_art_url` alanından alınır. Bu kayıtlar
   * parça adıyla değil albüm adıyla eşleştiği için sıralamada doğal olarak
   * aşağıda kalır; yine de seçenek olarak sunulur.
   */
  for (const hit of albumHits) {
    const album = hit?.result;
    if (!album) continue;

    const artworkUrl: string | undefined = album.cover_art_url;
    if (!artworkUrl) continue;

    push({
      id: `genius-album-${album.id ?? artworkUrl}`,
      trackName: album.name || '',
      artistName: album.artist?.name || album.primary_artist?.name || '',
      albumName: album.name || undefined,
      artworkUrl,
      thumbnailUrl: album.cover_art_thumbnail_url || artworkUrl,
      source: 'genius',
    });
  }

  return results;
}

/**
 * Sonuçları aranan parçaya uygunluğa göre sıralar.
 *
 * Alakasız kapaklar (ör. "UZI MODD" aramasında çıkan bir country parçası)
 * gösterilmez: puanı eşiğin altında kalan sonuçlar elenir. Hiçbir sonuç eşiği
 * geçemiyorsa (katalog adı çok farklı olabilir) en iyi sonuçlar yine gösterilir;
 * aksi halde özellik "kapak bulamadı" gibi görünürdü.
 */
export const MIN_ARTWORK_SCORE = 0.2;
export const MAX_ARTWORK_RESULTS = 12;

/**
 * Kaynak başına küçük puan avantajı.
 *
 * lrc.red kapağı ISRC'ye bağlı gerçek kayıt kapağıdır; eşit benzerlikte
 * iTunes/Genius sonucunun (ör. cover sürümü) önüne geçmesi gerekir.
 */
const SOURCE_SCORE_BONUS: Record<OnlineArtworkResult['source'], number> = {
  'lrc.red': 0.05,
  itunes: 0,
  genius: 0,
};

export function rankArtworkResults(
  results: OnlineArtworkResult[],
  expectedArtist: string,
  expectedTrack: string,
  limit: number = MAX_ARTWORK_RESULTS
): OnlineArtworkResult[] {
  const seen = new Set<string>();
  const scored: { item: OnlineArtworkResult; index: number; score: number }[] = [];

  results.forEach((item, index) => {
    if (!item.artworkUrl || seen.has(item.artworkUrl)) return;
    seen.add(item.artworkUrl);
    scored.push({
      item,
      index,
      score: Math.min(
        1,
        scoreArtworkResult(item, expectedArtist, expectedTrack) +
          (SOURCE_SCORE_BONUS[item.source] ?? 0)
      ),
    });
  });

  // Skor eşitse kaynak sırası korunur (lrc.red → iTunes → Genius).
  scored.sort((a, b) => b.score - a.score || a.index - b.index);

  const relevant = scored.filter((entry) => entry.score >= MIN_ARTWORK_SCORE);
  const chosen = relevant.length > 0 ? relevant : scored;
  return chosen.slice(0, Math.max(1, limit)).map((entry) => entry.item);
}

/**
 * Başlık ve sanatçıya göre internetten albüm kapaklarını arar.
 *
 * Üç kaynak paralel taranır, sonuçlar tekrarsız birleştirilir ve aranan
 * sanatçı/parçaya uyum puanına göre sıralanır. `allSettled` kullanılır: bir
 * kaynak hata verirse veya zaman aşımına uğrarsa diğerleri sonucu doldurur.
 */
export async function searchOnlineArtwork(
  title: string,
  artist = ''
): Promise<OnlineArtworkResult[]> {
  try {
    const settled = await Promise.allSettled([
      searchLrcRedArtwork(title, artist),
      searchItunesArtwork(title, artist),
      searchGeniusArtwork(title, artist),
    ]);

    const merged = settled.flatMap((entry) =>
      entry.status === 'fulfilled' ? entry.value : []
    );
    if (merged.length === 0) return [];

    const { expectedArtist, expectedTrack } = getSearchKeywords(title, artist);
    return rankArtworkResults(merged, expectedArtist, expectedTrack);
  } catch (error) {
    console.warn('[artworkSearchService] error searching artwork:', error);
    return [];
  }
}
