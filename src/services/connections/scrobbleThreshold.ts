/**
 * Scrobble eşiği.
 *
 * Last.fm standardı: parçanın **yarısı** veya **4 dakika**, hangisi önce
 * dolarsa. Bu, uygulamanın kendi istatistiklerindeki 30 saniyelik eşikten
 * bilinçli olarak bağımsızdır — istatistikler yerel bir özellik, scrobble ise
 * üçüncü taraf servise gönderim.
 *
 * Saf fonksiyon: native bağımlılığı yok, Node'da test edilebilir.
 */
export const MAX_SCROBBLE_THRESHOLD_SECONDS = 240;

export function scrobbleThresholdSeconds(duration?: number | null): number {
  if (!duration || duration <= 0) return MAX_SCROBBLE_THRESHOLD_SECONDS;
  return Math.min(duration / 2, MAX_SCROBBLE_THRESHOLD_SECONDS);
}
