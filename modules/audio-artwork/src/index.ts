import AudioArtworkModule from './AudioArtworkModule';
import { AudioTrackMetadata } from './AudioArtwork.types';

export * from './AudioArtwork.types';

export async function getArtworkAsync(uri: string, trackId?: string | null): Promise<string | null> {
  if (!AudioArtworkModule) return null;
  try {
    return await AudioArtworkModule.getArtworkAsync(uri, trackId ?? null);
  } catch {
    return null;
  }
}

export async function getBatchArtworksAsync(
  items: Array<{ id: string; uri: string }>
): Promise<Record<string, string>> {
  if (!AudioArtworkModule) return {};
  try {
    return await AudioArtworkModule.getBatchArtworksAsync(items);
  } catch {
    return {};
  }
}

export async function getMetadataAsync(
  uri: string,
  trackId?: string | null
): Promise<AudioTrackMetadata | null> {
  if (!AudioArtworkModule) return null;
  try {
    return await AudioArtworkModule.getMetadataAsync(uri, trackId ?? null);
  } catch {
    return null;
  }
}

export async function getBatchMetadataAsync(
  items: Array<{ id: string; uri: string }>
): Promise<Record<string, AudioTrackMetadata>> {
  if (!AudioArtworkModule) return {};
  try {
    return await AudioArtworkModule.getBatchMetadataAsync(items);
  } catch {
    return {};
  }
}

export async function getDominantColorAsync(uri: string): Promise<string | null> {
  if (!AudioArtworkModule) return null;
  try {
    if (typeof AudioArtworkModule.getDominantColorAsync === 'function') {
      return await AudioArtworkModule.getDominantColorAsync(uri);
    }
    return null;
  } catch {
    return null;
  }
}

export default {
  getArtworkAsync,
  getBatchArtworksAsync,
  getMetadataAsync,
  getBatchMetadataAsync,
  getDominantColorAsync,
};
