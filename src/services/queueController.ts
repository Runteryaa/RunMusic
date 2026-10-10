import TrackPlayer, { State, Track } from 'react-native-track-player';
import { useStore } from '../store/useStore';
import { saveQueueSnapshot } from './playbackStorage';
import {
  buildPlayOrder,
  deriveQueueSections,
  shuffleArray,
  trackKey,
  type QueueSections,
} from './queueMath';

// Saf kuyruk matematiği ayrı modülde yaşar (native'siz, test edilebilir);
// buradan yeniden dışa aktarılır ki çağıranlar tek yerden import etsin.
export { buildPlayOrder, deriveQueueSections, shuffleArray, trackKey };
export type { QueueEntry, QueueSections, QueueTrackLike } from './queueMath';

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

/** Kuyruk modelini diske yazar (yapısal değişikliklerden sonra çağrılır). */
async function persistQueue(): Promise<void> {
  const s = useStore.getState();
  await saveQueueSnapshot({
    upNextIds: s.upNextIds,
    contextIds: s.contextIds,
    isShuffle: s.isShuffle,
  });
}

async function readQueueState(): Promise<{ queue: Track[]; activeIndex: number }> {
  const queue = await TrackPlayer.getQueue();
  const rawIndex = await TrackPlayer.getActiveTrackIndex();
  const activeIndex = typeof rawIndex === 'number' && rawIndex >= 0 ? rawIndex : 0;
  return { queue, activeIndex };
}

export async function getQueueSections(): Promise<QueueSections<Track>> {
  const { queue, activeIndex } = await readQueueState();
  return deriveQueueSections(queue, activeIndex, useStore.getState().upNextIds);
}

/** Kullanıcı kütüphaneden bir parçaya dokunduğunda kuyruğu kurar ve çalar. */
export async function startPlaybackFromLibrary(params: {
  tracks: QueueTrack[];
  startId: string;
  shuffle: boolean;
}): Promise<void> {
  const { tracks, startId, shuffle } = params;
  const contextIds = tracks.map((t) => t.id);
  const byId = new Map(tracks.map((t) => [t.id, t]));

  const orderIds = buildPlayOrder(contextIds, startId, shuffle);
  const ordered = orderIds
    .map((id) => byId.get(id))
    .filter((t): t is QueueTrack => Boolean(t));

  const startIndex = Math.max(0, orderIds.indexOf(startId));

  await TrackPlayer.setQueue(ordered as Track[]);
  if (startIndex > 0) {
    await TrackPlayer.skip(startIndex);
  }
  await TrackPlayer.play();

  const store = useStore.getState();
  store.setContextIds(contextIds);
  store.clearUpNext();
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

/** "Sırada" bölümü içinde yeniden sıralama (indeksler bölüme görelidir). */
export async function moveUpNext(from: number, to: number): Promise<void> {
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
 * Not: `setQueue` yerel oynatıcıyı sıfırladığı için konum `seekTo` ile geri
 * yüklenir; bu yüzden kısa bir ses kesintisi olur (bilinçli bir kullanıcı
 * eylemi olduğu için kabul edilebilir).
 */
export async function setShuffle(enabled: boolean): Promise<void> {
  const store = useStore.getState();
  const { queue, activeIndex } = await readQueueState();

  if (queue.length === 0 || store.contextIds.length === 0) {
    store.setIsShuffle(enabled);
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
  const upNextTracks = sections.upNext.map((e) => e.track);
  const upcomingContext = sections.context.map((e) => e.track);

  // Shuffle kapalıyken bağlam, kaydedilmiş orijinal kütüphane sırasına döner.
  const contextOrder = new Map(store.contextIds.map((id, i) => [id, i]));
  const orderedContext = [...upcomingContext].sort(
    (a, b) => (contextOrder.get(trackKey(a)) ?? 0) - (contextOrder.get(trackKey(b)) ?? 0)
  );

  const newUpcoming = [...upNextTracks, ...(enabled ? shuffleArray(orderedContext) : orderedContext)];
  const newQueue = [...history, ...newUpcoming];

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

  store.setIsShuffle(enabled);
  await persistQueue();
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
