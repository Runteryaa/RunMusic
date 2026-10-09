import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
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
import TrackPlayer, { useActiveTrack } from 'react-native-track-player';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../store/useStore';
import { usePlayerUIStore } from '../store/usePlayerUIStore';
import { useThemeStore } from '../store/useThemeStore';
import { TrackArtwork } from '../components/TrackArtwork';
import { getBatchMetadataAsync } from '../../modules/audio-artwork/src';
import { cleanYouTubeTitle, getSearchKeywords } from '../services/lyricsService';

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
  const theme = useThemeStore((s) => s.theme);
  const library = useStore((s) => s.library);
  const setLibrary = useStore((s) => s.setLibrary);
  const isScanning = useStore((s) => s.isScanning);
  const setIsScanning = useStore((s) => s.setIsScanning);
  const settings = useStore((s) => s.settings);
  const hideTrack = useStore((s) => s.hideTrack);
  const artworkMap = useStore((s) => s.artworkMap);
  const metadataMap = useStore((s) => s.metadataMap);
  const setBatchTrackMetadata = useStore((s) => s.setBatchTrackMetadata);

  const openFullscreenPlayer = usePlayerUIStore((s) => s.openFullscreenPlayer);
  const activeTrack = useActiveTrack();

  const [statusMessage, setStatusMessage] = useState<string>('');

  // Search state
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Sort state (defaults to name_asc)
  const [sortOption, setSortOption] = useState<SortOption>('name_asc');
  const [isSortModalOpen, setIsSortModalOpen] = useState(false);

  // Track action menu state
  const [selectedTrackForMenu, setSelectedTrackForMenu] = useState<MediaLibrary.Asset | null>(null);

  // Added to queue toast indicator
  const [queueToast, setQueueToast] = useState<string | null>(null);
  const toastTimeoutRef = useRef<any>(null);

  const showToast = (message: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setQueueToast(message);
    toastTimeoutRef.current = setTimeout(() => {
      setQueueToast(null);
    }, 2200);
  };

  const cleanTitle = (raw: string) => cleanYouTubeTitle(raw);

  const getTrackDisplayInfo = useCallback(
    (asset: MediaLibrary.Asset) => {
      const meta = metadataMap[asset.id];
      const keywords = getSearchKeywords(asset.filename);
      const artist =
        (meta?.artist?.trim() && meta.artist !== 'Local Audio' && meta.artist !== 'Bilinmeyen Sanatçı'
          ? cleanYouTubeTitle(meta.artist)
          : '') ||
        (keywords.expectedArtist && keywords.expectedArtist !== 'Local Audio' && keywords.expectedArtist !== 'Bilinmeyen Sanatçı'
          ? keywords.expectedArtist
          : '');
      const rawTitle =
        (meta?.title?.trim() ? cleanYouTubeTitle(meta.title) : '') ||
        keywords.expectedTrack ||
        cleanYouTubeTitle(asset.filename);
      const title = rawTitle;
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
    setStatusMessage('İzinler denetleniyor...');
    try {
      let permission = await MediaLibrary.getPermissionsAsync(false, ['audio']);
      if (!permission.granted && permission.status !== 'granted') {
        permission = await MediaLibrary.requestPermissionsAsync(false, ['audio']);
      }

      if (!permission.granted && permission.status !== 'granted') {
        Alert.alert(
          'İzin Gerekli',
          'Müziklerinizi taramak ve oynatmak için lütfen ses dosyalarına erişim izni verin.'
        );
        setStatusMessage('İzin verilmedi.');
        setIsScanning(false);
        return;
      }

      setStatusMessage('Müzik dosyaları taranıyor...');
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
        if (settings.minLengthSec != null && settings.minLengthSec > 0) {
          if (asset.duration == null || asset.duration < settings.minLengthSec) continue;
        }
        if (settings.maxLengthSec != null && settings.maxLengthSec > 0) {
          if (asset.duration != null && asset.duration > settings.maxLengthSec) continue;
        }

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
            // Keep asset if size inspection fails
          }
        }

        validAudio.push(asset);
      }

      setLibrary(validAudio);
      setStatusMessage(`${validAudio.length} şarkı bulundu.`);

      // Background extraction of missing metadata & artworks (nefes payı ve tek seferlik toplu kayıt ile)
      (async () => {
        try {
          // Açılışta kullanıcı arayüzünün 0ms anında tepki vermesi için 1.5 sn bekle
          await new Promise((r) => setTimeout(r, 1500));
          const currentMeta = useStore.getState().metadataMap;
          const missing = validAudio.filter((a) => !currentMeta[a.id]);
          if (missing.length === 0) return;
          const accumulatedBatch: Record<string, any> = {};
          for (let i = 0; i < missing.length; i += 50) {
            const chunk = missing.slice(i, i + 50).map((a) => ({ id: a.id, uri: a.uri }));
            const metaBatch = await getBatchMetadataAsync(chunk);
            if (Object.keys(metaBatch).length > 0) {
              Object.assign(accumulatedBatch, metaBatch);
            }
            await new Promise((r) => setTimeout(r, 200));
          }
          if (Object.keys(accumulatedBatch).length > 0) {
            setBatchTrackMetadata(accumulatedBatch as any);
          }
        } catch (e) {
          console.warn('Batch metadata extraction error:', e);
        }
      })();
    } catch (e: any) {
      console.error('Scan error:', e);
      setStatusMessage(`Hata: ${e?.message || e}`);
      Alert.alert('Tarama Hatası', e?.message || 'Müzikler taranırken bir hata oluştu.');
    } finally {
      setIsScanning(false);
    }
  }, [settings, setLibrary, setIsScanning, setBatchTrackMetadata]);

  useEffect(() => {
    if (library.length === 0) {
      scanMedia();
    } else {
      const timer = setTimeout(() => {
        scanMedia();
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [scanMedia, library.length]);

  // Sorting comparator
  const sortComparator = useCallback(
    (a: MediaLibrary.Asset, b: MediaLibrary.Asset, option: SortOption) => {
      const nameA = getTrackDisplayInfo(a).title.toLowerCase();
      const nameB = getTrackDisplayInfo(b).title.toLowerCase();
      switch (option) {
        case 'name_asc':
          return nameA.localeCompare(nameB);
        case 'name_desc':
          return nameB.localeCompare(nameA);
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

  const fullSortedList = useMemo(() => {
    return [...library].sort((a, b) => sortComparator(a, b, sortOption));
  }, [library, sortOption, sortComparator]);

  // Displayed list
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
      openFullscreenPlayer();
    } catch (e) {
      console.error('Failed to play track', e);
    }
  };

  const handleAddToQueue = async (asset: MediaLibrary.Asset) => {
    try {
      const info = getTrackDisplayInfo(asset);
      await TrackPlayer.add({
        id: asset.id,
        url: asset.uri,
        title: info.title,
        artist: info.artist,
        artwork: metadataMap[asset.id]?.artwork || artworkMap[asset.id] || undefined,
      });
      showToast(`"${info.title}" sıraya eklendi`);
    } catch (e) {
      console.warn('Failed to add track to queue', e);
    }
  };

  const closeSearch = () => {
    setSearchQuery('');
    setIsSearchOpen(false);
  };

  const renderItem = ({ item }: { item: MediaLibrary.Asset }) => {
    const info = getTrackDisplayInfo(item);
    const isPlayingCurrent =
      activeTrack && (activeTrack.id === item.id || activeTrack.url === item.uri);

    const renderLeftActions = () => (
      <View style={[styles.swipeLeftActionBox, { backgroundColor: theme.primary }]}>
        <Ionicons name="list" size={20} color="#ffffff" style={{ marginRight: 6 }} />
        <Text style={styles.swipeLeftActionText}>Sıraya Ekle</Text>
      </View>
    );

    return (
      <Swipeable
        renderLeftActions={renderLeftActions}
        friction={2}
        leftThreshold={40}
        onSwipeableOpen={(direction) => {
          if (direction === 'left') {
            handleAddToQueue(item);
          }
        }}>
        <View
          style={[
            styles.trackItem,
            isPlayingCurrent && [
              styles.trackItemPlaying,
              { borderColor: theme.border, backgroundColor: theme.surface },
            ],
          ]}>
          <TouchableOpacity
            style={styles.trackMainContent}
            activeOpacity={0.7}
            onPress={() => playTrack(item)}>
            <View style={{ marginRight: 12 }}>
              <TrackArtwork
                uri={metadataMap[item.id]?.artwork || artworkMap[item.id]}
                trackId={item.id}
                trackUri={item.uri}
                size={44}
                borderRadius={10}
                iconSize={20}
              />
            </View>
            <View style={styles.trackInfo}>
              <View style={styles.titleRow}>
                {isPlayingCurrent ? (
                  <Ionicons
                    name="volume-high"
                    size={16}
                    color={theme.primary}
                    style={{ marginRight: 6 }}
                  />
                ) : null}
                <Text
                  style={[
                    styles.trackTitle,
                    isPlayingCurrent && [styles.trackTitlePlaying, { color: theme.primary }],
                  ]}
                  numberOfLines={1}>
                  {info.title}
                </Text>
              </View>
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
      </Swipeable>
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
              <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.searchClearBtn}>
                <Ionicons name="close-circle" size={18} color="#71717a" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      ) : (
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>Kütüphane</Text>
            <Text style={styles.headerSubtitle}>
              {library.length} şarkı kayıtlı
            </Text>
          </View>
          <View style={styles.headerRightActions}>
            <TouchableOpacity
              style={styles.headerActionBtn}
              onPress={() => setIsSearchOpen(true)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="search" size={20} color="#ffffff" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.headerActionBtn}
              onPress={() => setIsSortModalOpen(true)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="swap-vertical" size={20} color="#ffffff" />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Floating Queue Toast Notification */}
      {queueToast ? (
        <View style={[styles.toastCard, { borderColor: theme.border }]}>
          <Ionicons
            name="checkmark-circle"
            size={16}
            color={theme.primary}
            style={{ marginRight: 6 }}
          />
          <Text style={styles.toastText} numberOfLines={1}>
            {queueToast}
          </Text>
        </View>
      ) : null}

      {/* Track List */}
      <FlatList
        data={displayedList}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        initialNumToRender={15}
        maxToRenderPerBatch={10}
        windowSize={7}
        removeClippedSubviews={true}
        refreshControl={
          <RefreshControl
            refreshing={isScanning}
            onRefresh={scanMedia}
            tintColor={theme.primary}
            colors={[theme.primary]}
          />
        }
        ListEmptyComponent={
          isScanning ? (
            <View style={styles.centerBox}>
              <ActivityIndicator size="large" color={theme.primary} />
              <Text style={[styles.statusText, { color: theme.primary }]}>{statusMessage}</Text>
            </View>
          ) : (
            <View style={styles.centerBox}>
              <Ionicons name="musical-notes-outline" size={48} color="#3f3f46" />
              <Text style={styles.emptyText}>
                {searchQuery ? 'Eşleşen şarkı bulunamadı.' : 'Henüz şarkı bulunamadı.'}
              </Text>
              {!searchQuery && (
                <TouchableOpacity style={[styles.rescanBtn, { backgroundColor: theme.primary }]} onPress={scanMedia}>
                  <Text style={styles.rescanBtnText}>Tekrar Tara</Text>
                </TouchableOpacity>
              )}
            </View>
          )
        }
      />

      {/* Sort Option Modal */}
      <Modal
        visible={isSortModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsSortModalOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setIsSortModalOpen(false)}>
          <Pressable style={styles.sortModalCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sortModalHeader}>
              <Text style={styles.sortModalTitle}>Sıralama Seçenekleri</Text>
              <TouchableOpacity onPress={() => setIsSortModalOpen(false)}>
                <Ionicons name="close" size={20} color="#a1a1aa" />
              </TouchableOpacity>
            </View>
            {SORT_OPTIONS.map((item) => {
              const isSelected = sortOption === item.id;
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[
                    styles.sortOptionRow,
                    isSelected && [styles.sortOptionRowActive, { borderColor: theme.primary }],
                  ]}
                  onPress={() => {
                    setSortOption(item.id);
                    setIsSortModalOpen(false);
                  }}>
                  <View style={styles.sortOptionLeft}>
                    <Ionicons
                      name={item.icon}
                      size={18}
                      color={isSelected ? theme.primary : '#a1a1aa'}
                      style={{ marginRight: 12 }}
                    />
                    <Text
                      style={[
                        styles.sortOptionLabel,
                        isSelected && [styles.sortOptionLabelActive, { color: theme.primary }],
                      ]}>
                      {item.label}
                    </Text>
                  </View>
                  {isSelected && <Ionicons name="checkmark" size={18} color={theme.primary} />}
                </TouchableOpacity>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Track Item Action Menu Modal */}
      <Modal
        visible={selectedTrackForMenu != null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedTrackForMenu(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setSelectedTrackForMenu(null)}>
          <Pressable style={styles.actionMenuCard} onPress={(e) => e.stopPropagation()}>
            {selectedTrackForMenu && (
              <>
                <View style={styles.actionMenuHeader}>
                  <Text style={styles.actionMenuTitle} numberOfLines={1}>
                    {getTrackDisplayInfo(selectedTrackForMenu).title}
                  </Text>
                  <Text style={styles.actionMenuSubtitle} numberOfLines={1}>
                    {getTrackDisplayInfo(selectedTrackForMenu).artist || 'Bilinmeyen Sanatçı'}
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.actionMenuItem}
                  onPress={() => {
                    handleAddToQueue(selectedTrackForMenu);
                    setSelectedTrackForMenu(null);
                  }}>
                  <Ionicons name="list" size={18} color={theme.primary} style={{ marginRight: 12 }} />
                  <Text style={styles.actionMenuText}>Sıraya Ekle</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionMenuItem, styles.actionMenuItemDestructive]}
                  onPress={() => {
                    Alert.alert(
                      'Şarkıyı Gizle',
                      'Bu şarkı kütüphane listenizden gizlenecek. Daha sonra Ayarlar menüsünden geri getirebilirsiniz.',
                      [
                        { text: 'İptal', style: 'cancel' },
                        {
                          text: 'Gizle',
                          style: 'destructive',
                          onPress: () => handleHideTrack(selectedTrackForMenu),
                        },
                      ]
                    );
                  }}>
                  <Ionicons name="eye-off-outline" size={18} color="#ef4444" style={{ marginRight: 12 }} />
                  <Text style={styles.actionMenuTextDestructive}>Şarkıyı Gizle</Text>
                </TouchableOpacity>
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
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#71717a',
    marginTop: 2,
    fontWeight: '500',
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerActionBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#18181b',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  searchBackBtn: {
    padding: 6,
    marginRight: 6,
  },
  searchInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181b',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 42,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  searchInnerIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: '#ffffff',
    fontSize: 14,
  },
  searchClearBtn: {
    padding: 4,
  },
  toastCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1c1917',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 16,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.4)',
  },
  toastText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 120, // MiniPlayer ve TabBar'ın altında kalmaması için
  },
  trackItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181b',
    padding: 10,
    borderRadius: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  trackItemPlaying: {
    borderColor: 'rgba(59, 130, 246, 0.5)',
    backgroundColor: '#1e2430',
  },
  trackMainContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  trackInfo: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  trackTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
    flex: 1,
  },
  trackTitlePlaying: {
    color: '#ffffff',
    fontWeight: '700',
  },
  trackDuration: {
    fontSize: 12,
    color: '#71717a',
    marginTop: 3,
  },
  trackMoreBtn: {
    padding: 8,
  },
  swipeLeftActionBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#27272a',
    justifyContent: 'center',
    paddingHorizontal: 20,
    borderRadius: 14,
    marginBottom: 8,
    marginRight: 6,
  },
  swipeLeftActionText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  centerBox: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 80,
  },
  statusText: {
    color: '#a1a1aa',
    marginTop: 12,
    fontSize: 14,
  },
  emptyText: {
    color: '#71717a',
    marginTop: 12,
    fontSize: 15,
  },
  rescanBtn: {
    marginTop: 16,
    backgroundColor: '#27272a',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
  },
  rescanBtnText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 14,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sortModalCard: {
    width: '100%',
    backgroundColor: '#18181b',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  sortModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
  },
  sortModalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  sortOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  sortOptionRowActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  sortOptionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sortOptionLabel: {
    fontSize: 14,
    color: '#a1a1aa',
    fontWeight: '500',
  },
  sortOptionLabelActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  actionMenuCard: {
    width: '100%',
    backgroundColor: '#18181b',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  actionMenuHeader: {
    paddingBottom: 14,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
  },
  actionMenuTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  actionMenuSubtitle: {
    color: '#71717a',
    fontSize: 13,
    marginTop: 2,
  },
  actionMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  actionMenuItemDestructive: {
    marginTop: 4,
  },
  actionMenuText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  actionMenuTextDestructive: {
    color: '#ef4444',
    fontSize: 14,
    fontWeight: '600',
  },
});
