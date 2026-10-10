import { useEffect, useRef } from 'react';
import { useActiveTrack, useProgress } from 'react-native-track-player';
import { recordPlay } from '../services/statsDatabase';

export function usePlayTracker() {
  const activeTrack = useActiveTrack();
  const progress = useProgress(1000);
  
  // Hangi şarkının (trackId) dinlenme kaydının çoktan alındığını takip eder.
  const trackedSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeTrack?.id) return;
    
    // Eğer yeni bir şarkıya geçildiyse referansı sıfırla (eğer şarkı değiştiyse progress başa döner)
    // Şarkı ID'si değiştiğinde veya kullanıcı aynı şarkıyı baştan başlattığında (position 0'a yakınken)
    if (trackedSessionIdRef.current !== activeTrack.id && progress.position < 2) {
      trackedSessionIdRef.current = null;
    }

    // Şarkı henüz kaydedilmediyse ve 30 saniye eşiğini geçtiyse
    if (trackedSessionIdRef.current !== activeTrack.id && progress.position >= 30) {
      // Dinleme kaydediliyor
      recordPlay(activeTrack.id, 30); // 30 saniye tetikleyici olarak kullanıldı, toplam süre farklı takip edilebilir
      trackedSessionIdRef.current = activeTrack.id;
    }
  }, [progress.position, activeTrack?.id]);
}
