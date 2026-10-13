import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import TrackPlayer, { useActiveTrack, useProgress, useIsPlaying } from 'react-native-track-player';
import { recordPlay, addListeningTime } from '../services/statsDatabase';
import { saveLastPlayback, updateQueueSnapshotActiveIndex } from '../services/playbackStorage';

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

    // Şarkı henüz kaydedilmediyse ve 30 saniye eşiğini geçtiyse
    if (trackedSessionIdRef.current !== activeTrack.id && progress.position >= 30) {
      // Dinlenme geçmişe ekleniyor (sadece sayılma amaçlı, süre 0 geçiyoruz çünkü app_stats'den tam süre hesaplanıyor)
      recordPlay(activeTrack.id, 0); 
      trackedSessionIdRef.current = activeTrack.id;
    }
  }, [progress.position, activeTrack?.id]);

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
