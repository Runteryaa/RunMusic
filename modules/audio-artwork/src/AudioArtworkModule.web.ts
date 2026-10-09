import { registerWebModule, NativeModule } from 'expo';
import { AudioTrackMetadata } from './AudioArtwork.types';

class AudioArtworkModule extends NativeModule {
  async getArtworkAsync(_uri: string, _trackId: string | null): Promise<string | null> {
    return null;
  }
  async getBatchArtworksAsync(_items: Array<{ id: string; uri: string }>): Promise<Record<string, string>> {
    return {};
  }
  async getMetadataAsync(_uri: string, _trackId: string | null): Promise<AudioTrackMetadata | null> {
    return null;
  }
  async getBatchMetadataAsync(
    _items: Array<{ id: string; uri: string }>
  ): Promise<Record<string, AudioTrackMetadata>> {
    return {};
  }
}

export default registerWebModule(AudioArtworkModule, 'AudioArtwork');
