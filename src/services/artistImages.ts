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
import {
  rankDeezerArtists,
  artistPictureOf,
  pickByTitleOverlap,
  matchingTrackArtistIds,
  bestVotedId,
  isPlaceholderPicture,
  MAX_TITLE_CANDIDATES,
  MAX_TRACK_SEARCHES,
  type DeezerArtistLike,
  type DeezerTrackLike,
} from './artistImageMatch';

// Eşleştirme anahtarı saf modülde tutulur (Node doğrulama betikleri için);
// mevcut importlar bozulmasın diye buradan yeniden dışa aktarılır.
export { normalizeArtistKey } from './artistMatch';

// v2: sanatçı seçimi popülerlik + parça doğrulamasıyla değişti; eski (yanlış)
// fotoğrafların önbellekte kalmasını önlemek için anahtar sürümlendi.
const CACHE_KEY = 'runmusic-artist-images-v2';
const FOUND_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * Doğrulanmamış (parça ipucu olmadan bulunmuş) görseller daha kısa tutulur:
 * aynı adda birden çok sanatçı varken popülerlik yanlış kişiyi seçebilir, bu
 * yüzden ipucu geldiğinde yeniden aranmalı.
 */
const UNVERIFIED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 400;

interface ArtistImageEntry {
  /** Bulunan görsel URL'i; bulunamadıysa null. */
  url: string | null;
  fetchedAt: number;
  /** Parça adı ipucuyla doğrulanarak mı bulundu? */
  verified?: boolean;
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

/** Tek bir parça için Deezer parça araması (sanatçı kimliği çıkarımı). */
async function fetchTrackArtistIds(title: string, name: string): Promise<number[]> {
  try {
    const res = await fetch(
      `https://api.deezer.com/search?q=${encodeURIComponent(`${title} ${name}`)}&limit=6`,
      { headers: { 'User-Agent': 'RunMusic/1.0' } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const items: DeezerTrackLike[] = Array.isArray(data?.data) ? data.data : [];
    return matchingTrackArtistIds(items, name);
  } catch {
    return [];
  }
}

/** Bir sanatçının Deezer kaydındaki profil fotoğrafı. */
async function fetchArtistPictureById(id: number): Promise<string | null> {
  try {
    const res = await fetch(`https://api.deezer.com/artist/${id}`, {
      headers: { 'User-Agent': 'RunMusic/1.0' },
    });
    if (!res.ok) return null;
    const artist: DeezerArtistLike = await res.json();
    const picture = artistPictureOf(artist);
    return picture && !isPlaceholderPicture(picture) ? picture : null;
  } catch {
    return null;
  }
}

/**
 * Deezer'dan sanatçı fotoğrafı bulur.
 *
 * NEDEN SIRALAMA GEREKİYOR: Deezer'da aynı adda çok sayıda sanatçı var
 * ("Motive" için dört ayrı kayıt, "UZI" için ondan fazla). İlk sonucu almak
 * neredeyse her zaman yanlış kişinin fotoğrafını getiriyordu.
 *
 * Sıra:
 *  1. Ada tam eşleşen adaylar (yoksa kelime benzerliği ≥ 0.6 olanlar);
 *     beyaz yer tutucu fotoğraflar elenir.
 *  2. `knownTitles` (gerçekten dinlenen parçalar) verilmişse parça aramasıyla
 *     **doğrudan yayınlayan kayıt** bulunur — en güçlü sinyal.
 *  3. Parça araması sonuç vermezse adayların en popüler parçalarıyla başlık
 *     örtüşmesine bakılır.
 *  4. O da yoksa hayran sayısı (`nb_fan`) en yüksek aday seçilir.
 *
 * Kararların tamamı `artistImageMatch` içinde (saf, test edilebilir).
 */
async function fetchFromDeezer(name: string, knownTitles: string[] = []): Promise<string | null> {
  const url = `https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=10`;
  const res = await fetch(url, { headers: { 'User-Agent': 'RunMusic/1.0' } });
  if (!res.ok) return null;
  const data = await res.json();
  const results: DeezerArtistLike[] = Array.isArray(data?.data) ? data.data : [];
  if (results.length === 0) return null;

  const byPopularity = rankDeezerArtists(results, name);
  // Zayıf eşleşmelerde yanlış sanatçının fotoğrafını göstermektense hiç
  // göstermemek daha iyidir.
  if (byPopularity.length === 0) return null;
  if (byPopularity.length === 1 || knownTitles.length === 0) {
    return artistPictureOf(byPopularity[0]);
  }

  const candidateIds = byPopularity
    .map((artist) => artist.id)
    .filter((id): id is number => typeof id === 'number');

  // ── 1. Parça aramasıyla kimlik doğrulama ──────────────────────────────
  // Tek bir güvenilir sonuç yeterli olduğu için parça adları sırayla denenir
  // ve ilk kesin sonuçta durulur (gereksiz ağ isteği yapılmaz).
  const titles = [...new Set(knownTitles.map((title) => (title || '').trim()).filter(Boolean))].slice(
    0,
    MAX_TRACK_SEARCHES
  );

  const votes = new Map<number, number>();
  let resolvedId: number | null = null;
  for (const title of titles) {
    const ids = await fetchTrackArtistIds(title, name);
    if (ids.length === 0) continue;
    // Deezer alaka sırası: ilk eşleşme en doğru kayıt.
    votes.set(ids[0], (votes.get(ids[0]) ?? 0) + 1);
    resolvedId = bestVotedId(votes, candidateIds);
    // Aday listesindeki bir kayda kesin olarak ulaşıldıysa devam etmeyelim.
    if (resolvedId != null && candidateIds.includes(resolvedId)) break;
  }

  if (resolvedId != null) {
    const known = byPopularity.find((artist) => artist.id === resolvedId);
    const knownPicture = known ? artistPictureOf(known) : null;
    if (knownPicture && !isPlaceholderPicture(knownPicture)) return knownPicture;
    // Aday listesinde yoksa (arama sırası farklı olabilir) doğrudan sorulur.
    const fetched = await fetchArtistPictureById(resolvedId);
    if (fetched) return fetched;
  }

  // ── 2. En popüler parçaların başlık örtüşmesi ─────────────────────────
  const candidates = byPopularity.slice(0, MAX_TITLE_CANDIDATES);
  const tops = await Promise.all(
    candidates.map((artist) =>
      artist.id != null ? fetchTopTrackTitles(artist.id) : Promise.resolve([] as string[])
    )
  );

  const chosen = candidates[pickByTitleOverlap(candidates, knownTitles, tops)];
  return artistPictureOf(chosen);
}

/** Tek bir sanatçı için profil fotoğrafı URL'i (yoksa null). */
export async function findArtistImage(name: string, knownTitles: string[] = []): Promise<string | null> {
  const key = normalizeArtistKey(name);
  if (!key) return null;

  const cache = await readCache();
  const cached = cache[key];
  // Doğrulanmamış kayıt, parça ipucu geldiğinde yeniden çözümlenir: aksi halde
  // ilk (ipucusuz ve yanlış olabilen) fotoğraf 7 gün boyunca takılı kalırdı.
  if (
    cached &&
    isFresh(cached, Date.now()) &&
    (cached.verified || knownTitles.length === 0)
  ) {
    return cached.url;
  }

  const existing = inflight.get(key);
  if (existing) return existing;

  const task = (async () => {
    let url: string | null = null;
    try {
      url = await fetchFromDeezer(name, knownTitles);
    } catch {
      url = null;
    }
    // Doğrulama ipucu olmadan bulunan görsel daha kısa süre tutulur: sonraki
    // açılışta parça adlarıyla daha doğru sonuç alınabilsin.
    cache[key] = { url, fetchedAt: Date.now(), verified: knownTitles.length > 0 };
    persist(cache);
    inflight.delete(key);
    return url;
  })();

  inflight.set(key, task);
  return task;
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
