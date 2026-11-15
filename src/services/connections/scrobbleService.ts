import {
  addToQueue,
  createEntryId,
  dueEntries,
  loadQueue,
  markAttempt,
  removeFromQueue,
} from './scrobbleQueue';
import {
  isLastFmRetryable,
  isLastFmSessionInvalid,
  resolveLastFmCredentials,
  scrobbleTrack,
  updateNowPlaying,
} from './lastfm';
import {
  isListenBrainzAuthError,
  isListenBrainzRetryable,
  submitListen,
  submitPlayingNow,
} from './listenbrainz';
import { useConnectionsStore } from '../../store/useConnectionsStore';
import { ConnectionError, type ScrobbleEntry, type ScrobbleTarget, type ScrobbleTrack } from './types';

/**
 * Scrobble dağıtıcısı.
 *
 * Kuyruk (`scrobbleQueue`) ile servisler (`lastfm`, `listenbrainz`) arasındaki
 * tek köprü. Uygulamanın kendi istatistik katmanından bağımsızdır: burada
 * `statsDatabase` ne okunur ne yazılır.
 */

/** Aynı anda iki flush çalışmasın (açılış + periyodik tetikleme çakışabilir). */
let flushInFlight: Promise<void> | null = null;

function currentCredentials() {
  const state = useConnectionsStore.getState();
  return {
    state,
    lastfm: resolveLastFmCredentials(state.lastfmCustomApiKey, state.lastfmCustomSecret),
  };
}

/** "Şimdi çalıyor" bildirimi — kuyruğa girmez, hata sessizce yutulur. */
export async function broadcastNowPlaying(track: ScrobbleTrack): Promise<void> {
  const { state, lastfm } = currentCredentials();

  const tasks: Promise<unknown>[] = [];

  if (state.lastfm.sessionKey && state.lastfm.nowPlaying) {
    tasks.push(
      updateNowPlaying(lastfm, state.lastfm.sessionKey, track).catch((error) => {
        // Oturum düştüyse panelde görünsün; diğer durumlar önemsiz.
        if (isLastFmSessionInvalid(error)) {
          useConnectionsStore.getState().setLastFmError(
            'Last.fm oturumu geçersiz. Yeniden bağlanın.'
          );
        }
      })
    );
  }

  if (state.listenbrainz.token && state.listenbrainz.nowPlaying) {
    tasks.push(
      submitPlayingNow(state.listenbrainz.token, track).catch((error) => {
        if (isListenBrainzAuthError(error)) {
          useConnectionsStore.getState().setListenBrainzError(
            'ListenBrainz token geçersiz. Yeniden bağlanın.'
          );
        }
      })
    );
  }

  await Promise.allSettled(tasks);
}

/** Tamamlanan dinlemeyi kuyruğa ekler (gönderim ayrı yapılır). */
export async function queueScrobble(track: ScrobbleTrack): Promise<void> {
  const { state } = currentCredentials();
  const pending: ScrobbleEntry[] = [];

  const targets: ScrobbleTarget[] = [];
  if (state.lastfm.sessionKey && state.lastfm.scrobble) targets.push('lastfm');
  if (state.listenbrainz.token && state.listenbrainz.scrobble) targets.push('listenbrainz');
  if (targets.length === 0) return;

  const now = Date.now();
  for (const target of targets) {
    pending.push({
      ...track,
      id: createEntryId(target, track.startedAt),
      target,
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
    });
  }

  await Promise.all(pending.map((entry) => addToQueue(entry)));
}

async function sendEntry(entry: ScrobbleEntry): Promise<void> {
  const { state, lastfm } = currentCredentials();

  if (entry.target === 'lastfm') {
    if (!state.lastfm.sessionKey) throw new ConnectionError('Last.fm bağlı değil.', 9);
    await scrobbleTrack(lastfm, state.lastfm.sessionKey, entry);
    return;
  }

  if (!state.listenbrainz.token) throw new ConnectionError('ListenBrainz bağlı değil.', 401);
  await submitListen(state.listenbrainz.token, entry);
}

function isPermanentFailure(target: ScrobbleTarget, error: unknown): boolean {
  if (target === 'lastfm') return !isLastFmRetryable(error);
  return !isListenBrainzRetryable(error);
}

/**
 * Süresi gelmiş kayıtları gönderir.
 *
 * Başarılı kayıtlar kuyruktan düşer, geçici hatalar artan gecikmeyle ertelenir,
 * kalıcı hatalar (oturum/token geçersiz) kuyruktan atılır. Ağ yoksa fonksiyon
 * sessizce döner.
 */
export async function flushScrobbles(): Promise<void> {
  if (flushInFlight) return flushInFlight;

  flushInFlight = (async () => {
    try {
      const entries = await loadQueue();
      if (entries.length === 0) return;
      const now = Date.now();

      for (const target of ['lastfm', 'listenbrainz'] as ScrobbleTarget[]) {
        const due = dueEntries(entries, target, now);
        for (const entry of due) {
          try {
            await sendEntry(entry);
            await removeFromQueue([entry.id]);
          } catch (error) {
            await markAttempt([entry.id], isPermanentFailure(target, error));
            if (target === 'lastfm') {
              if (isLastFmSessionInvalid(error)) {
                useConnectionsStore.getState().setLastFmError(
                  'Last.fm oturumu geçersiz. Yeniden bağlanın.'
                );
              }
            } else if (isListenBrainzAuthError(error)) {
              useConnectionsStore.getState().setListenBrainzError(
                'ListenBrainz token geçersiz. Yeniden bağlanın.'
              );
            }
            // Ağ tamamen yoksa diğer kayıtları da denemeye çalışmak anlamsız.
            if (!(error instanceof ConnectionError)) break;
          }
        }
      }
    } catch {
      // Kuyruk okunamadı; sonraki tetiklemede yeniden denenir.
    } finally {
      flushInFlight = null;
    }
  })();

  return flushInFlight;
}
