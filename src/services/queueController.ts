import TrackPlayer, { State, Track, RepeatMode } from 'react-native-track-player';
import { useStore } from '../store/useStore';
import { useThemeStore } from '../store/useThemeStore';
import { useOptimisticPlayerStore } from '../store/useOptimisticPlayerStore';
import { saveQueueSnapshot } from './playbackStorage';
import { getPlayCountsMap } from './statsDatabase';
import {
  buildPlayOrder,
  buildQueueRows,
  computeUpcomingOrder,
  deriveQueueSections,
  findNextPlayableIndex,
  reorderQueueOnTrackSelect,
  shuffleArray,
  smartShuffleArray,
  trackKey,
  type QueueSections,
} from './queueMath';

// Saf kuyruk matematiği ayrı modülde yaşar (native'siz, test edilebilir);
// buradan yeniden dışa aktarılır ki çağıranlar tek yerden import etsin.
export {
  buildPlayOrder,
  buildQueueRows,
  computeUpcomingOrder,
  deriveQueueSections,
  findNextPlayableIndex,
  reorderQueueOnTrackSelect,
  shuffleArray,
  smartShuffleArray,
  trackKey,
};
export type {
  QueueEntry,
  QueueRow,
  QueueSections,
  QueueTrackLike,
  QueueSectionLabels,
  ReorderQueueResult,
} from './queueMath';

/**
 * Kuyruk yönetimi — Apple Music / Spotify semantiği.
 *
 * MODEL
 * -----
 * TrackPlayer kuyruğu, çalma sırasının TEK doğruluk kaynağıdır; böylece
 * bildirim, Bluetooth ve donanım tuşları (native next/prev) doğru çalışır.
 *
 * Kuyruk üç bölümden oluşur:
 *   1. Geçmiş + şu an çalan   (indeksler 0..activeIndex)
 *   2. "Sırada" (manuel)      (kullanıcının özellikle öne aldığı parçalar)
 *   3. Bağlam (kütüphane)     (kalan parçalar, kütüphane sırasında)
 *
 * `useStore.upNextIds` yalnızca 2. bölümün kimliklerini, çalınma sırasına göre
 * tutar. Bölümler kuyruktan HER ZAMAN yeniden türetilir; ayrı bir senkron
 * aboneliği gerekmez ve geri/ileri atlamalar kendiliğinden tutarlı kalır.
 *
 * Shuffle artık tek seferlik rastgele bir "sonraki" seçimi DEĞİL, bağlamın
 * kalıcı bir permütasyonudur: sıra bir kez karıştırılır, next/prev bu sırayı
 * izler ve shuffle kapatıldığında `contextIds` ile orijinal sıraya dönülür.
 */

export interface QueueTrack {
  id: string;
  url: string;
  title?: string;
  artist?: string;
  artwork?: string;
  duration?: number;
}

let isNavigatingHistory = false;
let isMutatingQueue = false;

export function getIsNavigatingHistory(): boolean {
  return isNavigatingHistory;
}

export function setIsNavigatingHistory(val: boolean): void {
  isNavigatingHistory = val;
}

export function getIsMutatingQueue(): boolean {
  return isMutatingQueue;
}

export function setIsMutatingQueue(val: boolean): void {
  isMutatingQueue = val;
}

/**
 * Dinlenen bir parçayı geçerli oturumun kuyruk geçmişine (`playedHistory`) ekler.
 * Yalnızca o oturumda dinlenen parçaları tutar, mükerrer peş peşe eklemeleri önler
 * ve son 20 parça ile sınırlıdır (sonsuza dek uzamaz).
 */
export function recordTrackToHistory(track: Track | QueueTrack | null | undefined): void {
  if (!track) return;
  const key = trackKey(track);
  if (!key) return;

  const current = useStore.getState().playedHistory;
  if (current.length > 0 && trackKey(current[current.length - 1]) === key) {
    return;
  }

  const item = {
    id: String(track.id ?? track.url ?? ''),
    url: String(track.url ?? ''),
    title: track.title,
    artist: track.artist,
    artwork: typeof track.artwork === 'string' ? track.artwork : undefined,
  };

  useStore.getState().addToPlayedHistory(item);
}

/**
 * Gerçek dinleme geçmişine göre önceki parçaya döner ("Previous" butonu).
 * - Eğer parça 3 saniyeden fazla çalmışsa başa sarar (Spotify standardı).
 * - Dinleme geçmişinde parça varsa en son dinlenene geri döner.
 * - Geçmiş boşsa başa sarar (sıradaki alakasız bir parçaya atlamaz).
 */
export async function skipToPreviousTrack(): Promise<void> {
  try {
    const { position } = await TrackPlayer.getProgress();
    if (position > 3) {
      await TrackPlayer.seekTo(0);
      return;
    }

    const playedHistory = useStore.getState().playedHistory;
    if (playedHistory.length === 0) {
      await TrackPlayer.seekTo(0);
      return;
    }

    const targetTrack = playedHistory[playedHistory.length - 1];
    const newHistory = playedHistory.slice(0, -1);

    isNavigatingHistory = true;
    useStore.getState().setPlayedHistory(newHistory);

    const queue = await TrackPlayer.getQueue();
    const targetKey = trackKey(targetTrack);
    const targetIndex = queue.findIndex((t) => trackKey(t) === targetKey);

    if (targetIndex >= 0) {
      await TrackPlayer.skip(targetIndex);
    } else {
      const rawActive = await TrackPlayer.getActiveTrackIndex();
      const active = typeof rawActive === 'number' && rawActive >= 0 ? rawActive : 0;
      await TrackPlayer.add(targetTrack as Track, active);
      await TrackPlayer.skip(active);
    }
    await TrackPlayer.play();
    await persistQueue();
  } catch (e) {
    console.warn('[queueController] skipToPreviousTrack error:', e);
    try {
      await TrackPlayer.skipToPrevious();
      await TrackPlayer.play();
    } catch {
      // ignore
    }
  } finally {
    setTimeout(() => {
      isNavigatingHistory = false;
    }, 600);
  }
}

/**
 * Kuyruk ekranındaki "ÖNCEDEN ÇALINAN" bölümünden bir parçaya dokunulduğunda çalışır.
 * Tıklanan parçaya döner ve geçmişi o noktaya kadar geri sarar.
 */
export async function playHistoryTrack(historyIndex: number, track?: Track | QueueTrack): Promise<void> {
  try {
    const currentHistory = useStore.getState().playedHistory;
    const targetTrack = track || currentHistory[historyIndex];
    if (!targetTrack) return;

    const newHistory = currentHistory.slice(0, historyIndex);

    isNavigatingHistory = true;
    useStore.getState().setPlayedHistory(newHistory);

    const queue = await TrackPlayer.getQueue();
    const targetKey = trackKey(targetTrack);
    const targetIndex = queue.findIndex((t) => trackKey(t) === targetKey);

    const allAssets = useStore.getState().allAssets;
    const canonicalId = resolveTrackId(targetTrack, allAssets);
    const meta =
      (canonicalId && useStore.getState().metadataMap[canonicalId]) ||
      useStore.getState().metadataMap[targetTrack.id];
    const art =
      meta?.artwork ||
      (canonicalId && useStore.getState().artworkMap[canonicalId]) ||
      useStore.getState().artworkMap[targetTrack.id] ||
      (typeof targetTrack.artwork === 'string' ? targetTrack.artwork : null);
    const summary = {
      id: canonicalId || targetTrack.id,
      title: meta?.title || targetTrack.title || 'Unknown Title',
      artist: meta?.artist || targetTrack.artist || 'Unknown Artist',
      duration: (targetTrack as any).duration || 0,
      hasArtwork: !!art,
    };
    useOptimisticPlayerStore.getState().setOptimisticTrack(summary, art);
    if (art && useStore.getState().preferences.dynamicColorFromArtwork) {
      useThemeStore.getState().updateThemeFromArtwork(art);
    }

    if (targetIndex >= 0) {
      await TrackPlayer.skip(targetIndex);
    } else {
      const rawActive = await TrackPlayer.getActiveTrackIndex();
      const active = typeof rawActive === 'number' && rawActive >= 0 ? rawActive : 0;
      await TrackPlayer.add(targetTrack as Track, active);
      await TrackPlayer.skip(active);
    }
    await TrackPlayer.play();
    await persistQueue();
  } catch (e) {
    console.warn('[queueController] playHistoryTrack error:', e);
  } finally {
    setTimeout(() => {
      isNavigatingHistory = false;
    }, 600);
  }
}

/** Kuyruk modelini diske yazar (yapısal değişikliklerden sonra çağrılır). */
async function persistQueue(): Promise<void> {
  const s = useStore.getState();
  await saveQueueSnapshot({
    upNextIds: s.upNextIds,
    contextIds: s.contextIds,
    isShuffle: s.isShuffle,
  });
  s.bumpQueueRevision();
}

async function readQueueState(): Promise<{ queue: Track[]; activeIndex: number; activeTrack: Track | null }> {
  const queue = await TrackPlayer.getQueue().catch(() => []);
  const activeTrack = await TrackPlayer.getActiveTrack().catch(() => null);
  let activeIndex = -1;
  if (activeTrack) {
    const aKey = trackKey(activeTrack);
    activeIndex = queue.findIndex((t) => trackKey(t) === aKey);
  }
  if (activeIndex < 0) {
    const rawIndex = await TrackPlayer.getActiveTrackIndex().catch(() => null);
    activeIndex = typeof rawIndex === 'number' && rawIndex >= 0 && rawIndex < queue.length ? rawIndex : 0;
  }
  return { queue, activeIndex, activeTrack: activeTrack ?? null };
}

export async function getQueueSections(): Promise<QueueSections<Track>> {
  const { queue, activeIndex, activeTrack } = await readQueueState();
  const playedHistory = useStore.getState().playedHistory;
  const activeKey = activeTrack ? trackKey(activeTrack) : undefined;
  return deriveQueueSections(
    queue,
    activeIndex,
    useStore.getState().upNextIds,
    playedHistory as any,
    activeKey
  );
}

/**
 * Kullanıcı kuyruk listesinden (veya kütüphanede zaten kuyrukta olan) bir parçaya
 * dokunduğunda o parçayı çalar.
 *
 * Eğer "Öncelikli Sıra"da bekleyen parçalar varken "Önceliksiz Sıra"dan bir parçaya
 * basıldıysa, öncelikli parçalar yeni parçanın hemen ardına taşınır (kaybolmaz).
 */
export async function playQueueTrack(
  queueIndex: number,
  trackId?: string
): Promise<void> {
  const queue = await TrackPlayer.getQueue().catch(() => []);
  if (queue.length === 0) return;

  let targetIndex = -1;
  if (trackId) {
    targetIndex = queue.findIndex(
      (t) => trackKey(t) === trackId || t.id === trackId || t.url === trackId
    );
  }
  if (targetIndex < 0 && queueIndex >= 0 && queueIndex < queue.length) {
    targetIndex = queueIndex;
  }
  if (targetIndex < 0 || targetIndex >= queue.length) return;

  const targetTrack = queue[targetIndex];
  if (!targetTrack) return;

  // Optimistik arayüz ve dinamik tema güncellemesi
  const allAssets = useStore.getState().allAssets;
  const canonicalId = resolveTrackId(targetTrack, allAssets);
  const meta =
    (canonicalId && useStore.getState().metadataMap[canonicalId]) ||
    useStore.getState().metadataMap[targetTrack.id];
  const art =
    meta?.artwork ||
    (canonicalId && useStore.getState().artworkMap[canonicalId]) ||
    useStore.getState().artworkMap[targetTrack.id] ||
    (typeof targetTrack.artwork === 'string' ? targetTrack.artwork : null);

  const summary = {
    id: canonicalId || targetTrack.id,
    title: meta?.title || targetTrack.title || 'Unknown Title',
    artist: meta?.artist || targetTrack.artist || 'Unknown Artist',
    duration: targetTrack.duration || 0,
    hasArtwork: !!art,
  };
  useOptimisticPlayerStore.getState().setOptimisticTrack(summary, art);
  if (art && useStore.getState().preferences.dynamicColorFromArtwork) {
    useThemeStore.getState().updateThemeFromArtwork(art);
  }

  // Doğrudan hedef parçaya atla ve çal (ses kesintisi ve setQueue sıfırlaması olmadan)
  await TrackPlayer.skip(targetIndex);
  await TrackPlayer.play();

  const currentUpNextIds = useStore.getState().upNextIds;
  const clearOnSelect = useStore.getState().preferences.clearQueueOnTrackSelect;
  const targetKey = trackKey(targetTrack);

  let newUpNext = currentUpNextIds.filter((id) => id !== targetKey);
  if (clearOnSelect) {
    newUpNext = [];
  }

  if (newUpNext.length > 0) {
    await syncUpcomingQueue(newUpNext);
  } else {
    useStore.getState().setUpNextIds([]);
    await persistQueue();
    useStore.getState().bumpQueueRevision();
  }
}

/** Kullanıcı kütüphaneden bir parçaya dokunduğunda kuyruğu kurar ve çalar. */
export async function startPlaybackFromLibrary(params: {
  tracks: QueueTrack[];
  startId: string;
  shuffle: boolean;
  smartShuffle?: boolean;
}): Promise<void> {
  const { tracks, startId, shuffle, smartShuffle = false } = params;
  const contextIds = tracks.map((t) => t.id);
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const metadataMap = useStore.getState().metadataMap;

  let playCounts: Record<string, number> | undefined;
  if (shuffle && smartShuffle) {
    try {
      playCounts = await getPlayCountsMap();
    } catch {
      // ignore
    }
  }

  const orderIds = buildPlayOrder(contextIds, startId, shuffle, {
    smartShuffle,
    playCounts,
    getArtist: (id) => metadataMap[id]?.artist || byId.get(id)?.artist,
  });
  const ordered = orderIds
    .map((id) => byId.get(id))
    .filter((t): t is QueueTrack => Boolean(t));

  const startIndex = Math.max(0, orderIds.indexOf(startId));
  const startTrack = ordered[startIndex];
  recordAttemptedTrack(startTrack, startIndex);

  if (startTrack) {
    const meta = metadataMap[startTrack.id];
    const art =
      meta?.artwork ||
      useStore.getState().artworkMap[startTrack.id] ||
      (typeof startTrack.artwork === 'string' ? startTrack.artwork : null);
    const summary = {
      id: startTrack.id,
      title: meta?.title || startTrack.title || 'Unknown Title',
      artist: meta?.artist || startTrack.artist || 'Unknown Artist',
      duration: startTrack.duration || 0,
      hasArtwork: !!art,
    };
    useOptimisticPlayerStore.getState().setOptimisticTrack(summary, art);
    if (art && useStore.getState().preferences.dynamicColorFromArtwork) {
      useThemeStore.getState().updateThemeFromArtwork(art);
    }
  }

  // Kullanıcının manuel olarak eklediği (Up Next) şarkıları koru
  const clearOnSelect = useStore.getState().preferences.clearQueueOnTrackSelect;
  const currentUpNextIds = useStore.getState().upNextIds;
  let preservedUpNextTracks: Track[] = [];

  if (!clearOnSelect && currentUpNextIds.length > 0) {
    try {
      const oldQueue = await TrackPlayer.getQueue().catch(() => []);
      const upNextSet = new Set(currentUpNextIds);
      const trackMap = new Map<string, Track>();
      for (const t of oldQueue) {
        const k = trackKey(t);
        if (k && upNextSet.has(k) && !trackMap.has(k)) {
          trackMap.set(k, t);
        }
      }
      for (const [id, t] of byId.entries()) {
        if (upNextSet.has(id) && !trackMap.has(id)) {
          trackMap.set(id, t as Track);
        }
      }
      const allAssets = useStore.getState().allAssets;
      for (const asset of allAssets) {
        if (upNextSet.has(asset.id) && !trackMap.has(asset.id)) {
          const meta = metadataMap[asset.id];
          trackMap.set(asset.id, {
            id: asset.id,
            url: asset.uri,
            title: meta?.title || asset.filename,
            artist: meta?.artist || 'Unknown Artist',
            artwork: meta?.artwork || useStore.getState().artworkMap[asset.id] || undefined,
            duration: asset.duration,
          } as Track);
        }
      }
      preservedUpNextTracks = currentUpNextIds
        .map((id) => trackMap.get(id))
        .filter((t): t is Track => Boolean(t) && trackKey(t) !== startId);
    } catch (e) {
      console.warn('[queueController] Failed to preserve existing upNext queue:', e);
    }
  }

  let finalQueue: Track[];
  let finalStartIndex: number;

  if (preservedUpNextTracks.length > 0) {
    const upNextKeys = new Set(preservedUpNextTracks.map((t) => trackKey(t)));
    if (shuffle) {
      // Karışık modda startTrack ilk sırada yer alır, ardına upNext eklenir
      const remainingContext = ordered
        .filter((t, idx) => idx !== startIndex && !upNextKeys.has(trackKey(t))) as Track[];
      finalQueue = [startTrack as Track, ...preservedUpNextTracks, ...remainingContext];
      finalStartIndex = 0;
    } else {
      // Doğrusal sırada context sırası korunur, upNext mevcut çalanın hemen ardına yerleşir
      const before = ordered
        .slice(0, startIndex + 1)
        .filter((t, idx) => idx === startIndex || !upNextKeys.has(trackKey(t))) as Track[];
      const after = ordered
        .slice(startIndex + 1)
        .filter((t) => !upNextKeys.has(trackKey(t))) as Track[];
      finalQueue = [...before, ...preservedUpNextTracks, ...after];
      finalStartIndex = finalQueue.findIndex((t) => trackKey(t) === startId);
      if (finalStartIndex < 0) {
        finalStartIndex = Math.max(0, before.length - 1);
      }
    }
  } else {
    finalQueue = ordered as Track[];
    finalStartIndex = startIndex;
  }

  const enrichedQueue = finalQueue.map((t) => {
    const k = trackKey(t);
    const meta = metadataMap[k];
    const art =
      meta?.artwork ||
      useStore.getState().artworkMap[k] ||
      (typeof t.artwork === 'string' ? t.artwork : undefined);
    return {
      ...t,
      title: meta?.title || t.title,
      artist: meta?.artist || t.artist,
      artwork: art,
    };
  });

  await TrackPlayer.setQueue(enrichedQueue);
  if (finalStartIndex > 0) {
    await TrackPlayer.skip(finalStartIndex);
  }
  try {
    await TrackPlayer.play();
  } catch (e) {
    console.warn('[queueController] startPlaybackFromLibrary play error:', e);
    await handlePlaybackError(e, startTrack, finalStartIndex);
  }

  // TEK `set`: zustand persist her set çağrısında TÜM store'u serileştirip
  // diske yazdığı için iki ayrı action çağırmak gereksiz iki yazım demekti.
  useStore.setState({
    contextIds,
    upNextIds: preservedUpNextTracks.map((t) => trackKey(t)),
    playedHistory: [],
    isShuffle: shuffle,
    isSmartShuffle: shuffle ? smartShuffle : false,
  });
  await persistQueue();
}


/**
 * Yerel oynatıcıdaki yaklaşan (upcoming) parçaları çalan parçayı durdurmadan
 * kesintisiz (gapless) olarak senkronize eder.
 *
 * 1. Öncelikli sıra (upNextIds) parçaları hemen çalan parçanın ardına dizilir.
 * 2. Kütüphane bağlamındaki (context) parçalar mükerrer olmayacak şekilde ardına eklenir.
 * 3. Çalan parça HİÇ DURMAZ, `removeUpcomingTracks` + `add` ile güncellenir.
 */
export async function syncUpcomingQueue(
  newUpNextIds: string[],
  extraTracks: Track[] = []
): Promise<void> {
  const { queue, activeIndex } = await readQueueState();
  if (queue.length === 0 || activeIndex < 0) {
    if (extraTracks.length > 0) {
      await TrackPlayer.add(extraTracks);
    }
    useStore.getState().setUpNextIds(newUpNextIds);
    await persistQueue();
    useStore.getState().bumpQueueRevision();
    return;
  }

  // Havuz: Mevcut kuyruktaki tüm parçalar + dışarıdan gelen parçalar
  const pool = new Map<string, Track>();
  for (const t of queue) {
    const k = trackKey(t);
    if (k && !pool.has(k)) pool.set(k, t);
  }
  for (const t of extraTracks) {
    const k = trackKey(t);
    if (k && !pool.has(k)) pool.set(k, t);
  }

  // Store'daki allAssets'tan da gerekirse tamamla
  const allAssets = useStore.getState().allAssets;
  const metadataMap = useStore.getState().metadataMap;
  const artworkMap = useStore.getState().artworkMap;

  const upNextTracks: Track[] = [];
  const validUpNextIds: string[] = [];
  for (const id of newUpNextIds) {
    let t = pool.get(id);
    if (!t) {
      const asset = allAssets.find((a) => a.id === id || a.uri === id);
      if (asset) {
        const meta = metadataMap[asset.id];
        t = {
          id: asset.id,
          url: asset.uri,
          title: meta?.title || asset.filename,
          artist: meta?.artist || 'Unknown Artist',
          artwork: meta?.artwork || artworkMap[asset.id] || undefined,
          duration: asset.duration,
        } as Track;
        pool.set(id, t);
      }
    }
    if (t) {
      upNextTracks.push(t);
      validUpNextIds.push(id);
    }
  }

  const upNextSet = new Set(validUpNextIds);
  const activeTrackKey = trackKey(queue[activeIndex]);

  // Mevcut çalan parçanın ardındaki kütüphane bağlamı parçaları
  // (Öncelikli sırada olanlar ve çalan parça elenir)
  const remainingContext: Track[] = [];
  const seenContext = new Set<string>();
  for (let i = activeIndex + 1; i < queue.length; i++) {
    const t = queue[i];
    const k = trackKey(t);
    if (k && !upNextSet.has(k) && k !== activeTrackKey && !seenContext.has(k)) {
      seenContext.add(k);
      remainingContext.push(t);
    }
  }

  const upcoming = [...upNextTracks, ...remainingContext];

  setIsMutatingQueue(true);
  try {
    await TrackPlayer.removeUpcomingTracks();
    if (upcoming.length > 0) {
      await TrackPlayer.add(upcoming);
    }
  } catch (err) {
    console.warn('[queueController] syncUpcomingQueue error:', err);
  } finally {
    setTimeout(() => {
      setIsMutatingQueue(false);
    }, 400);
  }

  useStore.getState().setUpNextIds(validUpNextIds);
  await persistQueue();
  useStore.getState().bumpQueueRevision();
}

async function insertManual(track: QueueTrack, position: 'next' | 'end'): Promise<void> {
  const key = trackKey(track);
  if (!key) return;

  const currentUpNext = useStore.getState().upNextIds;
  const remaining = currentUpNext.filter((id) => id !== key);
  const newUpNextIds = position === 'next' ? [key, ...remaining] : [...remaining, key];

  await syncUpcomingQueue(newUpNextIds, [track as Track]);
}

/** Şarkıyı hemen mevcut parçadan sonra çalar ("Play next"). */
export function playNext(track: QueueTrack): Promise<void> {
  return insertManual(track, 'next');
}

/** Şarkıyı manuel kuyruğun sonuna ekler (bağlamdan önce çalınır). */
export function addToQueue(track: QueueTrack): Promise<void> {
  return insertManual(track, 'end');
}

/**
 * Birden fazla parçayı (ör. eklentiden gelen şarkılar) yüksek öncelikli
 * "Sırada" bölümünün sonuna veya hemen ardına ekler.
 */
export async function addTracksToQueue(
  tracks: QueueTrack[],
  position: 'next' | 'end' = 'end'
): Promise<void> {
  if (!tracks || tracks.length === 0) return;
  const newKeys = tracks.map((t) => trackKey(t)).filter(Boolean);
  const currentUpNext = useStore.getState().upNextIds;
  const remaining = currentUpNext.filter((id) => !newKeys.includes(id));
  const newUpNextIds =
    position === 'next' ? [...newKeys, ...remaining] : [...remaining, ...newKeys];

  await syncUpcomingQueue(newUpNextIds, tracks as Track[]);
}

/**
 * Düşük öncelikli bağlam (kütüphane) listesindeki bir parçayı
 * yüksek öncelikli "Sırada" (Up Next) bölümünün sonuna taşır.
 */
export async function promoteContextTrackToUpNext(queueIndex: number, trackId?: string): Promise<void> {
  const { queue, activeIndex } = await readQueueState();
  let targetIndex = queueIndex;
  if (trackId) {
    const resolved = queue.findIndex(
      (t) => trackKey(t) === trackId || t.id === trackId || t.url === trackId
    );
    if (resolved >= 0) targetIndex = resolved;
  }
  if (targetIndex <= activeIndex || targetIndex >= queue.length) return;

  const targetTrack = queue[targetIndex];
  if (!targetTrack) return;

  const key = trackKey(targetTrack);
  const currentUpNext = useStore.getState().upNextIds;
  if (currentUpNext.includes(key)) return;

  const newUpNextIds = [...currentUpNext, key];
  await syncUpcomingQueue(newUpNextIds, [targetTrack]);
}

/**
 * Sıradaki bir öğeyi kuyruktan çıkarır ve `upNextIds`'i yeniden eşitler.
 * Yalnızca mevcut parçanın İLERİSİNDEKİ öğeler kaldırılabilir.
 */
export async function removeQueueItem(index: number, trackId?: string): Promise<void> {
  const { queue, activeIndex } = await readQueueState();
  let targetIndex = index;
  if (trackId) {
    const resolved = queue.findIndex(
      (t) => trackKey(t) === trackId || t.id === trackId || t.url === trackId
    );
    if (resolved >= 0) targetIndex = resolved;
  }
  if (targetIndex <= activeIndex || targetIndex >= queue.length) return;

  const targetTrack = queue[targetIndex];
  const key = targetTrack ? trackKey(targetTrack) : trackId;
  const currentUpNext = useStore.getState().upNextIds;
  const isUpNext = key && currentUpNext.includes(key);

  if (isUpNext && key) {
    const newUpNextIds = currentUpNext.filter((id) => id !== key);
    await syncUpcomingQueue(newUpNextIds);
  } else {
    setIsMutatingQueue(true);
    try {
      await TrackPlayer.remove(targetIndex);
      await persistQueue();
      useStore.getState().bumpQueueRevision();
    } catch (err) {
      console.warn('[queueController] removeQueueItem error:', err);
    } finally {
      setTimeout(() => {
        setIsMutatingQueue(false);
      }, 400);
    }
  }
}

/**
 * Manuel "Sırada" öğelerinin TAMAMINI kuyruktan çıkarır.
 */
export async function clearUpNextQueue(): Promise<void> {
  await syncUpcomingQueue([]);
  useStore.getState().clearUpNext();
}

/** "Sırada" bölümü içinde yeniden sıralama (indeksler bölüme görelidir). */
export async function moveUpNext(from: number, to: number): Promise<void> {
  const currentUpNextIds = [...useStore.getState().upNextIds];
  if (from < 0 || to < 0 || from >= currentUpNextIds.length || to >= currentUpNextIds.length) return;
  if (from === to) return;

  const [movedId] = currentUpNextIds.splice(from, 1);
  currentUpNextIds.splice(to, 0, movedId);

  await syncUpcomingQueue(currentUpNextIds);
}

/**
 * Shuffle'ı açar/kapatır.
 *
 * Sıra yeniden kurulurken geçmiş (0..activeIndex) KORUNUR, böylece çalan parça
 * ve konumu değişmez. Manuel "Sırada" öğeleri mevcut parçanın hemen ardında
 * kalır; yalnızca kütüphane bağlamı karıştırılır ya da `contextIds` sırasına
 * göre geri dizilir.
 *
 * Kesintisiz (gapless) oynatma:
 * Yerel oynatıcıda `setQueue` kullanmak yerine `removeUpcomingTracks()` ile
 * yalnızca mevcut çalan parçanın ardındaki parçalar silinir ve yeni sıra
 * `TrackPlayer.add()` ile eklenir. Böylece çalan parça HİÇ DURMAZ, ses kesintisi
 * yaşanmaz.
 */
export async function setShuffle(enabled: boolean, smart: boolean = false): Promise<void> {
  const store = useStore.getState();
  const { queue, activeIndex } = await readQueueState();

  if (queue.length === 0 || activeIndex < 0) {
    store.setIsShuffle(enabled);
    store.setIsSmartShuffle(enabled ? smart : false);
    return;
  }

  const { position } = await TrackPlayer.getProgress();
  const playback = await TrackPlayer.getPlaybackState();
  const wasPlaying =
    playback.state === State.Playing ||
    playback.state === State.Buffering ||
    playback.state === State.Loading;

  const sections = deriveQueueSections(queue, activeIndex, store.upNextIds);
  const history = queue.slice(0, activeIndex + 1);

  let playCounts: Record<string, number> | undefined;
  if (enabled && smart) {
    try {
      playCounts = await getPlayCountsMap();
    } catch {
      // ignore
    }
  }
  const metadataMap = store.metadataMap;

  const { upcoming, baselineIds } = computeUpcomingOrder({
    enabled,
    upNextTracks: sections.upNext.map((e) => e.track),
    upcomingContext: sections.context.map((e) => e.track),
    contextIds: store.contextIds,
    fullQueue: queue,
    smartShuffle: smart,
    playCounts,
    getArtist: (t) => metadataMap[t.id || '']?.artist || t.artist,
  });

  try {
    // Çalan parçayı durdurmadan ve sıfırlamadan sıradaki parçaları güncelle
    await TrackPlayer.removeUpcomingTracks();
    if (upcoming.length > 0) {
      await TrackPlayer.add(upcoming as Track[]);
    }
  } catch (err) {
    console.warn('Seamless queue update failed, falling back to setQueue', err);
    const newQueue = [...history, ...upcoming];
    await TrackPlayer.setQueue(newQueue);
    if (activeIndex > 0) {
      await TrackPlayer.skip(activeIndex);
    }
    if (position > 0) {
      await TrackPlayer.seekTo(position);
    }
    if (wasPlaying) {
      await TrackPlayer.play();
    } else {
      await TrackPlayer.pause();
    }
  }

  // Tek `set`: persist her set'te tüm store'u yazdığı için birleştiriyoruz.
  useStore.setState({
    isShuffle: enabled,
    isSmartShuffle: enabled ? smart : false,
    ...(baselineIds ? { contextIds: baselineIds } : {}),
  });
  await persistQueue();
}

let isCyclingPlaybackMode = false;

/**
 * 4 Aşamalı Oynatma Modu Döngüsü:
 * 1. Sırayla (Sequential): isShuffle = false, repeatMode = RepeatMode.Queue (veya Off)
 * 2. Karıştır (Classic Shuffle): isShuffle = true, isSmartShuffle = false, repeatMode = RepeatMode.Off
 * 3. Akıllı Karıştır (Smart Shuffle): isShuffle = true, isSmartShuffle = true, repeatMode = RepeatMode.Off
 * 4. Aynı Şarkıyı Tekrarla (Repeat Track): isShuffle = false, repeatMode = RepeatMode.Track
 * Tekrar basıldığında -> 1. Sırayla durumuna döner.
 */
export async function cyclePlaybackMode(): Promise<void> {
  if (isCyclingPlaybackMode) return;
  isCyclingPlaybackMode = true;
  try {
    const store = useStore.getState();
    const { isShuffle, isSmartShuffle, repeatMode } = store;

    if (isShuffle && !isSmartShuffle) {
      // 2 (Karıştır) -> 3 (Akıllı Karıştır)
      store.setRepeatMode(RepeatMode.Off);
      await TrackPlayer.setRepeatMode(RepeatMode.Off);
      await setShuffle(true, true);
    } else if (isShuffle && isSmartShuffle) {
      // 3 (Akıllı Karıştır) -> 4 (Tek Şarkı Tekrarla)
      await setShuffle(false, false);
      store.setRepeatMode(RepeatMode.Track);
      await TrackPlayer.setRepeatMode(RepeatMode.Track);
    } else if (repeatMode === RepeatMode.Track) {
      // 4 (Tek Şarkı Tekrarla) -> 1 (Sırayla)
      // Mod 4'e geçerken zaten kuyruk sırası normale döndürülmüştü.
      // Sadece repeatMode'u güncelliyoruz; ses ve sıra kesintisiz kalır.
      if (isShuffle) {
        await setShuffle(false, false);
      }
      store.setRepeatMode(RepeatMode.Queue);
      await TrackPlayer.setRepeatMode(RepeatMode.Queue);
      store.bumpQueueRevision();
    } else {
      // 1 (Sırayla) -> 2 (Klasik Karıştır)
      store.setRepeatMode(RepeatMode.Off);
      await TrackPlayer.setRepeatMode(RepeatMode.Off);
      await setShuffle(true, false);
    }
  } finally {
    isCyclingPlaybackMode = false;
  }
}

/**
 * Çalınan parça manuel kuyruktan geldiyse listeden düşürür.
 * Aktif parça değiştiğinde çağrılır (O(1), kuyruğu yeniden okumaz).
 */
export function markUpNextConsumed(track: { id?: string; url?: string } | null | undefined): void {
  const key = trackKey(track);
  if (!key) return;
  const ids = useStore.getState().upNextIds;
  if (ids.includes(key)) {
    useStore.getState().setUpNextIds(ids.filter((id) => id !== key));
    persistQueue().catch(() => {});
    useStore.getState().bumpQueueRevision();
  }
}

/**
 * Parça nesnesinden (veya id/url) kütüphanedeki kanonik MediaLibrary Asset ID'sini bulur.
 */
export function resolveTrackId(
  track: Track | QueueTrack | { id?: string; url?: string } | null | undefined,
  allAssets = useStore.getState().allAssets
): string {
  if (!track) return '';
  const rawId = String(track.id ?? track.url ?? '').trim();
  const rawUrl = String(track.url ?? '').trim();
  if (!rawId && !rawUrl) return '';

  const matched = allAssets.find(
    (a) => a.id === rawId || a.uri === rawId || (rawUrl && a.uri === rawUrl)
  );
  return matched ? matched.id : rawId;
}

/**
 * Parçanın çalınamaz olarak işaretlenip işaretlenmediğini kontrol eder.
 */
export function isTrackInUnplayable(
  track: Track | QueueTrack | { id?: string; url?: string } | null | undefined,
  unplayableIds: string[],
  allAssets = useStore.getState().allAssets
): boolean {
  if (!track) return true;
  const canonicalId = resolveTrackId(track, allAssets);
  if (canonicalId && unplayableIds.includes(canonicalId)) return true;

  const rawId = String(track.id ?? '').trim();
  if (rawId && unplayableIds.includes(rawId)) return true;

  const rawUrl = String(track.url ?? '').trim();
  if (rawUrl && unplayableIds.includes(rawUrl)) return true;

  return false;
}

let lastAttemptedTrack: Track | QueueTrack | null = null;
let lastAttemptedIndex: number = -1;

export function recordAttemptedTrack(
  track: Track | QueueTrack | { id?: string; url?: string } | null | undefined,
  index?: number
): void {
  if (track) {
    lastAttemptedTrack = track as Track | QueueTrack;
  }
  if (typeof index === 'number' && index >= 0) {
    lastAttemptedIndex = index;
  }
}

export function clearSessionFailedTracks(): void {
  // Geriye dönük uyumluluk için dışa aktarım korunur
}

let errorHandlingQueue = Promise.resolve();

async function processPlaybackError(
  error?: unknown,
  failedTrackHint?: Track | QueueTrack | null,
  failedIndexHint?: number
): Promise<void> {
  try {
    const queue = await TrackPlayer.getQueue();
    if (!queue || queue.length === 0) {
      await TrackPlayer.pause();
      return;
    }

    const activeTrack = await TrackPlayer.getActiveTrack().catch(() => null);
    const rawIndex = await TrackPlayer.getActiveTrackIndex().catch(() => null);
    const activeIndex =
      typeof failedIndexHint === 'number' && failedIndexHint >= 0
        ? failedIndexHint
        : typeof rawIndex === 'number' && rawIndex >= 0
        ? rawIndex
        : lastAttemptedIndex >= 0 && lastAttemptedIndex < queue.length
        ? lastAttemptedIndex
        : 0;
    const currentTrack =
      failedTrackHint ||
      activeTrack ||
      lastAttemptedTrack ||
      (activeIndex >= 0 && activeIndex < queue.length ? queue[activeIndex] : null);

    const allAssets = useStore.getState().allAssets;
    const failedTrackId = resolveTrackId(currentTrack, allAssets);
    const failedKey = trackKey(currentTrack);
    const idToMark = failedTrackId || failedKey;

    const store = useStore.getState();

    // Mükerrer / Stale Hata Koruması:
    // Eğer bu parça zaten çalınamaz olarak işaretlenmişse:
    if (idToMark && store.unplayableTrackIds.includes(idToMark)) {
      // Eğer oynatıcı şu an bu parçada DEĞİLSE (yani önceki bir skip başarılı olmuş ve
      // oynatıcı başka bir parçaya geçmişse), gelen bu hata eski parçadan kalan gecikmiş
      // mükerrer bir hatadır. Yeni ve masum parçayı etkilememek için hemen çık.
      const nowActive = await TrackPlayer.getActiveTrack();
      const nowActiveKey = trackKey(nowActive);
      const nowActiveId = resolveTrackId(nowActive, allAssets);
      if (
        (nowActiveKey && nowActiveKey !== failedKey && nowActiveKey !== failedTrackId) ||
        (nowActiveId && nowActiveId !== failedTrackId && nowActiveId !== failedKey)
      ) {
        return;
      }
    }

    // Şarkıyı sessizce çalınamaz ve gizli olarak işaretle (kütüphaneden anında kalkar)
    if (idToMark) {
      store.markTrackUnplayable(idToMark);
    }

    // Başarısız olan parçanın kuyruktaki tam indeksini belirle
    let currentIndex = -1;
    if (typeof failedIndexHint === 'number' && failedIndexHint >= 0 && failedIndexHint < queue.length) {
      currentIndex = failedIndexHint;
    } else if (failedKey) {
      currentIndex = queue.findIndex(
        (t) => trackKey(t) === failedKey || (failedTrackId && resolveTrackId(t, allAssets) === failedTrackId)
      );
    }
    if (currentIndex === -1) {
      currentIndex = activeIndex >= 0 && activeIndex < queue.length ? activeIndex : 0;
    }

    const currentUnplayableIds = useStore.getState().unplayableTrackIds;
    const isTrackUnplayable = (t: Track): boolean => {
      if (!t) return true;
      return isTrackInUnplayable(t, currentUnplayableIds, allAssets);
    };

    const isQueueRepeat = store.repeatMode === RepeatMode.Queue;
    const nextPlayableIndex = findNextPlayableIndex(
      queue,
      currentIndex,
      isTrackUnplayable,
      isQueueRepeat
    );

    // Güvenlik Önlemi: Kuyruk tükendi veya tüm parçalar bozuksa sonsuz döngüye girmeden dur
    if (nextPlayableIndex === -1) {
      console.warn('[queueController] Kuyruk tükendi veya çalınabilir parça kalmadı. Oynatma durduruluyor.');
      await TrackPlayer.pause();
      return;
    }

    // Bildirim veya toast çıkarmadan SESSİZCE sıradaki parçaya atla
    try {
      await TrackPlayer.skip(nextPlayableIndex);
      await TrackPlayer.play();
    } catch (skipErr) {
      console.warn('[queueController] Sonraki parçaya geçiş hatası:', skipErr);
      const failedCandidate = queue[nextPlayableIndex];
      if (failedCandidate) {
        const cId = resolveTrackId(failedCandidate, allAssets) || trackKey(failedCandidate);
        if (cId) {
          useStore.getState().markTrackUnplayable(cId);
        }
      }
      // Rekürsif devam: bir sonraki parçayı dene
      await processPlaybackError(skipErr, failedCandidate, nextPlayableIndex);
    }
  } catch (err) {
    console.warn('[queueController] processPlaybackError yakalanan hata:', err);
    try {
      await TrackPlayer.pause();
    } catch {
      // ignore
    }
  }
}

/**
 * Çalma hatası meydana geldiğinde (Event.PlaybackError veya play() istisnası) çağrılır.
 * Eşzamanlı çağrıları Promise zinciriyle sıraya sokarak yarış durumlarını ve mükerrer atlamaları önler.
 */
export function handlePlaybackError(
  error?: unknown,
  failedTrackHint?: Track | QueueTrack | null,
  failedIndexHint?: number
): Promise<void> {
  errorHandlingQueue = errorHandlingQueue
    .then(() => processPlaybackError(error, failedTrackHint, failedIndexHint))
    .catch((err) => {
      console.warn('[queueController] handlePlaybackError zincir hatası:', err);
    });
  return errorHandlingQueue;
}
