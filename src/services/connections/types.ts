/**
 * Bağlantı (scrobble) katmanının ortak tipleri.
 *
 * Bu modül bilinçli olarak `statsDatabase` / `useStore` gibi uygulama içi
 * istatistik katmanından **tamamen ayrıdır**. Uygulamanın kendi istatistikleri
 * yerel bir özellik; Last.fm ve ListenBrainz ise kullanıcının izniyle dışarıya
 * veri gönderen üçüncü taraf tümleşmeleridir. İkisi birbirini hiç çağırmaz.
 */

export type ScrobbleTarget = 'lastfm' | 'listenbrainz';

/** Dinlenen parçanın scrobble için gereken alanları. */
export interface ScrobbleTrack {
  artist: string;
  track: string;
  album?: string;
  /** Saniye. Last.fm'in yarı-süre kuralında kullanılır. */
  duration?: number;
  /** Dinlemenin başladığı an (Unix saniye). */
  startedAt: number;
}

/**
 * Kuyrukta bekleyen tek bir gönderim.
 *
 * `target` ile ayrılır: aynı dinleme iki servise de gönderilebilir, biri
 * başarısız olduğunda diğeri etkilenmez.
 */
export interface ScrobbleEntry extends ScrobbleTrack {
  id: string;
  target: ScrobbleTarget;
  /** Kaç kez denendi (yeniden deneme gecikmesi buna göre hesaplanır). */
  attempts: number;
  /** Bu andan önce gönderilmez (ms). */
  nextAttemptAt: number;
  createdAt: number;
}

/** Bağlantı işlemlerinin ortak hata sınıfı. */
export class ConnectionError extends Error {
  readonly code?: number;

  constructor(message: string, code?: number) {
    super(message);
    this.name = 'ConnectionError';
    this.code = code;
  }
}
