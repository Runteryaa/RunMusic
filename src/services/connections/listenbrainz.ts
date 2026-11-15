import { ConnectionError, type ScrobbleTrack } from './types';

/**
 * ListenBrainz tümleşimi.
 *
 * Last.fm'den farkı: uygulama düzeyinde anahtar yok. Kullanıcı kendi profilinden
 * bir **user token** kopyalar, biz de onu `Authorization: Token …` başlığıyla
 * kullanırız. Token doğrulanabildiği için "bağlı mı" sorusu her açılışta
 * kesin cevaplanabilir.
 */

const API_URL = 'https://api.listenbrainz.org/1';
const REQUEST_TIMEOUT_MS = 8000;
const TOKEN_SETTINGS_URL = 'https://listenbrainz.org/settings/';

export const LISTENBRAINZ_TOKEN_URL = TOKEN_SETTINGS_URL;

export interface ListenBrainzValidation {
  valid: boolean;
  username: string | null;
  message?: string;
}

async function request<T>(
  path: string,
  init: { method: string; token: string; body?: string }
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: init.method,
      body: init.body,
      headers: {
        Authorization: `Token ${init.token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'RunMusic/1.2 (Android)',
      },
      signal: controller.signal,
    });
  } catch (error) {
    throw new ConnectionError(
      error instanceof Error && error.name === 'AbortError'
        ? 'ListenBrainz isteği zaman aşımına uğradı.'
        : 'ListenBrainz’e ulaşılamadı.'
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401) {
    throw new ConnectionError('ListenBrainz token geçersiz.', 401);
  }
  if (response.status === 429) {
    throw new ConnectionError('ListenBrainz istekleri sınırlandı. Birazdan denenecek.', 429);
  }
  if (!response.ok) {
    throw new ConnectionError(`ListenBrainz hatası (HTTP ${response.status}).`, response.status);
  }

  if (response.status === 204) return undefined as T;
  try {
    return (await response.json()) as T;
  } catch {
    return undefined as T;
  }
}

/** Token'ı doğrular ve bağlı kullanıcı adını döner. */
export async function validateToken(token: string): Promise<ListenBrainzValidation> {
  const trimmed = (token || '').trim();
  if (!trimmed) return { valid: false, username: null, message: 'Token boş.' };

  const data = await request<{ valid?: boolean; user_name?: string; message?: string }>(
    '/validate-token',
    { method: 'GET', token: trimmed }
  );

  return {
    valid: data?.valid === true,
    username: data?.user_name || null,
    message: data?.message,
  };
}

/** Token geçersizse kalıcı hata sayılır. */
export function isListenBrainzAuthError(error: unknown): boolean {
  return error instanceof ConnectionError && (error.code === 401 || error.code === 403);
}

/** 429 / ağ hatası → yeniden denenebilir. */
export function isListenBrainzRetryable(error: unknown): boolean {
  if (!(error instanceof ConnectionError)) return true;
  if (error.code === 401 || error.code === 403) return false;
  return true;
}

/** `playing_now` bildirimi (kuyruğa girmez). */
export async function submitPlayingNow(token: string, track: ScrobbleTrack): Promise<void> {
  await request('/submit-listens', {
    method: 'POST',
    token,
    body: JSON.stringify({
      listen_type: 'playing_now',
      payload: [
        {
          track_metadata: {
            artist_name: track.artist,
            track_name: track.track,
            ...(track.album ? { release_name: track.album } : {}),
          },
        },
      ],
    }),
  });
}

/** Tamamlanmış bir dinlemeyi gönderir. */
export async function submitListen(token: string, track: ScrobbleTrack): Promise<void> {
  await request('/submit-listens', {
    method: 'POST',
    token,
    body: JSON.stringify({
      listen_type: 'single',
      payload: [
        {
          listened_at: track.startedAt,
          track_metadata: {
            artist_name: track.artist,
            track_name: track.track,
            ...(track.album ? { release_name: track.album } : {}),
            ...(track.duration && track.duration > 0
              ? { additional_info: { duration_ms: Math.round(track.duration * 1000) } }
              : {}),
          },
        },
      ],
    }),
  });
}
