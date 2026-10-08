import { useEffect, useState, useCallback } from 'react';
import { StyleSheet, Text, View, FlatList, TouchableOpacity, ActivityIndicator, Alert, RefreshControl } from 'react-native';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as FileSystem from 'expo-file-system';
import TrackPlayer from 'react-native-track-player';
import { useStore } from '../store/useStore';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

export default function LibraryScreen() {
  const { library, setLibrary, isScanning, setIsScanning, settings } = useStore();
  const [statusMessage, setStatusMessage] = useState<string>('');
  const router = useRouter();

  const cleanTitle = (raw: string) => raw.replace(/\.[^/.]+$/, '');

  const scanMedia = useCallback(async () => {
    setIsScanning(true);
    setStatusMessage('Checking permissions...');
    try {
      let permission = await MediaLibrary.getPermissionsAsync(false, ['audio']);
      if (!permission.granted && permission.status !== 'granted') {
        permission = await MediaLibrary.requestPermissionsAsync(false, ['audio']);
      }

      if (!permission.granted && permission.status !== 'granted') {
        Alert.alert(
          'Permission Required',
          'Please grant access to audio files to scan and play your music.'
        );
        setStatusMessage('Permission not granted.');
        setIsScanning(false);
        return;
      }

      setStatusMessage('Scanning audio files...');
      let hasNextPage = true;
      let after: string | undefined = undefined;
      const allAudio: MediaLibrary.Asset[] = [];

      while (hasNextPage) {
        const result = await MediaLibrary.getAssetsAsync({
          mediaType: [MediaLibrary.MediaType.audio],
          first: 100,
          after,
        });

        if (result.assets && result.assets.length > 0) {
          allAudio.push(...result.assets);
        }
        hasNextPage = result.hasNextPage;
        after = result.endCursor;
      }

      // Filter local array
      const validAudio: MediaLibrary.Asset[] = [];

      for (const asset of allAudio) {
        // Duration filter (duration is in seconds)
        if (settings.minLengthSec != null && settings.minLengthSec > 0) {
          if (asset.duration == null || asset.duration < settings.minLengthSec) continue;
        }
        if (settings.maxLengthSec != null && settings.maxLengthSec > 0) {
          if (asset.duration != null && asset.duration > settings.maxLengthSec) continue;
        }

        // Size filter
        if ((settings.minSizeMB != null && settings.minSizeMB > 0) || (settings.maxSizeMB != null && settings.maxSizeMB > 0)) {
          try {
            const fileInfo = await FileSystem.getInfoAsync(asset.uri);
            if (fileInfo.exists && !fileInfo.isDirectory && typeof fileInfo.size === 'number') {
              const sizeMB = fileInfo.size / (1024 * 1024);
              if (settings.minSizeMB != null && settings.minSizeMB > 0 && sizeMB < settings.minSizeMB) continue;
              if (settings.maxSizeMB != null && settings.maxSizeMB > 0 && sizeMB > settings.maxSizeMB) continue;
            }
          } catch {
            // Keep asset if size cannot be inspected
          }
        }

        validAudio.push(asset);
      }

      setLibrary(validAudio);
      setStatusMessage(`Found ${validAudio.length} track(s).`);
    } catch (e: any) {
      console.error('Scan error:', e);
      setStatusMessage(`Error scanning: ${e?.message || e}`);
      Alert.alert('Scan Error', e?.message || 'Failed to scan audio files.');
    } finally {
      setIsScanning(false);
    }
  }, [settings, setLibrary, setIsScanning]);

  useEffect(() => {
    scanMedia();
  }, [scanMedia]);

  const playTrack = async (index: number) => {
    try {
      await TrackPlayer.reset();
      
      const tracks = library.map((asset) => ({
        id: asset.id,
        url: asset.uri,
        title: cleanTitle(asset.filename),
        artist: 'Local Audio',
      }));

      await TrackPlayer.add(tracks);
      await TrackPlayer.skip(index);
      await TrackPlayer.play();
      router.navigate('/');
    } catch (e) {
      console.error('Failed to play track', e);
    }
  };

  const renderItem = ({ item, index }: { item: MediaLibrary.Asset, index: number }) => (
    <TouchableOpacity style={styles.trackItem} onPress={() => playTrack(index)}>
      <View style={styles.iconContainer}>
        <Ionicons name="musical-note" size={20} color="#3b82f6" />
      </View>
      <View style={styles.trackInfo}>
        <Text style={styles.trackTitle} numberOfLines={1}>{cleanTitle(item.filename)}</Text>
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
            <Ionicons name="refresh" size={18} color="#fff" />
          )}
          <Text style={styles.scanButtonText}>Scan</Text>
        </TouchableOpacity>
      </View>
      
      {statusMessage ? (
        <Text style={styles.statusText}>{statusMessage}</Text>
      ) : null}

      <FlatList
        data={library}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl refreshing={isScanning} onRefresh={scanMedia} colors={['#3b82f6']} tintColor="#3b82f6" />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>
              {isScanning ? "Scanning your device..." : (statusMessage || "No audio files found. Adjust settings or tap Scan.")}
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
    backgroundColor: '#121212',
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#ffffff',
  },
  scanButton: {
    flexDirection: 'row',
    backgroundColor: '#3b82f6',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  scanButtonText: {
    color: '#fff',
    marginLeft: 6,
    fontWeight: '600',
    fontSize: 14,
  },
  trackItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
  },
  iconContainer: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  trackInfo: {
    flex: 1,
  },
  trackTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 3,
  },
  trackDuration: {
    fontSize: 13,
    color: '#71717a',
  },
  emptyState: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    color: '#71717a',
    textAlign: 'center',
    fontSize: 15,
  },
  statusText: {
    color: '#3b82f6',
    fontSize: 13,
    marginBottom: 12,
    textAlign: 'center',
  },
});
