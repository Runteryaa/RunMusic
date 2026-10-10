import { useEffect } from 'react';
import { useActiveTrack, useIsPlaying } from 'react-native-track-player';
import { useStore } from '../store/useStore';
import { useThemeStore } from '../store/useThemeStore';

let MusicWidgetModule: any = null;
try {
  MusicWidgetModule = require('../../modules/music-widget/src/MusicWidgetModule').default;
} catch (e) {
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
      const title = activeTrack?.title || 'RunMusic';
      const artist = activeTrack?.artist || 'Müzik Çalar';
      const bgColor = theme.primary || '#212121';

      try {
        MusicWidgetModule.updateWidget(title, artist, artworkUri, playing, bgColor);
      } catch (e) {
        console.warn('Failed to update Android Widget:', e);
      }
    }
  }, [activeTrack?.title, activeTrack?.artist, playing, artworkUri, theme.primary]);

  useEffect(() => {
    if (!MusicWidgetModule || !MusicWidgetModule.addListener) return;
    const subscription = MusicWidgetModule.addListener('onWidgetAction', async (event: { action: string }) => {
      try {
        if (event.action === 'shuffle') {
          // Toggle shuffle
          const isShuffle = useStore.getState().isShuffle;
          const { setShuffle } = await import('../services/queueController');
          setShuffle(!isShuffle);
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
