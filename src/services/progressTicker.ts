import { AppState } from 'react-native';
import TrackPlayer, { Event, State } from 'react-native-track-player';

/**
 * Tek bir çalma konumu yoklayıcısı — uygulamadaki TÜM ilerleme tüketicileri
 * (kaydırıcı, söz senkronu, mini oynatıcı çubuğu, istatistik, scrobble,
 * kaldığın yerden devam) buradan beslenir.
 *
 * NEDEN: `react-native-track-player`'ın `useProgress(ms)` kancası **her kullanım
 * için ayrı bir zamanlayıcı** kurar ve her turda native köprüye `getProgress()`
 * çağrısı yapar. Oynatıcı ekranı 250 ms'de bir, mini oynatıcı 250 ms'de bir,
 * söz ekranı 250 ms'de bir, istatistik 1 sn'de bir, scrobble 1 sn'de bir,
 * kaldığın yerden devam 2 sn'de bir yokluyordu. Müzik çalarken bu **saniyede
 * ~14 native çağrı** demek: JS iş parçacığı hiç uyuyamıyor, pil tükeniyor,
 * arayüz de gereksiz yere yeniden çiziliyor.
 *
 * Burada tek zamanlayıcı, tek `getProgress()` çağrısı var. Aboneler yalnızca
 * kendi istedikleri aralık dolduğunda bilgilendirilir. Çalma duraklatıldığında
 * konum değişmediği için tur aralığı 2 saniyeye çıkar; uygulama arka plandayken
 * (ekran kapalı, arayüz görünmüyor) de tur aralığı 2 saniyeye çıkar — bu sırada
 * yalnızca istatistik/scrobble gibi 1 sn hassasiyet gerektirmeyen işler çalışır.
 * Oynatma durumu değişince (devam/parça değişimi) anında tazelenir.
 */

export interface ProgressSnapshot {
  position: number;
  duration: number;
  buffered: number;
}

export type ProgressListener = (snapshot: ProgressSnapshot) => void;

interface Subscriber {
  intervalMs: number;
  listener: ProgressListener;
  lastDeliveredAt: number;
}

const EMPTY_SNAPSHOT: ProgressSnapshot = { position: 0, duration: 0, buffered: 0 };

/** Zamanlayıcının alt sınırı: daha sık tur gereksizdir, zaten 4 Hz üst sınır. */
const MIN_TICK_MS = 200;
/** Duraklatılmışken (konum sabit) en sık yoklama aralığı. */
const PAUSED_INTERVAL_FLOOR_MS = 2000;

const subscribers = new Set<Subscriber>();
let snapshot: ProgressSnapshot = EMPTY_SNAPSHOT;
let timer: ReturnType<typeof setTimeout> | null = null;
let reading = false;
let playing = false;
let playingStateKnown = false;
let listenersAttached = false;
let appActive = AppState.currentState === 'active';

function isPlayingState(state: State): boolean {
  return state === State.Playing || state === State.Buffering || state === State.Loading;
}

function effectiveInterval(sub: Subscriber): number {
  // Arka planda arayüz çizilmiyor; 1 Hz'in altına inmek yeterli.
  const floor = !appActive ? PAUSED_INTERVAL_FLOOR_MS : playing ? 0 : PAUSED_INTERVAL_FLOOR_MS;
  return Math.max(sub.intervalMs, floor);
}

function nextDelay(): number {
  let min = Infinity;
  for (const sub of subscribers) {
    min = Math.min(min, effectiveInterval(sub));
  }
  if (!Number.isFinite(min)) return MIN_TICK_MS;
  return Math.max(MIN_TICK_MS, min);
}

function deliver(sub: Subscriber): void {
  try {
    sub.listener(snapshot);
  } catch {
    // Bir abone hata verse de diğerleri güncellenmeye devam etmeli.
  }
}

function broadcastNow(): void {
  const now = Date.now();
  for (const sub of subscribers) {
    sub.lastDeliveredAt = now;
    deliver(sub);
  }
}

function schedule(delay: number): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void runTick();
  }, delay);
}

function forceTick(): void {
  if (subscribers.size === 0) return;
  schedule(0);
}

/** Oynatma durumu bilinmiyorken bir kez okunur (duraklama aralığı için). */
async function primePlaybackState(): Promise<void> {
  if (playingStateKnown) return;
  try {
    const state = await TrackPlayer.getPlaybackState();
    playing = isPlayingState(state.state);
    playingStateKnown = true;
    forceTick();
  } catch {
    // Oynatıcı henüz kurulmadı; ilk turda yeniden denenir.
  }
}

function attachListeners(): void {
  if (listenersAttached) return;
  listenersAttached = true;

  try {
    TrackPlayer.addEventListener(Event.PlaybackState, (event) => {
      const wasPlaying = playing;
      playing = isPlayingState(event.state);
      playingStateKnown = true;
      if (playing !== wasPlaying) {
        // Oynatma başladı/durakladı: yeni tempoyla hemen tazele.
        forceTick();
      }
    });

    TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, (event) => {
      // Parça değişti: konum sıfırlandı, süre yeni parçadan gelir.
      snapshot = {
        position: 0,
        duration: typeof event.track?.duration === 'number' ? event.track.duration : 0,
        buffered: 0,
      };
      broadcastNow();
      forceTick();
    });
  } catch {
    // Native olay kaydı başarısız olsa da yoklama çalışmaya devam eder.
  }

  try {
    AppState.addEventListener('change', (next) => {
      const wasActive = appActive;
      appActive = next === 'active';
      if (appActive && !wasActive) {
        // Ön plana dönüş: arayüz görünür olduğu için hemen tazele.
        forceTick();
      }
    });
  } catch {
    // AppState yoksa (teorik) yoklama ön plan hızında devam eder.
  }

  void primePlaybackState();
}

async function runTick(): Promise<void> {
  if (subscribers.size === 0) return;
  if (reading) {
    schedule(nextDelay());
    return;
  }

  reading = true;
  try {
    const progress = await TrackPlayer.getProgress();
    snapshot = {
      position: progress.position,
      duration: progress.duration,
      buffered: progress.buffered,
    };
    playingStateKnown = true;
  } catch {
    // Oynatıcı hazır değil: sonraki turda yeniden denenir.
  } finally {
    reading = false;
  }

  const now = Date.now();
  for (const sub of subscribers) {
    if (now - sub.lastDeliveredAt >= effectiveInterval(sub)) {
      sub.lastDeliveredAt = now;
      deliver(sub);
    }
  }

  if (subscribers.size > 0) schedule(nextDelay());
}

/** Son okunan konum (abonelik kurulmadan önceki ilk değer için). */
export function getProgressSnapshot(): ProgressSnapshot {
  return snapshot;
}

/**
 * İlerleme güncellemelerine abone olur. `intervalMs <= 0` ise abonelik
 * kurulmaz (devre dışı bırakma).
 */
export function subscribeProgress(
  intervalMs: number,
  listener: ProgressListener
): () => void {
  if (!(intervalMs > 0)) return () => {};

  const sub: Subscriber = { intervalMs, listener, lastDeliveredAt: 0 };
  subscribers.add(sub);
  attachListeners();
  // Eldeki son değeri gecikmeden ver; taze değer bir sonraki turda gelir.
  deliver(sub);
  forceTick();

  return () => {
    subscribers.delete(sub);
    if (subscribers.size === 0 && timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
