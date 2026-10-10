import { registerWebModule, NativeModule } from 'expo';

class MusicWidgetModule extends NativeModule<{}> {}

export default registerWebModule(MusicWidgetModule, 'MusicWidgetModule');
