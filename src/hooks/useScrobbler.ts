import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useProgress } from 'react-native-track-player';
import { useStore } from '../store/useStore';
import { useDownloadStore } from '../store/useDownloadStore';
import { useRemoteConnectStore } from '../store/useRemoteConnectStore';
import { useConnectionsStore, hasActiveScrobbling } from '../store/useConnectionsStore';
import { useResilientActiveTrack } from './useResilientActiveTrack';
import { useIsOnline } from './useIsOnline';
import { broadcastNowPlaying, flushScrobbles, queueScrobble } from '../services/connections/scrobbleService';
import { syncBackgroundScrobbleRegistration } from '../services/backgroundScrobble';
import { scrobbleThresholdSeconds } from '../services/connections/scrobbleThreshold';
import { cleanTrackFields } from '../services/displayNames';

/**
 * Last.fm / ListenBrainz scrobble köprüsü.
 *
 * Uygulamanın kendi istatistiklerinden (`usePlayTracker` → `statsDatabase`)
 * **tamamen ayrıdır**: ayrı eşik, ayrı kayıt, ayrı depolama. Buradaki tek iş,
 * kullanıcı bağlantı kurduysa dinlemeyi dış servise iletmek.
 *
 * Eşik Last.fm standardıdır: parçanın yarısı veya 4 dakika (hangisi önce
 * dolarsa). Uygulama içi istatistiklerin 30 saniyelik eşiğinden bilinçli
 * olarak farklıdır.
 */
export function useScrobbler(): void {
  const activeTrack = useResilientActiveTrack();
  const progress = useProgress(1000);

  const isRemoteConnected = useRemoteConnectStore(
    (s) => s.mode === 'client' && s.connectionStatus === 'connected'
  );
  const isShadowTrack = String(activeTrack?.id ?? '').startsWith('remote_');
  const shouldSkip = isRemoteConnected || isShadowTrack;

  // Kullanıcı bağlantı kurduğunda/çıkardığında efekti yeniden kur.
  const lastfmEnabled = useConnectionsStore((s) => Boolean(s.lastfm.sessionKey && s.lastfm.scrobble));
  const listenBrainzEnabled = useConnectionsStore((s) =>
    Boolean(s.listenbrainz.token && s.listenbrainz.scrobble)
  );
  const lastfmNowPlaying = useConnectionsStore((s) => s.lastfm.nowPlaying);
  const listenBrainzNowPlaying = useConnectionsStore((s) => s.listenbrainz.nowPlaying);
  const anyEnabled = lastfmEnabled || listenBrainzEnabled;
  const isOnline = useIsOnline();

  /** Aynı parça için iki kez now-playing/scrobble göndermeyi engeller. */
  const announcedTrackRef = useRef<string | null>(null);
  const scrobbledTrackRef = useRef<string | null>(null);
  /** Son damgalanan parça: seçenek değişimleri dinleme başlangıcını bozmasın. */
  const listenTrackIdRef = useRef<string | null>(null);
  /** Dinlemenin başladığı an; sunuculara `timestamp` olarak gider. */
  const listenStartRef = useRef<number>(0);

  const buildTrack = () => {
    if (!activeTrack) return null;
    const metadataMap = useStore.getState().metadataMap;
    const tasks = useDownloadStore.getState().tasks;
    const task = tasks.find(
      (t) => t.id === activeTrack.id || (activeTrack.url && t.localFileUri === activeTrack.url)
    );
    const meta = metadataMap[activeTrack.id] || (activeTrack.url ? metadataMap[activeTrack.url] : undefined);

    const rawArtist = (task?.artist || meta?.artist || activeTrack.artist || '').trim();
    const rawTitle = (task?.title || meta?.title || activeTrack.title || '').trim();

    // Dış servislere de uygulamanın her yerinde görünen **düzenlenmiş** isimler
    // gider; ham başlık yalnızca "şarkı bilgilerini düzenle" ekranında görünür.
    const fields = cleanTrackFields(rawTitle, rawArtist);
    if (!fields.artist || !fields.title) return null;

    const duration =
      activeTrack.duration && activeTrack.duration > 0
        ? activeTrack.duration
        : meta?.duration && meta.duration > 0
        ? meta.duration
        : undefined;

    return {
      artist: fields.artist,
      track: fields.title,
      album: (meta?.album || '').trim() || undefined,
      duration,
      startedAt: listenStartRef.current || Math.floor(Date.now() / 1000),
    };
  };

  // Parça gerçekten değiştiğinde dinleme başlangıcını damgala.
  useEffect(() => {
    if (shouldSkip || !activeTrack?.id) return;
    if (listenTrackIdRef.current === activeTrack.id) return;
    listenTrackIdRef.current = activeTrack.id;
    listenStartRef.current = Math.floor(Date.now() / 1000);
    scrobbledTrackRef.current = null;
  }, [activeTrack?.id, shouldSkip]);

  // Now-playing bildirimi (parça veya seçenek değişiminde bir kez).
  useEffect(() => {
    if (shouldSkip || !activeTrack?.id || !anyEnabled) return;
    if (!lastfmNowPlaying && !listenBrainzNowPlaying) return;
    if (announcedTrackRef.current === activeTrack.id) return;

    announcedTrackRef.current = activeTrack.id;
    const track = buildTrack();
    if (!track) return;
    void broadcastNowPlaying(track);
    // buildTrack her render'da yeni nesne döndürdüğü için bağımlılığa eklenmez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTrack?.id, shouldSkip, anyEnabled, lastfmNowPlaying, listenBrainzNowPlaying]);

  // Eşik dolduğunda bir kez kuyruğa ekle.
  useEffect(() => {
    if (shouldSkip || !activeTrack?.id || !anyEnabled) return;
    if (scrobbledTrackRef.current === activeTrack.id) return;

    const track = buildTrack();
    if (!track) return;

    const threshold = scrobbleThresholdSeconds(
      track.duration ?? (activeTrack.duration as number | undefined)
    );
    if (progress.position < threshold) return;

    scrobbledTrackRef.current = activeTrack.id;
    void queueScrobble(track).then(() => flushScrobbles());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress.position, activeTrack?.id, shouldSkip, anyEnabled]);

  // Periyodik gönderim + ön plana dönüşte gönderim.
  useEffect(() => {
    if (!anyEnabled) return;

    if (isOnline) void flushScrobbles();
    const interval = setInterval(() => {
      if (AppState.currentState === 'active' && isOnline) void flushScrobbles();
    }, 60_000);

    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active' && isOnline && hasActiveScrobbling()) void flushScrobbles();
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [anyEnabled, isOnline]);

  // Ağ geri geldiğinde kuyruktaki birikmiş dinlemeleri hemen gönder.
  const wasOnlineRef = useRef(isOnline);
  useEffect(() => {
    if (isOnline && !wasOnlineRef.current && hasActiveScrobbling()) {
      void flushScrobbles();
    }
    wasOnlineRef.current = isOnline;
  }, [isOnline]);

  // Bağlantı varsa arka plan görevini kaydet; yoksa pil tüketmemek için kaldır.
  useEffect(() => {
    void syncBackgroundScrobbleRegistration(anyEnabled);
  }, [anyEnabled]);
}
