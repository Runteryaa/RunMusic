import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import TrackPlayer, {
  useActiveTrack,
  useIsPlaying,
  useProgress,
} from 'react-native-track-player';
import { useStore } from '../store/useStore';
import { usePlayerUIStore } from '../store/usePlayerUIStore';
import { useThemeStore } from '../store/useThemeStore';
import { TrackArtwork } from './TrackArtwork';
import { cleanYouTubeTitle, getSearchKeywords } from '../services/lyricsService';
import { saveLastPlayback } from '../services/playbackStorage';

function getRandomIndex(length: number): number {
  return Math.floor(Math.random() * length);
}

export function MiniPlayer() {
  const activeTrack = useActiveTrack();
  const { playing } = useIsPlaying();
  const progress = useProgress(500);

  const theme = useThemeStore((s) => s.theme);
  const openFullscreenPlayer = usePlayerUIStore((s) => s.openFullscreenPlayer);
  const metadataMap = useStore((s) => s.metadataMap);
  const artworkMap = useStore((s) => s.artworkMap);
  const isShuffle = useStore((s) => s.isShuffle);

  const duration = progress.duration > 0 ? progress.duration : 0;
  const progressPercent = duration > 0 ? Math.min(1, Math.max(0, progress.position / duration)) : 0;

  const activeMeta = activeTrack?.id ? metadataMap[activeTrack.id] : undefined;
  const activeKeywords = getSearchKeywords(activeTrack?.title || '', activeTrack?.artist || '');
  const rawArtist =
    (activeMeta?.artist?.trim() && activeMeta.artist !== 'Local Audio' && activeMeta.artist !== 'Bilinmeyen Sanatçı'
      ? cleanYouTubeTitle(activeMeta.artist)
      : '') ||
    (activeKeywords.expectedArtist && activeKeywords.expectedArtist !== 'Local Audio' && activeKeywords.expectedArtist !== 'Bilinmeyen Sanatçı'
      ? activeKeywords.expectedArtist
      : (activeTrack?.artist && activeTrack.artist !== 'Local Audio' && activeTrack.artist !== 'Bilinmeyen Sanatçı'
          ? cleanYouTubeTitle(activeTrack.artist)
          : 'Bilinmeyen Sanatçı'));

  const rawTitle =
    (activeMeta?.title?.trim() ? cleanYouTubeTitle(activeMeta.title) : '') ||
    activeKeywords.expectedTrack ||
    cleanYouTubeTitle(activeTrack?.title || '') ||
    'Bilinmeyen Parça';

  const displayArtist = rawArtist;
  const displayTitle = rawTitle;

  const artworkUri =
    (activeTrack?.id ? metadataMap[activeTrack.id]?.artwork || artworkMap[activeTrack.id] : undefined) ||
    (typeof activeTrack?.artwork === 'string' ? activeTrack.artwork : undefined);

  const skipNext = React.useCallback(async () => {
    try {
      if (isShuffle) {
        const q = await TrackPlayer.getQueue();
        if (q.length > 1) {
          const currentIndex = await TrackPlayer.getActiveTrackIndex();
          let nextIndex = getRandomIndex(q.length);
          if (nextIndex === currentIndex) {
            nextIndex = (nextIndex + 1) % q.length;
          }
          await TrackPlayer.skip(nextIndex);
          await TrackPlayer.play();
          return;
        }
      }
      await TrackPlayer.skipToNext();
      await TrackPlayer.play();
    } catch (e) {
      console.warn('Skip next failed', e);
    }
  }, [isShuffle]);

  const skipPrev = React.useCallback(async () => {
    try {
      const { position } = await TrackPlayer.getProgress();
      if (position > 3) {
        await TrackPlayer.seekTo(0);
      } else {
        await TrackPlayer.skipToPrevious();
        await TrackPlayer.play();
      }
    } catch (e) {
      console.warn('Skip prev failed', e);
    }
  }, []);

  const togglePlayback = async () => {
    if (playing) {
      await TrackPlayer.pause();
      if (activeTrack && progress.position > 0) {
        TrackPlayer.getActiveTrackIndex().then((idx) => {
          saveLastPlayback(
            {
              trackId: activeTrack.id || activeTrack.url,
              trackIndex: idx ?? 0,
              position: progress.position,
              track: {
                id: activeTrack.id || activeTrack.url,
                url: activeTrack.url,
                title: activeTrack.title,
                artist: activeTrack.artist,
                artwork: typeof activeTrack.artwork === 'string' ? activeTrack.artwork : undefined,
              },
            },
            true
          );
        }).catch(() => {});
      }
    } else {
      await TrackPlayer.play();
    }
  };

  // PanResponder for gestures (Tap, Swipe Left/Right, Swipe Up)
  const panResponder = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 15 || Math.abs(gesture.dy) > 15,
        onPanResponderRelease: (_, gesture) => {
          if (Math.abs(gesture.dx) < 10 && Math.abs(gesture.dy) < 10) {
            // Normal dokunma: Tam ekran çaları aç
            openFullscreenPlayer();
          } else if (gesture.dy < -30) {
            // Yukarı kaydırma: Tam ekran çaları aç
            openFullscreenPlayer();
          } else if (gesture.dx < -40) {
            // Sola kaydırma: Sonraki şarkı
            skipNext();
          } else if (gesture.dx > 40) {
            // Sağa kaydırma: Önceki şarkı
            skipPrev();
          }
        },
      }),
    [openFullscreenPlayer, skipNext, skipPrev]
  );

  if (!activeTrack) {
    return null;
  }

  return (
    <View
      style={[styles.miniPlayerContainer, { borderColor: theme.border }]}
      {...panResponder.panHandlers}>
      {/* Top 2px Progress Bar with dynamic theme color */}
      <View style={styles.progressBarTrack}>
        <View
          style={[
            styles.progressBarFill,
            { backgroundColor: theme.primary, width: `${progressPercent * 100}%` },
          ]}
        />
      </View>

      <View style={styles.contentRow}>
        {/* Cover Thumbnail */}
        <View style={styles.artworkBox}>
          <TrackArtwork
            uri={artworkUri}
            trackId={activeTrack.id}
            trackUri={activeTrack.url}
            size={44}
            borderRadius={8}
            iconSize={22}
          />
        </View>

        {/* Title & Artist */}
        <View style={styles.textDetailsBox}>
          <Text style={styles.titleText} numberOfLines={1}>
            {displayTitle}
          </Text>
          <Text style={styles.artistText} numberOfLines={1}>
            {displayArtist}
          </Text>
        </View>

        {/* Controls: Play/Pause and Next */}
        <View style={styles.controlsBox}>
          <TouchableOpacity
            style={styles.controlIconBtn}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
            onPress={togglePlayback}>
            <Ionicons
              name={playing ? 'pause' : 'play'}
              size={24}
              color="#ffffff"
              style={!playing ? { marginLeft: 2 } : undefined}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.controlIconBtn}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
            onPress={skipNext}>
            <Ionicons name="play-skip-forward" size={22} color="#ffffff" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  miniPlayerContainer: {
    backgroundColor: '#1f1f23',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginHorizontal: 10,
    marginBottom: 4,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 12,
  },
  progressBarTrack: {
    height: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    width: '100%',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#ffffff',
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  artworkBox: {
    marginRight: 12,
  },
  textDetailsBox: {
    flex: 1,
    justifyContent: 'center',
    marginRight: 10,
  },
  titleText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  artistText: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  controlsBox: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  controlIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 4,
  },
});
