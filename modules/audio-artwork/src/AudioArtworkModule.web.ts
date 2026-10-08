import { registerWebModule, NativeModule } from 'expo';

class AudioArtworkModule extends NativeModule {
  async getArtworkAsync(_uri: string, _trackId: string | null): Promise<string | null> {
    return null;
  }
  async getBatchArtworksAsync(_items: Array<{ id: string; uri: string }>): Promise<Record<string, string>> {
    return {};
  }
}

export default registerWebModule(AudioArtworkModule, 'AudioArtwork');
