/**
 * Kuyruk matematiği — SAF (native bağımlılığı olmayan) mantık.
 *
 * Bu dosya bilinçli olarak TrackPlayer/React Native import ETMEZ; böylece kuyruk
 * bölümlemesi ve shuffle permütasyonu Node üzerinde doğrudan test edilebilir
 * (bkz. scripts/verify-queue-logic.ts).
 */

/** Kuyruk matematiğinin ihtiyaç duyduğu asgari parça şekli. */
export interface QueueTrackLike {
  id?: string;
  url?: string;
  title?: string;
  artist?: string;
  artwork?: unknown;
}

export interface QueueEntry<T> {
  /** TrackPlayer kuyruğundaki MUTLAK indeks. */
  index: number;
  track: T;
}

export interface QueueSections<T> {
  current: QueueEntry<T> | null;
  /** Manuel "Sırada" öğeleri (kütüphane bağlamından önce çalınır). */
  upNext: QueueEntry<T>[];
  /** Kütüphane bağlamından sıradaki parçalar. */
  context: QueueEntry<T>[];
}

/** Bir parçanın kuyruk kimliği (id varsa id, yoksa url). */
export function trackKey(track: QueueTrackLike | null | undefined): string {
  if (!track) return '';
  return String(track.id ?? track.url ?? '');
}

/** Fisher-Yates: adil, tekrarsız ve girdiyi değiştirmeyen permütasyon. */
export function shuffleArray<T>(input: T[]): T[] {
  const out = [...input];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Kuyruğu bölümlere ayırır.
 *
 * Aynı parça hem manuel kuyrukta hem bağlamda bulunabilir (kullanıcı, kütüphanede
 * zaten sırada olan bir şarkıyı "şimdi çal" ile öne almış olabilir). Bu durumda
 * şu ana EN YAKIN eşleşme manuel sayılır; sonraki kopya bağlama bırakılır.
 *
 * `activeIndex` mevcut parçayı belirtir; yalnızca ONDAN SONRAKİ öğeler listelenir.
 * Bu sayede parça çalındıkça (indeks ilerledikçe) tüketilen manuel öğe kendiliğinden
 * listeden düşer; geri gidildiğinde ise yeniden görünür.
 */
export function deriveQueueSections<T extends QueueTrackLike>(
  queue: T[],
  activeIndex: number,
  upNextIds: string[]
): QueueSections<T> {
  const pending = new Set(upNextIds);

  const current =
    activeIndex >= 0 && activeIndex < queue.length
      ? { index: activeIndex, track: queue[activeIndex] }
      : null;

  const upNext: QueueEntry<T>[] = [];
  const context: QueueEntry<T>[] = [];

  for (let i = activeIndex + 1; i < queue.length; i++) {
    const key = trackKey(queue[i]);
    if (pending.has(key)) {
      pending.delete(key);
      upNext.push({ index: i, track: queue[i] });
    } else {
      context.push({ index: i, track: queue[i] });
    }
  }

  return { current, upNext, context };
}

/**
 * Çalma sırasını üretir.
 *
 * Shuffle kapalıyken bağlamın kendi sırası korunur. Shuffle açıkken hedef parça
 * ilk sıraya alınır ve KALANI bir kez karıştırılır; böylece sıra sabit kalır
 * (her "sonraki"de yeniden rastgele seçim yapılmaz).
 */
export function buildPlayOrder(contextIds: string[], startId: string, shuffle: boolean): string[] {
  if (!shuffle) return contextIds;
  const rest = contextIds.filter((id) => id !== startId);
  return [startId, ...shuffleArray(rest)];
}
