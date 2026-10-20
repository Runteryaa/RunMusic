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
  RepeatMode,
  Track,
} from 'react-native-track-player';
import { useStore } from '../store/useStore';
import { usePlayerUIStore } from '../store/usePlayerUIStore';
import { useThemeStore } from '../store/useThemeStore';
import { useRemoteConnectStore } from '../store/useRemoteConnectStore';
import { useActivePlayer } from '../hooks/useActivePlayer';
import { useActiveProgress } from '../hooks/useActiveProgress';
import { TrackArtwork } from './TrackArtwork';
import { MarqueeText } from './ui/MarqueeText';
import { cleanYouTubeTitle, cleanDisplayTitle, getSearchKeywords } from '../services/lyricsService';
import { saveLastPlayback, updateQueueSnapshotActiveIndex } from '../services/playbackStorage';
import { useTranslation } from '../services/i18n';

const SCREEN_WIDTH = Dimensions.get('window').width;

export function MiniPlayer({ isEmbedded = false }: { isEmbedded?: boolean } = {}) {
  const { t } = useTranslation();
  const player = useActivePlayer();
  const progress = useActiveProgress();

  const theme = useThemeStore((s) => s.theme);
  const openFullscreenPlayer = usePlayerUIStore((s) => s.openFullscreenPlayer);
  const metadataMap = useStore((s) => s.metadataMap);
  const artworkMap = useStore((s) => s.artworkMap);

  const duration = progress.duration > 0 ? progress.duration : 0;
  const progressPercent = duration > 0 ? Math.min(1, Math.max(0, progress.position / duration)) : 0;

  // Queue State for Next/Prev Previews
  const [localQueue, setLocalQueue] = useState<Track[]>([]);
  const [localActiveIndex, setLocalActiveIndex] = useState<number>(0);
  const remoteQueue = useRemoteConnectStore((s) => s.remoteState.queue);

  useEffect(() => {
    if (player.isRemote) return;
    const fetchQueue = async () => {
      try {
        const q = await TrackPlayer.getQueue();
        const idx = await TrackPlayer.getActiveTrackIndex();
        setLocalQueue(q || []);
        setLocalActiveIndex(idx ?? 0);
      } catch (e) {
        console.warn('MiniPlayer queue fetch err:', e);
      }
    };
    if (player.activeTrack) {
      fetchQueue();
    }
  }, [player.activeTrack, player.isRemote]);

  const queue = player.isRemote ? (remoteQueue as any[]) : localQueue;
  const activeIndex = player.isRemote
    ? remoteQueue.findIndex((t) => t.id === player.activeTrack?.id)
    : localActiveIndex;

  const prevTrack = useMemo(() => {
    if (queue.length <= 1) return null;
    if (activeIndex > 0) return queue[activeIndex - 1];
    return player.repeatMode === RepeatMode.Queue ? queue[queue.length - 1] : null;
  }, [queue, activeIndex, player.repeatMode]);

  const nextTrack = useMemo(() => {
    if (queue.length <= 1) return null;
    if (activeIndex >= 0 && activeIndex < queue.length - 1) return queue[activeIndex + 1];
    return player.repeatMode === RepeatMode.Queue ? queue[0] : null;
  }, [queue, activeIndex, player.repeatMode]);

  // Track Meta Helper
  const getTrackMeta = useCallback(
    (track: { id?: string; title?: string; artist?: string; url?: string; artwork?: any } | null) => {
      if (!track) return { title: '', artist: '', artwork: undefined };

      const isCurrentActive = track.id === player.activeTrack?.id;
      if (player.isRemote && isCurrentActive) {
        return {
          title: track.title || t('common.unknown_track'),
          artist: track.artist || t('common.unknown_artist'),
          artwork: player.artworkUri || undefined,
        };
      }

      const meta =
        (track.id ? metadataMap[track.id] : undefined) ||
        (track.url ? metadataMap[track.url] : undefined);
      const keywords = getSearchKeywords(track.title || '', track.artist || '');

      const unknownArtist = t('common.unknown_artist');
      const unknownTrack = t('common.unknown_track');

      let rawArtist =
        (meta?.artist?.trim() && meta.artist !== 'Local Audio' && meta.artist !== 'Bilinmeyen Sanatçı'
          ? meta.artist.trim()
          : '') ||
        (isCurrentActive && player.activeTrack?.artist && player.activeTrack.artist !== 'Unknown Artist' && player.activeTrack.artist !== 'Local Audio'
          ? player.activeTrack.artist
          : '') ||
        (keywords.expectedArtist && keywords.expectedArtist !== 'Local Audio' && keywords.expectedArtist !== 'Bilinmeyen Sanatçı'
          ? keywords.expectedArtist
          : track.artist && track.artist !== 'Local Audio' && track.artist !== 'Bilinmeyen Sanatçı'
          ? cleanYouTubeTitle(track.artist)
          : unknownArtist);

      let rawTitle =
        (meta?.title?.trim() ? meta.title.trim() : '') ||
        (isCurrentActive && player.activeTrack?.title && player.activeTrack.title !== 'Unknown Title' ? player.activeTrack.title : '') ||
        keywords.expectedTrack ||
        track.title ||
        '';

      const title =
        cleanDisplayTitle(
          rawTitle,
          rawArtist !== unknownArtist && rawArtist !== 'Bilinmeyen Sanatçı' ? rawArtist : undefined
        ) || unknownTrack;

      let artworkUri =
        (isCurrentActive ? player.artworkUri : undefined) ||
        meta?.artwork ||
        (track.id ? artworkMap[track.id] : undefined) ||
        (track.url ? artworkMap[track.url] : undefined) ||
        (typeof track.artwork === 'string' ? track.artwork : undefined);

      return { title, artist: rawArtist, artwork: artworkUri };
    },
    [
      player.isRemote,
      player.activeTrack,
      player.artworkUri,
      metadataMap,
      artworkMap,
      t,
    ]
  );

  const activeMeta = useMemo(() => getTrackMeta(player.activeTrack), [player.activeTrack, getTrackMeta]);
  const prevMeta = useMemo(() => getTrackMeta(prevTrack), [prevTrack, getTrackMeta]);
  const nextMeta = useMemo(() => getTrackMeta(nextTrack), [nextTrack, getTrackMeta]);

  const miniPanX = useMemo(() => new Animated.Value(0), []);
  const isMiniSkippingRef = useRef(false);
  const currentTrackIdRef = useRef(player.activeTrack?.id);

  const skipNext = useCallback(async () => {
    try {
      await player.skipToNext();
    } catch (e) {
      console.warn('Skip next failed', e);
    } finally {
      setTimeout(() => {
        if (isMiniSkippingRef.current) {
          isMiniSkippingRef.current = false;
          Animated.spring(miniPanX, { toValue: 0, useNativeDriver: true }).start();
        }
      }, 500);
    }
  }, [miniPanX, player]);

  const gestureSkipPrev = useCallback(async () => {
    try {
      await player.skipToPrevious();
    } catch (e) {
      console.warn('Gesture skip prev failed', e);
    } finally {
      setTimeout(() => {
        if (isMiniSkippingRef.current) {
          isMiniSkippingRef.current = false;
          Animated.spring(miniPanX, { toValue: 0, useNativeDriver: true }).start();
        }
      }, 500);
    }
  }, [miniPanX, player]);

  const togglePlayback = async () => {
    if (player.isPlaying) {
      await player.pause();
      if (!player.isRemote && player.activeTrack && progress.position > 0) {
        TrackPlayer.getActiveTrackIndex()
          .then((idx) => {
            const resolvedIdx = idx ?? 0;
            saveLastPlayback(
              {
                trackId: player.activeTrack!.id,
                trackIndex: resolvedIdx,
                position: progress.position,
                track: {
                  id: player.activeTrack!.id,
                  url: (player.activeTrack as any).url || '',
                  title: player.activeTrack!.title,
                  artist: player.activeTrack!.artist,
                  artwork: player.artworkUri || undefined,
                },
              },
              true
            );
            updateQueueSnapshotActiveIndex(resolvedIdx, progress.position);
          })
          .catch(() => {});
      }
    } else {
      await player.play();
    }
  };

  // When activeTrack changes, snap back to center (seamless page turn)
  useEffect(() => {
    if (currentTrackIdRef.current !== player.activeTrack?.id) {
      currentTrackIdRef.current = player.activeTrack?.id;
      if (isMiniSkippingRef.current) {
        miniPanX.setValue(0);
        isMiniSkippingRef.current = false;
      }
    }
  }, [player.activeTrack?.id, miniPanX]);

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

  if (!player.activeTrack) {
    if (player.isRemote) {
      return (
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={openFullscreenPlayer}
          style={[
            styles.miniPlayerContainer,
            isEmbedded && styles.miniPlayerContainerEmbedded,
            { borderColor: theme.border || 'rgba(255, 255, 255, 0.12)' },
          ]}>
          <View style={styles.contentRow}>
            <View
              style={[
                styles.artworkBox,
                {
                  width: 44,
                  height: 44,
                  borderRadius: 8,
                  backgroundColor: `${theme.primary}20`,
                  alignItems: 'center',
                  justifyContent: 'center',
                },
              ]}>
              <Ionicons name="radio-outline" size={24} color={theme.primary} />
            </View>
            <View style={styles.textDetailsBox}>
              <Text style={styles.titleText} numberOfLines={1}>
                {player.remoteDeviceName || t('remote.remote_device')}
              </Text>
              <Text style={styles.artistText} numberOfLines={1}>
                {`${t('remote.status_connected')} • ${t('remote.waiting_for_music')}`}
              </Text>
            </View>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => player.play()}
              style={{ padding: 8, marginRight: 4 }}>
              <Ionicons name="play" size={24} color={theme.primary} />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      );
    }
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
                  <MarqueeText text={prevMeta.title || ''} style={styles.titleText} />
                  <MarqueeText text={prevMeta.artist || ''} style={styles.artistText} />
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
                  trackId={player.activeTrack.id}
                  trackUri={(player.activeTrack as any).url}
                  size={44}
                  borderRadius={8}
                  iconSize={22}
                />
              </View>
              <View style={styles.textDetailsBox}>
                {player.isRemote && (
                  <View style={styles.remoteBadge}>
                    <View style={styles.remoteBadgeDot} />
                    <Text style={styles.remoteBadgeText} numberOfLines={1}>
                      {player.remoteDeviceName || 'Remote'}
                    </Text>
                  </View>
                )}
                <MarqueeText text={activeMeta.title || ''} style={styles.titleText} />
                <MarqueeText text={activeMeta.artist || ''} style={styles.artistText} />
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
                  <MarqueeText text={nextMeta.title || ''} style={styles.titleText} />
                  <MarqueeText text={nextMeta.artist || ''} style={styles.artistText} />
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
              name={player.isPlaying ? 'pause' : 'play'}
              size={24}
              color="#ffffff"
              style={!player.isPlaying ? { marginLeft: 2 } : undefined}
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
  remoteBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  remoteBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10b981',
  },
  remoteBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#10b981',
    letterSpacing: 0.3,
  },
});
