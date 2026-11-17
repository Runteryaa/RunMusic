import * as MediaLibrary from 'expo-media-library/legacy';
import TrackPlayer from 'react-native-track-player';

import { useStore } from '../store/useStore';
import { saveCachedLibrary } from './libraryStorage';

/**
 * Kitaplıktaki dosyaları cihazdan kalıcı olarak siler ve uygulama durumunu
 * tutarlı bırakır.
 *
 * Silme işlemi MediaLibrary üzerinden yapılır; başarılıysa:
 * - o an çalan parça silinmişse bir sonrakine geçilir (yoksa duraklatılır),
 * - kuyruktan silinen girişler (sondan başa) çıkarılır,
 * - store'daki kitaplık ve disk önbelleği güncellenir.
 *
 * Böylece hem kütüphane ekranındaki toplu silme hem de Kitaplık Araçları
 * ekranı aynı davranışı paylaşır.
 */
export async function deleteTracksFromDevice(
  tracks: { id: string; uri?: string }[]
): Promise<{ deleted: number; failed: boolean }> {
  const ids = Array.from(new Set(tracks.map((track) => track.id).filter(Boolean)));
  if (ids.length === 0) return { deleted: 0, failed: false };

  let success = false;
  try {
    success = await MediaLibrary.deleteAssetsAsync(ids);
  } catch (error) {
    console.warn('Failed to delete assets', error);
    return { deleted: 0, failed: true };
  }
  if (!success) return { deleted: 0, failed: true };

  const idSet = new Set(ids);
  const uriSet = new Set(tracks.map((track) => track.uri).filter(Boolean) as string[]);

  try {
    const active = await TrackPlayer.getActiveTrack();
    if (active && (idSet.has(active.id || '') || uriSet.has(active.url || ''))) {
      try {
        await TrackPlayer.skipToNext();
      } catch {
        await TrackPlayer.pause();
      }
    }
    const queue = await TrackPlayer.getQueue();
    // Sondan başa sil ki indeksler kaymasın.
    for (let i = queue.length - 1; i >= 0; i--) {
      const entry = queue[i];
      if (idSet.has(entry.id || '') || uriSet.has(entry.url || '')) {
        await TrackPlayer.remove(i).catch(() => {});
      }
    }
  } catch (error) {
    console.warn('TrackPlayer update on delete failed', error);
  }

  const updatedLibrary = useStore.getState().library.filter((asset) => !idSet.has(asset.id));
  useStore.getState().setLibrary(updatedLibrary);
  saveCachedLibrary(updatedLibrary).catch(() => {});

  return { deleted: ids.length, failed: false };
}
