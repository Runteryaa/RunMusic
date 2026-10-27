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
export function shuffleArray<T>(input: T[], random: () => number = Math.random): T[] {
  const out = [...input];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Dört durumlu oynatma modu; UI ve remote aynı modeli kullanır. */
export type PlaybackMode = 'repeat-all' | 'shuffle' | 'smart' | 'repeat-one';

export const PLAYBACK_MODE_ORDER: readonly PlaybackMode[] = [
  'repeat-all',
  'shuffle',
  'smart',
  'repeat-one',
];

export function getPlaybackMode(params: {
  isShuffle: boolean;
  isSmartShuffle: boolean;
  isRepeatOne: boolean;
}): PlaybackMode {
  if (params.isRepeatOne) return 'repeat-one';
  if (params.isShuffle) return params.isSmartShuffle ? 'smart' : 'shuffle';
  return 'repeat-all';
}

export function nextPlaybackMode(mode: PlaybackMode): PlaybackMode {
  const index = PLAYBACK_MODE_ORDER.indexOf(mode);
  return PLAYBACK_MODE_ORDER[(index + 1) % PLAYBACK_MODE_ORDER.length];
}

const UNKNOWN_ARTIST_KEY = '\u0000runmusic_unknown_artist';

/** Sanatçı adını karşılaştırılabilir hale getirir; boş/yer tutucu adları gruplar. */
function normalizeArtistName(value: string | undefined): string {
  const artist = (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (
    !artist ||
    artist === 'unknown artist' ||
    artist === 'unknown' ||
    artist === 'bilinmeyen sanatçı' ||
    artist === 'bilinmeyen sanatci' ||
    artist === 'local audio'
  ) {
    return UNKNOWN_ARTIST_KEY;
  }
  return artist;
}

function findArtistSafeIndex<T extends QueueTrackLike>(
  pool: { track: T; artist: string }[],
  recentArtists: string[]
): number {
  for (let i = 0; i < pool.length; i++) {
    if (!recentArtists.includes(pool[i].artist)) return i;
  }
  return -1;
}

/**
 * Akıllı Karıştırma (Smart Shuffle):
 * 1. Sanatçı Ayrıştırması: Aynı sanatçının şarkılarının arka arkaya gelmesini önler
 *    (araya en az 2 farklı sanatçı yerleştirilmeye çalışılır). Çalan şarkının
 *    sanatçısı `seedArtists` ile verilirse sıradaki ilk şarkı da aynı sanatçıdan
 *    seçilmez.
 * 2. Dinleme Dengesi: Çok çalınan ve az çalınan parçalar iki havuza ayrılır;
 *    sıra bu iki havuzdan dönüşümlü seçilerek oluşturulur. Böylece popüler
 *    parçalar listenin başına yığılmaz, keşif parçaları aralara serpilir.
 * 3. Kütüphanede tek sanatçı veya az sanatçı varsa sonsuz döngüye girmeden
 *    kısıtları esnetir (graceful fallback).
 */
export function smartShuffleArray<T extends QueueTrackLike>(
  input: T[],
  options?: {
    playCounts?: Record<string, number>;
    getArtist?: (track: T) => string | undefined;
    /** Çalan/son çalınan parçaların sanatçıları; ilk seçimde çakışmayı önler. */
    seedArtists?: string[];
    /** Çalan parçanın dinlenme sayısı; ilk havuzu dengeler. */
    seedPlayCount?: number;
    /** Testlerde deterministik sonuç için enjekte edilebilir. */
    random?: () => number;
  }
): T[] {
  if (input.length <= 1) return [...input];

  const playCounts = options?.playCounts ?? {};
  const getArtist =
    options?.getArtist ?? ((t: T) => t.artist || (t as any).artistName || '');
  const random = options?.random ?? Math.random;

  interface Candidate {
    track: T;
    artist: string;
    playCount: number;
  }

  const candidates: Candidate[] = input.map((track) => ({
    track,
    artist: normalizeArtistName(getArtist(track)),
    playCount: playCounts[trackKey(track)] || 0,
  }));

  const counts = candidates.map((c) => c.playCount).sort((a, b) => a - b);
  const hasVariation = counts[0] !== counts[counts.length - 1];
  const mid = Math.floor(counts.length / 2);
  const median =
    counts.length % 2 === 0 ? (counts[mid - 1] + counts[mid]) / 2 : counts[mid];

  const rare = hasVariation
    ? shuffleArray(candidates.filter((c) => c.playCount <= median), random)
    : shuffleArray(candidates, random);
  const frequent = hasVariation
    ? shuffleArray(candidates.filter((c) => c.playCount > median), random)
    : [];

  const recentArtists: string[] = [];
  for (const artist of options?.seedArtists ?? []) {
    const normalized = normalizeArtistName(artist);
    if (normalized && !recentArtists.includes(normalized)) {
      recentArtists.push(normalized);
    }
  }
  if (recentArtists.length > 2) {
    recentArtists.splice(0, recentArtists.length - 2);
  }

  const result: T[] = [];
  let preferRare = true;
  if (hasVariation && options?.seedPlayCount !== undefined) {
    // Çalan parça sık dinleniyorsa nadir, nadir dinleniyorsa sık havuzuyla başla.
    preferRare = options.seedPlayCount > median;
  }

  const takeSafe = (pool: Candidate[]): Candidate | null => {
    if (pool.length === 0) return null;
    const index = findArtistSafeIndex(pool, recentArtists);
    if (index < 0) return null;
    return pool.splice(index, 1)[0];
  };

  while (rare.length > 0 || frequent.length > 0) {
    const preferred = preferRare ? rare : frequent;
    const fallback = preferRare ? frequent : rare;

    const selected =
      takeSafe(preferred) ?? takeSafe(fallback) ?? preferred.shift() ?? fallback.shift();
    if (!selected) break;

    result.push(selected.track);
    recentArtists.push(selected.artist);
    if (recentArtists.length > 2) recentArtists.shift();
    preferRare = !preferRare;
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
  playedHistory?: T[],
  activeTrackKey?: string
): QueueSections<T> {
  let resolvedIndex = activeIndex;
  if (activeTrackKey) {
    const foundIdx = queue.findIndex((t) => trackKey(t) === activeTrackKey);
    if (foundIdx >= 0) {
      resolvedIndex = foundIdx;
    }
  }

  const pending = new Set(upNextIds);

  const current =
    resolvedIndex >= 0 && resolvedIndex < queue.length
      ? { index: resolvedIndex, track: queue[resolvedIndex] }
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
    for (let i = 0; i < resolvedIndex; i++) {
      history.push({ index: i, track: queue[i] });
    }
  }

  const upNext: QueueEntry<T>[] = [];
  const context: QueueEntry<T>[] = [];

  for (let i = resolvedIndex + 1; i < queue.length; i++) {
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
 * Verilen kuyrukta, belirtilen geçerli indeksten sonraki ilk çalınabilir parçanın indeksini bulur.
 * Çalınamaz parçalar listesinde olan öğeleri atlar.
 *
 * isQueueRepeat: true ise (RepeatMode.Queue) kuyruk sonuna gelindiğinde başa sararak (modulo) arar.
 * isQueueRepeat: false ise (RepeatMode.Off / RepeatMode.Track) yalnızca ileriye doğru arar.
 *
 * Eğer kuyruktaki tüm parçalar çalınamaz durumdaysa veya ileriye doğru başka çalınabilir parça kalmadıysa -1 döner.
 */
export function findNextPlayableIndex<T extends QueueTrackLike>(
  queue: T[],
  currentIndex: number,
  isUnplayable: (track: T) => boolean,
  isQueueRepeat: boolean = false
): number {
  if (!queue || queue.length === 0) return -1;
  const len = queue.length;

  if (isQueueRepeat) {
    for (let offset = 1; offset < len; offset++) {
      const idx = (currentIndex + offset) % len;
      if (!isUnplayable(queue[idx])) {
        return idx;
      }
    }
  } else {
    for (let idx = Math.max(0, currentIndex + 1); idx < len; idx++) {
      if (!isUnplayable(queue[idx])) {
        return idx;
      }
    }
  }

  return -1;
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
    /** Çalan şarkının sanatçısı; akıllı sıranın ilk parçasını ayrıştırır. */
    seedArtists?: string[];
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
        seedArtists: options.seedArtists,
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
      seedArtists: options.seedArtists,
      seedPlayCount: options.playCounts?.[startId],
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
  seedArtists?: string[];
  seedPlayCount?: number;
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
    seedArtists,
    seedPlayCount,
  } = params;

  if (enabled) {
    const baselineIds = contextIds.length === 0 ? fullQueue.map((t) => trackKey(t)) : null;
    const shuffledContext = smartShuffle
      ? smartShuffleArray(upcomingContext, {
          playCounts,
          getArtist,
          seedArtists,
          seedPlayCount,
        })
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
    rows.push({
      kind: 'current',
      key: `current-${trackKey(sections.current.track)}-${sections.current.index}`,
      entry: sections.current,
    });
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

export interface ReorderQueueResult<T> {
  newQueue: T[];
  newStartIndex: number;
  newUpNextIds: string[];
}

/**
 * Kuyruk içinden bir parça seçildiğinde (dokunulduğunda) kuyruk düzenini ve
 * öncelikli sırayı (Up Next) yeniden düzenler.
 *
 * Spotify / Apple Music davranışı:
 * - Eğer kullanıcı "Öncelikli Sıra"da bekleyen parçalar varken "Önceliksiz Sıra"dan
 *   (bağlam/kütüphane) bir parçayı doğrudan başlatırsa:
 *   Öncelikli parçalar kaybolmaz veya geçmişte kalmaz; başlatılan yeni parçanın
 *   HEMEN ARDINA taşınırlar. Böylece çalan parça bittiğinde veya skiplendiğinde
 *   öncelikli sıra çalmaya devam eder.
 * - Eğer dokunulan parça zaten Öncelikli Sıra içindeyse, parça çalınır ve öncelikli
 *   listeden tüketilir.
 * - `clearOnSelect` true ise (kullanıcı tercihi), öncelikli sıra temizlenir.
 */
export function reorderQueueOnTrackSelect<T extends QueueTrackLike>(params: {
  queue: T[];
  targetIndex: number;
  upNextIds: string[];
  clearOnSelect?: boolean;
}): ReorderQueueResult<T> {
  const { queue, targetIndex, upNextIds, clearOnSelect = false } = params;

  if (targetIndex < 0 || targetIndex >= queue.length) {
    return {
      newQueue: [...queue],
      newStartIndex: Math.max(0, targetIndex),
      newUpNextIds: [...upNextIds],
    };
  }

  const targetTrack = queue[targetIndex];
  const targetKey = trackKey(targetTrack);

  // 1. Öncelikli sıra boşsa veya kullanıcı tercihi parçaya dokununca sırayı temizlemek ise
  if (clearOnSelect || upNextIds.length === 0) {
    return {
      newQueue: [...queue],
      newStartIndex: targetIndex,
      newUpNextIds: clearOnSelect ? [] : [...upNextIds],
    };
  }

  const upNextSet = new Set(upNextIds);

  // 2. Dokunulan parça zaten Öncelikli Sıra (upNext) içindeyse
  if (upNextSet.has(targetKey)) {
    const newUpNextIds = upNextIds.filter((id) => id !== targetKey);
    return {
      newQueue: [...queue],
      newStartIndex: targetIndex,
      newUpNextIds,
    };
  }

  // 3. Dokunulan parça Önceliksiz Sıra (bağlam/kütüphane) içindeyse:
  // Mevcut kuyruktaki öncelikli parçaları upNextIds sırasına göre topla
  const trackMap = new Map<string, T>();
  for (const t of queue) {
    const k = trackKey(t);
    if (k && upNextSet.has(k) && !trackMap.has(k)) {
      trackMap.set(k, t);
    }
  }

  const preservedUpNextTracks = upNextIds
    .map((id) => trackMap.get(id))
    .filter((t): t is T => Boolean(t) && trackKey(t) !== targetKey);

  if (preservedUpNextTracks.length === 0) {
    return {
      newQueue: [...queue],
      newStartIndex: targetIndex,
      newUpNextIds: [],
    };
  }

  // Öncelikli parçaları mevcut kuyruktan ayıkla
  const nonUpNextTracks = queue.filter((t) => !upNextSet.has(trackKey(t)));
  const targetInNonUpNext = nonUpNextTracks.findIndex((t) => trackKey(t) === targetKey);

  if (targetInNonUpNext < 0) {
    return {
      newQueue: [...queue],
      newStartIndex: targetIndex,
      newUpNextIds: [...upNextIds],
    };
  }

  const before = nonUpNextTracks.slice(0, targetInNonUpNext + 1);
  const after = nonUpNextTracks.slice(targetInNonUpNext + 1);

  const newQueue = [...before, ...preservedUpNextTracks, ...after];
  const newStartIndex = targetInNonUpNext;

  return {
    newQueue,
    newStartIndex,
    newUpNextIds: preservedUpNextTracks.map((t) => trackKey(t)),
  };
}

