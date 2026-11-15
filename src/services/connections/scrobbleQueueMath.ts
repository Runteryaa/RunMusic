import type { ScrobbleEntry, ScrobbleTarget } from './types';

/**
 * Scrobble kuyruğunun **saf** mantığı.
 *
 * Bu dosya bilinçli olarak hiçbir native modül (AsyncStorage, SQLite) veya
 * React'e bağlı değil; böylece kuyruk davranışı Node üzerinde
 * `scripts/verify-connections.ts` ile doğrulanabiliyor. Depolamayla konuşan
 * kısım `scrobbleQueue.ts` içinde.
 */

/** Tek bir kaydın sınırı: Android AsyncStorage tek değer sınırına yaklaşmayalım. */
export const QUEUE_MAX_ENTRIES = 200;
/** Bir haftadan eski dinlemeler artık gönderilmez (servisler de kabul etmez). */
export const QUEUE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Artan aralıklı yeniden deneme: 30 sn → 2 dk → 10 dk → 30 dk (sonrası 30 dk). */
export const RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 1_800_000] as const;

/** Deneme sayısına göre bir sonraki deneme gecikmesi. */
export function retryDelayMs(attempts: number): number {
  const index = Math.min(Math.max(attempts - 1, 0), RETRY_DELAYS_MS.length - 1);
  return RETRY_DELAYS_MS[index];
}

/**
 * Süresi dolmuş ve sınırı aşan kayıtları temizler.
 *
 * Önce TTL uygulanır, sonra en yeni `QUEUE_MAX_ENTRIES` kayıt tutulur; böylece
 * kuyruk hiçbir zaman şişmez.
 */
export function pruneQueue(entries: ScrobbleEntry[], now: number): ScrobbleEntry[] {
  const fresh = entries.filter((entry) => now - entry.createdAt < QUEUE_TTL_MS);
  if (fresh.length <= QUEUE_MAX_ENTRIES) return fresh;
  return fresh.slice(fresh.length - QUEUE_MAX_ENTRIES);
}

/** Kuyruğa yeni kayıt ekler (aynı hedef+parça+zaman için tekrar eklemez). */
export function enqueueEntry(
  entries: ScrobbleEntry[],
  entry: ScrobbleEntry,
  now: number
): ScrobbleEntry[] {
  const duplicate = entries.some(
    (existing) =>
      existing.target === entry.target &&
      existing.track === entry.track &&
      existing.artist === entry.artist &&
      Math.abs(existing.startedAt - entry.startedAt) < 1
  );
  if (duplicate) return entries;
  return pruneQueue([...entries, entry], now);
}

/** Gönderilmeye hazır kayıtlar (hedefe göre, eskiden yeniye). */
export function dueEntries(
  entries: ScrobbleEntry[],
  target: ScrobbleTarget,
  now: number
): ScrobbleEntry[] {
  return entries
    .filter((entry) => entry.target === target && entry.nextAttemptAt <= now)
    .sort((a, b) => a.startedAt - b.startedAt);
}

let idCounter = 0;

/** Kuyruk kimliği: hedef + zaman + sayaç (deterministik ve çakışmasız). */
export function createEntryId(target: ScrobbleTarget, startedAt: number): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return `${target}-${startedAt}-${idCounter}`;
}
