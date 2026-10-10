import AsyncStorage from '@react-native-async-storage/async-storage';
import TrackPlayer from 'react-native-track-player';

export const PLAYBACK_STORAGE_KEY = '@runmusic_last_playback_v2';

export interface SavedTrackItem {
  id: string;
  url: string;
  title?: string;
  artist?: string;
  artwork?: string;
}

export interface SavedPlaybackState {
  trackId: string;
  position: number;
  trackIndex?: number;
  track?: SavedTrackItem;
}

let lastSavedTime = 0;
let pendingSaveTimeout: any = null;

/**
 * En son dinlenen şarkı ve konumunu bağımsız, çok küçük (~200 bayt) bir JSON olarak kaydeder.
 * Zustand store'unu ve büyük medya önbelleğini kesinlikle meşgul etmez veya tetiklemez.
 */
export async function saveLastPlayback(data: SavedPlaybackState, immediate = false): Promise<void> {
  const now = Date.now();

  const doSave = async () => {
    try {
      lastSavedTime = Date.now();
      await AsyncStorage.setItem(PLAYBACK_STORAGE_KEY, JSON.stringify(data));
    } catch {
      // ignore
    }
  };

  if (immediate) {
    if (pendingSaveTimeout) {
      clearTimeout(pendingSaveTimeout);
      pendingSaveTimeout = null;
    }
    return doSave();
  }

  // 10 saniye throttling (çok sık disk yazımını önler, UI'yi sıfır gecikmede tutar)
  if (now - lastSavedTime >= 10000) {
    return doSave();
  }

  if (!pendingSaveTimeout) {
    pendingSaveTimeout = setTimeout(() => {
      pendingSaveTimeout = null;
      doSave();
    }, 10000);
  }
}

export async function getLastPlayback(): Promise<SavedPlaybackState | null> {
  try {
    const raw = await AsyncStorage.getItem(PLAYBACK_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Kuyruk anlık görüntüsü (queue snapshot)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tam kuyruğun saklandığı anahtar.
 *
 * Konum bilgisi (`PLAYBACK_STORAGE_KEY`) sık ve küçük yazılır; kuyruğun kendisi
 * ise YALNIZCA yapısal değişikliklerde (kuyruk kurma, ekleme, silme, sıralama,
 * shuffle) yazılır. Böylece her duraklatmada yüzlerce parçalık bir dizi
 * serileştirilmez.
 */
export const QUEUE_STORAGE_KEY = '@runmusic_queue_v1';

/**
 * Güvenli üst sınır. Bunun üzerindeki kütüphanelerde tam kuyruk yazılmaz;
 * uygulama eski davranışa (yalnızca son parça) düşer ki AsyncStorage'ın
 * tek-değer sınırı aşılmasın.
 */
export const MAX_PERSISTED_QUEUE = 2000;

export interface SavedQueueModel {
  upNextIds: string[];
  contextIds: string[];
  isShuffle: boolean;
}

export interface SavedQueueState extends SavedQueueModel {
  queue: SavedTrackItem[];
  activeIndex: number;
  /** Anlık görüntü alındığı andaki çalma konumu (saniye). */
  position: number;
}

/** Aktif kuyruğu ve kuyruk modelini diske yazar. */
export async function saveQueueSnapshot(model: SavedQueueModel): Promise<void> {
  try {
    const queue = await TrackPlayer.getQueue();
    if (queue.length === 0) return;

    if (queue.length > MAX_PERSISTED_QUEUE) {
      console.warn(
        `[queueSnapshot] kuyruk çok büyük (${queue.length} > ${MAX_PERSISTED_QUEUE}); ` +
          'tam kuyruk kaydedilmedi'
      );
      return;
    }

    const rawIndex = await TrackPlayer.getActiveTrackIndex();
    const activeIndex = typeof rawIndex === 'number' && rawIndex >= 0 ? rawIndex : 0;
    const { position } = await TrackPlayer.getProgress();

    // Yalnızca taşınması gereken alanlar; kapak yolları store'dan yeniden gelir.
    const items: SavedTrackItem[] = queue.map((track) => ({
      id: String(track.id ?? track.url ?? ''),
      url: String(track.url ?? ''),
      title: track.title ?? undefined,
      artist: track.artist ?? undefined,
      artwork: typeof track.artwork === 'string' ? track.artwork : undefined,
    }));

    const payload: SavedQueueState = {
      queue: items,
      activeIndex,
      position: position > 0 ? position : 0,
      upNextIds: model.upNextIds,
      contextIds: model.contextIds,
      isShuffle: model.isShuffle,
    };

    await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn('[queueSnapshot] kaydedilemedi:', e);
  }
}

export async function getQueueSnapshot(): Promise<SavedQueueState | null> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedQueueState;
    if (!parsed || !Array.isArray(parsed.queue) || parsed.queue.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearQueueSnapshot(): Promise<void> {
  try {
    await AsyncStorage.removeItem(QUEUE_STORAGE_KEY);
  } catch {
    // yoksay
  }
}

