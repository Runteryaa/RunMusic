import { md5 } from './md5';
import { ConnectionError, type ScrobbleTrack } from './types';

/**
 * Last.fm scrobble tümleşimi.
 *
 * API hesabı (api_key + shared_secret) **uygulamanın** kimliğidir; kullanıcı
 * verisi taşımaz. Her kullanıcı "Bağlan"a bastığında kendi hesabıyla giriş
 * yapar ve kendi `session_key`'ini alır — scrobble'lar o hesaba gider.
 *
 * Akış (webview/deep link gerekmez, tarayıcı yeterli):
 *   1. `auth.getToken`
 *   2. Kullanıcı `last.fm/api/auth/?api_key=…&token=…` sayfasında izin verir
 *   3. `auth.getSession` → kullanıcı adı + session_key
 */

const API_URL = 'https://ws.audioscrobbler.com/2.0/';
const AUTH_URL = 'https://www.last.fm/api/auth/';
const REQUEST_TIMEOUT_MS = 8000;

/** Kayıtlı RunMusic uygulama kimliği. */
export const LASTFM_APP_API_KEY = '6a5a0d5391b25296763373ac2a747085';
const LASTFM_APP_SHARED_SECRET = 'a91931c31fe257f13f6dbf786f0f2b6f';

export interface LastFmCredentials {
  apiKey: string;
  sharedSecret: string;
}

/** Kullanıcı kendi API anahtarını girdiyse o kullanılır, yoksa uygulama anahtarı. */
export function resolveLastFmCredentials(
  customApiKey?: string | null,
  customSecret?: string | null
): LastFmCredentials {
  const apiKey = (customApiKey || '').trim();
  const sharedSecret = (customSecret || '').trim();
  if (apiKey && sharedSecret) return { apiKey, sharedSecret };
  return { apiKey: LASTFM_APP_API_KEY, sharedSecret: LASTFM_APP_SHARED_SECRET };
}

export interface LastFmSession {
  username: string;
  sessionKey: string;
}

type Params = Record<string, string | number | undefined | null>;

/**
 * İmza: parametreler alfabetik dizilir, `ad=değer` biçiminde birleştirilir ve
 * sonuna `shared_secret` eklenip md5 alınır. `format` / `callback` imzaya
 * **girmez** (Last.fm belgesi).
 */
export function buildApiSignature(params: Params, sharedSecret: string): string {
  const signature = Object.keys(params)
    .filter((key) => key !== 'format' && key !== 'callback' && params[key] !== undefined)
    .sort()
    .map((key) => `${key}${params[key]}`)
    .join('');
  return md5(signature + sharedSecret);
}

async function callApi<T>(
  method: string,
  params: Params,
  credentials: LastFmCredentials
): Promise<T> {
  const payload: Params = { ...params, method, api_key: credentials.apiKey, format: 'json' };
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) continue;
    body.append(key, String(value));
  }
  body.append('api_sig', buildApiSignature(payload, credentials.sharedSecret));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'RunMusic/1.2 (Android)',
      },
      body: body.toString(),
      signal: controller.signal,
    });
  } catch (error) {
    throw new ConnectionError(
      error instanceof Error && error.name === 'AbortError'
        ? 'Last.fm isteği zaman aşımına uğradı.'
        : 'Last.fm’e ulaşılamadı.'
    );
  } finally {
    clearTimeout(timer);
  }

  let data: any = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (data && typeof data.error === 'number') {
    throw new ConnectionError(describeError(data.error, data.message), data.error);
  }
  if (!response.ok) {
    throw new ConnectionError(`Last.fm hatası (HTTP ${response.status}).`, response.status);
  }
  if (!data || typeof data !== 'object') {
    throw new ConnectionError('Last.fm beklenmeyen bir yanıt döndürdü.');
  }
  return data as T;
}

/** Last.fm hata numaralarını kullanıcıya anlaşılır metne çevirir. */
export function describeError(code: number, message?: string): string {
  switch (code) {
    case 4:
      return 'Last.fm kimlik doğrulaması başarısız (imza geçersiz).';
    case 6:
      return 'Last.fm parça bulunamadı.';
    case 9:
      return 'Last.fm oturumu geçersiz. Yeniden bağlanın.';
    case 10:
      return 'Last.fm API anahtarı geçersiz.';
    case 11:
    case 16:
    case 29:
      return 'Last.fm geçici olarak istekleri sınırlandırıyor. Birazdan yeniden denenecek.';
    case 13:
      return 'Last.fm servisi şu anda kullanılamıyor.';
    case 26:
      return 'Last.fm hesabı askıya alınmış.';
    default:
      return message ? `Last.fm: ${message}` : `Last.fm hatası (${code}).`;
  }
}

/** Oturumun kalıcı olarak geçersiz olduğunu gösteren hata mı? */
export function isLastFmSessionInvalid(error: unknown): boolean {
  return error instanceof ConnectionError && error.code === 9;
}

/** Hız sınırı / geçici hata: kayıt kuyrukta kalmalı mı? */
export function isLastFmRetryable(error: unknown): boolean {
  if (!(error instanceof ConnectionError)) return true;
  const code = error.code;
  if (code === undefined) return true;
  // 4/9/10/26: kimlik doğrulama sorunları, 6: parça bulunamadı → kalıcı.
  if (code === 4 || code === 6 || code === 9 || code === 10 || code === 26) return false;
  return true;
}

/** Kullanıcıyı izin sayfasına götürecek adresi üretir. */
export function buildAuthUrl(apiKey: string, token: string): string {
  return `${AUTH_URL}?api_key=${encodeURIComponent(apiKey)}&token=${encodeURIComponent(token)}`;
}

/** 1. adım: geçici token. */
export async function requestAuthToken(credentials: LastFmCredentials): Promise<string> {
  const data = await callApi<{ token?: string }>('auth.getToken', {}, credentials);
  if (!data?.token) throw new ConnectionError('Last.fm token alınamadı.');
  return data.token;
}

/** 3. adım: token'ı kalıcı oturuma çevirir. */
export async function requestSession(
  credentials: LastFmCredentials,
  token: string
): Promise<LastFmSession> {
  const data = await callApi<{ session?: { name?: string; key?: string } }>(
    'auth.getSession',
    { token },
    credentials
  );
  const name = data?.session?.name;
  const key = data?.session?.key;
  if (!name || !key) {
    throw new ConnectionError(
      'Last.fm oturumu oluşturulamadı. İzni verdiğinizden emin olun.'
    );
  }
  return { username: name, sessionKey: key };
}

function trackParams(track: ScrobbleTrack): Params {
  const params: Params = {
    artist: track.artist,
    track: track.track,
  };
  if (track.album) params.album = track.album;
  if (track.duration && track.duration > 0) {
    params.duration = Math.round(track.duration);
  }
  return params;
}

function scrobbleParams(track: ScrobbleTrack): Params {
  return { ...trackParams(track), timestamp: track.startedAt };
}

/** Şu anda çalan parçayı bildirir (kalıcı değil, kuyruğa girmez). */
export async function updateNowPlaying(
  credentials: LastFmCredentials,
  sessionKey: string,
  track: ScrobbleTrack
): Promise<void> {
  await callApi(
    'track.updateNowPlaying',
    { ...trackParams(track), sk: sessionKey },
    credentials
  );
}

/** Bir dinlemeyi scrobble eder. */
export async function scrobbleTrack(
  credentials: LastFmCredentials,
  sessionKey: string,
  track: ScrobbleTrack
): Promise<void> {
  await callApi(
    'track.scrobble',
    { ...scrobbleParams(track), sk: sessionKey },
    credentials
  );
}
