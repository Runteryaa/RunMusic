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
  /** Mevcut parçadan ÖNCE çalınmış parçalar (eskiden yeniye doğru). */
  history: QueueEntry<T>[];
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
 * `activeIndex` mevcut parçayı belirtir. Ondan ÖNCEKİ parçalar `history`
 * (eskiden yeniye), SONRAKİLER ise `upNext` / `context` olarak döner. Bu sayede
 * parça çalındıkça (indeks ilerledikçe) tüketilen manuel öğe kendiliğinden
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

  // Geçmiş: en eskiden en yeniye. Kullanıcı yukarı kaydırdığında hemen üstünde
  // bir önceki parçayı görsün diye artan indeks sırasında tutulur.
  // Mevcut parça geçerli değilse (indeks aralık dışı) geçmiş de boş kalır.
  const history: QueueEntry<T>[] = [];
  if (current) {
    for (let i = 0; i < activeIndex; i++) {
      history.push({ index: i, track: queue[i] });
    }
  }

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

  return { history, current, upNext, context };
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

/**
 * Kuyruk panelindeki tek bir satır.
 *
 * Dört bölüm (geçmiş / şu an / sırada / kütüphaneden) TEK bir düz listeye
 * çevrilir; böylece FlatList hepsini birlikte sanallaştırır. Geçmişi listenin
 * başlığına koysaydık sanallaştırma dışında kalır ve yüzlerce satır aynı anda
 * çizilirdi.
 */
export type QueueRow<T> =
  | { kind: 'section'; key: string; title: string }
  | { kind: 'history'; key: string; entry: QueueEntry<T> }
  | { kind: 'current'; key: string; entry: QueueEntry<T> }
  | { kind: 'upnext'; key: string }
  | { kind: 'context'; key: string; entry: QueueEntry<T> };

/**
 * Bölümleri tek bir sanallaştırılabilir satır dizisine çevirir (saf fonksiyon).
 *
 * Sıra: ÖNCEDEN ÇALINAN (eskiden yeniye) → ŞU AN ÇALIYOR → SIRADA → KÜTÜPHANEDEN.
 * Kullanıcı yukarı kaydırdığında çalınmış parçaları, aşağı kaydırdığında
 * sıradakileri görür.
 */
export function buildQueueRows<T extends QueueTrackLike>(
  sections: QueueSections<T> | null,
  upNextCount: number,
  isShuffle: boolean
): QueueRow<T>[] {
  if (!sections) return [];
  const rows: QueueRow<T>[] = [];

  if (sections.history.length > 0) {
    rows.push({
      kind: 'section',
      key: 'sec-history',
      title: `ÖNCEDEN ÇALINAN · ${sections.history.length}`,
    });
    for (const entry of sections.history) {
      rows.push({
        kind: 'history',
        key: `hist-${entry.index}-${trackKey(entry.track)}`,
        entry,
      });
    }
  }

  if (sections.current) {
    rows.push({ kind: 'current', key: 'current', entry: sections.current });
  }

  if (upNextCount > 0) {
    rows.push({ kind: 'upnext', key: 'upnext' });
  }

  if (sections.context.length > 0) {
    rows.push({
      kind: 'section',
      key: 'sec-context',
      title: isShuffle
        ? `KÜTÜPHANEDEN · KARIŞIK · ${sections.context.length}`
        : `KÜTÜPHANEDEN SIRADAKİ · ${sections.context.length}`,
    });
    for (const entry of sections.context) {
      rows.push({
        kind: 'context',
        key: `ctx-${entry.index}-${trackKey(entry.track)}`,
        entry,
      });
    }
  }

  return rows;
}
