import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ScrobbleEntry } from './types';
import {
  QUEUE_MAX_ENTRIES,
  QUEUE_TTL_MS,
  enqueueEntry,
  pruneQueue,
  retryDelayMs,
} from './scrobbleQueueMath';

/**
 * Kalıcı scrobble kuyruğu (depolama katmanı).
 *
 * Amaç: ağ yokken, servis hız sınırına takıldığında veya uygulama kapanırken
 * kaybolan dinlemeleri biriktirmek ve sonra göndermek. Kuyruk kendi
 * AsyncStorage anahtarında durur; ana uygulama store'una (`runmusic-storage`)
 * hiç dokunmaz — böylece persist boyutu ve migrasyon riski artmaz.
 *
 * Saf mantık `scrobbleQueueMath.ts` içinde; burada yalnızca okuma/yazma var.
 */

const STORAGE_KEY = 'runmusic-scrobble-queue';

export { QUEUE_MAX_ENTRIES, QUEUE_TTL_MS };
export {
  RETRY_DELAYS_MS,
  createEntryId,
  dueEntries,
  enqueueEntry,
  pruneQueue,
  retryDelayMs,
} from './scrobbleQueueMath';

let cache: ScrobbleEntry[] | null = null;
let writeChain: Promise<void> = Promise.resolve();

async function readStorage(): Promise<ScrobbleEntry[]> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      cache = [];
      return cache;
    }
    const parsed = JSON.parse(raw);
    cache = Array.isArray(parsed) ? (parsed as ScrobbleEntry[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

/** Yazmalar sıraya alınır: eşzamanlı scrobble'lar birbirinin üzerine yazmasın. */
function persist(entries: ScrobbleEntry[]): Promise<void> {
  cache = entries;
  writeChain = writeChain
    .then(() => AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries)))
    .catch(() => {
      // Yazma başarısız olsa da bellekteki kuyruk çalışmaya devam eder.
    });
  return writeChain;
}

/**
 * Değiştiren işlemler tek sırada çalışır.
 *
 * NEDEN: `addToQueue` "oku → değiştir → yaz" yapıyor. İki servis birden açıksa
 * iki kayıt aynı anda eklenir; ikisi de kuyruğun aynı (eski) kopyasını okuyup
 * yazarsa biri kaybolur. Bu sıra, okuma/yazma arasını atomik hale getirir.
 */
let mutationChain: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = mutationChain.then(task, task);
  mutationChain = run.catch(() => undefined);
  return run;
}

export async function loadQueue(): Promise<ScrobbleEntry[]> {
  const entries = await readStorage();
  const pruned = pruneQueue(entries, Date.now());
  if (pruned.length !== entries.length) {
    await persist(pruned);
    return pruned;
  }
  return entries;
}

export function addToQueue(entry: ScrobbleEntry): Promise<void> {
  return serialize(async () => {
    const entries = await loadQueue();
    const next = enqueueEntry(entries, entry, Date.now());
    if (next !== entries) await persist(next);
  });
}

export function removeFromQueue(ids: string[]): Promise<void> {
  if (ids.length === 0) return Promise.resolve();
  return serialize(async () => {
    const entries = await loadQueue();
    const remove = new Set(ids);
    await persist(entries.filter((entry) => !remove.has(entry.id)));
  });
}

/**
 * Başarısız bir kaydı günceller.
 *
 * `permanent` ise kayıt düşürülür (oturum geçersiz, parça reddedildi gibi
 * tekrar denemekle düzelmeyecek hatalar). Aksi halde deneme sayacı artar ve
 * bir sonraki deneme zamanı ileri atılır.
 */
export function markAttempt(ids: string[], permanent: boolean): Promise<void> {
  if (ids.length === 0) return Promise.resolve();
  return serialize(async () => {
    const entries = await loadQueue();
    const target = new Set(ids);
    const now = Date.now();
    const next: ScrobbleEntry[] = [];
    for (const entry of entries) {
      if (!target.has(entry.id)) {
        next.push(entry);
        continue;
      }
      if (permanent) continue;
      const attempts = entry.attempts + 1;
      next.push({ ...entry, attempts, nextAttemptAt: now + retryDelayMs(attempts) });
    }
    await persist(next);
  });
}

/** Ayarlardan "kuyruğu temizle" için. */
export function clearQueue(): Promise<void> {
  return serialize(() => persist([]));
}

/** Testler için bellekteki kopyayı sıfırlar. */
export function resetQueueCacheForTests(): void {
  cache = null;
}

export async function getQueueSize(): Promise<number> {
  const entries = await loadQueue();
  return entries.length;
}

export const QUEUE_STORAGE_KEY = STORAGE_KEY;
