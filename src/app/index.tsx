import { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  GestureResponderEvent,
  Modal,
  Pressable,
  FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import TrackPlayer, {
  useActiveTrack,
  useIsPlaying,
  useProgress,
  RepeatMode,
  Track,
} from 'react-native-track-player';
import { useStore } from '../store/useStore';

export default function PlayerScreen() {
  const activeTrack = useActiveTrack();
  const { playing } = useIsPlaying();
  const progress = useProgress(250);

  const { isShuffle, setIsShuffle, repeatMode, setRepeatMode } = useStore();

  const [barWidth, setBarWidth] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragTime, setDragTime] = useState(0);

  // Queue Sheet state
  const [isQueueModalOpen, setIsQueueModalOpen] = useState(false);
  const [queue, setQueue] = useState<Track[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(0);

  const currentPosition = isDragging ? dragTime : progress.position;
  const duration = progress.duration > 0 ? progress.duration : 0;
  const progressPercent = duration > 0 ? Math.min(1, Math.max(0, currentPosition / duration)) : 0;

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const cleanTitle = (raw?: string) => {
    if (!raw) return 'No Song Playing';
    return raw.replace(/\.[^/.]+$/, '');
  };

  const refreshQueue = async () => {
    try {
      const q = await TrackPlayer.getQueue();
      const idx = await TrackPlayer.getActiveTrackIndex();
      setQueue(q);
      setActiveIndex(idx ?? 0);
    } catch (e) {
      console.warn('Failed to load queue', e);
    }
  };

  useEffect(() => {
    if (activeTrack) {
      refreshQueue();
    }
  }, [activeTrack]);

  const handleTouchCalc = (e: GestureResponderEvent) => {
    if (barWidth <= 0 || duration <= 0) return 0;
    const x = Math.max(0, Math.min(barWidth, e.nativeEvent.locationX));
    return (x / barWidth) * duration;
  };

  const handleSeekGrant = (e: GestureResponderEvent) => {
    if (duration <= 0) return;
    setIsDragging(true);
    setDragTime(handleTouchCalc(e));
  };

  const handleSeekMove = (e: GestureResponderEvent) => {
    if (!isDragging || duration <= 0) return;
    setDragTime(handleTouchCalc(e));
  };

  const handleSeekRelease = async (e: GestureResponderEvent) => {
    if (duration <= 0) {
      setIsDragging(false);
      return;
    }
    const target = handleTouchCalc(e);
    setIsDragging(false);
    await TrackPlayer.seekTo(target);
  };

  const togglePlayback = async () => {
    if (playing) {
      await TrackPlayer.pause();
    } else {
      await TrackPlayer.play();
    }
  };

  const skipNext = async () => {
    try {
      if (isShuffle) {
        const q = await TrackPlayer.getQueue();
        if (q.length > 1) {
          const currentIndex = await TrackPlayer.getActiveTrackIndex();
          let nextIndex = Math.floor(Math.random() * q.length);
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
  };

  const skipPrev = async () => {
    try {
      if (progress.position > 3) {
        await TrackPlayer.seekTo(0);
      } else {
        await TrackPlayer.skipToPrevious();
        await TrackPlayer.play();
      }
    } catch (e) {
      console.warn('Skip prev failed', e);
    }
  };

  const toggleRepeat = async () => {
    let nextMode: RepeatMode = RepeatMode.Off;
    if (repeatMode === RepeatMode.Off) {
      nextMode = RepeatMode.Queue;
    } else if (repeatMode === RepeatMode.Queue) {
      nextMode = RepeatMode.Track;
    } else {
      nextMode = RepeatMode.Off;
    }

    setRepeatMode(nextMode);
    await TrackPlayer.setRepeatMode(nextMode);
  };

  const toggleShuffle = () => {
    setIsShuffle(!isShuffle);
  };

  const handlePlayFromQueue = async (index: number) => {
    try {
      await TrackPlayer.skip(index);
      await TrackPlayer.play();
      await refreshQueue();
    } catch (e) {
      console.warn('Failed to skip track from queue', e);
    }
  };

  const handleRemoveTrack = async (index: number) => {
    try {
      await TrackPlayer.remove(index);
      await refreshQueue();
    } catch (e) {
      console.warn('Failed to remove track', e);
    }
  };

  const handleClearUpcoming = async () => {
    try {
      await TrackPlayer.removeUpcomingTracks();
      await refreshQueue();
    } catch (e) {
      console.warn('Failed to clear upcoming tracks', e);
    }
  };

  const renderQueueItem = ({ item, index }: { item: Track; index: number }) => {
    const isCurrent = index === activeIndex;

    return (
      <TouchableOpacity
        style={[styles.queueItemRow, isCurrent && styles.queueItemRowActive]}
        onPress={() => handlePlayFromQueue(index)}>
        <View style={styles.queueItemLeft}>
          <View style={[styles.queueItemIconBox, isCurrent && styles.queueItemIconBoxActive]}>
            <Ionicons
              name={isCurrent ? 'volume-high' : 'musical-note'}
              size={18}
              color={isCurrent ? '#3b82f6' : '#71717a'}
            />
          </View>
          <View style={styles.queueItemInfo}>
            <Text
              style={[styles.queueItemTitle, isCurrent && styles.queueItemTitleActive]}
              numberOfLines={1}>
              {cleanTitle(item.title)}
            </Text>
            <Text style={styles.queueItemArtist} numberOfLines={1}>
              {isCurrent ? 'Şu An Çalıyor' : item.artist || 'Local Audio'}
            </Text>
          </View>
        </View>

        {!isCurrent && (
          <TouchableOpacity
            style={styles.queueItemRemoveBtn}
            onPress={() => handleRemoveTrack(index)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="trash-outline" size={18} color="#ef4444" />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Minimalist Art Card */}
      <View style={styles.albumArtContainer}>
        <View style={styles.albumArtBox}>
          <Ionicons name="musical-notes" size={90} color="#3b82f6" />
        </View>
      </View>

      {/* Track Info */}
      <View style={styles.infoContainer}>
        <Text style={styles.title} numberOfLines={1}>
          {cleanTitle(activeTrack?.title)}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {activeTrack?.artist || 'Local Audio'}
        </Text>
      </View>

      {/* Interactive Seekbar */}
      <View style={styles.progressSection}>
        <View
          style={styles.progressBarWrapper}
          onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={handleSeekGrant}
          onResponderMove={handleSeekMove}
          onResponderRelease={handleSeekRelease}
          onResponderTerminate={() => setIsDragging(false)}>
          <View style={styles.trackBackground}>
            <View style={[styles.trackFill, { width: `${progressPercent * 100}%` }]} />
          </View>
          {barWidth > 0 && (
            <View
              style={[
                styles.thumb,
                { left: Math.max(0, Math.min(barWidth - 14, barWidth * progressPercent - 7)) },
              ]}
            />
          )}
        </View>

        {/* Time Counters */}
        <View style={styles.timeRow}>
          <Text style={styles.timeText}>{formatTime(currentPosition)}</Text>
          <Text style={styles.timeText}>{formatTime(duration)}</Text>
        </View>
      </View>

      {/* Full Playback Controls */}
      <View style={styles.controlsRow}>
        {/* Shuffle Button */}
        <TouchableOpacity style={styles.secondaryButton} onPress={toggleShuffle}>
          <Ionicons
            name="shuffle"
            size={24}
            color={isShuffle ? '#3b82f6' : '#71717a'}
          />
        </TouchableOpacity>

        {/* Skip Previous Button */}
        <TouchableOpacity style={styles.primaryButton} onPress={skipPrev}>
          <Ionicons name="play-skip-back" size={32} color="#ffffff" />
        </TouchableOpacity>

        {/* Play/Pause Button */}
        <TouchableOpacity style={styles.playPauseButton} onPress={togglePlayback}>
          <Ionicons
            name={playing ? 'pause' : 'play'}
            size={36}
            color="#ffffff"
            style={!playing ? { marginLeft: 3 } : undefined}
          />
        </TouchableOpacity>

        {/* Skip Next Button */}
        <TouchableOpacity style={styles.primaryButton} onPress={skipNext}>
          <Ionicons name="play-skip-forward" size={32} color="#ffffff" />
        </TouchableOpacity>

        {/* Repeat Mode Button */}
        <TouchableOpacity style={styles.secondaryButton} onPress={toggleRepeat}>
          <View style={styles.repeatButtonWrapper}>
            <Ionicons
              name="repeat"
              size={24}
              color={repeatMode !== RepeatMode.Off ? '#3b82f6' : '#71717a'}
            />
            {repeatMode === RepeatMode.Track && (
              <View style={styles.repeatOneBadge}>
                <Text style={styles.repeatOneText}>1</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </View>

      {/* Up Next / Queue Bottom Trigger Bar */}
      <TouchableOpacity
        style={styles.queueTriggerButton}
        onPress={() => {
          refreshQueue();
          setIsQueueModalOpen(true);
        }}>
        <View style={styles.queueTriggerLeft}>
          <Ionicons name="list" size={18} color="#3b82f6" style={styles.queueTriggerIcon} />
          <Text style={styles.queueTriggerText}>Sıradaki Şarkılar</Text>
          {queue.length > 0 && (
            <View style={styles.queueTriggerBadge}>
              <Text style={styles.queueTriggerBadgeText}>{queue.length}</Text>
            </View>
          )}
        </View>
        <Ionicons name="chevron-up" size={18} color="#71717a" />
      </TouchableOpacity>

      {/* Up Next / Queue Full Bottom Sheet Modal */}
      <Modal
        visible={isQueueModalOpen}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setIsQueueModalOpen(false)}>
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setIsQueueModalOpen(false)}>
          <Pressable style={styles.queueModalContent} onPress={(e) => e.stopPropagation()}>
            <View style={styles.dragHandleContainer}>
              <View style={styles.dragHandle} />
            </View>

            {/* Queue Header */}
            <View style={styles.queueHeader}>
              <View style={styles.queueHeaderLeft}>
                <Text style={styles.queueTitle}>Sıradaki Parçalar</Text>
                {queue.length > 0 && (
                  <View style={styles.queueCountBadge}>
                    <Text style={styles.queueCountText}>{queue.length}</Text>
                  </View>
                )}
              </View>

              <View style={styles.queueHeaderActions}>
                {queue.length > activeIndex + 1 && (
                  <TouchableOpacity
                    style={styles.clearUpcomingBtn}
                    onPress={handleClearUpcoming}>
                    <Text style={styles.clearUpcomingText}>Kalanları Temizle</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.closeQueueBtn}
                  onPress={() => setIsQueueModalOpen(false)}>
                  <Ionicons name="chevron-down" size={24} color="#a1a1aa" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Queue Track List */}
            <FlatList
              data={queue}
              keyExtractor={(item, index) => `${item.id || item.url}_${index}`}
              renderItem={renderQueueItem}
              contentContainerStyle={
                queue.length === 0 ? styles.emptyQueueContainer : styles.queueListContainer
              }
              ListEmptyComponent={
                <View style={styles.emptyQueueState}>
                  <Ionicons
                    name="musical-notes-outline"
                    size={48}
                    color="#52525b"
                    style={{ marginBottom: 12 }}
                  />
                  <Text style={styles.emptyQueueTitle}>Sırada şarkı yok</Text>
                  <Text style={styles.emptyQueueText}>
                    Kütüphaneden şarkı seçerek çalma sırası oluşturabilirsiniz.
                  </Text>
                </View>
              }
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    paddingHorizontal: 25,
    paddingTop: 16,
    paddingBottom: 20,
    justifyContent: 'space-between',
  },
  albumArtContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 10,
  },
  albumArtBox: {
    width: 240,
    height: 240,
    borderRadius: 24,
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  infoContainer: {
    alignItems: 'center',
    marginBottom: 8,
    paddingHorizontal: 10,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: '#a1a1aa',
    textAlign: 'center',
    fontWeight: '400',
  },
  progressSection: {
    width: '100%',
    marginVertical: 10,
  },
  progressBarWrapper: {
    height: 30,
    justifyContent: 'center',
  },
  trackBackground: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#27272a',
    overflow: 'hidden',
  },
  trackFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: '#3b82f6',
  },
  thumb: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  timeText: {
    fontSize: 12,
    color: '#71717a',
    fontWeight: '500',
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    marginBottom: 12,
  },
  secondaryButton: {
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
    width: 44,
  },
  primaryButton: {
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playPauseButton: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#3b82f6',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  repeatButtonWrapper: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  repeatOneBadge: {
    position: 'absolute',
    top: -2,
    right: -6,
    backgroundColor: '#3b82f6',
    borderRadius: 6,
    width: 12,
    height: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  repeatOneText: {
    color: '#ffffff',
    fontSize: 8,
    fontWeight: 'bold',
  },
  queueTriggerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#18181b',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#27272a',
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 4,
  },
  queueTriggerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  queueTriggerIcon: {
    marginRight: 8,
  },
  queueTriggerText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  queueTriggerBadge: {
    backgroundColor: '#27272a',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 8,
  },
  queueTriggerBadgeText: {
    color: '#3b82f6',
    fontSize: 12,
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  queueModalContent: {
    height: '80%',
    backgroundColor: '#18181b',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: '#27272a',
    paddingTop: 10,
    paddingBottom: 24,
    paddingHorizontal: 16,
  },
  dragHandleContainer: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#3f3f46',
  },
  queueHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
  },
  queueHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  queueTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
  },
  queueCountBadge: {
    backgroundColor: '#27272a',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 8,
  },
  queueCountText: {
    color: '#3b82f6',
    fontSize: 12,
    fontWeight: '700',
  },
  queueHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  clearUpcomingBtn: {
    backgroundColor: '#27272a',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  clearUpcomingText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '600',
  },
  closeQueueBtn: {
    padding: 4,
  },
  queueListContainer: {
    paddingBottom: 20,
  },
  queueItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    marginVertical: 2,
  },
  queueItemRowActive: {
    backgroundColor: '#27272a',
    borderWidth: 1,
    borderColor: '#3b82f6',
  },
  queueItemLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  queueItemIconBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#27272a',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  queueItemIconBoxActive: {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
  },
  queueItemInfo: {
    flex: 1,
  },
  queueItemTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: '#ffffff',
    marginBottom: 2,
  },
  queueItemTitleActive: {
    color: '#3b82f6',
    fontWeight: '700',
  },
  queueItemArtist: {
    fontSize: 12,
    color: '#71717a',
  },
  queueItemRemoveBtn: {
    padding: 8,
    marginLeft: 8,
  },
  emptyQueueContainer: {
    flexGrow: 1,
  },
  emptyQueueState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 20,
  },
  emptyQueueTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 6,
  },
  emptyQueueText: {
    fontSize: 14,
    color: '#71717a',
    textAlign: 'center',
  },
});
