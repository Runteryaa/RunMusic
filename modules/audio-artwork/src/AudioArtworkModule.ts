import { NativeModule, requireNativeModule } from 'expo';

declare class AudioArtworkModule extends NativeModule {
  getArtworkAsync(uri: string, trackId: string | null): Promise<string | null>;
  getBatchArtworksAsync(items: Array<{ id: string; uri: string }>): Promise<Record<string, string>>;
}

export default requireNativeModule<AudioArtworkModule>('AudioArtwork');
