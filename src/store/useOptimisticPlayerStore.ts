import { create } from 'zustand';
import type { RemoteTrackSummary } from '../services/remote/remoteTypes';

interface OptimisticPlayerState {
  optimisticTrack: RemoteTrackSummary | null;
  optimisticArtworkUri: string | null;
  setOptimisticTrack: (track: RemoteTrackSummary | null, artworkUri?: string | null) => void;
  clearOptimisticTrack: () => void;
}

let clearTimer: ReturnType<typeof setTimeout> | null = null;

export const useOptimisticPlayerStore = create<OptimisticPlayerState>((set) => ({
  optimisticTrack: null,
  optimisticArtworkUri: null,
  setOptimisticTrack: (track, artworkUri = null) => {
    if (clearTimer) {
      clearTimeout(clearTimer);
      clearTimer = null;
    }
    set({ optimisticTrack: track, optimisticArtworkUri: artworkUri });
    // Güvenlik zaman aşımı: gerçek parça olayı gelmezse nazikçe geri dön.
    // 6 sn: yavaş cihazlarda TrackPlayer olayı 2.5 sn'yi aşabiliyor ve erken
    // temizlik, şarkı çalmaya başladıktan sonra arayüzün eski parçaya
    // dönmesine (görünür "arayüz değişti" hatası) yol açıyordu.
    clearTimer = setTimeout(() => {
      set({ optimisticTrack: null, optimisticArtworkUri: null });
      clearTimer = null;
    }, 6000);
  },
  clearOptimisticTrack: () => {
    if (clearTimer) {
      clearTimeout(clearTimer);
      clearTimer = null;
    }
    set({ optimisticTrack: null, optimisticArtworkUri: null });
  },
}));
