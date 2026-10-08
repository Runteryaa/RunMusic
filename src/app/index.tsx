import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import TrackPlayer, { useActiveTrack, useIsPlaying } from 'react-native-track-player';

export default function PlayerScreen() {
  const activeTrack = useActiveTrack();
  const { playing } = useIsPlaying();

  const togglePlayback = async () => {
    if (playing) {
      await TrackPlayer.pause();
    } else {
      await TrackPlayer.play();
    }
  };

  const skipNext = async () => {
    await TrackPlayer.skipToNext();
  };

  const skipPrev = async () => {
    await TrackPlayer.skipToPrevious();
  };

  return (
    <View style={styles.container}>
      <View style={styles.albumArtPlaceholder}>
        <Ionicons name="musical-notes" size={100} color="#ccc" />
      </View>
      <Text style={styles.title} numberOfLines={1}>
        {activeTrack ? activeTrack.title : 'No Song Playing'}
      </Text>
      <Text style={styles.subtitle}>
        {activeTrack ? activeTrack.artist : 'Select a song from the Library'}
      </Text>
      
      <View style={styles.controls}>
        <TouchableOpacity style={styles.controlButton} onPress={skipPrev}>
          <Ionicons name="play-skip-back" size={40} color="#333" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.controlButton} onPress={togglePlayback}>
          <Ionicons name={playing ? "pause-circle" : "play-circle"} size={80} color="#333" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.controlButton} onPress={skipNext}>
          <Ionicons name="play-skip-forward" size={40} color="#333" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  albumArtPlaceholder: {
    width: 250,
    height: 250,
    backgroundColor: '#eee',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 30,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 16,
    color: '#888',
    marginBottom: 40,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    width: '80%',
  },
  controlButton: {
    padding: 10,
  },
});
