import { NativeModule, requireNativeModule } from 'expo';

declare class MusicWidgetModule extends NativeModule {
  updateWidget(title: string, artist: string, artworkUri: string | null, isPlaying: boolean, bgColorHex: string | null): Promise<void>;
}

export default requireNativeModule<MusicWidgetModule>('MusicWidget');
