import AudioArtworkModule from './AudioArtworkModule';

export async function getArtworkAsync(uri: string, trackId?: string | null): Promise<string | null> {
  try {
    return await AudioArtworkModule.getArtworkAsync(uri, trackId ?? null);
  } catch (e) {
    return null;
  }
}

export async function getBatchArtworksAsync(
  items: Array<{ id: string; uri: string }>
): Promise<Record<string, string>> {
  try {
    return await AudioArtworkModule.getBatchArtworksAsync(items);
  } catch (e) {
    return {};
  }
}

export default {
  getArtworkAsync,
  getBatchArtworksAsync,
};
