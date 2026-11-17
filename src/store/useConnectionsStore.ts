import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import { adoptSecret, setSecret } from '../services/secureSecrets';

/**
 * Last.fm / ListenBrainz bağlantı durumu.
 *
 * NEDEN AYRI STORE: kimlik bilgileri kullanıcıya ait gizli veridir ve ana
 * uygulama store'unda tutulursa `PERSIST_VERSION` migrasyonu, söz önbelleği
 * sıkıştırması ve tek-kayıt boyut sınırı hesaplarına dahil olur. Ayrı bir
 * anahtarda tutmak hem bunu önler hem de "çıkış yap" işlemini tek satıra
 * indirir.
 *
 * Ayrıca bu store uygulamanın kendi istatistiklerinden bağımsızdır: buradaki
 * hiçbir alan `statsDatabase`'e yazılmaz, istatistikler de burayı okumaz.
 */

export interface LastFmConnection {
  username: string | null;
  sessionKey: string | null;
  /** Parça değişiminde "şimdi çalıyor" bildirilsin mi? */
  nowPlaying: boolean;
  /** Dinlemeler scrobble edilsin mi? */
  scrobble: boolean;
}

export interface ListenBrainzConnection {
  username: string | null;
  token: string | null;
  nowPlaying: boolean;
  scrobble: boolean;
}

interface ConnectionsState {
  lastfm: LastFmConnection;
  listenbrainz: ListenBrainzConnection;
  /** Gelişmiş: kullanıcı kendi Last.fm API anahtarını girdiyse. */
  lastfmCustomApiKey: string | null;
  lastfmCustomSecret: string | null;
  /** Son hata mesajları (panele gösterilir, kalıcı değil ama zararsız). */
  lastfmError: string | null;
  listenbrainzError: string | null;

  connectLastFm: (username: string, sessionKey: string) => void;
  disconnectLastFm: () => void;
  setLastFmOptions: (patch: Partial<Pick<LastFmConnection, 'nowPlaying' | 'scrobble'>>) => void;
  setLastFmCustomCredentials: (apiKey: string | null, secret: string | null) => void;
  setLastFmError: (message: string | null) => void;

  connectListenBrainz: (username: string, token: string) => void;
  disconnectListenBrainz: () => void;
  setListenBrainzOptions: (
    patch: Partial<Pick<ListenBrainzConnection, 'nowPlaying' | 'scrobble'>>
  ) => void;
  setListenBrainzError: (message: string | null) => void;
}

export const useConnectionsStore = create<ConnectionsState>()(
  persist(
    (set) => ({
      lastfm: {
        username: null,
        sessionKey: null,
        nowPlaying: true,
        scrobble: true,
      },
      listenbrainz: {
        username: null,
        token: null,
        nowPlaying: true,
        scrobble: true,
      },
      lastfmCustomApiKey: null,
      lastfmCustomSecret: null,
      lastfmError: null,
      listenbrainzError: null,

      connectLastFm: (username, sessionKey) => {
        set((state) => ({
          lastfm: { ...state.lastfm, username, sessionKey },
          lastfmError: null,
        }));
        // Oturum anahtarı düz AsyncStorage'a YAZILMAZ; şifreli depoya gider.
        void setSecret('lastfm_session_key', sessionKey);
      },
      disconnectLastFm: () => {
        set((state) => ({
          lastfm: { ...state.lastfm, username: null, sessionKey: null },
          lastfmError: null,
        }));
        void setSecret('lastfm_session_key', null);
      },
      setLastFmOptions: (patch) =>
        set((state) => ({ lastfm: { ...state.lastfm, ...patch } })),
      setLastFmCustomCredentials: (apiKey, secret) => {
        set({ lastfmCustomApiKey: apiKey || null, lastfmCustomSecret: secret || null });
        // API anahtarı herkese açık; yalnızca secret şifreli saklanır.
        void setSecret('lastfm_custom_secret', secret || null);
      },
      setLastFmError: (message) => set({ lastfmError: message }),

      connectListenBrainz: (username, token) => {
        set((state) => ({
          listenbrainz: { ...state.listenbrainz, username, token },
          listenbrainzError: null,
        }));
        void setSecret('listenbrainz_token', token);
      },
      disconnectListenBrainz: () => {
        set((state) => ({
          listenbrainz: { ...state.listenbrainz, username: null, token: null },
          listenbrainzError: null,
        }));
        void setSecret('listenbrainz_token', null);
      },
      setListenBrainzOptions: (patch) =>
        set((state) => ({ listenbrainz: { ...state.listenbrainz, ...patch } })),
      setListenBrainzError: (message) => set({ listenbrainzError: message }),
    }),
    {
      name: 'runmusic-connections',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        // Gizli alanlar (sessionKey, token, lastfmCustomSecret) BİLİNÇLİ olarak
        // kalıcı kayda dahil edilmez; secureSecrets.ts üzerinden şifreli saklanır.
        lastfm: { ...state.lastfm, sessionKey: null },
        listenbrainz: { ...state.listenbrainz, token: null },
        lastfmCustomApiKey: state.lastfmCustomApiKey,
      }),
    }
  )
);

/** Scrobble göndermeye değer bir bağlantı var mı? */
export function hasActiveScrobbling(state = useConnectionsStore.getState()): boolean {
  return (
    (!!state.lastfm.sessionKey && state.lastfm.scrobble) ||
    (!!state.listenbrainz.token && state.listenbrainz.scrobble)
  );
}

/** Ayarlar satırında gösterilecek kısa durum. */
export function connectionSummary(state = useConnectionsStore.getState()): {
  lastfm: string | null;
  listenbrainz: string | null;
  activeCount: number;
} {
  const lastfm = state.lastfm.username;
  const listenbrainz = state.listenbrainz.username;
  return {
    lastfm,
    listenbrainz,
    activeCount: (lastfm ? 1 : 0) + (listenbrainz ? 1 : 0),
  };
}

export const CONNECTIONS_STORAGE_KEY = 'runmusic-connections';

/**
 * Açılışta gizli değerleri SecureStore'dan yükler ve eski düz kayıttan gelen
 * değerleri (varsa) bir kez şifreli depoya taşır.
 *
 * `useScrobbler` token'ı doğrudan store'dan okuduğu için, yükleme tamamlanınca
 * store güncellenir ve scrobble akışı kendiliğinden devreye girer. Yükleme
 * sırasında `hasActiveScrobbling()` false döner; yani eksik token'la ağ isteği
 * atılmaz.
 */
let secretsPromise: Promise<void> | null = null;
let secretsLoaded = false;

export function areConnectionSecretsLoaded(): boolean {
  return secretsLoaded;
}

export function ensureConnectionSecretsLoaded(): Promise<void> {
  if (secretsPromise) return secretsPromise;

  secretsPromise = (async () => {
    const initial = useConnectionsStore.getState();

    const [lastfmSessionKey, listenbrainzToken, lastfmCustomSecret] = await Promise.all([
      adoptSecret('lastfm_session_key', initial.lastfm.sessionKey),
      adoptSecret('listenbrainz_token', initial.listenbrainz.token),
      adoptSecret('lastfm_custom_secret', initial.lastfmCustomSecret),
    ]);

    const latest = useConnectionsStore.getState();
    // Kullanıcı yükleme sırasında bağlandıysa/çıktıysa onun son işlemi kazanır.
    const resolve = (
      current: string | null,
      before: string | null,
      adopted: string | null
    ): string | null => (current !== before ? current : current || adopted);

    useConnectionsStore.setState({
      lastfm: {
        ...latest.lastfm,
        sessionKey: resolve(latest.lastfm.sessionKey, initial.lastfm.sessionKey, lastfmSessionKey),
      },
      listenbrainz: {
        ...latest.listenbrainz,
        token: resolve(latest.listenbrainz.token, initial.listenbrainz.token, listenbrainzToken),
      },
      lastfmCustomSecret: resolve(
        latest.lastfmCustomSecret,
        initial.lastfmCustomSecret,
        lastfmCustomSecret
      ),
    });

    secretsLoaded = true;
  })()
    .catch((error) => {
      // Şifreli depo tamamen kullanılamazsa uygulama açılmaya devam eder;
      // kullanıcı yeniden bağlanana kadar scrobble devre dışı kalır.
      console.warn('[useConnectionsStore] gizli değerler yüklenemedi:', error);
      secretsLoaded = true;
    })
    .finally(() => {
      secretsPromise = null;
    });

  return secretsPromise;
}

if (useConnectionsStore.persist?.hasHydrated?.()) {
  void ensureConnectionSecretsLoaded();
} else if (typeof useConnectionsStore.persist?.onFinishHydration === 'function') {
  useConnectionsStore.persist.onFinishHydration(() => {
    void ensureConnectionSecretsLoaded();
  });
}
