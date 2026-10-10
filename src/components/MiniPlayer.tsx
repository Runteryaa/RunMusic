import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  PanResponder,
  Animated,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import TrackPlayer, {
  useActiveTrack,
  useIsPlaying,
  useProgress,
  Track,
} from 'react-native-track-player';
import { useStore } from '../store/useStore';
import { usePlayerUIStore } from '../store/usePlayerUIStore';
import { useThemeStore } from '../store/useThemeStore';
import { TrackArtwork } from './TrackArtwork';
import { cleanYouTubeTitle, getSearchKeywords } from '../services/lyricsService';
import { saveLastPlayback } from '../services/playbackStorage';

const SCREEN_WIDTH = Dimensions.get('window').width;

function getRandomIndex(length: number): number {
  return Math.floor(Math.random() * length);
}

export function MiniPlayer({ isEmbedded = false }: { isEmbedded?: boolean } = {}) {
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

  // Local Queue State for Next/Prev Previews
  const [queue, setQueue] = useState<Track[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [shuffleNextIndex, setShuffleNextIndex] = useState<number | null>(null);

  useEffect(() => {
    const fetchQueue = async () => {
      try {
        const q = await TrackPlayer.getQueue();
        const idx = await TrackPlayer.getActiveTrackIndex();
        setQueue(q || []);
        setActiveIndex(idx ?? 0);
      } catch (e) {
        console.warn('MiniPlayer queue fetch err:', e);
      }
    };
    if (activeTrack) {
      fetchQueue();
    }
  }, [activeTrack]);

  useEffect(() => {
    if (isShuffle && queue.length > 1) {
      let nextIndex = getRandomIndex(queue.length);
      if (nextIndex === activeIndex) {
        nextIndex = (nextIndex + 1) % queue.length;
      }
      setShuffleNextIndex(nextIndex);
    } else {
      setShuffleNextIndex(null);
    }
  }, [activeIndex, queue.length, isShuffle]);

  const prevTrack = useMemo(() => {
    if (queue.length <= 1) return null;
    if (activeIndex > 0) return queue[activeIndex - 1];
    return queue[queue.length - 1];
  }, [queue, activeIndex]);

  const nextTrack = useMemo(() => {
    if (queue.length <= 1) return null;
    if (isShuffle && shuffleNextIndex !== null) return queue[shuffleNextIndex];
    if (activeIndex < queue.length - 1) return queue[activeIndex + 1];
    return queue[0];
  }, [queue, activeIndex, isShuffle, shuffleNextIndex]);

  // Track Meta Helper
  const getTrackMeta = useCallback((track: Track | null) => {
    if (!track) return { title: '', artist: '', artwork: undefined };
    const meta = track.id ? metadataMap[track.id] : undefined;
    const keywords = getSearchKeywords(track.title || '', track.artist || '');
    
    let rawArtist =
      (meta?.artist?.trim() && meta.artist !== 'Local Audio' && meta.artist !== 'Bilinmeyen Sanatçı'
        ? cleanYouTubeTitle(meta.artist)
        : '') ||
      (keywords.expectedArtist && keywords.expectedArtist !== 'Local Audio' && keywords.expectedArtist !== 'Bilinmeyen Sanatçı'
        ? keywords.expectedArtist
        : (track.artist && track.artist !== 'Local Audio' && track.artist !== 'Bilinmeyen Sanatçı'
            ? cleanYouTubeTitle(track.artist)
            : 'Bilinmeyen Sanatçı'));
            
    let rawTitle =
      (meta?.title?.trim() ? cleanYouTubeTitle(meta.title) : '') ||
      keywords.expectedTrack ||
      cleanYouTubeTitle(track.title || '') ||
      'Bilinmeyen Parça';
      
    let artworkUri =
      (track.id ? meta?.artwork || artworkMap[track.id] : undefined) ||
      (typeof track.artwork === 'string' ? track.artwork : undefined);
      
    return { title: rawTitle, artist: rawArtist, artwork: artworkUri };
  }, [metadataMap, artworkMap]);

  const activeMeta = useMemo(() => getTrackMeta(activeTrack || null), [activeTrack, getTrackMeta]);
  const prevMeta = useMemo(() => getTrackMeta(prevTrack), [prevTrack, getTrackMeta]);
  const nextMeta = useMemo(() => getTrackMeta(nextTrack), [nextTrack, getTrackMeta]);

  const skipNext = useCallback(async () => {
    try {
      if (isShuffle && shuffleNextIndex !== null) {
        await TrackPlayer.skip(shuffleNextIndex);
        await TrackPlayer.play();
        return;
      }
      if (activeIndex === queue.length - 1 && queue.length > 0) {
        await TrackPlayer.skip(0);
      } else {
        await TrackPlayer.skipToNext();
      }
      await TrackPlayer.play();
    } catch (e) {
      console.warn('Skip next failed', e);
    }
  }, [isShuffle, shuffleNextIndex, activeIndex, queue.length]);



  const gestureSkipPrev = useCallback(async () => {
    try {
      if (activeIndex === 0 && queue.length > 0) {
        await TrackPlayer.skip(queue.length - 1);
      } else {
        await TrackPlayer.skipToPrevious();
      }
      await TrackPlayer.play();
    } catch (e) {
      console.warn('Gesture skip prev failed', e);
    }
  }, [activeIndex, queue.length]);

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

  const miniPanX = useMemo(() => new Animated.Value(0), []);
  const isMiniSkippingRef = useRef(false);
  const currentTrackIdRef = useRef(activeTrack?.id);

  // When activeTrack changes, snap back to center (seamless page turn)
  useEffect(() => {
    if (currentTrackIdRef.current !== activeTrack?.id) {
      currentTrackIdRef.current = activeTrack?.id;
      if (isMiniSkippingRef.current) {
        miniPanX.setValue(0);
        isMiniSkippingRef.current = false;
      }
    }
  }, [activeTrack?.id, miniPanX]);

  // PanResponder for gestures
  const panResponder = useMemo(
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
          miniPanX.setValue(gesture.dx * 0.9); 
        },
        onPanResponderRelease: (_, gesture) => {
          if (isMiniSkippingRef.current) return;
          
          if (gesture.dy < -25 && Math.abs(gesture.dy) > Math.abs(gesture.dx)) {
            openFullscreenPlayer();
            return;
          }
          
          if (gesture.dx < -35) {
            // Sola kaydırma: Sonraki şarkı
            isMiniSkippingRef.current = true;
            Animated.timing(miniPanX, {
              toValue: -SCREEN_WIDTH * 0.8,
              duration: 250,
              useNativeDriver: true,
            }).start(() => {
              skipNext();
              setTimeout(() => {
                if (isMiniSkippingRef.current) {
                  miniPanX.setValue(0);
                  isMiniSkippingRef.current = false;
                }
              }, 800);
            });
          } else if (gesture.dx > 35) {
            // Sağa kaydırma: Önceki şarkı
            isMiniSkippingRef.current = true;
            Animated.timing(miniPanX, {
              toValue: SCREEN_WIDTH * 0.8,
              duration: 250,
              useNativeDriver: true,
            }).start(() => {
              gestureSkipPrev();
              setTimeout(() => {
                if (isMiniSkippingRef.current) {
                  miniPanX.setValue(0);
                  isMiniSkippingRef.current = false;
                }
              }, 800);
            });
          } else {
            // Snap back
            Animated.spring(miniPanX, {
              toValue: 0,
              tension: 100,
              friction: 10,
              useNativeDriver: true,
            }).start();
          }
        },
      });
    },
    [openFullscreenPlayer, skipNext, gestureSkipPrev, miniPanX]
  );

  if (!activeTrack) {
    return null;
  }

  return (
    <View
      style={[
        styles.miniPlayerContainer,
        isEmbedded && styles.miniPlayerContainerEmbedded,
        { borderColor: theme.border || 'rgba(255, 255, 255, 0.12)' },
      ]}
      {...panResponder.panHandlers}>
      {/* Top 2px Progress Bar */}
      <View style={styles.progressBarTrack}>
        <View
          style={[
            styles.progressBarFill,
            { backgroundColor: theme.primary, width: `${progressPercent * 100}%` },
          ]}
        />
      </View>

      <View style={styles.contentRow}>
        <View style={{ flex: 1, overflow: 'hidden', marginRight: 4 }}>
          <Animated.View
            style={[
              styles.animatedInfoRow,
              {
                transform: [{ translateX: miniPanX }],
              },
            ]}>
            
            {/* PREV TRACK PREVIEW */}
            {prevTrack && (
              <View style={[styles.mainInfoPressable, { position: 'absolute', right: '100%', width: '100%', paddingRight: 24 }]}>
                <View style={styles.artworkBox}>
                  <TrackArtwork
                    uri={prevMeta.artwork}
                    trackId={prevTrack.id}
                    trackUri={prevTrack.url}
                    size={44}
                    borderRadius={8}
                    iconSize={22}
                  />
                </View>
                <View style={styles.textDetailsBox}>
                  <Text style={styles.titleText} numberOfLines={1}>{prevMeta.title}</Text>
                  <Text style={styles.artistText} numberOfLines={1}>{prevMeta.artist}</Text>
                </View>
              </View>
            )}

            {/* ACTIVE TRACK */}
            <TouchableOpacity
              style={[styles.mainInfoPressable, { width: '100%' }]}
              activeOpacity={0.8}
              onPress={openFullscreenPlayer}>
              <View style={styles.artworkBox}>
                <TrackArtwork
                  uri={activeMeta.artwork}
                  trackId={activeTrack.id}
                  trackUri={activeTrack.url}
                  size={44}
                  borderRadius={8}
                  iconSize={22}
                />
              </View>
              <View style={styles.textDetailsBox}>
                <Text style={styles.titleText} numberOfLines={1}>
                  {activeMeta.title}
                </Text>
                <Text style={styles.artistText} numberOfLines={1}>
                  {activeMeta.artist}
                </Text>
              </View>
            </TouchableOpacity>

            {/* NEXT TRACK PREVIEW */}
            {nextTrack && (
              <View style={[styles.mainInfoPressable, { position: 'absolute', left: '100%', width: '100%', paddingLeft: 24 }]}>
                <View style={styles.artworkBox}>
                  <TrackArtwork
                    uri={nextMeta.artwork}
                    trackId={nextTrack.id}
                    trackUri={nextTrack.url}
                    size={44}
                    borderRadius={8}
                    iconSize={22}
                  />
                </View>
                <View style={styles.textDetailsBox}>
                  <Text style={styles.titleText} numberOfLines={1}>{nextMeta.title}</Text>
                  <Text style={styles.artistText} numberOfLines={1}>{nextMeta.artist}</Text>
                </View>
              </View>
            )}
            
          </Animated.View>
        </View>

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
    backgroundColor: '#18181b',
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 0,
    marginHorizontal: 10,
    marginBottom: 0,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 12,
  },
  miniPlayerContainerEmbedded: {
    marginHorizontal: 0,
    borderTopWidth: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    backgroundColor: 'transparent',
    elevation: 0,
    shadowOpacity: 0,
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
    backgroundColor: '#18181b',
    paddingLeft: 6,
    zIndex: 10,
  },
  controlIconBtn: {
    width: 42,
    height: 42,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 4,
  },
});
