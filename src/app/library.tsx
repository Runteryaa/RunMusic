import { useEffect } from 'react';
import { StyleSheet, Text, View, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import TrackPlayer from 'react-native-track-player';
import { useStore } from '../store/useStore';
import { Ionicons } from '@expo/vector-icons';

export default function LibraryScreen() {
  const { library, setLibrary, isScanning, setIsScanning, settings } = useStore();

  const scanMedia = async () => {
    setIsScanning(true);
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        alert('Permission to access media is required!');
        setIsScanning(false);
        return;
      }

      let hasNextPage = true;
      let after = undefined;
      const allAudio: MediaLibrary.Asset[] = [];

      while (hasNextPage) {
        const result = await MediaLibrary.getAssetsAsync({
          mediaType: MediaLibrary.MediaType.audio,
          first: 100,
          after,
        });
        
        allAudio.push(...result.assets);
        hasNextPage = result.hasNextPage;
        after = result.endCursor;
      }

      // Filter local array
      const validAudio: MediaLibrary.Asset[] = [];
      
      for (const asset of allAudio) {
        // Duration filter
        if (settings.minLengthSec && asset.duration < settings.minLengthSec) continue;
        if (settings.maxLengthSec && asset.duration > settings.maxLengthSec) continue;

        // Size filter
        if (settings.minSizeMB || settings.maxSizeMB) {
          const fileInfo = await FileSystem.getInfoAsync(asset.uri);
          if (fileInfo.exists && !fileInfo.isDirectory) {
            const sizeMB = fileInfo.size / (1024 * 1024);
            if (settings.minSizeMB && sizeMB < settings.minSizeMB) continue;
            if (settings.maxSizeMB && sizeMB > settings.maxSizeMB) continue;
          }
        }

        validAudio.push(asset);
      }

      setLibrary(validAudio);
    } catch (e) {
      console.error(e);
    } finally {
      setIsScanning(false);
    }
  };

  useEffect(() => {
    // Initial scan if library is empty
    if (library.length === 0) {
      scanMedia();
    }
  }, []);

  const playTrack = async (index: number) => {
    try {
      await TrackPlayer.reset();
      
      const tracks = library.map((asset) => ({
        id: asset.id,
        url: asset.uri,
        title: asset.filename,
        artist: 'Unknown Artist', // MediaLibrary doesn't always provide artist without extra queries
      }));

      await TrackPlayer.add(tracks);
      await TrackPlayer.skip(index);
      await TrackPlayer.play();
    } catch (e) {
      console.error('Failed to play track', e);
    }
  };

  const renderItem = ({ item, index }: { item: MediaLibrary.Asset, index: number }) => (
    <TouchableOpacity style={styles.trackItem} onPress={() => playTrack(index)}>
      <Ionicons name="musical-note" size={24} color="#666" style={styles.trackIcon} />
      <View style={styles.trackInfo}>
        <Text style={styles.trackTitle} numberOfLines={1}>{item.filename}</Text>
        <Text style={styles.trackDuration}>{Math.floor(item.duration / 60)}:{(Math.floor(item.duration % 60)).toString().padStart(2, '0')}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Your Library</Text>
        <TouchableOpacity style={styles.scanButton} onPress={scanMedia} disabled={isScanning}>
          {isScanning ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Ionicons name="refresh" size={20} color="#fff" />
          )}
          <Text style={styles.scanButtonText}>Scan</Text>
        </TouchableOpacity>
      </View>
      
      <FlatList
        data={library}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>
              {isScanning ? "Scanning your device..." : "No audio files found. Adjust settings or tap Scan."}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 15,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  scanButton: {
    flexDirection: 'row',
    backgroundColor: '#007AFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  scanButtonText: {
    color: '#fff',
    marginLeft: 5,
    fontWeight: 'bold',
  },
  trackItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  trackIcon: {
    marginRight: 15,
  },
  trackInfo: {
    flex: 1,
  },
  trackTitle: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  trackDuration: {
    fontSize: 12,
    color: '#888',
  },
  emptyState: {
    padding: 30,
    alignItems: 'center',
  },
  emptyText: {
    color: '#888',
    textAlign: 'center',
    fontSize: 16,
  },
});
