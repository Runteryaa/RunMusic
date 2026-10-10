import type { LyricsResult } from './lyricsService';

/**
 * Kalıcı depolama için SAF (native bağımlılığı olmayan) temizleme mantığı.
 *
 * Bu dosya bilinçli olarak AsyncStorage/React Native import ETMEZ; böylece
 * migrasyon ve boyut küçültme mantığı Node üzerinde doğrudan test edilebilir
 * (bkz. scripts/verify-persist-migration.ts).
 */

/**
 * Şarkı sözü önbelleğinde alternatif bir anahtarın kanonik kayda işaretçisi.
 *
 * Aynı parça birden fazla anahtarla (id, url, dosya adı, başlık/sanatçı
 * kombinasyonları) bulunabildiği için, içeriği her anahtara kopyalamak yerine
 * yalnızca kanonik anahtara referans tutulur. Kalıcı kayıt böylece anahtar
 * sayısıyla değil, GERÇEK parça sayısıyla orantılı büyür.
 */
export interface LyricsCacheRef {
  ref: string;
}

export type LyricsCacheEntry = LyricsResult | LyricsCacheRef;

/**
 * Android AsyncStorage için güvenli tek-değer sınırı.
 * Bunun üzerindeki tek bir setItem, düşük RAM'li cihazlarda CursorWindow
 * hatası vermeye başlar; bu yüzden gerçek sınırın belirgin altında kalıyoruz.
 */
export const MAX_SAFE_BYTES = 1_800_000;

/** Genel üst sınır: bunun üzerindeki veri hiçbir koşulda yazılmaya çalışılmaz. */
export const HARD_MAX_BYTES = 3_500_000;

/** UTF-8 bayt uzunluğu. TextEncoder yoksa kod noktası üzerinden hesaplar. */
export function byteLength(value: string): number {
  try {
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(value).length;
    }
  } catch {
    // TextEncoder yok; aşağıdaki hesaba düş.
  }
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      // Vekil çift (surrogate pair): 4 bayt, sonraki kod birimini atla.
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/** Önbellek girdisinin kanonik kayda işaretçi olup olmadığını daraltır. */
export function isLyricsCacheRef(entry: LyricsCacheEntry | undefined): entry is LyricsCacheRef {
  return (
    !!entry &&
    typeof entry === 'object' &&
    'ref' in entry &&
    typeof (entry as LyricsCacheRef).ref === 'string'
  );
}

/**
 * Kalıcı veriye YAZILMAYAN, yeniden üretilebilir alanları ayıklar:
 *  - `candidates`: aday listesi yalnızca manuel arama ekranı için gerekir ve
 *    gerektiğinde yeniden çekilir.
 *  - `parsedLines`: `parseAnySyncedLyrics` ile söz metninden yeniden üretilir.
 *
 * Ölçüm: bu iki alan, kalıcı kaydın yaklaşık %85'ini oluşturuyordu.
 */
export function slimLyrics(lyrics: LyricsResult): LyricsResult {
  const { candidates: _candidates, parsedLines: _parsedLines, ...rest } = lyrics;
  return rest as LyricsResult;
}

/**
 * Söz önbelleğini kalıcı depolama için sıkıştırır:
 *  1. Her kayıttan türetilmiş alanlar (`candidates`, `parsedLines`) atılır.
 *  2. Aynı parçaya ait alternatif anahtarlar tam kopya yerine `{ ref }`
 *     işaretçisine dönüştürülür. Gruplama kaynak kimliği (`LyricsResult.id`)
 *     üzerinden yapılır; `setLyrics` aynı nesneyi tüm anahtarlara yazdığı için
 *     bu kimlik tüm kopyalarda aynıdır.
 *
 * İdempotenttir: zaten işaretçi olan kayıtlar olduğu gibi korunur, bu yüzden
 * hem migrasyonda hem her `partialize` çağrısında güvenle kullanılabilir.
 */
export function normalizeLyricsCache(
  cache: Record<string, LyricsCacheEntry> | undefined | null
): Record<string, LyricsCacheEntry> {
  const result: Record<string, LyricsCacheEntry> = {};
  if (!cache || typeof cache !== 'object') return result;

  // Kaynak kimliği -> kanonik (tam içerikli) anahtar
  const canonicalBySourceId = new Map<string, string>();

  for (const [key, value] of Object.entries(cache)) {
    if (!value || typeof value !== 'object') continue;

    if (isLyricsCacheRef(value)) {
      result[key] = value;
      continue;
    }

    const slimmed = slimLyrics(value as LyricsResult);
    const sourceId = slimmed.id;

    if (sourceId) {
      const canonicalKey = canonicalBySourceId.get(sourceId);
      if (canonicalKey === undefined) {
        canonicalBySourceId.set(sourceId, key);
        result[key] = slimmed;
      } else {
        result[key] = { ref: canonicalKey };
      }
    } else {
      // Kimliği olmayan (ör. özel) kayıtlar tekilleştirilemez; olduğu gibi kalır.
      result[key] = slimmed;
    }
  }

  return result;
}

/**
 * Verilen arama anahtarlarıyla önbellekten söz kaydını bulur.
 * Alternatif anahtarlar `{ ref }` ise kanonik kayda çözülür; kanonik kayıt
 * eksikse (ör. kırpılmışsa) sarkan referans yok sayılır.
 */
export function findLyricsInCache(
  cache: Record<string, LyricsCacheEntry> | undefined | null,
  keys: string[]
): LyricsResult | null {
  if (!cache) return null;
  for (const key of keys) {
    const entry = cache[key];
    if (!entry) continue;
    if (isLyricsCacheRef(entry)) {
      const target = cache[entry.ref];
      if (target && !isLyricsCacheRef(target)) return target;
      continue;
    }
    return entry;
  }
  return null;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function jsonBytes(value: unknown): number {
  try {
    return byteLength(JSON.stringify(value) ?? '');
  } catch {
    return 0;
  }
}

/**
 * Store'un kalıcı hale getirilmiş kısmını güvenli boyuta indirir.
 *
 * Sıra, en kolay yeniden üretilebilir veriden en değerliye doğrudur:
 *  1. Şarkı sözü aday listeleri ve türetilmiş `parsedLines`
 *  2. Söz önbelleğindeki kanonik kayıt sayısı (en büyükler önce atılır)
 *  3. Kapak haritası kuyruğu (dosyadan yeniden çıkarılır)
 *  4. Son çare: söz önbelleğinin tamamı
 *
 * Kullanıcı tercihleri (settings, isShuffle, repeatMode, hiddenTrackIds,
 * metadataMap) HER ZAMAN korunur — bunlar geri getirilemez verilerdir.
 */
export function reducePersistedState<T extends Record<string, any>>(
  state: T,
  aggressive = false
): { state: T; trimmed: boolean } {
  if (jsonBytes(state) <= MAX_SAFE_BYTES) {
    return { state, trimmed: false };
  }

  const next: Record<string, any> = { ...state };

  /** Aday listeleri ve parsedLines kalıcı veriye yazılmaz. */
  const stripDerivedLyricsFields = () => {
    const cache = asRecord(next.lyricsCache);
    const cleaned: Record<string, any> = {};
    for (const [key, value] of Object.entries(cache)) {
      if (isLyricsCacheRef(value)) {
        cleaned[key] = value;
        continue;
      }
      if (value && typeof value === 'object') {
        const { candidates: _c, parsedLines: _p, ...rest } = value as Record<string, any>;
        cleaned[key] = rest;
      } else {
        cleaned[key] = value;
      }
    }
    next.lyricsCache = cleaned;
  };

  /**
   * Kanonik söz kayıtlarını `maxCanonical` sayısına indirir. En büyük kayıtlar
   * önce atılır (boyut kazancı en yüksek). Atılan kayda işaret eden `ref`
   * girişleri de temizlenir; böylece sarkan referans kalmaz.
   */
  const pruneLyrics = (maxCanonical: number) => {
    const cache = asRecord(next.lyricsCache);
    const entries = Object.entries(cache);
    if (entries.length === 0) return;

    const canonical = entries.filter(([, v]) => !isLyricsCacheRef(v));
    if (canonical.length <= maxCanonical) return;

    const bySizeDesc = [...canonical].sort((a, b) => jsonBytes(b[1]) - jsonBytes(a[1]));
    const dropped = new Set(bySizeDesc.slice(maxCanonical).map(([k]) => k));

    const pruned: Record<string, any> = {};
    for (const [key, value] of entries) {
      if (dropped.has(key)) continue;
      if (isLyricsCacheRef(value) && dropped.has(value.ref)) continue;
      pruned[key] = value;
    }
    next.lyricsCache = pruned;
  };

  const trimArtworkMap = (maxEntries: number) => {
    const artworks = asRecord(next.artworkMap);
    const keys = Object.keys(artworks);
    if (keys.length <= maxEntries) return;
    const kept: Record<string, any> = {};
    for (const key of keys.slice(-maxEntries)) kept[key] = artworks[key];
    next.artworkMap = kept;
  };

  const steps: (() => void)[] = [
    stripDerivedLyricsFields,
    () => pruneLyrics(aggressive ? 20 : 80),
    () => pruneLyrics(aggressive ? 8 : 25),
    () => trimArtworkMap(aggressive ? 20 : 60),
    () => {
      // Son çare: söz önbelleğini tamamen bırak. Tercihler korunur.
      next.lyricsCache = {};
    },
  ];

  for (const step of steps) {
    step();
    if (jsonBytes(next) <= MAX_SAFE_BYTES) break;
  }

  return { state: next as T, trimmed: true };
}
