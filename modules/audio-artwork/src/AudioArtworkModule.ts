import { NativeModule, requireNativeModule } from 'expo';
import { AudioTrackMetadata } from './AudioArtwork.types';

declare class AudioArtworkModule extends NativeModule {
  getArtworkAsync(uri: string, trackId: string | null): Promise<string | null>;
  getBatchArtworksAsync(items: Array<{ id: string; uri: string }>): Promise<Record<string, string>>;
  getMetadataAsync(uri: string, trackId: string | null): Promise<AudioTrackMetadata | null>;
  getBatchMetadataAsync(
    items: Array<{ id: string; uri: string }>
  ): Promise<Record<string, AudioTrackMetadata>>;
  getDominantColorAsync(uri: string): Promise<string | null>;
}

export default requireNativeModule<AudioArtworkModule>('AudioArtwork');
