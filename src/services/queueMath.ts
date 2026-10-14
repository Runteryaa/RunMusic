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
 * Akıllı Karıştırma (Smart Shuffle):
 * 1. Sanatçı Ayrıştırması: Aynı sanatçının şarkılarının arka arkaya gelmesini önler
 *    (araya en az 2 farklı sanatçı yerleştirilmeye çalışılır).
 * 2. Dinleme Geçmişi Ağırlığı: Çok dinlenen parçalara kontrollü bir öncelik verir.
 * 3. Keşif Dengesi: Hiç dinlenmemiş veya az dinlenmiş parçaları da aralara serpiştirir.
 * 4. Kütüphanede tek sanatçı veya az sanatçı varsa sonsuz döngüye girmeden
 *    kısıtları esnetir (graceful fallback).
 */
export function smartShuffleArray<T extends QueueTrackLike>(
  input: T[],
  options?: {
    playCounts?: Record<string, number>;
    getArtist?: (track: T) => string | undefined;
  }
): T[] {
  if (input.length <= 2) {
    return shuffleArray(input);
  }

  const playCounts = options?.playCounts ?? {};
  const getArtist =
    options?.getArtist ?? ((t: T) => t.artist || (t as any).artistName || '');

  // 1. Ağırlıklı skorlama ile adayları zenginleştir
  interface ScoredCandidate {
    track: T;
    artist: string;
    score: number;
    playCount: number;
  }

  const scored: ScoredCandidate[] = input.map((track) => {
    const key = trackKey(track);
    const count = playCounts[key] || 0;
    const rawArtist = (getArtist(track) || '').trim().toLowerCase();

    // count > 0 ise dinleme sayısı logaritmik olarak katkı sağlar (1.0 .. 2.2).
    // count === 0 ise keşif dengesi olarak 1.15 verilir.
    let weight = 1.0;
    if (count > 0) {
      weight = 1.0 + Math.min(Math.log2(count + 1) * 0.35, 1.2);
    } else {
      weight = 1.15;
    }

    const r = Math.max(0.0001, Math.random());
    const score = Math.pow(r, 1 / weight);

    return {
      track,
      artist: rawArtist,
      score,
      playCount: count,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  // 2. Sanatçı Ayrıştırması (Artist De-clustering / Spacing)
  const result: T[] = [];
  const pool = [...scored];
  const recentArtists: string[] = [];

  while (pool.length > 0) {
    let chosenIndex = -1;

    // Önce son 2 sanatçıyla çakışmayan en yüksek skorlu adayı bul
    for (let i = 0; i < pool.length; i++) {
      const candidateArtist = pool[i].artist;
      if (!candidateArtist || !recentArtists.includes(candidateArtist)) {
        chosenIndex = i;
        break;
      }
    }

    // Bulunamadıysa son 1 sanatçıyla çakışmayanı dene
    if (chosenIndex === -1 && recentArtists.length > 0) {
      const lastArtist = recentArtists[recentArtists.length - 1];
      for (let i = 0; i < pool.length; i++) {
        const candidateArtist = pool[i].artist;
        if (!candidateArtist || candidateArtist !== lastArtist) {
          chosenIndex = i;
          break;
        }
      }
    }

    // Kütüphanede tek sanatçı kaldıysa ilk adayı al
    if (chosenIndex === -1) {
      chosenIndex = 0;
    }

    const [selected] = pool.splice(chosenIndex, 1);
    result.push(selected.track);

    if (selected.artist) {
      recentArtists.push(selected.artist);
      if (recentArtists.length > 2) {
        recentArtists.shift();
      }
    } else {
      recentArtists.length = 0;
    }
  }

  return result;
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
  upNextIds: string[],
  playedHistory?: T[]
): QueueSections<T> {
  const pending = new Set(upNextIds);

  const current =
    activeIndex >= 0 && activeIndex < queue.length
      ? { index: activeIndex, track: queue[activeIndex] }
      : null;

  // Geçmiş: Gerçek dinleme geçmişi sağlandıysa, dinlenme sırasına göre (eskiden yeniye).
  // Sağlanmadıysa (fallback), geriye dönük uyumluluk için activeIndex'ten önceki parçalar.
  const history: QueueEntry<T>[] = [];
  if (Array.isArray(playedHistory)) {
    const queueIndexMap = new Map<string, number>();
    queue.forEach((t, i) => {
      const k = trackKey(t);
      if (k && !queueIndexMap.has(k)) {
        queueIndexMap.set(k, i);
      }
    });

    const currentKey = current ? trackKey(current.track) : '';

    for (let i = 0; i < playedHistory.length; i++) {
      const t = playedHistory[i];
      const k = trackKey(t);
      if (k && k === currentKey) continue;
      const idx = queueIndexMap.get(k) ?? i;
      history.push({ index: idx, track: t });
    }
  } else if (current) {
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
export function buildPlayOrder(
  contextIds: string[],
  startId: string,
  shuffle: boolean,
  options?: {
    smartShuffle?: boolean;
    playCounts?: Record<string, number>;
    getArtist?: (id: string) => string | undefined;
  }
): string[] {
  // Başlangıç parçası bağlamda yoksa (ya da bağlam boşsa) UYDURMA GİRDİ
  // eklemeyiz; yalnızca bağlamın kendisini döndürürüz. Aksi halde kuyruğa
  // var olmayan bir kimlik (ör. boş string) sızıyordu.
  if (!startId || !contextIds.includes(startId)) {
    if (!shuffle) return contextIds;
    if (options?.smartShuffle) {
      const items = contextIds.map((id) => ({ id }));
      return smartShuffleArray(items, {
        playCounts: options.playCounts,
        getArtist: (t) => options.getArtist?.(t.id),
      }).map((t) => t.id);
    }
    return shuffleArray(contextIds);
  }
  if (!shuffle) return contextIds;

  const rest = contextIds.filter((id) => id !== startId);
  if (options?.smartShuffle) {
    const items = rest.map((id) => ({ id }));
    const shuffledRest = smartShuffleArray(items, {
      playCounts: options.playCounts,
      getArtist: (t) => options.getArtist?.(t.id),
    }).map((t) => t.id);
    return [startId, ...shuffledRest];
  }

  return [startId, ...shuffleArray(rest)];
}

/**
 * Shuffle aç/kapat sırasında "sıradaki" bölümün yeni sırasını hesaplar.
 *
 * Kritik nokta: KARIŞTIRMAK için orijinal kütüphane sırasına (`contextIds`)
 * GEREK YOKTUR — mevcut bağlamı karıştırmak yeterlidir. Orijinal sıra yalnızca
 * shuffle KAPATILIRKEN, eski düzene dönebilmek için gerekir. Bu ayrım
 * yapılmadığında (eski davranış) shuffle yalnızca bayrağı değiştiriyor, sıra
 * liste düzeninde kalıyordu.
 *
 * Her durumda manuel "Sırada" öğeleri bağlamın ÖNÜNDE kalır.
 */
export function computeUpcomingOrder<T extends QueueTrackLike>(params: {
  enabled: boolean;
  upNextTracks: T[];
  upcomingContext: T[];
  /** Kaydedilmiş orijinal kütüphane sırası; bilinmiyorsa boş. */
  contextIds: string[];
  /** Orijinal sıra yoksa taban kabul edilecek tam kuyruk. */
  fullQueue: T[];
  smartShuffle?: boolean;
  playCounts?: Record<string, number>;
  getArtist?: (track: T) => string | undefined;
}): { upcoming: T[]; baselineIds: string[] | null } {
  const {
    enabled,
    upNextTracks,
    upcomingContext,
    contextIds,
    fullQueue,
    smartShuffle = false,
    playCounts,
    getArtist,
  } = params;

  if (enabled) {
    const baselineIds = contextIds.length === 0 ? fullQueue.map((t) => trackKey(t)) : null;
    const shuffledContext = smartShuffle
      ? smartShuffleArray(upcomingContext, { playCounts, getArtist })
      : shuffleArray(upcomingContext);
    return { upcoming: [...upNextTracks, ...shuffledContext], baselineIds };
  }

  if (contextIds.length > 0) {
    const contextOrder = new Map(contextIds.map((id, i) => [id, i]));
    const orderedContext = [...upcomingContext].sort(
      (a, b) => (contextOrder.get(trackKey(a)) ?? 0) - (contextOrder.get(trackKey(b)) ?? 0)
    );
    return { upcoming: [...upNextTracks, ...orderedContext], baselineIds: null };
  }

  // Orijinal sıra yok: mevcut sırayı koru, çalma bozulmasın.
  return { upcoming: [...upNextTracks, ...upcomingContext], baselineIds: null };
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
  | { kind: 'history'; key: string; entry: QueueEntry<T>; historyIndex: number }
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
export interface QueueSectionLabels {
  history?: string;
  smartShuffle?: string;
  shuffle?: string;
  upcoming?: string;
}

export function buildQueueRows<T extends QueueTrackLike>(
  sections: QueueSections<T> | null,
  upNextCount: number,
  isShuffle: boolean,
  isSmartShuffle?: boolean,
  sectionLabels?: QueueSectionLabels
): QueueRow<T>[] {
  if (!sections) return [];
  const rows: QueueRow<T>[] = [];

  if (sections.history.length > 0) {
    const historyPrefix = sectionLabels?.history || 'ÖNCEDEN ÇALINAN';
    rows.push({
      kind: 'section',
      key: 'sec-history',
      title: `${historyPrefix} · ${sections.history.length}`,
    });
    for (let i = 0; i < sections.history.length; i++) {
      const entry = sections.history[i];
      rows.push({
        kind: 'history',
        key: `hist-${i}-${trackKey(entry.track)}`,
        entry,
        historyIndex: i,
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
    let contextTitle: string;
    if (isShuffle && isSmartShuffle) {
      const prefix = sectionLabels?.smartShuffle || 'AKILLI KARIŞIK';
      contextTitle = `${prefix} · ${sections.context.length}`;
    } else if (isShuffle) {
      const prefix = sectionLabels?.shuffle || 'KÜTÜPHANEDEN · KARIŞIK';
      contextTitle = `${prefix} · ${sections.context.length}`;
    } else {
      const prefix = sectionLabels?.upcoming || 'KÜTÜPHANEDEN SIRADAKİ';
      contextTitle = `${prefix} · ${sections.context.length}`;
    }

    rows.push({
      kind: 'section',
      key: 'sec-context',
      title: contextTitle,
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
