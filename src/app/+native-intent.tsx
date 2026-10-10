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
 * Çözüm: bu URL'i ana ekrana (kütüphane) yönlendirmek. Kullanıcı bildirime
 * dokunduğunda uygulama normal şekilde açılır; mini player zaten görünür.
 *
 * Not: `path` adında olsa da geçerli bir URL garantisi yok (Expo dokümanı),
 * bu yüzden `new URL()` yerine basit metin kontrolü yapılır ve fonksiyon
 * asla hata fırlatmaz.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (path.includes('notification.click')) {
      return '/';
    }
    return path;
  } catch {
    // Bu fonksiyon içinde çökmek uygulamayı açılışta kilitleyebilir.
    return '/';
  }
}
