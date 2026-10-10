import AsyncStorage from '@react-native-async-storage/async-storage';
import { StateStorage } from 'zustand/middleware';
import {
  byteLength,
  reducePersistedState,
  HARD_MAX_BYTES,
  MAX_SAFE_BYTES,
} from './persistSanitize';

export {
  MAX_SAFE_BYTES,
  HARD_MAX_BYTES,
  byteLength,
  reducePersistedState,
  normalizeLyricsCache,
  findLyricsInCache,
  slimLyrics,
  isLyricsCacheRef,
} from './persistSanitize';
export type { LyricsCacheRef, LyricsCacheEntry } from './persistSanitize';

/**
 * Android AsyncStorage'e dayanan dayanıklı kalıcı depolama katmanı.
 *
 * NEDEN GEREKLİ:
 * Zustand'ın `createJSONStorage` sarmalayıcısı tüm store'u TEK bir JSON
 * string'e çevirip tek bir `AsyncStorage.setItem` çağrısıyla yazar. Android'de
 * AsyncStorage (SQLite/CursorWindow tabanlı) çok büyük tek değerleri yazamaz ve
 * yazma sessizce başarısız olur. Bu durumda store bir daha diske kaydedilmez;
 * kullanıcı açısından "verilerim güncellemeden sonra kayboldu" olarak görünür.
 *
 * Bu katman:
 *  1. Her yazmada boyutu ölçer; güvenli sınırın üzerindeyse kademeli küçültür.
 *  2. Yazma başarısız olursa daha agresif kırpma ile tekrar dener.
 *  3. Her başarılı yazmada doğrulanmış bir yedek anahtar günceller.
 *  4. Bozuk (parse edilemeyen) veriyi yedekten kurtarır.
 */

/** Ana persist kaydı. Sürümden bağımsız sabit anahtar (OTA'da asla değişmez). */
export const STORE_STORAGE_KEY = 'runmusic-storage';

/** Son bilinen iyi durumun yedeği (bozulma/taşma durumunda kurtarma için). */
export const STORE_BACKUP_KEY = 'runmusic-storage-backup';

export interface PersistMetrics {
  bytes: number;
  trimmed: boolean;
  failed: boolean;
}

let lastMetrics: PersistMetrics = { bytes: 0, trimmed: false, failed: false };

export function getLastPersistMetrics(): PersistMetrics {
  return lastMetrics;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function writeBackup(payload: string): Promise<void> {
  try {
    await AsyncStorage.setItem(STORE_BACKUP_KEY, payload);
  } catch {
    // Yedek yazımı başarısız olsa da ana kayıt geçerli; kritik değil.
  }
}

/**
 * Zustand `persist` için dayanıklı StateStorage.
 *
 * Not: `createJSONStorage` bu katmanın ÜZERİNDE çalışır; yani buraya gelen
 * `value` zaten bir JSON string'dir.
 */
export const resilientStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      const raw = await AsyncStorage.getItem(name);
      if (!raw) return null;

      try {
        JSON.parse(raw);
        return raw;
      } catch {
        console.warn(`[persist] "${name}" bozuk JSON; yedekten kurtarılıyor`);
        const backup = await AsyncStorage.getItem(STORE_BACKUP_KEY);
        if (backup) {
          try {
            JSON.parse(backup);
            await AsyncStorage.setItem(name, backup);
            return backup;
          } catch {
            // Yedek de bozuk; aşağıda temiz başlangıç yapılacak.
          }
        }
        // Kurtarılamıyor: uygulama açılmaya devam etmeli.
        await AsyncStorage.removeItem(name);
        return null;
      }
    } catch (e) {
      console.warn('[persist] okuma hatası:', errorMessage(e));
      return null;
    }
  },

  setItem: async (name: string, value: string): Promise<void> => {
    const originalBytes = byteLength(value);

    if (originalBytes > HARD_MAX_BYTES) {
      console.warn(
        `[persist] kayıt çok büyük (${Math.round(originalBytes / 1024)} KB); kırpılacak`
      );
    }

    // 1. Deneme: boyut güvenli sınırın altındaysa olduğu gibi yaz.
    if (originalBytes <= MAX_SAFE_BYTES) {
      try {
        await AsyncStorage.setItem(name, value);
        await writeBackup(value);
        lastMetrics = { bytes: originalBytes, trimmed: false, failed: false };
        return;
      } catch (e) {
        console.warn('[persist] yazma başarısız; kırpma denenecek:', errorMessage(e));
      }
    }

    // 2. Deneme: parse edip kademeli olarak küçült.
    let parsed: any;
    try {
      parsed = JSON.parse(value);
    } catch {
      lastMetrics = { bytes: originalBytes, trimmed: false, failed: true };
      return;
    }

    const inner = parsed?.state && typeof parsed.state === 'object' ? parsed.state : parsed;

    for (const aggressive of [false, true]) {
      const { state: reduced } = reducePersistedState(
        (inner && typeof inner === 'object' ? inner : {}) as Record<string, any>,
        aggressive
      );
      const rebuilt = parsed?.state ? { ...parsed, state: reduced } : reduced;

      let payload: string;
      try {
        payload = JSON.stringify(rebuilt);
      } catch (e) {
        console.warn('[persist] yeniden serileştirme hatası:', errorMessage(e));
        continue;
      }

      try {
        await AsyncStorage.setItem(name, payload);
        await writeBackup(payload);
        console.warn(
          `[persist] veri kırpılarak kaydedildi: ${Math.round(originalBytes / 1024)} KB -> ` +
            `${Math.round(byteLength(payload) / 1024)} KB (aggressive=${aggressive})`
        );
        lastMetrics = { bytes: byteLength(payload), trimmed: true, failed: false };
        return;
      } catch (e) {
        console.warn(
          `[persist] kırpılmış yazma başarısız (aggressive=${aggressive}):`,
          errorMessage(e)
        );
      }
    }

    lastMetrics = { bytes: originalBytes, trimmed: true, failed: true };
    console.warn('[persist] kalıcı kayıt başarısız; veriler bellekte tutuluyor');
  },

  removeItem: async (name: string): Promise<void> => {
    try {
      await AsyncStorage.multiRemove([name, STORE_BACKUP_KEY]);
    } catch (e) {
      console.warn('[persist] silme hatası:', errorMessage(e));
    }
  },
};

/** Tanılama amaçlı: mevcut kalıcı kaydın boyutunu KB cinsinden döner. */
export async function getPersistedSizeKB(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(STORE_STORAGE_KEY);
    return raw ? Math.round(byteLength(raw) / 1024) : 0;
  } catch {
    return 0;
  }
}
