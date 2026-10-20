import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import TrackPlayer, { useActiveTrack, useProgress, useIsPlaying } from 'react-native-track-player';
import { recordPlay, addListeningTime } from '../services/statsDatabase';
import { saveLastPlayback, updateQueueSnapshotActiveIndex } from '../services/playbackStorage';
import { useStore } from '../store/useStore';
import { useDownloadStore } from '../store/useDownloadStore';

export function usePlayTracker() {
  const activeTrack = useActiveTrack();
  const progress = useProgress(1000);
  const { playing } = useIsPlaying();
  
  // Hangi şarkının (trackId) dinlenme kaydının çoktan alındığını takip eder.
  const trackedSessionIdRef = useRef<string | null>(null);

  // Exact time tracking state
  const sessionStartTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (!activeTrack?.id) return;
    
    // Eğer yeni bir şarkıya geçildiyse referansı sıfırla
    if (trackedSessionIdRef.current !== activeTrack.id && progress.position < 2) {
      trackedSessionIdRef.current = null;
    }

    // Şarkı henüz kaydedilmediyse ve dinleme eşiğini (30 sn veya kısa şarkılarda sürenin %50'sini) geçtiyse
    const threshold = Math.min(30, (activeTrack.duration && activeTrack.duration > 0 ? activeTrack.duration * 0.5 : 30));
    if (trackedSessionIdRef.current !== activeTrack.id && progress.position >= threshold) {
      const metadataMap = useStore.getState().metadataMap;
      const downloadTasks = useDownloadStore.getState().tasks;
      const dlTask = downloadTasks.find(
        (t) => t.id === activeTrack.id || (activeTrack.url && t.localFileUri === activeTrack.url)
      );

      const meta = metadataMap[activeTrack.id] || (activeTrack.url ? metadataMap[activeTrack.url] : undefined);
      const title = dlTask?.title || meta?.title || activeTrack.title || null;
      const artist = dlTask?.artist || meta?.artist || activeTrack.artist || null;
      const artwork = dlTask?.artwork || meta?.artwork || (typeof activeTrack.artwork === 'string' ? activeTrack.artwork : null);

      // Dinlenme geçmişe şarkının başlığı, sanatçısı ve kapağı ile birlikte kaydediliyor
      recordPlay(activeTrack.id, 0, { title, artist, artwork });
      trackedSessionIdRef.current = activeTrack.id;
    }
  }, [progress.position, activeTrack]);

  useEffect(() => {
    // Exact listening time accumulator
    if (playing) {
      sessionStartTimeRef.current = Date.now();
    } else {
      if (sessionStartTimeRef.current) {
        const diffMs = Date.now() - sessionStartTimeRef.current;
        const diffSecs = Math.floor(diffMs / 1000);
        if (diffSecs > 0) {
          addListeningTime(diffSecs);
        }
        sessionStartTimeRef.current = null;
      }
    }

    return () => {
      // Unmount olduğunda (veya dependency değiştiğinde) birikeni kaydet
      if (sessionStartTimeRef.current) {
        const diffMs = Date.now() - sessionStartTimeRef.current;
        const diffSecs = Math.floor(diffMs / 1000);
        if (diffSecs > 0) {
          addListeningTime(diffSecs);
        }
        sessionStartTimeRef.current = Date.now(); // Eğer playing hala true ise sıfırdan başlasın
      }
    };
  }, [playing, activeTrack?.id]);

  const positionBucket = Math.floor(progress.position / 10);

  // Çalma konumu ve parça durumunu periyodik ve duraklatmada kaydet
  useEffect(() => {
    if (!activeTrack) return;
    const trackId = String(activeTrack.id ?? activeTrack.url ?? '');
    const trackData = {
      id: trackId,
      url: String(activeTrack.url ?? ''),
      title: activeTrack.title,
      artist: activeTrack.artist,
      artwork: typeof activeTrack.artwork === 'string' ? activeTrack.artwork : undefined,
    };

    if (playing && progress.position > 0) {
      // Oynatılırken throttled (10s) kayıt
      TrackPlayer.getActiveTrackIndex().then((idx) => {
        if (typeof idx === 'number') {
          saveLastPlayback(
            {
              trackId,
              trackIndex: idx,
              position: progress.position,
              track: trackData,
            },
            false
          );
        }
      }).catch(() => {});
    } else if (!playing && progress.position > 0) {
      // Duraklatıldığında anında kayıt
      TrackPlayer.getActiveTrackIndex().then((idx) => {
        if (typeof idx === 'number') {
          saveLastPlayback(
            {
              trackId,
              trackIndex: idx,
              position: progress.position,
              track: trackData,
            },
            true
          );
          updateQueueSnapshotActiveIndex(idx, progress.position);
        }
      }).catch(() => {});
    }
  }, [playing, positionBucket, activeTrack, progress.position]);

  // Uygulama arka plana geçtiğinde veya kapatıldığında son durumu anında kaydet
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active' && activeTrack && progress.position > 0) {
        TrackPlayer.getActiveTrackIndex().then((idx) => {
          if (typeof idx === 'number') {
            const trackId = String(activeTrack.id ?? activeTrack.url ?? '');
            saveLastPlayback(
              {
                trackId,
                trackIndex: idx,
                position: progress.position,
                track: {
                  id: trackId,
                  url: String(activeTrack.url ?? ''),
                  title: activeTrack.title,
                  artist: activeTrack.artist,
                  artwork: typeof activeTrack.artwork === 'string' ? activeTrack.artwork : undefined,
                },
              },
              true
            );
            updateQueueSnapshotActiveIndex(idx, progress.position);
          }
        }).catch(() => {});
      }
    });
    return () => sub.remove();
  }, [activeTrack, progress.position]);
}
