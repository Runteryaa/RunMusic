import { getCrashlytics } from '@react-native-firebase/crashlytics';

/**
 * Crashlytics köprüsü.
 *
 * NEDEN AYRI DOSYA: Firebase Crashlytics native bir modül. Uygulamanın her
 * yerine doğrudan `getCrashlytics()` çağrısı serpmek yerine tek kapı kullanılır:
 * - hata ayıklama (__DEV__) derlemelerinde TOPLAMA KAPALI (geliştirme
 *   hataları panele düşüp gerçek kullanıcı hatalarını gürültüye boğmasın),
 * - JS hatası ne olursa olsun raporlama asla uygulamayı çökertmez (her çağrı
 *   try/catch içinde),
 * - isteğe bağlı bağlam alanları (ekran, parça vb.) iliştirilebilir.
 */

let initialized = false;
let collectionEnabled = false;

/** Uygulama açılışında bir kez çağrılır. */
export function initCrashReporting(): void {
  if (initialized) return;
  initialized = true;

  // Geliştirme derlemesinde toplama kapalı: test hataları panele gitmesin.
  collectionEnabled = !__DEV__;

  try {
    getCrashlytics().setCrashlyticsCollectionEnabled(collectionEnabled).catch(() => {});
  } catch (error) {
    console.warn('[crashReporting] başlatılamadı:', error);
  }
}

export function isCrashReportingEnabled(): boolean {
  return collectionEnabled;
}

/**
 * Yakalanmamış JS hatalarını (fatal olanlar dahil) Crashlytics'e iletir.
 *
 * NEDEN: `ErrorBoundary` yalnızca React render hatalarını görür. Promise
 * reddi, olay işleyicisi veya native köprüden gelen bir hata bu sınırın
 * dışında kalır ve uygulama sessizce çöker; o durumda panelde hiçbir iz
 * olmuyordu. RN'in kendi global işleyicisi korunur: rapor yazıldıktan sonra
 * hata yine ona devredilir, böylece kırmızı ekran/çökme davranışı değişmez.
 */
export function installGlobalErrorHandler(): void {
  try {
    const errorUtils = (globalThis as { ErrorUtils?: { getGlobalHandler: () => unknown; setGlobalHandler: (handler: unknown) => void } }).ErrorUtils;
    if (!errorUtils) return;

    const previousHandler = errorUtils.getGlobalHandler();
    errorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
      // Raporlama asla çökme yolunu kesmemeli.
      try {
        reportError(error, { source: 'global', fatal: isFatal === true });
      } catch {
        // yoksay
      }
      if (typeof previousHandler === 'function') {
        (previousHandler as (e: unknown, f?: boolean) => void)(error, isFatal);
      }
    });
  } catch (error) {
    console.warn('[crashReporting] global hata yakalayıcı kurulamadı:', error);
  }
}

/**
 * Yakalanan bir hatayı raporlar. Hata nesnesi olmayan değerler de kabul edilir
 * (`throw 'mesaj'` gibi durumlar için).
 */
export function reportError(
  error: unknown,
  context?: Record<string, string | number | boolean | null | undefined>
): void {
  if (!collectionEnabled) return;

  try {
    const normalized =
      error instanceof Error ? error : new Error(typeof error === 'string' ? error : String(error));

    if (context) {
      const attributes: Record<string, string> = {};
      for (const [key, value] of Object.entries(context)) {
        if (value === null || value === undefined) continue;
        attributes[key] = String(value).slice(0, 100);
      }
      if (Object.keys(attributes).length > 0) {
        getCrashlytics().setAttributes(attributes).catch(() => {});
      }
    }

    getCrashlytics().recordError(normalized);
  } catch (reportingError) {
    console.warn('[crashReporting] hata raporlanamadı:', reportingError);
  }
}

/**
 * Çökme raporuna eklenecek ekmek kırıntısı (breadcrumb) yazar.
 * Yalnızca tanılama amaçlıdır; hiçbir mantıksal etkisi yoktur.
 */
export function logBreadcrumb(message: string): void {
  if (!collectionEnabled) return;
  try {
    getCrashlytics().log(String(message).slice(0, 500));
  } catch {
    // Tanılama asla uygulamayı etkilemez.
  }
}
