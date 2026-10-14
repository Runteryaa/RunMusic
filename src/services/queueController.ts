import TrackPlayer, { State, Track, RepeatMode } from 'react-native-track-player';
import { useStore } from '../store/useStore';
import { saveQueueSnapshot } from './playbackStorage';
import { getPlayCountsMap } from './statsDatabase';
import {
  buildPlayOrder,
  buildQueueRows,
  computeUpcomingOrder,
  deriveQueueSections,
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
  shuffleArray,
  smartShuffleArray,
  trackKey,
};
export type { QueueEntry, QueueRow, QueueSections, QueueTrackLike, QueueSectionLabels } from './queueMath';

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
}

let isNavigatingHistory = false;

export function getIsNavigatingHistory(): boolean {
  return isNavigatingHistory;
}

export function setIsNavigatingHistory(val: boolean): void {
  isNavigatingHistory = val;
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

async function readQueueState(): Promise<{ queue: Track[]; activeIndex: number }> {
  const queue = await TrackPlayer.getQueue();
  const rawIndex = await TrackPlayer.getActiveTrackIndex();
  const activeIndex = typeof rawIndex === 'number' && rawIndex >= 0 ? rawIndex : 0;
  return { queue, activeIndex };
}

export async function getQueueSections(): Promise<QueueSections<Track>> {
  const { queue, activeIndex } = await readQueueState();
  const playedHistory = useStore.getState().playedHistory;
  return deriveQueueSections(
    queue,
    activeIndex,
    useStore.getState().upNextIds,
    playedHistory as any
  );
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

  await TrackPlayer.setQueue(ordered as Track[]);
  if (startIndex > 0) {
    await TrackPlayer.skip(startIndex);
  }
  await TrackPlayer.play();

  // TEK `set`: zustand persist her set çağrısında TÜM store'u serileştirip
  // diske yazdığı için iki ayrı action çağırmak gereksiz iki yazım demekti.
  useStore.setState({
    contextIds,
    upNextIds: [],
    playedHistory: [],
    isShuffle: shuffle,
    isSmartShuffle: shuffle ? smartShuffle : false,
  });
  await persistQueue();
}

/**
 * Kuyruktaki manuel bölümü yeniden hesaplar ve `upNextIds`'i gerçek duruma
 * göre günceller. Ekleme/silme/taşıma sonrası çağrılır; böylece kimlik listesi
 * ile native kuyruk asla ayrışmaz.
 */
async function resyncUpNextFromQueue(): Promise<void> {
  const { queue, activeIndex } = await readQueueState();
  const ids = useStore.getState().upNextIds;
  const sections = deriveQueueSections(queue, activeIndex, ids);
  useStore.getState().setUpNextIds(sections.upNext.map((e) => trackKey(e.track)));
}

async function insertManual(track: QueueTrack, position: 'next' | 'end'): Promise<void> {
  const key = track.id;
  const { queue, activeIndex } = await readQueueState();
  const currentUpNext = useStore.getState().upNextIds;
  const sections = deriveQueueSections(queue, activeIndex, currentUpNext);

  const existing = sections.upNext.find((entry) => trackKey(entry.track) === key);
  if (existing && position === 'end') {
    // Zaten sırada: mükerrer giriş oluşturma.
    return;
  }

  let insertAt: number;
  if (position === 'next') {
    insertAt = activeIndex + 1;
  } else {
    const last = sections.upNext[sections.upNext.length - 1];
    insertAt = last ? last.index + 1 : activeIndex + 1;
  }

  if (existing) {
    // "Şimdi çal" için mevcut girişi kopyalamak yerine taşı.
    await TrackPlayer.remove(existing.index);
    if (existing.index < insertAt) insertAt -= 1;
  }

  await TrackPlayer.add(track as Track, insertAt);

  const remaining = currentUpNext.filter((id) => id !== key);
  useStore.getState().setUpNextIds(position === 'next' ? [key, ...remaining] : [...remaining, key]);
  await persistQueue();
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
 * Sıradaki bir öğeyi kuyruktan çıkarır ve `upNextIds`'i yeniden eşitler.
 * Yalnızca mevcut parçanın İLERİSİNDEKİ öğeler kaldırılabilir.
 */
export async function removeQueueItem(index: number): Promise<void> {
  const { queue, activeIndex } = await readQueueState();
  if (index <= activeIndex || index >= queue.length) return;

  await TrackPlayer.remove(index);
  await resyncUpNextFromQueue();
  await persistQueue();
}

/**
 * Manuel "Sırada" öğelerinin TAMAMINI kuyruktan çıkarır.
 *
 * Yalnızca `upNextIds` listesini temizlemek yetmez: öğeler native kuyrukta
 * kaldığı sürece çalınmaya devam eder. Bu yüzden önce kuyruktan silinirler
 * (sondan başa doğru, indeksler kaymasın diye), sonra liste boşaltılır.
 */
export async function clearUpNextQueue(): Promise<void> {
  const { queue, activeIndex } = await readQueueState();
  const sections = deriveQueueSections(queue, activeIndex, useStore.getState().upNextIds);

  const indices = sections.upNext.map((entry) => entry.index).sort((a, b) => b - a);
  for (const index of indices) {
    try {
      await TrackPlayer.remove(index);
    } catch (e) {
      console.warn('Failed to remove up-next item', e);
    }
  }

  useStore.getState().clearUpNext();
  await persistQueue();
}

/** "Sırada" bölümü içinde yeniden sıralama (indeksler bölüme görelidir). */export async function moveUpNext(from: number, to: number): Promise<void> {
  const { queue, activeIndex } = await readQueueState();
  const sections = deriveQueueSections(queue, activeIndex, useStore.getState().upNextIds);

  if (from < 0 || to < 0 || from >= sections.upNext.length || to >= sections.upNext.length) return;
  if (from === to) return;

  await TrackPlayer.move(sections.upNext[from].index, sections.upNext[to].index);
  await resyncUpNextFromQueue();
  await persistQueue();
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
  }
}
