/**
 * lrc.red sağlayıcısı — Apple Music TTML, hece bazlı, ISRC ile arşivlenmiş.
 *
 * Belgeler `https://lrc.red/s/{ISRC}.ttml` adresinde durur; bu yüzden doğru
 * kaydın ISRC'si biliniyorsa tek istekle ve yanlış sürüme düşme riski olmadan
 * alınır. ISRC yoksa `/search.json?q=` serbest metin araması yapılır ve
 * sonuçlar sıraya güvenmeden eşleştirilir: arama "Bohemian Rhapsody (Operatic
 * Section / 2011 A Cappella Mix)"i şarkının kendisinden üstte gösterebilir.
 *
 * Eşleştirme kuralları BitChord'un LrcRed.kt dosyasından uyarlanmıştır:
 * normalize başlık eşitliği, sürüm kelimeleri (live/remix/acoustic…),
 * ortak sanatçı ve ±3 sn süre toleransı.
 */

export interface LrcRedHit {
  isrc: string;
  title: string;
  artist: string;
  album?: string;
  year?: number;
  duration?: number;
  cover?: string;
  color?: string;
}

/**
 * Arşivdeki belgenin senkron seviyesi.
 *
 * lrc.red her parça için `/s/{ISRC}.json` üzerinden üst veri yayınlar ve
 * `sync` alanı belgenin gerçekte ne sunduğunu söyler. Bu bilgi olmadan
 * `None` belgeler "WORD SYNC" gibi görünüp açıldığında boş kalıyordu.
 */
export type LrcRedSyncLevel = 'word' | 'line' | 'none' | 'unknown';

export interface LrcRedInfo {
  isrc: string;
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  sync: LrcRedSyncLevel;
  lines?: number;
  ttmlUrl?: string;
  lrcUrl?: string;
}

const SEARCH_URL = 'https://lrc.red/search.json';
const DOCUMENT_URL = 'https://lrc.red/s';
const REQUEST_TIMEOUT_MS = 6000;
const INFO_TIMEOUT_MS = 4000;
const DURATION_TOLERANCE_SECONDS = 3;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 24;
const INFO_CACHE_MAX_ENTRIES = 64;

const HEADERS: HeadersInit = {
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  Accept: 'application/json, application/ttml+xml, text/xml, */*',
};

interface CacheEntry {
  ttml: string;
  at: number;
}

interface InfoCacheEntry {
  info: LrcRedInfo;
  at: number;
}

interface PlainCacheEntry {
  text: string;
  at: number;
}

const documentCache = new Map<string, CacheEntry>();
const infoCache = new Map<string, InfoCacheEntry>();
const plainCache = new Map<string, PlainCacheEntry>();

function normalize(value?: string | null): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value?: string | null): string[] {
  const normalized = normalize(value);
  return normalized ? normalized.split(' ').filter(Boolean) : [];
}

/** Kelime kümesi örtüşmesi (Dice katsayısı). */
function similarity(a?: string | null, b?: string | null): number {
  const setA = new Set(tokens(a));
  const setB = new Set(tokens(b));
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  setA.forEach((word) => {
    if (setB.has(word)) shared++;
  });
  return (2 * shared) / (setA.size + setB.size);
}

const VERSION_WORDS = [
  'live',
  'remix',
  'remaster',
  'remastered',
  'acoustic',
  'instrumental',
  'sped',
  'slowed',
  'demo',
  'edit',
  'mix',
  'cover',
  'karaoke',
  'extended',
  'radio',
  'version',
  'session',
];

/** Başlıktaki sürüm belirteçleri (parantez içi ve " - " sonrası). */
function versionTokens(title?: string | null): Set<string> {
  const lower = (title || '').toLowerCase();
  const brackets = Array.from(lower.matchAll(/[([{]([^)\]}]*)[)\]}]/g))
    .map((match) => match[1])
    .join(' ');
  const suffix = lower.split(/\s[-–—]\s/).slice(1).join(' ');
  const found = new Set<string>();
  for (const token of `${brackets} ${suffix}`.split(/[^a-z0-9]+/)) {
    if (!token) continue;
    const version = VERSION_WORDS.find((word) => token.startsWith(word));
    if (version) found.add(version);
  }
  return found;
}

function versionMatch(a: string, b: string): number {
  const setA = versionTokens(a);
  const setB = versionTokens(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size !== setB.size) return 0;
  for (const version of setA) {
    if (!setB.has(version)) return 0;
  }
  return 1;
}

const CONNECTOR_WORDS = new Set(['feat', 'ft', 'and', 'the', 'x', 'vs']);

function artistOverlap(a: string, b: string): number {
  const setA = new Set(tokens(a).filter((word) => !CONNECTOR_WORDS.has(word)));
  const setB = new Set(tokens(b).filter((word) => !CONNECTOR_WORDS.has(word)));
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  setA.forEach((word) => {
    if (setB.has(word)) shared++;
  });
  return shared > 0 ? 1 : 0;
}

/**
 * Bir lrc.red isabetinin aranan parçayla uyumu (0..1).
 *
 * Ağırlıklar söz eşleştirmesiyle aynı mantığı izler: sanatçı %55, başlık %35,
 * sürüm ve süre kalan %10. İstenen sürümün dışındaki kayıtlar (canlı, remix)
 * bu sayede doğru stüdyo kaydının önüne geçemez.
 */
export function scoreLrcRedHit(
  hit: Pick<LrcRedHit, 'title' | 'artist' | 'duration'>,
  title: string,
  artist = '',
  duration?: number
): number {
  const expectedTitle = stripVersionSuffix(title);
  const hitTitle = stripVersionSuffix(hit.title);
  const titleSim = similarity(hitTitle, expectedTitle);
  const artistSim = artist ? artistOverlap(hit.artist, artist) : 0.8;
  const versions = versionMatch(hit.title, title);

  let durationSim = 0.8;
  if (
    typeof duration === 'number' &&
    duration > 0 &&
    typeof hit.duration === 'number' &&
    hit.duration > 0
  ) {
    const delta = Math.abs(hit.duration - duration);
    durationSim = delta <= DURATION_TOLERANCE_SECONDS ? 1 : Math.max(0, 1 - delta / 30);
  }

  let score = artistSim * 0.55 + titleSim * 0.35 + versions * 0.05 + durationSim * 0.05;

  // Süre belirgin biçimde uyuşmuyorsa kayıt büyük olasılıkla başka bir sürüm.
  if (
    typeof duration === 'number' &&
    duration > 0 &&
    typeof hit.duration === 'number' &&
    hit.duration > 0 &&
    Math.abs(hit.duration - duration) > DURATION_TOLERANCE_SECONDS
  ) {
    score *= 0.7;
  }

  // Birebir başlık + tam sanatçı eşleşmesi her zaman en güçlü sinyaldir.
  if (normalize(hitTitle) === normalize(expectedTitle) && artistSim >= 1) {
    score = Math.max(score, 0.95);
  }

  return Math.max(0, Math.min(1, score));
}

/** Başlıktan parantez içeriğini ve " - ..." sonekini atar. */
function stripVersionSuffix(title?: string | null): string {
  return (title || '')
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .replace(/\s[-–—]\s.*$/, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return run(controller.signal).finally(() => clearTimeout(timer));
}

function withInfoTimeout<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INFO_TIMEOUT_MS);
  return run(controller.signal).finally(() => clearTimeout(timer));
}

/**
 * ISRC'yi arşiv anahtarına çevirir.
 *
 * Yalnızca uzunluk ve karakter sınıfı denetlenir; kayıt ülke kodunun resmî
 * listede olması gerekmez. Biçime uymayan bir ISRC'yi tamamen reddetmek,
 * arşivde var olan belgeye erişimi gereksiz yere engelliyordu.
 */
function normalizeIsrc(isrc?: string | null): string | null {
  const key = (isrc || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (key.length !== 12) return null;
  return key;
}

function touchCache<T extends { at: number }>(cache: Map<string, T>, key: string, value: T, max: number) {
  cache.set(key, value);
  if (cache.size > max) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

function isUsableHit(value: unknown): value is LrcRedHit {
  if (!value || typeof value !== 'object') return false;
  const hit = value as Record<string, unknown>;
  return (
    typeof hit.isrc === 'string' &&
    hit.isrc.length >= 10 &&
    typeof hit.title === 'string' &&
    typeof hit.artist === 'string'
  );
}

/**
 * Başlık + sanatçı ile lrc.red arşivini arar.
 * Ağ hatası, zaman aşımı veya bozuk yanıtta boş dizi döner.
 */
export async function searchLrcRed(
  title: string,
  artist = '',
  options: { duration?: number } = {}
): Promise<LrcRedHit[]> {
  const query = [stripVersionSuffix(title) || title, artist]
    .map((part) => (part || '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
  if (!query) return [];

  try {
    const response = await withTimeout((signal) =>
      fetch(`${SEARCH_URL}?q=${encodeURIComponent(query)}`, { headers: HEADERS, signal })
    );
    if (!response.ok) return [];

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) return [];

    const data = await response.json();
    const rawHits: unknown[] = Array.isArray(data?.hits) ? data.hits : [];
    const hits = rawHits.filter(isUsableHit);
    if (hits.length === 0) return [];

    // Sıralamayı sunucuya bırakmıyoruz: serbest metin araması yanlış sürümü
    // üste koyabiliyor. En yakın eşleşme başta olacak şekilde yeniden dizer.
    return hits
      .map((hit, index) => ({
        hit,
        index,
        score: scoreLrcRedHit(hit, title, artist, options.duration),
      }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((entry) => entry.hit);
  } catch {
    return [];
  }
}

/** Aramadan dönen en iyi kaydı seçer; makul bir eşik altındaysa null. */
export function pickBestLrcRedHit(
  hits: LrcRedHit[],
  title: string,
  artist = '',
  duration?: number
): { hit: LrcRedHit; score: number } | null {
  let best: { hit: LrcRedHit; score: number } | null = null;
  for (const hit of hits) {
    const score = scoreLrcRedHit(hit, title, artist, duration);
    if (!best || score > best.score) best = { hit, score };
  }
  return best && best.score >= 0.45 ? best : null;
}

/**
 * ISRC'den arşiv üst verisini okur (`sync` alanı belgenin ne sunduğunu söyler).
 *
 * Ağ hatası, zaman aşımı veya bozuk yanıtta `null` döner; çağıran taraf bu
 * durumda belgeyi iyimser kabul eder.
 */
export async function fetchLrcRedInfo(isrc: string): Promise<LrcRedInfo | null> {
  const key = normalizeIsrc(isrc);
  if (!key) return null;

  const cached = infoCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.info;
  }

  try {
    const response = await withInfoTimeout((signal) =>
      fetch(`${DOCUMENT_URL}/${key}.json`, { headers: HEADERS, signal })
    );
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) return null;

    const data = (await response.json()) as Record<string, unknown>;
    const rawSync = String(data?.sync ?? '').toLowerCase();
    const sync: LrcRedSyncLevel =
      rawSync === 'word' || rawSync === 'line' || rawSync === 'none' ? rawSync : 'unknown';
    const files = (data?.files && typeof data.files === 'object' ? data.files : {}) as Record<
      string,
      unknown
    >;

    const info: LrcRedInfo = {
      isrc: key,
      title: typeof data?.title === 'string' ? data.title : undefined,
      artist: typeof data?.artist === 'string' ? data.artist : undefined,
      album: typeof data?.album === 'string' ? data.album : undefined,
      duration: typeof data?.duration === 'number' ? data.duration : undefined,
      sync,
      lines: typeof data?.lines === 'number' ? data.lines : undefined,
      ttmlUrl: typeof files.ttml === 'string' ? files.ttml : undefined,
      lrcUrl: typeof files.lrc === 'string' ? files.lrc : undefined,
    };

    touchCache(infoCache, key, { info, at: Date.now() }, INFO_CACHE_MAX_ENTRIES);
    return info;
  } catch {
    return null;
  }
}

/**
 * Zaman damgaları arındırılmış düz söz metnini döndürür.
 *
 * `sync: "none"` belgelerde TTML `<p>` etiketleri zamanlama taşımadığı için
 * satır satır söz üretilemiyor. Arşiv aynı metni `.lrc` olarak da yayınlıyor;
 * buradan düz söz olarak yüklenebiliyor.
 */
export async function fetchLrcRedPlainLyrics(isrc: string): Promise<string | null> {
  const key = normalizeIsrc(isrc);
  if (!key) return null;

  const cached = plainCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.text;
  }

  try {
    const response = await withInfoTimeout((signal) =>
      fetch(`${DOCUMENT_URL}/${key}.lrc`, { headers: HEADERS, signal })
    );
    if (!response.ok) return null;

    const raw = await response.text();
    if (!raw || raw.includes('<html') || raw.includes('<!DOCTYPE')) return null;

    const text = raw
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*\[[^\]]*\]\s*/, '').replace(/\s+$/, ''))
      .join('\n')
      // lrc.red metni kesme işaretlerini ters bölüyle kaçırıyor (`don\'t`).
      .replace(/\\(['"`])/g, '$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (!text) return null;

    touchCache(plainCache, key, { text, at: Date.now() }, INFO_CACHE_MAX_ENTRIES);
    return text;
  } catch {
    return null;
  }
}

/**
 * ISRC'den Apple TTML belgesini indirir.
 *
 * lrc.red ara sıra Cloudflare HTML'i döndürür; bu durumda istek bir kez daha
 * denenir, yine olmazsa belge yok sayılır ki çağıran taraf bir sonraki
 * sağlayıcıya düşebilsin.
 */
export async function fetchLrcRedTtml(isrc: string): Promise<string | null> {
  const key = normalizeIsrc(isrc);
  if (!key) return null;

  const cached = documentCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.ttml;
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await withTimeout((signal) =>
        fetch(`${DOCUMENT_URL}/${key}.ttml`, { headers: HEADERS, signal })
      );
      if (!response.ok) continue;

      const text = await response.text();
      if (!text || !text.includes('<tt') || !/<p\b/.test(text)) continue;

      touchCache(documentCache, key, { ttml: text, at: Date.now() }, CACHE_MAX_ENTRIES);
      return text;
    } catch {
      // Zaman aşımı/ağ hatası: bir kez daha dene.
    }
  }
  return null;
}

/** Test ve hata ayıklama için önbelleği temizler. */
export function clearLrcRedCache(): void {
  documentCache.clear();
  infoCache.clear();
  plainCache.clear();
}
