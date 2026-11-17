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
