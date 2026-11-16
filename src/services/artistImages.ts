/**
 * Sanatçı profil fotoğrafı arama servisi.
 *
 * Wrapped ve istatistik ekranlarında sanatçı satırları albüm kapağı yerine
 * sanatçının kendi fotoğrafını gösterebilsin diye Deezer'in herkese açık
 * sanatçı aramasını kullanır. API anahtarı gerekmez.
 *
 * Sonuçlar AsyncStorage'da önbelleğe alınır: aynı isim için her açılışta ağ
 * isteği yapılmaz. Bulunamayan isimler de (boş sonuç) kısa süreliğine
 * önbelleğe yazılır, böylece olmayan bir sanatçı her seferinde yeniden
 * aranmaz. Tüm hatalar yutulur; görsel bulunamazsa arayüz harf rozetine düşer.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeArtistKey } from './artistMatch';
import { cleanTrackTitle } from './displayNames';
import { splitArtistNames } from './wrappedStats';
import {
  rankDeezerArtists,
  artistPictureOf,
  pickByTitleOverlap,
  matchingTrackArtistIds,
  isPlaceholderPicture,
  MAX_TITLE_CANDIDATES,
  MAX_TRACK_SEARCHES,
  type DeezerArtistLike,
  type DeezerTrackLike,
} from './artistImageMatch';

// Eşleştirme anahtarı saf modülde tutulur (Node doğrulama betikleri için);
// mevcut importlar bozulmasın diye buradan yeniden dışa aktarılır.
export { normalizeArtistKey } from './artistMatch';

// v3: sanatçı seçimi parça adıyla (çalan şarkı) doğrulanıyor ve Genius kaynağı
// eklendi; eski yanlış/boş kayıtların önbellekte kalmasını önlemek için sürüm.
const CACHE_KEY = 'runmusic-artist-images-v3';
const FOUND_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * Doğrulanmamış (parça ipucu olmadan bulunmuş) görseller daha kısa tutulur:
 * aynı adda birden çok sanatçı varken popülerlik yanlış kişiyi seçebilir, bu
 * yüzden ipucu geldiğinde yeniden aranmalı.
 */
const UNVERIFIED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * "Bulunamadı" kaydı kısa tutulur.
 *
 * Uzun tutulduğunda tek bir başarısız çözümleme sanatçının fotoğrafını
 * günlerce gizliyordu; kısa tutulduğunda uygulama kendini çabucak toparlar.
 */
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
  /** Görselin geldiği kaynak. */
  source?: 'deezer' | 'genius';
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

/** Bir sanatçının Deezer'daki en popüler parçalarının adları. */
async function fetchTopTrackTitles(artistId: number): Promise<string[]> {
  try {
    const res = await fetch(`https://api.deezer.com/artist/${artistId}/top?limit=25`, {
      headers: { 'User-Agent': 'RunMusic/1.0' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const items = Array.isArray(data?.data) ? data.data : [];
    return items.map((item: { title?: string }) => item.title || '').filter(Boolean);
  } catch {
    return [];
  }
}

/** Deezer isteği başarısız olduğunda fırlatılır (ağ / HTTP hatası). */
class DeezerRequestError extends Error {}

/**
 * Tüm Deezer istekleri için ortak eşzamanlılık sınırı.
 *
 * İstatistikler 25 sanatçıyı, player ise her parça değişiminde 1-3 sanatçıyı
 * çözer. Bu istekler aynı anda birleştiğinde Deezer 429 dönebiliyor ve o
 * durumda fotoğraflar hiç yüklenmiyordu. Tek bir kuyruk bunu önler.
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
 * Deezer JSON uç noktası.
 *
 * "Sonuç bulunamadı" ile "istek başarısız" arasındaki farkı korumak için
 * hatalar yutulmaz. Bu ayrım önemli: başarısız istek önbelleğe yazılırsa
 * sanatçının fotoğrafı günlerce hiç görünmez.
 */
async function deezerJson<T>(url: string): Promise<T> {
  return withRequestSlot(async () => {
    const res = await fetch(url, { headers: { 'User-Agent': 'RunMusic/1.0' } });
    if (!res.ok) throw new DeezerRequestError(`HTTP ${res.status}`);
    return (await res.json()) as T;
  });
}

/** Tek bir parça için Deezer parça araması (sanatçı kimliği çıkarımı). */
async function fetchTrackArtistIds(title: string, name: string): Promise<number[]> {
  try {
    const data = await deezerJson<{ data?: DeezerTrackLike[] }>(
      `https://api.deezer.com/search?q=${encodeURIComponent(`${title} ${name}`)}&limit=6`
    );
    const items = Array.isArray(data?.data) ? data.data : [];
    return matchingTrackArtistIds(items, name);
  } catch {
    return [];
  }
}

/** Bir sanatçının Deezer kaydındaki profil fotoğrafı. */
async function fetchArtistPictureById(id: number): Promise<string | null> {
  try {
    const artist = await deezerJson<DeezerArtistLike>(`https://api.deezer.com/artist/${id}`);
    const picture = artistPictureOf(artist);
    return picture && !isPlaceholderPicture(picture) ? picture : null;
  } catch {
    return null;
  }
}

/** Deezer aramasının sonucu: görsel, "bulunamadı" ve "istek başarısız" ayrı. */
interface ArtistLookup {
  url: string | null;
  /** İstek ağ/HTTP hatasıyla düştü mü? (Bu durumda önbelleğe yazılmaz.) */
  failed: boolean;
}

/**
 * Deezer'dan sanatçı fotoğrafı bulur.
 *
 * NEDEN SIRALAMA GEREKİYOR: Deezer'da aynı adda çok sayıda sanatçı var
 * ("Motive" için dört ayrı kayıt, "UZI" için ondan fazla). İlk sonucu almak
 * neredeyse her zaman yanlış kişinin fotoğrafını getiriyordu.
 *
 * Sıra:
 *  1. **Parça araması** (`knownTitles`): çalan/çalınan parçanın adıyla
 *     "parça + sanatçı" aranır ve o parçayı yayınlayan kayıt seçilir. Bu en
 *     güçlü sinyaldir — aynı adlı sanatçılar arasındaki belirsizliği parça
 *     adı kesin olarak çözer. Genelde tek istekte biter.
 *  2. Ada tam eşleşen adaylar (yoksa kelime benzerliği ≥ 0.6 olanlar);
 *     beyaz yer tutucu fotoğraflar elenir.
 *  3. Parça araması sonuç vermezse adayların en popüler parçalarıyla başlık
 *     örtüşmesine bakılır.
 *  4. O da yoksa hayran sayısı (`nb_fan`) en yüksek aday seçilir.
 *
 * Kararların tamamı `artistImageMatch` içinde (saf, test edilebilir).
 */
async function fetchFromDeezer(name: string, knownTitles: string[] = []): Promise<ArtistLookup> {
  const titles = [
    ...new Set(knownTitles.map((title) => (title || '').trim()).filter(Boolean)),
  ].slice(0, MAX_TRACK_SEARCHES);

  // ── 1. Parça araması: en güçlü ve en ucuz yol ─────────────────────────
  // Sanatçı aramasından ÖNCE denenir. Böylece çalan parça için tek istekle
  // doğru kayda ulaşılır ve aynı adlı sanatçı karışıklığı hiç oluşmaz.
  for (const title of titles) {
    const ids = await fetchTrackArtistIds(title, name);
    if (ids.length === 0) continue;
    // Deezer alaka sırası: ilk eşleşme en doğru kayıt.
    const picture = await fetchArtistPictureById(ids[0]);
    if (picture) return { url: picture, failed: false };
  }

  // ── 2. Sanatçı araması ────────────────────────────────────────────────
  let results: DeezerArtistLike[];
  try {
    const data = await deezerJson<{ data?: DeezerArtistLike[] }>(
      `https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=10`
    );
    results = Array.isArray(data?.data) ? data.data : [];
  } catch {
    // İstek düştü: "bu sanatçının fotoğrafı yok" DEĞİL. Önbelleğe yazılmaz.
    return { url: null, failed: true };
  }

  const byPopularity = rankDeezerArtists(results, name);
  // Zayıf eşleşmelerde yanlış sanatçının fotoğrafını göstermektense hiç
  // göstermemek daha iyidir.
  if (byPopularity.length === 0) return { url: null, failed: false };
  if (byPopularity.length === 1) {
    return { url: artistPictureOf(byPopularity[0]), failed: false };
  }

  // ── 3. En popüler parçaların başlık örtüşmesi ─────────────────────────
  if (titles.length > 0) {
    const candidates = byPopularity.slice(0, MAX_TITLE_CANDIDATES);
    const tops = await Promise.all(
      candidates.map((artist) =>
        artist.id != null ? fetchTopTrackTitles(artist.id) : Promise.resolve([] as string[])
      )
    );

    const chosen = candidates[pickByTitleOverlap(candidates, titles, tops)];
    const picture = artistPictureOf(chosen);
    if (picture && !isPlaceholderPicture(picture)) return { url: picture, failed: false };
  }

  // ── 4. Popülerlik ─────────────────────────────────────────────────────
  return { url: artistPictureOf(byPopularity[0]), failed: false };
}

/**
 * Tek bir sanatçı için profil fotoğrafı URL'i (yoksa null).
 *
 * `knownTitles`: elde olan parça adları (çalan parça, kütüphane, geçmiş...).
 * Verilirse Deezer'da aynı adda kaç sanatçı olursa olsun doğru kayıt bulunur.
 */
export async function findArtistImage(name: string, knownTitles: string[] = []): Promise<string | null> {
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
      result = await fetchFromDeezer(name, knownTitles);
    } catch {
      result = { url: null, failed: true };
    }

    // Başarısız istek önbelleğe YAZILMAZ. Aksi halde ağ bir kez aksadığında
    // sanatçının fotoğrafı günlerce hiç görünmüyordu.
    if (!result.failed) {
      cache[key] = {
        url: result.url,
        fetchedAt: Date.now(),
        verified: hinted && Boolean(result.url),
        source: 'deezer',
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
 * Bilinen bir kaynaktan (ör. Genius) gelen sanatçı görselini önbelleğe yazar.
 *
 * Lyrics servisi Genius'tan şarkı sözü çekerken o şarkının sanatçı görselini
 * de alır; bu, Deezer'da bulunamayan (veya yanlış bulunan) sanatçılar için
 * doğrudan doğru kaynaktır.
 *
 * Var olan kayıt **doğrulanmışsa** üzerine yazılmaz: Deezer'ın parça aramasıyla
 * doğrulanmış görseli daha günceldir. Aksi halde (yok / doğrulanmamış /
 * süresi geçmiş) yeni görsel yazılır.
 */
export async function rememberArtistImage(
  name: string,
  url: string | null,
  source: 'genius' | 'deezer' = 'genius'
): Promise<void> {
  const key = normalizeArtistKey(name);
  if (!key || !url) return;

  const cache = await readCache();
  const cached = cache[key];
  const now = Date.now();
  const keepExisting = Boolean(
    cached && cached.url && cached.verified && cached.verifiedAt && now - cached.verifiedAt < FOUND_TTL_MS
  );
  if (keepExisting) return;

  cache[key] = { url, fetchedAt: now, verified: true, verifiedAt: now, source };
  persist(cache);
}

/**
 * Çalan parçadan sanatçı fotoğrafı çözer (player tarafından tetiklenir).
 *
 * Kullanıcı bir şarkı çaldığında o şarkının adı + sanatçı adı Deezer'da
 * aranır; bulunan kayıt o sanatçı için önbelleğe yazılır. Böylece istatistik
 * ve Wrapped ekranları açıldığında fotoğraflar hazır olur — üstelik aynı adlı
 * sanatçılar arasındaki karışıklık parça adıyla kesin olarak çözülür.
 *
 * `artistField` virgülle ayrılmış olabilir ("UZI, MODD"); her sanatçı ayrı
 * ayrı çözülür. Dönen sözlük initialize görselleri içerir.
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
    // Parça adı olmadan arama yapılmaz: zayıf sinyalle yanlış sanatçıyı
    // önbelleğe yazmak, hiç yazmamaktan kötüdür.
    titlesByArtist[normalizeArtistKey(name)] = cleanTitle ? [cleanTitle] : [];
  }
  return loadArtistImages(names, titlesByArtist);
}

/**
 * Aynı anda yapılacak en fazla Deezer isteği.
 *
 * Deezer'ın ücretsiz kotası kısa sürede çok istek atıldığında 429 dönebiliyor.
 * İstatistikler 25 sanatçıya kadar listeleyebildiği için hepsini aynı anda
 * göndermek riskliydi.
 */
const MAX_CONCURRENT_FETCHES = 4;

/**
 * Birden çok sanatçı için görsel haritası üretir.
 *
 * Dönen sözlük normalize edilmiş sanatçı anahtarı → görsel URL'i biçimindedir;
 * yalnızca görsel bulunanlar yer alır. İstekler eşzamanlılık sınırıyla yapılır.
 *
 * `titlesByArtist` verilirse, aynı ada sahip birden çok sanatçı arasında
 * doğru olanı seçmek için sanatçının bilinen parça adları kullanılır
 * (`findArtistImage` açıklamasına bakın).
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
