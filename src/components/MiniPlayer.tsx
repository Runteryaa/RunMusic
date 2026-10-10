import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  PanResponder,
  Animated,
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

  const miniPanX = React.useMemo(() => new Animated.Value(0), []);
  const isMiniSkippingRef = React.useRef(false);

  // PanResponder for gestures (Swipe Left/Right, Swipe Up) with real-time animation
  const panResponder = React.useMemo(
    () => {
      // eslint-disable-next-line react-hooks/refs
      return PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_, gesture) =>
          !isMiniSkippingRef.current && (Math.abs(gesture.dx) > 12 || gesture.dy < -12),
        onMoveShouldSetPanResponderCapture: (_, gesture) =>
          !isMiniSkippingRef.current && (Math.abs(gesture.dx) > 12 || gesture.dy < -12),
        onPanResponderMove: (_, gesture) => {
          if (isMiniSkippingRef.current) return;
          if (gesture.dy < -15 && Math.abs(gesture.dy) > Math.abs(gesture.dx)) return;
          miniPanX.setValue(gesture.dx * 0.7);
        },
        onPanResponderRelease: (_, gesture) => {
          if (isMiniSkippingRef.current) return;
          if (gesture.dy < -25 && Math.abs(gesture.dy) > Math.abs(gesture.dx)) {
            // Yukarı kaydırma: Tam ekran çaları aç
            openFullscreenPlayer();
            return;
          }
          if (gesture.dx < -35) {
            // Sola kaydırma: Sonraki şarkı — hemen geç, animasyon paralel
            isMiniSkippingRef.current = true;
            skipNext();
            Animated.spring(miniPanX, {
              toValue: -90,
              tension: 70,
              friction: 9,
              useNativeDriver: true,
            }).start(() => {
              miniPanX.setValue(0);
              isMiniSkippingRef.current = false;
            });
          } else if (gesture.dx > 35) {
            // Sağa kaydırma: Önceki şarkı — hemen geç, animasyon paralel
            isMiniSkippingRef.current = true;
            skipPrev();
            Animated.spring(miniPanX, {
              toValue: 90,
              tension: 70,
              friction: 9,
              useNativeDriver: true,
            }).start(() => {
              miniPanX.setValue(0);
              isMiniSkippingRef.current = false;
            });
          } else {
            Animated.spring(miniPanX, {
              toValue: 0,
              tension: 80,
              friction: 8,
              useNativeDriver: true,
            }).start();
          }
        },
      });
    },
    [openFullscreenPlayer, skipNext, skipPrev, miniPanX]
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
        <Animated.View
          style={[
            styles.animatedInfoRow,
            {
              transform: [{ translateX: miniPanX }],
              opacity: miniPanX.interpolate({
                inputRange: [-80, 0, 80],
                outputRange: [0.4, 1, 0.4],
                extrapolate: 'clamp',
              }),
            },
          ]}>
          {/* Cover + Info: Dokunulduğunda tam ekran çaları açar */}
          <TouchableOpacity
            style={styles.mainInfoPressable}
            activeOpacity={0.8}
            onPress={openFullscreenPlayer}>
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

            <View style={styles.textDetailsBox}>
              <Text style={styles.titleText} numberOfLines={1}>
                {displayTitle}
              </Text>
              <Text style={styles.artistText} numberOfLines={1}>
                {displayArtist}
              </Text>
            </View>
          </TouchableOpacity>
        </Animated.View>

        {/* Controls: Play/Pause and Next */}
        <View style={styles.controlsBox}>
          <TouchableOpacity
            style={styles.controlIconBtn}
            activeOpacity={0.65}
            hitSlop={{ top: 14, bottom: 14, left: 12, right: 12 }}
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
            activeOpacity={0.65}
            hitSlop={{ top: 14, bottom: 14, left: 12, right: 12 }}
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
    justifyContent: 'space-between',
  },
  animatedInfoRow: {
    flex: 1,
    flexDirection: 'row',
  },
  mainInfoPressable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
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
