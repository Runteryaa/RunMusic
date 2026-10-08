import { useState, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  GestureResponderEvent,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import TrackPlayer, {
  useActiveTrack,
  useIsPlaying,
  useProgress,
  RepeatMode,
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
        const queue = await TrackPlayer.getQueue();
        if (queue.length > 1) {
          const currentIndex = await TrackPlayer.getActiveTrackIndex();
          let nextIndex = Math.floor(Math.random() * queue.length);
          if (nextIndex === currentIndex) {
            nextIndex = (nextIndex + 1) % queue.length;
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    paddingHorizontal: 25,
    paddingTop: 20,
    paddingBottom: 30,
    justifyContent: 'space-between',
  },
  albumArtContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 15,
  },
  albumArtBox: {
    width: 250,
    height: 250,
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
    marginBottom: 10,
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
    marginVertical: 15,
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
    paddingHorizontal: 10,
    marginBottom: 20,
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
    width: 72,
    height: 72,
    borderRadius: 36,
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
});
