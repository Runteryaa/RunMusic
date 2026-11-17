/**
 * Sanatçı profil fotoğrafı arama servisi — **Genius** kaynaklı.
 *
 * Wrapped, istatistik ve sanatçı sayfalarında albüm kapağı yerine sanatçının
 * kendi fotoğrafı gösterilsin diye kullanılır. API anahtarı gerekmez: Genius'ın
 * siteyi besleyen herkese açık arama uç noktaları kullanılıyor. Aynı kaynak
 * şarkı sözlerini de sağladığı için kimin hangi şarkıyı yayınladığı bilgisi
 * zaten elimizde.
 *
 * NEDEN DEEZER DEĞİL: Deezer Türkiye'de hizmet vermiyor; API'si ve görsel
 * CDN'i cihazdan erişilemiyordu (fotoğrafların hiç görünmemesinin nedeni) ve
 * aynı adda onlarca kayıt döndürüp yanlış kişiyi seçiyordu.
 *
 * Sonuçlar AsyncStorage'da önbelleğe alınır. **Başarısız istek önbelleğe
 * yazılmaz**: aksi halde ağ bir kez aksadığında sanatçının fotoğrafı günlerce
 * gizli kalıyordu.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeArtistKey } from './artistMatch';
import { cleanTrackTitle } from './displayNames';
import { splitArtistNames } from './wrappedStats';
import { isNetworkAvailable } from './networkAwareFetch';
import {
  GENIUS_SUGGEST_LIMIT,
  geniusArtistImageOf,
  pickArtistFromSongs,
  rankGeniusArtists,
  type GeniusArtistHit,
  type GeniusArtistLike,
  type GeniusSongLike,
} from './artistImageMatch';

// Eşleştirme anahtarı saf modülde tutulur (Node doğrulama betikleri için);
// mevcut importlar bozulmasın diye buradan yeniden dışa aktarılır.
export { normalizeArtistKey } from './artistMatch';

// v4: kaynak Deezer'dan Genius'a taşındı. Anahtar sürümlendi ki cihazdaki
// eski (yanlış veya boş) Deezer kayıtları hiç kullanılmasın.
const CACHE_KEY = 'runmusic-artist-images-v4';
const FOUND_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * Doğrulanmamış (parça ipucu olmadan bulunmuş) görseller daha kısa tutulur:
 * sonraki açılışta çalan parçayla daha doğru sonuç alınabilsin.
 */
const UNVERIFIED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** "Bulunamadı" kaydı kısa tutulur; uygulama kendini çabucak toparlar. */
const MISS_TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 400;

interface ArtistImageEntry {
  /** Bulunan görsel URL'i; bulunamadıysa null. */
  url: string | null;
  fetchedAt: number;
  /** Parça adı ipucuyla doğrulanarak mı bulundu? */
  verified?: boolean;
  /** Doğrulandığı an (bilinen kaynaktan yazıldıysa). */
  verifiedAt?: number;
  source?: 'genius';
}

type ArtistImageCache = Record<string, ArtistImageEntry>;

let memoryCache: ArtistImageCache | null = null;
let loadPromise: Promise<ArtistImageCache> | null = null;
/** Aynı isim için eşzamanlı istekleri tekilleştirir. */
const inflight = new Map<string, Promise<string | null>>();
let writeChain: Promise<void> = Promise.resolve();

function isFresh(entry: ArtistImageEntry, now: number): boolean {
  const ttl = !entry.url
    ? MISS_TTL_MS
    : entry.verified
      ? FOUND_TTL_MS
      : UNVERIFIED_TTL_MS;
  return now - entry.fetchedAt < ttl;
}

async function readCache(): Promise<ArtistImageCache> {
  if (memoryCache) return memoryCache;
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const raw = await AsyncStorage.getItem(CACHE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        memoryCache =
          parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as ArtistImageCache)
            : {};
      } catch {
        memoryCache = {};
      }
      return memoryCache;
    })();
  }
  return loadPromise;
}

function persist(cache: ArtistImageCache): void {
  // Yazma sırası korunur; hata yutulur (önbellek yalnızca hızlandırıcıdır).
  writeChain = writeChain.then(async () => {
    try {
      const now = Date.now();
      const entries = Object.entries(cache).filter(([, entry]) => isFresh(entry, now));
      // En yeni kayıtlar önce; boyut sınırını aşan eskiler atılır.
      entries.sort((a, b) => b[1].fetchedAt - a[1].fetchedAt);
      const trimmed: ArtistImageCache = {};
      for (const [key, entry] of entries.slice(0, MAX_ENTRIES)) {
        trimmed[key] = entry;
      }
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(trimmed));
    } catch {
      // yoksay
    }
  });
}

/**
 * Genius isteği başarısız olduğunda fırlatılır (ağ / HTTP hatası).
 *
 * "Sonuç bulunamadı" ile "istek düştü" ayrımını korumak için hatalar yutulmaz.
 */
class GeniusRequestError extends Error {}

/**
 * Tüm Genius istekleri için ortak eşzamanlılık sınırı.
 *
 * İstatistikler 25 sanatçıyı, player ise her parça değişiminde birkaç sanatçıyı
 * çözer. Tek bir kuyruk, aynı anda onlarca istek atıp engellenmeyi önler.
 */
const MAX_CONCURRENT_REQUESTS = 4;
let activeRequests = 0;
const requestQueue: (() => void)[] = [];

async function withRequestSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
    await new Promise<void>((resolve) => requestQueue.push(resolve));
  }
  activeRequests += 1;
  try {
    return await task();
  } finally {
    activeRequests -= 1;
    requestQueue.shift()?.();
  }
}

/**
 * Genius'ın siteyi besleyen JSON uç noktası.
 *
 * Geniş kapsamlı arama düz uç noktalar (`genius.com/api/...`) tarayıcı
 * `User-Agent`'ı olmadan Cloudflare tarafından 403 ile engellenebiliyor.
 */
async function geniusJson<T>(url: string): Promise<T> {
  // Çevrimdışıyken istek denemek boşa gider; çağıranlar bu hatayı "başarısız
  // istek" olarak ele alıp önbelleğe YAZMAZ (fotoğraf gizli kalmaz).
  if (!isNetworkAvailable()) throw new GeniusRequestError('OFFLINE');

  return withRequestSlot(async () => {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
    });
    if (!res.ok) throw new GeniusRequestError(`HTTP ${res.status}`);
    return (await res.json()) as T;
  });
}

interface GeniusSection<T> {
  type?: string;
  hits?: T[];
}

interface GeniusSearchResponse<T> {
  response?: { sections?: GeniusSection<T>[] };
}

/** Şarkı araması: parça adı + sanatçı adı. */
async function searchSongs(query: string): Promise<GeniusSongLike[]> {
  const data = await geniusJson<GeniusSearchResponse<{ result?: GeniusSongLike }>>(
    `https://genius.com/api/search/multi?per_page=${GENIUS_SUGGEST_LIMIT}&q=${encodeURIComponent(query)}`
  );
  const sections = data?.response?.sections ?? [];
  const songSection = sections.find((section) => section.type === 'song');
  return (songSection?.hits ?? [])
    .map((hit) => hit?.result)
    .filter((song): song is GeniusSongLike => Boolean(song));
}

/**
 * Sanatçı araması.
 *
 * Önce sanatçıya özel arama denenir (küçük ve isabetli); o uç nokta
 * yanıt vermezse genel aramadaki sanatçı bölümüne düşülür.
 */
async function searchArtists(name: string): Promise<GeniusArtistLike[]> {
  try {
    const data = await geniusJson<GeniusSearchResponse<GeniusArtistHit>>(
      `https://genius.com/api/search/artist?per_page=${GENIUS_SUGGEST_LIMIT}&q=${encodeURIComponent(name)}`
    );
    const sections = data?.response?.sections ?? [];
    const hits = sections.flatMap((section) => section.hits ?? []);
    if (hits.length > 0) {
      return hits
        .map((hit) => hit?.result)
        .filter((artist): artist is GeniusArtistLike => Boolean(artist));
    }
  } catch {
    // Aşağıdaki genel aramaya düşülür.
  }

  const data = await geniusJson<GeniusSearchResponse<GeniusArtistHit>>(
    `https://genius.com/api/search/multi?per_page=${GENIUS_SUGGEST_LIMIT}&q=${encodeURIComponent(name)}`
  );
  const sections = data?.response?.sections ?? [];
  const artistSection = sections.find((section) => section.type === 'artist');
  return (artistSection?.hits ?? [])
    .map((hit) => hit?.result)
    .filter((artist): artist is GeniusArtistLike => Boolean(artist));
}

/** Aramanın sonucu: görsel, "bulunamadı" ve "istek başarısız" ayrı. */
interface ArtistLookup {
  url: string | null;
  /** İstek ağ/HTTP hatasıyla düştü mü? (Bu durumda önbelleğe yazılmaz.) */
  failed: boolean;
}

/** Parça ipucu için en fazla kaç arama yapılır. */
const MAX_TRACK_SEARCHES = 2;

/**
 * Genius'tan sanatçı fotoğrafı bulur.
 *
 * Sıra:
 *  1. **Parça araması** (`knownTitles`): çalan parçanın adı + sanatçı adı
 *     aranır ve o parçayı yayınlayan kaydın görseli alınır. En güçlü sinyal —
 *     aynı adlı sanatçılar arasındaki belirsizliği parça adı kesin çözer.
 *  2. **Sanatçı araması**: ada tam eşleşen kayıt (yer tutucu görseller elenir).
 *  3. Sanatçı adıyla şarkı araması: sanatçının ana kaydında profil görseli
 *     yoksa ama şarkılarından birinde varsa o kullanılır.
 */
async function fetchFromGenius(
  name: string,
  knownTitles: string[] = []
): Promise<ArtistLookup> {
  const titles = [
    ...new Set(knownTitles.map((title) => (title || '').trim()).filter(Boolean)),
  ].slice(0, MAX_TRACK_SEARCHES);

  try {
    // ── 1. Çalan parçayla arama ─────────────────────────────────────────
    for (const title of titles) {
      const songs = await searchSongs(`${title} ${name}`);
      const image = pickArtistFromSongs(songs, name);
      if (image) return { url: image, failed: false };
    }

    // ── 2. Sanatçı araması ──────────────────────────────────────────────
    const artists = await searchArtists(name);
    const [bestArtist] = rankGeniusArtists(artists, name);
    const artistImage = geniusArtistImageOf(bestArtist);
    if (artistImage) return { url: artistImage, failed: false };

    // ── 3. Sanatçı adıyla şarkı araması ─────────────────────────────────
    const songs = await searchSongs(name);
    const image = pickArtistFromSongs(songs, name);
    return { url: image ?? null, failed: false };
  } catch {
    // İstek düştü: "bu sanatçının fotoğrafı yok" DEĞİL. Önbelleğe yazılmaz.
    return { url: null, failed: true };
  }
}

/**
 * Tek bir sanatçı için profil fotoğrafı URL'i (yoksa null).
 *
 * `knownTitles`: elde olan parça adları (çalan parça, kütüphane, geçmiş...).
 * Verilirse doğru kayıt parça adıyla kesinleştirilir.
 */
export async function findArtistImage(
  name: string,
  knownTitles: string[] = []
): Promise<string | null> {
  const key = normalizeArtistKey(name);
  if (!key) return null;

  const cache = await readCache();
  const cached = cache[key];
  const hinted = knownTitles.some((title) => (title || '').trim().length > 0);

  // Doğrulanmamış kayıt, parça ipucu geldiğinde yeniden çözümlenir: aksi halde
  // ilk (ipucusuz ve yanlış olabilen) fotoğraf takılı kalırdı.
  if (cached && isFresh(cached, Date.now()) && (cached.verified || !hinted)) {
    return cached.url;
  }

  const existing = inflight.get(key);
  if (existing) return existing;

  const task = (async () => {
    let result: ArtistLookup;
    try {
      result = await fetchFromGenius(name, knownTitles);
    } catch {
      result = { url: null, failed: true };
    }

    // Başarısız istek önbelleğe YAZILMAZ.
    if (!result.failed) {
      cache[key] = {
        url: result.url,
        fetchedAt: Date.now(),
        verified: hinted && Boolean(result.url),
        source: 'genius',
      };
      persist(cache);
    }
    inflight.delete(key);
    return result.url;
  })();

  inflight.set(key, task);
  return task;
}

/**
 * Bilinen bir kaynaktan (ör. söz çekilirken Genius yanıtından) gelen sanatçı
 * görselini önbelleğe yazar.
 *
 * Var olan kayıt **doğrulanmışsa** üzerine yazılmaz: parça aramasıyla
 * doğrulanmış görsel daha günceldir. Aksi halde (yok / doğrulanmamış /
 * süresi geçmiş) yeni görsel yazılır.
 */
export async function rememberArtistImage(
  name: string,
  url: string | null,
  source: 'genius' = 'genius'
): Promise<void> {
  const key = normalizeArtistKey(name);
  if (!key || !url) return;

  const cache = await readCache();
  const cached = cache[key];
  const now = Date.now();
  const keepExisting = Boolean(
    cached &&
      cached.url &&
      cached.verified &&
      cached.verifiedAt &&
      now - cached.verifiedAt < FOUND_TTL_MS
  );
  if (keepExisting) return;

  cache[key] = { url, fetchedAt: now, verified: true, verifiedAt: now, source };
  persist(cache);
}

/**
 * Çalan parçadan sanatçı fotoğrafı çözer (player tarafından tetiklenir).
 *
 * Kullanıcı bir şarkı çaldığında o şarkının adı + sanatçı adı Genius'ta
 * aranır; bulunan kayıt o sanatçı için önbelleğe yazılır. Böylece istatistik
 * ve Wrapped ekranları açıldığında fotoğraflar hazır olur.
 *
 * `artistField` virgülle ayrılmış olabilir ("UZI, MODD"); her sanatçı ayrı
 * ayrı çözülür. Dönen sözlük normalize edilmiş sanatçı anahtarı → görsel.
 */
export async function resolveArtistImagesForTrack(
  title: string,
  artistField: string
): Promise<Record<string, string>> {
  const names = splitArtistNames(artistField);
  if (names.length === 0) return {};

  const cleanTitle = cleanTrackTitle(title);
  const titlesByArtist: Record<string, string[]> = {};
  for (const name of names) {
    titlesByArtist[normalizeArtistKey(name)] = cleanTitle ? [cleanTitle] : [];
  }
  return loadArtistImages(names, titlesByArtist);
}

/**
 * Aynı anda yapılacak en fazla sanatçı çözümlemesi.
 *
 * İstatistikler 25 sanatçıya kadar listeleyebildiği için hepsini aynı anda
 * başlatmak yerine sınırlı sayıda çalıştırılır (ağ istekleri ayrıca
 * `withRequestSlot` kuyruğundan geçer).
 */
const MAX_CONCURRENT_FETCHES = 4;

/**
 * Birden çok sanatçı için görsel haritası üretir.
 *
 * Dönen sözlük normalize edilmiş sanatçı anahtarı → görsel URL'i biçimindedir;
 * yalnızca görsel bulunanlar yer alır.
 *
 * `titlesByArtist` verilirse, doğru kaydı seçmek için sanatçının bilinen parça
 * adları kullanılır (`findArtistImage` açıklamasına bakın).
 */
export async function loadArtistImages(
  names: string[],
  titlesByArtist?: Record<string, string[]>
): Promise<Record<string, string>> {
  const unique = [...new Set(names.map((name) => (name ?? '').trim()).filter(Boolean))];
  const out: Record<string, string> = {};
  let cursor = 0;

  const worker = async () => {
    while (cursor < unique.length) {
      const name = unique[cursor++];
      const titles = titlesByArtist?.[normalizeArtistKey(name)] ?? [];
      const url = await findArtistImage(name, titles);
      if (url) out[normalizeArtistKey(name)] = url;
    }
  };

  const workers = Array.from(
    { length: Math.min(MAX_CONCURRENT_FETCHES, unique.length) },
    () => worker()
  );
  await Promise.all(workers);
  return out;
}
