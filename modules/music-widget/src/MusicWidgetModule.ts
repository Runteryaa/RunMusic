import { Platform } from 'react-native';
import { NativeModule, requireNativeModule } from 'expo';

declare class MusicWidgetModule extends NativeModule {
  updateWidget(title: string, artist: string, artworkUri: string | null, isPlaying: boolean, bgColorHex: string | null): Promise<void>;
  moveAppToBack?(): boolean;
}

const mockModule: MusicWidgetModule = {
  updateWidget: async () => {},
  moveAppToBack: () => false,
  addListener: () => ({ remove: () => {} }),
  removeListeners: () => {},
} as unknown as MusicWidgetModule;

export default Platform.OS === 'android'
  ? requireNativeModule<MusicWidgetModule>('MusicWidget')
  : mockModule;
