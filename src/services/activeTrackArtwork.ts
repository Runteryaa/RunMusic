import TrackPlayer, { type Track } from 'react-native-track-player';
import { getArtworkAsync } from '../../modules/audio-artwork/src';
import { useStore } from '../store/useStore';
import { useRemoteConnectStore } from '../store/useRemoteConnectStore';

/**
 * Active-track artwork resolution.
 *
 * The media notification/lock screen may need a cover while the player UI is
 * unmounted in the background. Resolve and cache artwork for the CURRENT track
 * only; queued tracks must not keep their own decoded artwork/notification
 * metadata alive. The next track is resolved when it actually becomes active.
 */

let inFlightKey: string | null = null;
let inFlightPromise: Promise<string | null> | null = null;

function resolveTrackKey(track: Track | null | undefined): string {
  if (!track) return '';
  const rawId = String(track.id ?? '').trim();
  const rawUrl = String(track.url ?? '').trim();
  if (!rawId && !rawUrl) return '';

  const allAssets = useStore.getState().allAssets;
  const matched = allAssets.find(
    (asset) =>
      asset.id === rawId ||
      asset.uri === rawId ||
      (rawUrl && asset.uri === rawUrl)
  );
  return matched?.id || rawId || rawUrl;
}

function findKnownArtwork(track: Track, key: string): string | undefined {
  const store = useStore.getState();
  const rawId = String(track.id ?? '').trim();
  const rawUrl = String(track.url ?? '').trim();

  return (
    store.metadataMap[key]?.artwork ||
    store.artworkMap[key] ||
    (rawId ? store.metadataMap[rawId]?.artwork || store.artworkMap[rawId] : undefined) ||
    (rawUrl ? store.metadataMap[rawUrl]?.artwork || store.artworkMap[rawUrl] : undefined) ||
    (typeof track.artwork === 'string' ? track.artwork : undefined)
  );
}

async function applyArtwork(
  track: Track,
  key: string,
  artwork: string,
  indexHint?: number | null
): Promise<void> {
  let index = typeof indexHint === 'number' && indexHint >= 0 ? indexHint : null;
  if (index === null) {
    const activeIndex = await TrackPlayer.getActiveTrackIndex().catch(() => null);
    index = typeof activeIndex === 'number' && activeIndex >= 0 ? activeIndex : null;
  }
  if (typeof index !== 'number' || index < 0) return;

  const active = await TrackPlayer.getActiveTrack().catch(() => null);
  const activeTrack = active || track;
  const activeKey = resolveTrackKey(activeTrack);
  if (activeKey && activeKey !== key) return;

  if (typeof activeTrack.artwork === 'string' && activeTrack.artwork === artwork) {
    return;
  }

  await TrackPlayer.updateMetadataForTrack(index, {
    title: activeTrack.title,
    artist: activeTrack.artist,
    album: activeTrack.album,
    duration: activeTrack.duration,
    artwork,
  }).catch(() => {});
}

export async function ensureActiveTrackArtwork(
  fallbackTrack?: Track | null,
  indexHint?: number | null
): Promise<string | null> {
  if (useRemoteConnectStore.getState().mode === 'client') return null;
  if (useRemoteConnectStore.getState().isRemoteConnected()) return null;

  const active = await TrackPlayer.getActiveTrack().catch(() => null);
  if (!active && indexHint == null) return null;
  const track = active || fallbackTrack || null;
  if (!track) return null;

  const rawId = String(track.id ?? '');
  if (rawId.startsWith('remote_')) return null;

  const key = resolveTrackKey(track);
  if (!key) return null;

  const knownArtwork = findKnownArtwork(track, key);
  if (knownArtwork) {
    await applyArtwork(track, key, knownArtwork, indexHint);
    return knownArtwork;
  }

  const url = String(track.url ?? '').trim();
  if (!url) return null;

  if (inFlightKey === key && inFlightPromise) {
    return inFlightPromise;
  }

  inFlightKey = key;
  inFlightPromise = (async () => {
    try {
      const resolved = await getArtworkAsync(url, key);
      if (!resolved) return null;

      useStore.getState().setArtwork(key, resolved);
      await applyArtwork(track, key, resolved, indexHint);
      return resolved;
    } catch {
      return null;
    } finally {
      if (inFlightKey === key) {
        inFlightKey = null;
        inFlightPromise = null;
      }
    }
  })();

  return inFlightPromise;
}
