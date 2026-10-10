import { usePlayerUIStore } from '../store/usePlayerUIStore';

/**
 * Gelen sistem URL'lerini (deep link) yönlendirir.
 *
 * NEDEN GEREKLİ:
 * `react-native-track-player`, Android'de müzik bildirimine dokunulduğunda
 * uygulamayı şu intent verisiyle açar (MusicService.kt):
 *
 *   data = Uri.parse("trackplayer://notification.click")
 *
 * Bu bir deep link DEĞİL; yalnızca "bildirime tıklandı" işareti. Ama Expo
 * Router gelen URL'i her zaman bir rota sanar, bu yüzden `notification.click`
 * adlı bir rota arayıp "not found" ekranını gösteriyordu.
 *
 * ÇÖZÜM:
 * 1. URL kütüphane ekranına yönlendirilir ("not found" engellenir).
 * 2. Tam ekran player da açılır. Player bir rota DEĞİL, `usePlayerUIStore`
 *    üzerinden yönetilen bir katman olduğu için ayrıca açılması gerekir.
 *
 * Store'daki bayrak açılışta ayarlanır; aktif parça geri yüklendiğinde
 * (asenkron) `ExpandingPlayer` bunu görüp player'ı açar. Uygulama zaten açıksa
 * dokunma anında açılır.
 *
 * Not: `path` adında olsa da geçerli bir URL garantisi yok (Expo dokümanı),
 * bu yüzden `new URL()` yerine basit metin kontrolü yapılır ve fonksiyon
 * asla hata fırlatmaz.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (path.includes('notification.click')) {
      // Bildirime dokunuldu: hem uygulamayı hem de player'ı aç.
      usePlayerUIStore.getState().openFullscreenPlayer();
      return '/';
    }
    return path;
  } catch {
    // Bu fonksiyon içinde çökmek uygulamayı açılışta kilitleyebilir.
    return '/';
  }
}
