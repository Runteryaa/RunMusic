import { useEffect } from 'react';
import { useActiveTrack, useIsPlaying } from 'react-native-track-player';
import { useStore } from '../store/useStore';
import { useThemeStore } from '../store/useThemeStore';
import { resolveDisplayMetadata } from '../services/displayMetadata';

let MusicWidgetModule: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  MusicWidgetModule = require('../../modules/music-widget/src/MusicWidgetModule').default;
} catch {
  // Module might not be linked yet during fast refresh or web
}

export function useWidgetUpdater() {
  const activeTrack = useActiveTrack();
  const { playing } = useIsPlaying();
  const activeTrackId = activeTrack?.id;
  const storeArtwork = useStore((s) =>
    activeTrackId ? s.metadataMap[activeTrackId]?.artwork || s.artworkMap[activeTrackId] : undefined
  );
  const theme = useThemeStore((s) => s.theme);

  const artworkUri = storeArtwork || (typeof activeTrack?.artwork === 'string' ? activeTrack.artwork : null);

  useEffect(() => {
    if (MusicWidgetModule && MusicWidgetModule.updateWidget) {
      /*
       * Ana ekran widget'ı, oynatıcı ekranındaki ismi göstermeli: kullanıcının
       * düzenlediği başlık/sanatçı `metadataMap`'te, ham (dosya adı) değer ise
       * kuyruk kaydındadır. `resolveDisplayMetadata` oyuncuyla aynı sırayı
       * uygular (önce düzenlenmiş meta, sonra kayıt).
       */
      const displayMeta = resolveDisplayMetadata(activeTrack);
      const title = displayMeta.title;
      const artist = displayMeta.artist;
      const bgColor = theme.primary || '#212121';

      try {
        MusicWidgetModule.updateWidget(
          title,
          artist,
          artworkUri ?? displayMeta.artwork,
          playing,
          bgColor
        );
      } catch (e) {
        console.warn('Failed to update Android Widget:', e);
      }
    }
  }, [activeTrack, playing, artworkUri, theme.primary]);

  useEffect(() => {
    if (!MusicWidgetModule || !MusicWidgetModule.addListener) return;
    const subscription = MusicWidgetModule.addListener('onWidgetAction', async (event: { action: string }) => {
      try {
        if (event.action === 'shuffle') {
          // Toggle shuffle; enabling keeps the previous Smart Mix choice.
          const { isShuffle, isSmartShuffle } = useStore.getState();
          const { setShuffle } = await import('../services/queueController');
          await setShuffle(!isShuffle, isShuffle ? false : isSmartShuffle);
        } else if (event.action === 'star') {
          // You might have a favorite function, but for now we'll do nothing or a simple toast
          console.log('Star clicked');
        }
      } catch (e) {
        console.error('Widget action error', e);
      }
    });
    return () => {
      subscription.remove();
    };
  }, []);
}
