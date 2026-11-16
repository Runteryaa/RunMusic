import { useCallback } from 'react';
import { BackHandler } from 'react-native';
import { router, useFocusEffect } from 'expo-router';

/**
 * İkincil ekranlarda (istatistik, Wrapped, sanatçı, ayarlar) donanım geri
 * tuşunu kütüphaneye döndürür.
 *
 * NEDEN: Bu ekranlar sekme yığınında değil, sekme değiştirilerek açılıyor.
 * Android'in varsayılan davranışı geri tuşunda uygulamadan çıkmaktı; bu da
 * mini oynatıcının kaybolmasına ve çalan şarkının kesilmesine yol açıyordu.
 * Kullanıcı istatistiklere bakıp geri dönerken müziğin devam etmesini bekliyor.
 *
 * Oynatıcıyı tamamen kapatmak isteyenler için Ayarlar > Bellek Tanılama
 * bölümünde ayrı bir düğme var (bkz. `shutdownPlayback`).
 *
 * `useFocusEffect` kullanılması şart: sekmeler ziyaret edildikten sonra
 * bağlı kalır. Ekran odakta değilken de kayıtlı kalsaydı, kütüphanede geri
 * tuşuna basıldığında bu işleyici devreye girip uygulamanın kapanmasını
 * engellerdi.
 */
export function useBackToLibrary(): void {
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        // Önce gerçek gezinme geçmişine dön (ör. istatistik → ayarlar).
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace('/');
        }
        return true;
      });
      return () => subscription.remove();
    }, [])
  );
}
