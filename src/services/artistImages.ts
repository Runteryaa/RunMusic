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

const CACHE_KEY = 'runmusic-artist-images-v1';
const FOUND_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 400;

interface ArtistImageEntry {
  /** Bulunan görsel URL'i; bulunamadıysa null. */
  url: string | null;
  fetchedAt: number;
}

type ArtistImageCache = Record<string, ArtistImageEntry>;

let memoryCache: ArtistImageCache | null = null;
let loadPromise: Promise<ArtistImageCache> | null = null;
/** Aynı isim için eşzamanlı istekleri tekilleştirir. */
const inflight = new Map<string, Promise<string | null>>();
let writeChain: Promise<void> = Promise.resolve();

/** Sanatçı isimlerini eşleştirme için sadeleştirir. */
export function normalizeArtistKey(name?: string | null): string {
  return (name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordSimilarity(a?: string | null, b?: string | null): number {
  const setA = new Set(normalizeArtistKey(a).split(' ').filter(Boolean));
  const setB = new Set(normalizeArtistKey(b).split(' ').filter(Boolean));
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  setA.forEach((word) => {
    if (setB.has(word)) intersection++;
  });
  return intersection / Math.max(setA.size, setB.size);
}

function isFresh(entry: ArtistImageEntry, now: number): boolean {
  const ttl = entry.url ? FOUND_TTL_MS : MISS_TTL_MS;
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

interface DeezerArtist {
  name?: string;
  picture_medium?: string;
  picture_big?: string;
  nb_fan?: number;
}

async function fetchFromDeezer(name: string): Promise<string | null> {
  const url = `https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=5`;
  const res = await fetch(url, { headers: { 'User-Agent': 'RunMusic/1.0' } });
  if (!res.ok) return null;
  const data = await res.json();
  const results: DeezerArtist[] = Array.isArray(data?.data) ? data.data : [];
  if (results.length === 0) return null;

  const target = normalizeArtistKey(name);
  let best: { score: number; artist: DeezerArtist } | null = null;
  for (const artist of results) {
    const picture = artist.picture_big || artist.picture_medium;
    if (!picture) continue;
    const artistKey = normalizeArtistKey(artist.name);
    // Tam eşleşme her zaman kazanır; aksi halde kelime örtüşmesi.
    const score = artistKey === target ? 1 : wordSimilarity(artist.name, name);
    if (!best || score > best.score) {
      best = { score, artist };
    }
  }

  // Zayıf eşleşmelerde yanlış sanatçının fotoğrafını göstermektense hiç
  // göstermemek daha iyidir.
  if (!best || best.score < 0.6) return null;
  return best.artist.picture_big || best.artist.picture_medium || null;
}

/** Tek bir sanatçı için profil fotoğrafı URL'i (yoksa null). */
export async function findArtistImage(name: string): Promise<string | null> {
  const key = normalizeArtistKey(name);
  if (!key) return null;

  const cache = await readCache();
  const cached = cache[key];
  if (cached && isFresh(cached, Date.now())) return cached.url;

  const existing = inflight.get(key);
  if (existing) return existing;

  const task = (async () => {
    let url: string | null = null;
    try {
      url = await fetchFromDeezer(name);
    } catch {
      url = null;
    }
    cache[key] = { url, fetchedAt: Date.now() };
    persist(cache);
    inflight.delete(key);
    return url;
  })();

  inflight.set(key, task);
  return task;
}

/**
 * Birden çok sanatçı için görsel haritası üretir.
 *
 * Dönen sözlük normalize edilmiş sanatçı anahtarı → görsel URL'i biçimindedir;
 * yalnızca görsel bulunanlar yer alır.
 */
export async function loadArtistImages(names: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(names.map((name) => (name ?? '').trim()).filter(Boolean))];
  const out: Record<string, string> = {};
  await Promise.all(
    unique.map(async (name) => {
      const url = await findArtistImage(name);
      if (url) out[normalizeArtistKey(name)] = url;
    })
  );
  return out;
}
