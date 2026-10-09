import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
  TextInput,
  Modal,
  Pressable,
} from 'react-native';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as FileSystem from 'expo-file-system';
import TrackPlayer from 'react-native-track-player';
import { useStore } from '../store/useStore';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { TrackArtwork } from '../components/TrackArtwork';
import { getBatchMetadataAsync } from '../../modules/audio-artwork/src';
import { parseArtistAndTitle } from '../services/lyricsService';

type SortOption =
  | 'name_asc'
  | 'name_desc'
  | 'duration_asc'
  | 'duration_desc'
  | 'date_desc'
  | 'date_asc';

interface SortItem {
  id: SortOption;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const SORT_OPTIONS: SortItem[] = [
  { id: 'name_asc', label: 'İsim (A ➔ Z)', icon: 'text' },
  { id: 'name_desc', label: 'İsim (Z ➔ A)', icon: 'text' },
  { id: 'duration_asc', label: 'Süre (En Kısa ➔ En Uzun)', icon: 'time-outline' },
  { id: 'duration_desc', label: 'Süre (En Uzun ➔ En Kısa)', icon: 'time' },
  { id: 'date_desc', label: 'Eklenme Tarihi (En Yeni ➔ En Eski)', icon: 'calendar' },
  { id: 'date_asc', label: 'Eklenme Tarihi (En Eski ➔ En Yeni)', icon: 'calendar-outline' },
];

export default function LibraryScreen() {
  const {
    library,
    setLibrary,
    isScanning,
    setIsScanning,
    settings,
    hideTrack,
    artworkMap,
    metadataMap,
    setBatchTrackMetadata,
  } = useStore();
  const [statusMessage, setStatusMessage] = useState<string>('');
  const router = useRouter();

  // Search state
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Sort state (defaults to name_asc)
  const [sortOption, setSortOption] = useState<SortOption>('name_asc');
  const [isSortModalOpen, setIsSortModalOpen] = useState(false);

  // Track action menu state
  const [selectedTrackForMenu, setSelectedTrackForMenu] = useState<MediaLibrary.Asset | null>(null);

  const cleanTitle = (raw: string) => raw.replace(/\.[^/.]+$/, '');

  const getTrackDisplayInfo = useCallback(
    (asset: MediaLibrary.Asset) => {
      const meta = metadataMap[asset.id];
      const parsed = parseArtistAndTitle(cleanTitle(asset.filename));
      const title = meta?.title?.trim() || parsed.title || cleanTitle(asset.filename);
      const artist =
        meta?.artist?.trim() && meta.artist !== 'Local Audio' && meta.artist !== 'Bilinmeyen Sanatçı'
          ? meta.artist.trim()
          : (parsed.artist && parsed.artist !== 'Local Audio' && parsed.artist !== 'Bilinmeyen Sanatçı'
              ? parsed.artist
              : '');
      return { title, artist };
    },
    [metadataMap]
  );

  const handleHideTrack = async (asset: MediaLibrary.Asset) => {
    setSelectedTrackForMenu(null);
    try {
      const currentActive = await TrackPlayer.getActiveTrack();
      if (currentActive && (currentActive.id === asset.id || currentActive.url === asset.uri)) {
        try {
          await TrackPlayer.skipToNext();
        } catch {
          await TrackPlayer.pause();
        }
      }
      const queue = await TrackPlayer.getQueue();
      const trackIdx = queue.findIndex((t) => t.id === asset.id || t.url === asset.uri);
      if (trackIdx !== -1) {
        await TrackPlayer.remove(trackIdx);
      }
    } catch (e) {
      console.warn('TrackPlayer update on hide failed', e);
    }
    hideTrack(asset.id);
  };

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
        if (
          (settings.minSizeMB != null && settings.minSizeMB > 0) ||
          (settings.maxSizeMB != null && settings.maxSizeMB > 0)
        ) {
          try {
            const fileInfo = await FileSystem.getInfoAsync(asset.uri);
            if (fileInfo.exists && !fileInfo.isDirectory && typeof fileInfo.size === 'number') {
              const sizeMB = fileInfo.size / (1024 * 1024);
              if (settings.minSizeMB != null && settings.minSizeMB > 0 && sizeMB < settings.minSizeMB)
                continue;
              if (settings.maxSizeMB != null && settings.maxSizeMB > 0 && sizeMB > settings.maxSizeMB)
                continue;
            }
          } catch {
            // Keep asset if size cannot be inspected
          }
        }

        validAudio.push(asset);
      }

      setLibrary(validAudio);
      setStatusMessage(`Found ${validAudio.length} track(s).`);

      // Background extraction of missing metadata & artworks
      (async () => {
        try {
          const currentMeta = useStore.getState().metadataMap;
          const missing = validAudio.filter((a) => !currentMeta[a.id]);
          for (let i = 0; i < missing.length; i += 25) {
            const chunk = missing.slice(i, i + 25).map((a) => ({ id: a.id, uri: a.uri }));
            const metaBatch = await getBatchMetadataAsync(chunk);
            if (Object.keys(metaBatch).length > 0) {
              setBatchTrackMetadata(metaBatch as any);
            }
          }
        } catch (e) {
          console.warn('Batch metadata extraction error:', e);
        }
      })();
    } catch (e: any) {
      console.error('Scan error:', e);
      setStatusMessage(`Error scanning: ${e?.message || e}`);
      Alert.alert('Scan Error', e?.message || 'Failed to scan audio files.');
    } finally {
      setIsScanning(false);
    }
  }, [settings, setLibrary, setIsScanning, setBatchTrackMetadata]);

  useEffect(() => {
    scanMedia();
  }, [scanMedia]);

  // Sorting comparator
  const sortComparator = useCallback(
    (a: MediaLibrary.Asset, b: MediaLibrary.Asset, option: SortOption) => {
      const nameA = getTrackDisplayInfo(a).title.toLowerCase();
      const nameB = getTrackDisplayInfo(b).title.toLowerCase();
      switch (option) {
        case 'name_asc':
          return nameA.localeCompare(nameB, undefined, { numeric: true });
        case 'name_desc':
          return nameB.localeCompare(nameA, undefined, { numeric: true });
        case 'duration_asc':
          return (a.duration || 0) - (b.duration || 0);
        case 'duration_desc':
          return (b.duration || 0) - (a.duration || 0);
        case 'date_desc':
          return (b.creationTime || 0) - (a.creationTime || 0);
        case 'date_asc':
          return (a.creationTime || 0) - (b.creationTime || 0);
        default:
          return 0;
      }
    },
    [getTrackDisplayInfo]
  );

  // Full library sorted by the active sortOption
  const fullSortedList = useMemo(() => {
    return [...library].sort((a, b) => sortComparator(a, b, sortOption));
  }, [library, sortOption, sortComparator]);

  // Displayed list (filtered by search query if any)
  const displayedList = useMemo(() => {
    if (!searchQuery.trim()) return fullSortedList;
    const q = searchQuery.toLowerCase().trim();
    return fullSortedList.filter((item) => {
      const info = getTrackDisplayInfo(item);
      return (
        info.title.toLowerCase().includes(q) ||
        info.artist.toLowerCase().includes(q) ||
        cleanTitle(item.filename).toLowerCase().includes(q)
      );
    });
  }, [fullSortedList, searchQuery, getTrackDisplayInfo]);

  const playTrack = async (selectedAsset: MediaLibrary.Asset) => {
    try {
      await TrackPlayer.reset();

      // Add the entire sorted library into queue with extracted metadata and cover art
      const tracks = fullSortedList.map((asset) => {
        const info = getTrackDisplayInfo(asset);
        return {
          id: asset.id,
          url: asset.uri,
          title: info.title,
          artist: info.artist,
          artwork: metadataMap[asset.id]?.artwork || artworkMap[asset.id] || undefined,
        };
      });

      await TrackPlayer.add(tracks);

      const targetIndex = fullSortedList.findIndex((item) => item.id === selectedAsset.id);
      if (targetIndex >= 0) {
        await TrackPlayer.skip(targetIndex);
      }
      await TrackPlayer.play();
      router.navigate('/');
    } catch (e) {
      console.error('Failed to play track', e);
    }
  };

  const closeSearch = () => {
    setSearchQuery('');
    setIsSearchOpen(false);
  };

  const renderItem = ({ item }: { item: MediaLibrary.Asset }) => {
    const info = getTrackDisplayInfo(item);
    return (
      <View style={styles.trackItem}>
        <TouchableOpacity
          style={styles.trackMainContent}
          activeOpacity={0.7}
          onPress={() => playTrack(item)}>
          <View style={{ marginRight: 12 }}>
            <TrackArtwork
              uri={metadataMap[item.id]?.artwork || artworkMap[item.id]}
              trackId={item.id}
              trackUri={item.uri}
              size={42}
              borderRadius={10}
              iconSize={20}
            />
          </View>
          <View style={styles.trackInfo}>
            <Text style={styles.trackTitle} numberOfLines={1}>
              {info.title}
            </Text>
            <Text style={styles.trackDuration} numberOfLines={1}>
              {Math.floor(item.duration / 60)}:
              {Math.floor(item.duration % 60)
                .toString()
                .padStart(2, '0')}
              {info.artist ? ` • ${info.artist}` : ''}
            </Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.trackMoreBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          onPress={() => setSelectedTrackForMenu(item)}>
          <Ionicons name="ellipsis-vertical" size={18} color="#a1a1aa" />
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Top Header / Search Bar */}
      {isSearchOpen ? (
        <View style={styles.searchBarContainer}>
          <TouchableOpacity onPress={closeSearch} style={styles.searchBackBtn}>
            <Ionicons name="arrow-back" size={22} color="#ffffff" />
          </TouchableOpacity>
          <View style={styles.searchInputWrapper}>
            <Ionicons name="search" size={18} color="#71717a" style={styles.searchInnerIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Şarkılarda ara..."
              placeholderTextColor="#71717a"
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoFocus
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearSearchBtn}>
                <Ionicons name="close-circle" size={18} color="#a1a1aa" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      ) : (
        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            <Text style={styles.title}>Your Library</Text>
            {library.length > 0 && (
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{library.length}</Text>
              </View>
            )}
          </View>

          <View style={styles.headerActions}>
            {/* Search Button */}
            <TouchableOpacity
              style={styles.headerIconButton}
              onPress={() => setIsSearchOpen(true)}>
              <Ionicons name="search" size={20} color="#ffffff" />
            </TouchableOpacity>

            {/* Sort Button */}
            <TouchableOpacity
              style={styles.headerIconButton}
              onPress={() => setIsSortModalOpen(true)}>
              <Ionicons name="swap-vertical" size={20} color="#ffffff" />
            </TouchableOpacity>

            {/* Scan Button */}
            <TouchableOpacity
              style={styles.scanButton}
              onPress={scanMedia}
              disabled={isScanning}>
              {isScanning ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Ionicons name="refresh" size={18} color="#fff" />
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {statusMessage && !isSearchOpen ? (
        <Text style={styles.statusText}>{statusMessage}</Text>
      ) : null}

      {/* Track List */}
      <FlatList
        data={displayedList}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={displayedList.length === 0 ? styles.emptyListContainer : undefined}
        refreshControl={
          <RefreshControl
            refreshing={isScanning}
            onRefresh={scanMedia}
            colors={['#3b82f6']}
            tintColor="#3b82f6"
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            {searchQuery.trim().length > 0 ? (
              <>
                <Ionicons name="search-outline" size={48} color="#52525b" style={styles.emptyIcon} />
                <Text style={styles.emptyTitle}>Eşleşen şarkı bulunamadı</Text>
                <Text style={styles.emptyText}>&quot;{searchQuery}&quot; araması için sonuç yok.</Text>
                <TouchableOpacity style={styles.clearSearchActionBtn} onPress={() => setSearchQuery('')}>
                  <Text style={styles.clearSearchActionText}>Aramayı Temizle</Text>
                </TouchableOpacity>
              </>
            ) : (
              <Text style={styles.emptyText}>
                {isScanning
                  ? 'Scanning your device...'
                  : statusMessage || 'No audio files found. Adjust settings or tap Scan.'}
              </Text>
            )}
          </View>
        }
      />

      {/* Sorting Options Bottom Modal */}
      <Modal
        visible={isSortModalOpen}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsSortModalOpen(false)}>
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setIsSortModalOpen(false)}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Sıralama Seçenekleri</Text>
              <TouchableOpacity onPress={() => setIsSortModalOpen(false)}>
                <Ionicons name="close" size={24} color="#a1a1aa" />
              </TouchableOpacity>
            </View>

            <View style={styles.sortOptionsList}>
              {SORT_OPTIONS.map((item) => {
                const isSelected = sortOption === item.id;
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.sortOptionRow, isSelected && styles.sortOptionRowSelected]}
                    onPress={() => {
                      setSortOption(item.id);
                      setIsSortModalOpen(false);
                    }}>
                    <View style={styles.sortOptionLeft}>
                      <Ionicons
                        name={item.icon}
                        size={20}
                        color={isSelected ? '#3b82f6' : '#a1a1aa'}
                        style={styles.sortOptionIcon}
                      />
                      <Text style={[styles.sortOptionLabel, isSelected && styles.sortOptionLabelSelected]}>
                        {item.label}
                      </Text>
                    </View>
                    {isSelected && <Ionicons name="checkmark" size={20} color="#3b82f6" />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Track Options Action Sheet Modal */}
      <Modal
        visible={selectedTrackForMenu !== null}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setSelectedTrackForMenu(null)}>
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setSelectedTrackForMenu(null)}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            {selectedTrackForMenu && (
              <>
                <View style={styles.trackModalHeader}>
                  <TrackArtwork
                    uri={metadataMap[selectedTrackForMenu.id]?.artwork || artworkMap[selectedTrackForMenu.id]}
                    trackId={selectedTrackForMenu.id}
                    trackUri={selectedTrackForMenu.uri}
                    size={46}
                    borderRadius={10}
                    iconSize={22}
                  />
                  <View style={styles.trackModalHeaderInfo}>
                    <Text style={styles.trackModalTitle} numberOfLines={1}>
                      {getTrackDisplayInfo(selectedTrackForMenu).title}
                    </Text>
                    <Text style={styles.trackModalDuration} numberOfLines={1}>
                      {Math.floor(selectedTrackForMenu.duration / 60)}:
                      {Math.floor(selectedTrackForMenu.duration % 60)
                        .toString()
                        .padStart(2, '0')}
                      {getTrackDisplayInfo(selectedTrackForMenu).artist
                        ? ` • ${getTrackDisplayInfo(selectedTrackForMenu).artist}`
                        : ''}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => setSelectedTrackForMenu(null)}>
                    <Ionicons name="close" size={24} color="#a1a1aa" />
                  </TouchableOpacity>
                </View>

                <View style={styles.trackActionList}>
                  <TouchableOpacity
                    style={styles.trackActionItem}
                    activeOpacity={0.7}
                    onPress={() => handleHideTrack(selectedTrackForMenu)}>
                    <View style={styles.trackActionIconWrapper}>
                      <Ionicons name="eye-off-outline" size={20} color="#ef4444" />
                    </View>
                    <View style={styles.trackActionTextWrapper}>
                      <Text style={styles.trackActionTitleDanger}>Bu Şarkıyı Gizle</Text>
                      <Text style={styles.trackActionDesc}>
                        Kütüphaneden gizler. Ayarlardan dilediğiniz zaman geri getirebilirsiniz.
                      </Text>
                    </View>
                  </TouchableOpacity>
                </View>
              </>
            )}
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
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#ffffff',
  },
  countBadge: {
    backgroundColor: '#27272a',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 8,
  },
  countBadgeText: {
    color: '#a1a1aa',
    fontSize: 12,
    fontWeight: '600',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIconButton: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanButton: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#3b82f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    gap: 10,
  },
  searchBackBtn: {
    padding: 6,
  },
  searchInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181b',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#27272a',
    paddingHorizontal: 10,
    height: 42,
  },
  searchInnerIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: '#ffffff',
    fontSize: 15,
    height: '100%',
  },
  clearSearchBtn: {
    padding: 4,
  },
  trackItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
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
  emptyListContainer: {
    flexGrow: 1,
  },
  emptyState: {
    flex: 1,
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIcon: {
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 6,
  },
  emptyText: {
    color: '#71717a',
    textAlign: 'center',
    fontSize: 14,
    marginBottom: 16,
  },
  clearSearchActionBtn: {
    backgroundColor: '#27272a',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  clearSearchActionText: {
    color: '#3b82f6',
    fontWeight: '600',
    fontSize: 14,
  },
  statusText: {
    color: '#3b82f6',
    fontSize: 13,
    marginBottom: 10,
    textAlign: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#18181b',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: '#27272a',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 32,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
  },
  sortOptionsList: {
    gap: 4,
  },
  sortOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  sortOptionRowSelected: {
    backgroundColor: '#27272a',
  },
  sortOptionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sortOptionIcon: {
    marginRight: 12,
  },
  sortOptionLabel: {
    fontSize: 15,
    color: '#a1a1aa',
    fontWeight: '500',
  },
  sortOptionLabelSelected: {
    color: '#ffffff',
    fontWeight: '600',
  },
  trackMainContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  trackMoreBtn: {
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  trackModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
  },
  trackModalHeaderInfo: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  trackModalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 3,
  },
  trackModalDuration: {
    fontSize: 13,
    color: '#71717a',
  },
  trackActionList: {
    gap: 8,
  },
  trackActionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#27272a44',
  },
  trackActionIconWrapper: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  trackActionTextWrapper: {
    flex: 1,
  },
  trackActionTitleDanger: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ef4444',
    marginBottom: 2,
  },
  trackActionDesc: {
    fontSize: 12,
    color: '#71717a',
  },
});
