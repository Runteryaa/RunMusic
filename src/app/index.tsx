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
  BackHandler,
} from 'react-native';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as FileSystem from 'expo-file-system';
import TrackPlayer, { useActiveTrack } from 'react-native-track-player';
import { Swipeable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../store/useStore';
import { useDownloadStore } from '../store/useDownloadStore';
import { usePlayerUIStore } from '../store/usePlayerUIStore';
import { useThemeStore } from '../store/useThemeStore';
import { useRemoteConnectStore } from '../store/useRemoteConnectStore';
import { useOptimisticPlayerStore } from '../store/useOptimisticPlayerStore';
import { useActivePlayer } from '../hooks/useActivePlayer';
import { remoteSyncManager } from '../services/remote/remoteSyncManager';
import type { RemoteTrackSummary } from '../services/remote/remoteTypes';
import { TrackArtwork } from '../components/TrackArtwork';
import { EditTrackModal, EditTrackTarget } from '../components/EditTrackModal';
import { AdBanner } from '../components/AdBanner';
import { getBatchMetadataAsync, getArtworkAsync } from '../../modules/audio-artwork/src';
import { cleanDisplayTitle, getSearchKeywords } from '../services/lyricsService';
import {
  addToQueue,
  handlePlaybackError,
  playNext,
  startPlaybackFromLibrary,
  type QueueTrack,
} from '../services/queueController';
import { compareAddedDate, type SortOption } from '../services/librarySort';
import { normalizeSearchText } from '../services/searchUtils';
import { useTranslation } from '../services/i18n';
import { getCachedLibrary, saveCachedLibrary } from '../services/libraryStorage';

interface SortItem {
  id: SortOption;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}


const TRACK_INFO_CACHE = new Map<
  string,
  { title: string; artist: string; sortKey: string; searchTarget: string }
>();
const MAX_TRACK_INFO_CACHE = 3000;

export default function LibraryScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
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
  const isShuffle = useStore((s) => s.isShuffle);
  const isSmartShuffle = useStore((s) => s.isSmartShuffle);
  const preferences = useStore((s) => s.preferences);
  const updatePreferences = useStore((s) => s.updatePreferences);
  const toggleDevMode = useStore((s) => s.toggleDevMode);

  const openFullscreenPlayer = usePlayerUIStore((s) => s.openFullscreenPlayer);
  const activeTrack = useActiveTrack();
  const isRemoteConnected = useRemoteConnectStore((s) => s.isRemoteConnected());
  const connectedDeviceName = useRemoteConnectStore((s) => s.connectedDeviceName);
  const remoteLibrary = useRemoteConnectStore((s) => s.remoteLibrary);
  const isRemoteLibraryLoading = useRemoteConnectStore((s) => s.isRemoteLibraryLoading);
  const activeTransport = remoteSyncManager.getActiveClientTransport();
  const player = useActivePlayer();

  const isShowingRemoteLibrary = isRemoteConnected && (activeTransport === 'wifi' || activeTransport === 'internet');

  const [statusMessage, setStatusMessage] = useState<string>('');
  const [hasScannedOnce, setHasScannedOnce] = useState(library.length > 0);

  const sortOptions: SortItem[] = useMemo(
    () => [
      { id: 'name_asc', label: t('sort.name_asc'), icon: 'text' },
      { id: 'name_desc', label: t('sort.name_desc'), icon: 'text' },
      { id: 'duration_asc', label: t('sort.duration_asc'), icon: 'time-outline' },
      { id: 'duration_desc', label: t('sort.duration_desc'), icon: 'time' },
      { id: 'date_desc', label: t('sort.date_desc'), icon: 'calendar' },
      { id: 'date_asc', label: t('sort.date_asc'), icon: 'calendar-outline' },
    ],
    [t]
  );

  // Search state
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Sort state (defaults to name_asc)
  // Sıralama tercihi kalıcıdır (Ayarlar'da da değiştirilebilir); yerel state yok.
  const sortOption = preferences.defaultSortOption;
  const [isSortModalOpen, setIsSortModalOpen] = useState(false);

  // Track action menu state
  const [selectedTrackForMenu, setSelectedTrackForMenu] = useState<MediaLibrary.Asset | null>(null);
  const [trackToEdit, setTrackToEdit] = useState<EditTrackTarget | null>(null);

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

  const getTrackDisplayInfo = useCallback(
    (asset: MediaLibrary.Asset) => {
      const meta = metadataMap[asset.id] || metadataMap[asset.uri];
      const keywords = getSearchKeywords(asset.filename);
      const artist =
        (meta?.artist?.trim() && meta.artist !== 'Local Audio' && meta.artist !== 'Bilinmeyen Sanatçı'
          ? meta.artist.trim()
          : '') ||
        (keywords.expectedArtist && keywords.expectedArtist !== 'Local Audio' && keywords.expectedArtist !== 'Bilinmeyen Sanatçı'
          ? keywords.expectedArtist
          : '');
      const rawTitle =
        (meta?.title?.trim() ? meta.title.trim() : '') ||
        keywords.expectedTrack ||
        asset.filename;
      const title = cleanDisplayTitle(rawTitle, artist);
      return { title, artist };
    },
    [metadataMap]
  );

  /** Bir medya öğesini kuyruk parçasına dönüştürür (kuyruk işlemleri için ortak). */
  const buildQueueTrack = useCallback(
    (asset: MediaLibrary.Asset): QueueTrack => {
      const info = getTrackDisplayInfo(asset);
      return {
        id: asset.id,
        url: asset.uri,
        title: info.title,
        artist: info.artist,
        artwork: metadataMap[asset.id]?.artwork || artworkMap[asset.id] || undefined,
        duration: asset.duration,
      };
    },
    [getTrackDisplayInfo, metadataMap, artworkMap]
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

  const handleDeleteTrack = async (asset: MediaLibrary.Asset) => {
    setSelectedTrackForMenu(null);
    Alert.alert(
      t('library.delete_confirm_title'),
      t('library.delete_confirm_msg'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              const success = await MediaLibrary.deleteAssetsAsync([asset.id]);
              if (success) {
                const updatedLibrary = useStore.getState().library.filter(a => a.id !== asset.id);
                useStore.getState().setLibrary(updatedLibrary);
                saveCachedLibrary(updatedLibrary).catch(() => {});
                
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
                  console.warn('TrackPlayer update on delete failed', e);
                }
                showToast(t('library.delete_success'));
              } else {
                Alert.alert(t('common.error'), t('library.delete_error_permission'));
              }
            } catch (e) {
              console.error('Failed to delete asset', e);
              Alert.alert(t('common.error'), t('library.delete_error_generic'));
            }
          },
        },
      ]
    );
  };

  const scanMedia = useCallback(async () => {
    setIsScanning(true);
    setStatusMessage(t('library.permissions_checking'));
    try {
      let permission = await MediaLibrary.getPermissionsAsync(false, ['audio']);
      if (!permission.granted && permission.status !== 'granted') {
        permission = await MediaLibrary.requestPermissionsAsync(false, ['audio']);
      }

      if (!permission.granted && permission.status !== 'granted') {
        Alert.alert(
          t('common.permission_needed'),
          t('library.permissions_desc')
        );
        setStatusMessage(t('library.permissions_denied'));
        setIsScanning(false);
        return;
      }

      setStatusMessage(t('library.scanning'));
      let hasNextPage = true;
      let after: string | undefined = undefined;
      const allAudio: MediaLibrary.Asset[] = [];

      while (hasNextPage) {
        const result = await MediaLibrary.getAssetsAsync({
          mediaType: [MediaLibrary.MediaType.audio],
          first: 500,
          after,
        });

        if (result.assets && result.assets.length > 0) {
          allAudio.push(...result.assets);
        }
        hasNextPage = result.hasNextPage;
        after = result.endCursor;

        // Olay döngüsüne nefes payı ver (kullanıcı tab değiştirebilsin, playerı açabilsin)
        if (hasNextPage) {
          await new Promise((r) => setTimeout(r, 16));
        }
      }

      // Filter local array
      const validAudio: MediaLibrary.Asset[] = [];

      for (let i = 0; i < allAudio.length; i++) {
        const asset = allAudio[i];
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

        // Her 100 dosyada bir JS thread'ini rahatlat
        if (i % 100 === 0 && i > 0) {
          await new Promise((r) => setTimeout(r, 10));
        }
      }

      // Kütüphaneye eklenmiş yerel indirmeleri (useDownloadStore) tara ve kütüphaneye kalıcı olarak dahil et
      const downloadTasks = useDownloadStore.getState().tasks;
      for (const task of downloadTasks) {
        if (
          task.status === 'completed' &&
          task.localFileUri &&
          (task.mediaLibraryAssetId || task.storageTarget === 'public')
        ) {
          try {
            const fileInfo = await FileSystem.getInfoAsync(task.localFileUri);
            if (fileInfo.exists) {
              const taskAssetId = task.mediaLibraryAssetId || `local_${task.id}`;
              const alreadyExists = validAudio.some(
                (a) => a.id === taskAssetId || a.id === task.mediaLibraryAssetId || a.uri === task.localFileUri
              );
              if (!alreadyExists) {
                const downloadedAsset: MediaLibrary.Asset = {
                  id: taskAssetId,
                  filename: task.fileName || `${task.title || 'audio'}.mp3`,
                  uri: task.localFileUri,
                  mediaType: 'audio' as any,
                  width: 0,
                  height: 0,
                  creationTime: task.createdAt || Date.now(),
                  modificationTime: task.completedAt || Date.now(),
                  duration: (task as any).duration || 0,
                };
                validAudio.unshift(downloadedAsset);

                if (task.title || task.artist || task.artwork) {
                  useStore.getState().setTrackMetadata(taskAssetId, {
                    title: task.title,
                    artist: task.artist,
                    artwork: task.artwork,
                  });
                  if (task.artwork) {
                    useStore.getState().setArtwork(taskAssetId, task.artwork);
                  }
                }
              }
            }
          } catch {
            // ignore
          }
        }
      }

      // Mevcut kütüphanede olup sistemde taranamayan (local_) diğer yerel dosyaları da koru
      const existingLib = useStore.getState().library;
      for (const item of existingLib) {
        if (item.id.startsWith('local_') && !validAudio.some((a) => a.id === item.id || a.uri === item.uri)) {
          try {
            const info = await FileSystem.getInfoAsync(item.uri);
            if (info.exists) {
              validAudio.unshift(item);
            }
          } catch {
            // ignore
          }
        }
      }

      // Kütüphane listesini güncellemeden önce bekleyen arayüz etkileşimlerine yer aç
      await new Promise((r) => setTimeout(r, 0));
      setLibrary(validAudio);
      saveCachedLibrary(validAudio).catch(() => {});
      setStatusMessage(t('library.songs_found', { count: validAudio.length }));

      // Background extraction of missing metadata & artworks (nefes payı ve tek seferlik toplu kayıt ile)
      (async () => {
        try {
          // Açılışta kullanıcı arayüzünün 0ms anında tepki vermesi için 2 sn bekle
          await new Promise((r) => setTimeout(r, 2000));
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
            // Her parçadan sonra arayüzün akıcı kalması için 100ms mola ver
            await new Promise((r) => setTimeout(r, 100));
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
      setStatusMessage(`${t('common.error')}: ${e?.message || e}`);
      Alert.alert(t('library.scan_error_title'), e?.message || t('library.scan_error_msg'));
    } finally {
      setIsScanning(false);
      setHasScannedOnce(true);
    }
  }, [settings, setLibrary, setIsScanning, setBatchTrackMetadata, t]);

  // İlk açılışta önbellekten anında oku (0ms), ardından kütüphaneyi arka planda tara ve güncelle
  useEffect(() => {
    let isMounted = true;
    (async () => {
      if (useStore.getState().library.length === 0) {
        try {
          const cached = await getCachedLibrary();
          if (isMounted && cached && cached.length > 0) {
            setLibrary(cached);
            setHasScannedOnce(true);
          }
        } catch (err) {
          console.warn('Initial cached library load error:', err);
        }
      } else {
        setHasScannedOnce(true);
      }
      if (isMounted) {
        scanMedia();
      }
    })();

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Donanım geri tuşu: Modal veya arama açıksa kapat; ana ekrandan çıkılırken kapatılınca çalma kapalıysa müziği durdur
  useEffect(() => {
    const onBackPress = () => {
      if (selectedTrackForMenu) {
        setSelectedTrackForMenu(null);
        return true;
      }
      if (trackToEdit) {
        setTrackToEdit(null);
        return true;
      }
      if (isSortModalOpen) {
        setIsSortModalOpen(false);
        return true;
      }
      if (isSearchOpen) {
        setIsSearchOpen(false);
        setSearchQuery('');
        return true;
      }

      const keepPlaying = useStore.getState().preferences?.keepPlayingWhenAppKilled ?? true;
      if (!keepPlaying) {
        TrackPlayer.stop().catch(() => {});
        TrackPlayer.reset().catch(() => {});
      }
      return false;
    };

    const backSub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => {
      backSub.remove();
    };
  }, [selectedTrackForMenu, trackToEdit, isSortModalOpen, isSearchOpen]);

  // Compute info once per track to avoid O(N log N) regex operations during sorting
  const libraryWithInfo = useMemo(() => {
    return library.map((asset) => {
      const meta = metadataMap[asset.id] || metadataMap[asset.uri];
      const cacheKey = `${asset.id}_${asset.modificationTime || 0}_${meta?.title || ''}_${meta?.artist || ''}`;
      let cached = TRACK_INFO_CACHE.get(cacheKey);
      if (!cached) {
        const info = getTrackDisplayInfo(asset);
        const sortKey = (info.title || '').toLocaleLowerCase('tr');
        const searchTarget = normalizeSearchText(`${info.title} ${info.artist} ${asset.filename}`);
        cached = { title: info.title, artist: info.artist, sortKey, searchTarget };

        if (TRACK_INFO_CACHE.size >= MAX_TRACK_INFO_CACHE) {
          const iter = TRACK_INFO_CACHE.keys();
          for (let i = 0; i < 500; i++) {
            const next = iter.next();
            if (next.done) break;
            TRACK_INFO_CACHE.delete(next.value);
          }
        }
        TRACK_INFO_CACHE.set(cacheKey, cached);
      }
      return {
        asset,
        info: { title: cached.title, artist: cached.artist },
        sortKey: cached.sortKey,
        searchTarget: cached.searchTarget,
      };
    });
  }, [library, metadataMap, getTrackDisplayInfo]);

  // Hızlı sıralama karşılaştırıcısı: localeCompare yerine önceden türetilmiş sortKey kullanılır (1000x daha hızlı)
  const sortComparator = useCallback(
    (
      a: { asset: MediaLibrary.Asset; info: { title: string; artist: string }; sortKey: string },
      b: { asset: MediaLibrary.Asset; info: { title: string; artist: string }; sortKey: string },
      option: SortOption
    ) => {
      switch (option) {
        case 'name_asc':
          return a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0;
        case 'name_desc':
          return a.sortKey > b.sortKey ? -1 : a.sortKey < b.sortKey ? 1 : 0;
        case 'duration_asc':
          return (a.asset.duration || 0) - (b.asset.duration || 0);
        case 'duration_desc':
          return (b.asset.duration || 0) - (a.asset.duration || 0);
        case 'date_desc':
          return compareAddedDate(b.asset, a.asset);
        case 'date_asc':
          return compareAddedDate(a.asset, b.asset);
        default:
          return 0;
      }
    },
    []
  );

  const fullSortedListWithInfo = useMemo(() => {
    return [...libraryWithInfo].sort((a, b) => sortComparator(a, b, sortOption));
  }, [libraryWithInfo, sortOption, sortComparator]);

  // The final sorted array of raw assets for TrackPlayer integration
  const fullSortedList = useMemo(() => fullSortedListWithInfo.map(item => item.asset), [fullSortedListWithInfo]);

  // Displayed list (array of objects with asset and precomputed info)
  const displayedList = useMemo(() => {
    if (!searchQuery.trim()) return fullSortedListWithInfo;
    const q = normalizeSearchText(searchQuery);
    if (!q) return fullSortedListWithInfo;

    const terms = q.split(' ').filter(Boolean);

    return fullSortedListWithInfo.filter((item) => {
      if (item.searchTarget.includes(q)) return true;
      if (terms.length <= 1) return false;
      return terms.every((term) => item.searchTarget.includes(term));
    });
  }, [fullSortedListWithInfo, searchQuery]);

  const remoteDisplayedList = useMemo(() => {
    if (!searchQuery.trim()) return remoteLibrary;
    const q = normalizeSearchText(searchQuery);
    if (!q) return remoteLibrary;
    const terms = q.split(' ').filter(Boolean);
    return remoteLibrary.filter((item) => {
      const target = normalizeSearchText(`${item.title} ${item.artist}`);
      if (target.includes(q)) return true;
      if (terms.length <= 1) return false;
      return terms.every((t) => target.includes(t));
    });
  }, [remoteLibrary, searchQuery]);

  const playRemoteTrack = (item: RemoteTrackSummary) => {
    useOptimisticPlayerStore.getState().setOptimisticTrack(item, artworkMap[item.id] || null);
    if (artworkMap[item.id] && preferences.dynamicColorFromArtwork) {
      useThemeStore.getState().updateThemeFromArtwork(artworkMap[item.id]);
    }
    remoteSyncManager.sendClientCommand({
      type: 'COMMAND_PLAY_LIBRARY_TRACK',
      trackId: item.id,
      title: item.title,
      artist: item.artist,
    });
    openFullscreenPlayer();
  };

  const handleRemoteAddToQueue = (item: RemoteTrackSummary) => {
    remoteSyncManager.sendClientCommand({
      type: 'COMMAND_PLAY_LIBRARY_TRACK',
      trackId: item.id,
      title: item.title,
      artist: item.artist,
    });
    showToast(`"${item.title}" ${t('library.added_to_queue')}`);
  };

  const handleRemoteShuffleAll = () => {
    remoteSyncManager.sendClientCommand({ type: 'COMMAND_SET_SHUFFLE', enabled: true });
    if (remoteLibrary.length > 0) {
      const random = remoteLibrary[Math.floor(Math.random() * remoteLibrary.length)];
      useOptimisticPlayerStore.getState().setOptimisticTrack(random, null);
      remoteSyncManager.sendClientCommand({
        type: 'COMMAND_PLAY_LIBRARY_TRACK',
        trackId: random.id,
        title: random.title,
        artist: random.artist,
      });
    } else {
      remoteSyncManager.sendClientCommand({ type: 'COMMAND_PLAY' });
    }
    openFullscreenPlayer();
    showToast(t('library.shuffle_started'));
  };

  const playTrack = async (selectedAsset: MediaLibrary.Asset) => {
    try {
      const targetArtwork =
        metadataMap[selectedAsset.id]?.artwork || artworkMap[selectedAsset.id] || undefined;
      const meta = metadataMap[selectedAsset.id];
      const summary: RemoteTrackSummary = {
        id: selectedAsset.id,
        title: meta?.title || selectedAsset.filename,
        artist: meta?.artist || 'Unknown Artist',
        duration: selectedAsset.duration || 0,
        hasArtwork: !!targetArtwork,
      };
      useOptimisticPlayerStore.getState().setOptimisticTrack(summary, targetArtwork || null);

      // 1. Temayı hemen yeni seçilen şarkının kapağına geçir ki ara renk / flash olmasın
      if (targetArtwork && preferences.dynamicColorFromArtwork) {
        useThemeStore.getState().updateThemeFromArtwork(targetArtwork);
      }

      // Uzak cihaz bağlantısı aktifse komutu doğrudan sunucu cihaza yönlendir
      if (useRemoteConnectStore.getState().isRemoteConnected()) {
        remoteSyncManager.sendClientCommand({
          type: 'COMMAND_PLAY_TRACK',
          trackId: selectedAsset.id,
          title: meta?.title || selectedAsset.filename,
          artist: meta?.artist || undefined,
        });
        openFullscreenPlayer();
        return;
      }

      // 2. Mevcut kuyrukta şarkı var mı denetle
      const queue = await TrackPlayer.getQueue();
      const existingIndex = queue.findIndex(
        (item) => item.id === selectedAsset.id || item.url === selectedAsset.uri
      );

      // Şarkı zaten kuyruktaysa ve shuffle KAPALIYSA mevcut konuma atla.
      //
      // Shuffle AÇIKKEN ise (Spotify gibi) dokunulan şarkıdan başlayan YENİ ve
      // KARIŞTIRILMIŞ bir kuyruk kurulur. Aksi halde kuyruk, shuffle açılmadan
      // önceki liste düzeninde kalır ve "shuffle seçili ama sıra karışmıyor"
      // durumu ortaya çıkar.
      if (existingIndex >= 0 && !isShuffle) {
        const info = getTrackDisplayInfo(selectedAsset);
        const art = targetArtwork || null;
        const summary = {
          id: selectedAsset.id,
          title: info.title || 'Unknown Title',
          artist: info.artist || 'Unknown Artist',
          duration: selectedAsset.duration || 0,
          hasArtwork: !!art,
        };
        useOptimisticPlayerStore.getState().setOptimisticTrack(summary, art);
        if (art && useStore.getState().preferences.dynamicColorFromArtwork) {
          useThemeStore.getState().updateThemeFromArtwork(art);
        }

        try {
          await TrackPlayer.skip(existingIndex);
          await TrackPlayer.play();
        } catch (playErr) {
          console.warn('[index.tsx] play existing track error:', playErr);
          const queue = await TrackPlayer.getQueue();
          await handlePlaybackError(playErr, queue[existingIndex], existingIndex);
        }
        openFullscreenPlayer();

        if (!targetArtwork) {
          getArtworkAsync(selectedAsset.uri, selectedAsset.id).then((art: string | null) => {
            if (art) {
              useStore.getState().setArtwork(selectedAsset.id, art);
              useThemeStore.getState().updateThemeFromArtwork(art);
            }
          });
        }
        return;
      }

      // 3. Kuyruk yoksa: tüm kütüphaneyi bağlam olarak kur ve seçilen parçayı çal.
      //    Shuffle açıkken sıra bir kez karıştırılır ve seçilen parça başa alınır.
      const tracks = fullSortedList.map((asset) => buildQueueTrack(asset));

      await startPlaybackFromLibrary({
        tracks,
        startId: selectedAsset.id,
        shuffle: isShuffle,
        smartShuffle: isShuffle ? isSmartShuffle : false,
      });
      openFullscreenPlayer();

      if (!targetArtwork) {
        getArtworkAsync(selectedAsset.uri, selectedAsset.id).then((art: string | null) => {
          if (art) {
            useStore.getState().setArtwork(selectedAsset.id, art);
            useThemeStore.getState().updateThemeFromArtwork(art);
          }
        });
      }
    } catch (e) {
      console.error('Failed to play track', e);
    }
  };

  const handleAddToQueue = async (asset: MediaLibrary.Asset) => {
    try {
      const meta = metadataMap[asset.id];
      const title = meta?.title || asset.filename;

      if (useRemoteConnectStore.getState().isRemoteConnected()) {
        remoteSyncManager.sendClientCommand({
          type: 'COMMAND_PLAY_LIBRARY_TRACK',
          trackId: asset.id,
          title,
          artist: meta?.artist || undefined,
        });
        showToast(`"${title}" ${t('library.added_to_queue')}`);
        return;
      }

      const track = buildQueueTrack(asset);
      await addToQueue(track);
      showToast(`"${track.title}" ${t('library.added_to_queue')}`);
    } catch (e) {
      console.warn('Failed to add track to queue', e);
    }
  };

  const handlePlayNext = async (asset: MediaLibrary.Asset) => {
    try {
      const meta = metadataMap[asset.id];
      const title = meta?.title || asset.filename;

      if (useRemoteConnectStore.getState().isRemoteConnected()) {
        remoteSyncManager.sendClientCommand({
          type: 'COMMAND_PLAY_LIBRARY_TRACK',
          trackId: asset.id,
          title,
          artist: meta?.artist || undefined,
        });
        showToast(`"${title}" ${t('library.play_next_added')}`);
        return;
      }

      const track = buildQueueTrack(asset);
      await playNext(track);
      showToast(`"${track.title}" ${t('library.play_next_added')}`);
    } catch (e) {
      console.warn('Failed to play next', e);
    }
  };

  /**
   * "Karışık çal": rastgele bir şarkıdan başlayıp tüm kütüphaneyi karıştırarak
   * çalar. Son seçilen modu hatırlar (akıllı veya standart).
   */
  const handleShuffleAll = async () => {
    if (fullSortedList.length === 0) return;
    try {
      if (useRemoteConnectStore.getState().isRemoteConnected()) {
        remoteSyncManager.sendClientCommand({ type: 'COMMAND_SET_SHUFFLE', enabled: true });
        remoteSyncManager.sendClientCommand({ type: 'COMMAND_PLAY' });
        openFullscreenPlayer();
        return;
      }

      const startIndex = Math.floor(Math.random() * fullSortedList.length);
      const startTrack = buildQueueTrack(fullSortedList[startIndex]);
      const tracks = fullSortedList.map((asset) => buildQueueTrack(asset));

      const useSmart = isSmartShuffle;

      await startPlaybackFromLibrary({
        tracks,
        startId: startTrack.id,
        shuffle: true,
        smartShuffle: useSmart,
      });
      openFullscreenPlayer();
      showToast(useSmart ? t('library.smart_shuffle_started') : t('library.shuffle_started'));
    } catch (e) {
      console.warn('Shuffle all failed', e);
    }
  };

  const closeSearch = () => {
    setSearchQuery('');
    setIsSearchOpen(false);
  };

  const handleSearchChange = (text: string) => {
    if (text.trim().toLowerCase() === '#runterya#') {
      closeSearch();
      toggleDevMode();
      return;
    }
    setSearchQuery(text);
  };

  const renderItem = ({
    item,
    index,
  }: {
    item: { asset: MediaLibrary.Asset; info: { title: string; artist: string } };
    index: number;
  }) => {
    const { asset, info } = item;
    const isPlayingCurrent =
      activeTrack && (activeTrack.id === asset.id || activeTrack.url === asset.uri);

    const renderLeftActions = () => (
      <View style={[styles.swipeLeftActionBox, { backgroundColor: theme.primary }]}>
        <Ionicons name="list" size={20} color="#ffffff" style={{ marginRight: 6 }} />
        <Text style={styles.swipeLeftActionText}>{t('library.add_to_queue')}</Text>
      </View>
    );

    return (
      <View key={`track-row-${asset.id}`}>
        <Swipeable
          renderLeftActions={renderLeftActions}
          friction={2}
          leftThreshold={40}
          activeOffsetX={[-25, 25]}
          failOffsetY={[-15, 15]}
          onSwipeableOpen={(direction) => {
            if (direction === 'left') {
              handleAddToQueue(asset);
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
              onPress={() => playTrack(asset)}>
              <View style={{ marginRight: 12 }}>
                <TrackArtwork
                  uri={metadataMap[asset.id]?.artwork || artworkMap[asset.id]}
                  trackId={asset.id}
                  trackUri={asset.uri}
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
                  {Math.floor(asset.duration / 60)}:
                  {Math.floor(asset.duration % 60)
                    .toString()
                    .padStart(2, '0')}
                  {info.artist ? ` • ${info.artist}` : ''}
                </Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.trackMoreBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              onPress={() => setSelectedTrackForMenu(asset)}>
              <Ionicons name="ellipsis-vertical" size={18} color="#a1a1aa" />
            </TouchableOpacity>
          </View>
        </Swipeable>
        {/* Her 15 şarkıda bir araya zararsız banner reklam (son şarkı hariç) */}
        {(index + 1) % 15 === 0 && index !== displayedList.length - 1 ? (
          <AdBanner style={{ marginVertical: 6 }} />
        ) : null}
      </View>
    );
  };

  const renderRemoteItem = ({ item, index }: { item: RemoteTrackSummary; index: number }) => {
    const isPlayingCurrent =
      (activeTrack && activeTrack.id === item.id) ||
      (player.activeTrack && player.activeTrack.id === item.id);

    const renderLeftActions = () => (
      <View style={[styles.swipeLeftActionBox, { backgroundColor: theme.primary }]}>
        <Ionicons name="list" size={20} color="#ffffff" style={{ marginRight: 6 }} />
        <Text style={styles.swipeLeftActionText}>{t('library.add_to_queue')}</Text>
      </View>
    );

    return (
      <View key={`remote-row-${item.id}`}>
        <Swipeable
          renderLeftActions={renderLeftActions}
          friction={2}
          leftThreshold={40}
          activeOffsetX={[-25, 25]}
          failOffsetY={[-15, 15]}
          onSwipeableOpen={(direction) => {
            if (direction === 'left') {
              handleRemoteAddToQueue(item);
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
              onPress={() => playRemoteTrack(item)}>
              <View style={{ marginRight: 12 }}>
                <TrackArtwork
                  uri={artworkMap[item.id]}
                  trackId={item.id}
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
                    {item.title}
                  </Text>
                </View>
                <Text style={styles.trackDuration} numberOfLines={1}>
                  {Math.floor(item.duration / 60)}:
                  {Math.floor(item.duration % 60)
                    .toString()
                    .padStart(2, '0')}
                  {item.artist ? ` • ${item.artist}` : ''}
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        </Swipeable>
        {(index + 1) % 15 === 0 && index !== remoteDisplayedList.length - 1 ? (
          <AdBanner style={{ marginVertical: 6 }} />
        ) : null}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Top Header / Search Bar */}
      {isSearchOpen ? (
        <View style={[styles.searchBarContainer, { paddingTop: Math.max(insets.top, 16) + 4 }]}>
          <TouchableOpacity onPress={closeSearch} style={styles.searchBackBtn}>
            <Ionicons name="arrow-back" size={22} color="#ffffff" />
          </TouchableOpacity>
          <View style={styles.searchInputWrapper}>
            <Ionicons name="search" size={18} color="#71717a" style={styles.searchInnerIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder={t('library.search_placeholder')}
              placeholderTextColor="#71717a"
              value={searchQuery}
              onChangeText={handleSearchChange}
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
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) + 4 }]}>
          <View>
            <Text style={styles.headerTitle}>{t('library.title')}</Text>
            <Text style={styles.headerSubtitle}>
              {isShowingRemoteLibrary
                ? `${connectedDeviceName ? `${connectedDeviceName} • ` : ''}${remoteLibrary.length} ${t('library.songs_registered')}`
                : isScanning && library.length > 0
                ? t('library.updating_library')
                : `${library.length} ${t('library.songs_registered')}`}
            </Text>
          </View>
          <View style={styles.headerRightActions}>
            <TouchableOpacity
              style={styles.headerActionBtn}
              onPress={() => setIsSearchOpen(true)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="search" size={20} color="#ffffff" />
            </TouchableOpacity>

            {!isShowingRemoteLibrary && (
              <TouchableOpacity
                style={styles.headerActionBtn}
                onPress={() => setIsSortModalOpen(true)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="swap-vertical" size={20} color="#ffffff" />
              </TouchableOpacity>
            )}

            {/* Karışık çal: rastgele bir şarkıdan başlayan karışık kuyruk */}
            <TouchableOpacity
              style={[styles.headerActionBtn, { backgroundColor: theme.primary, borderColor: theme.primary }]}
              onPress={isShowingRemoteLibrary ? handleRemoteShuffleAll : handleShuffleAll}
              disabled={isShowingRemoteLibrary ? remoteLibrary.length === 0 : library.length === 0}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="shuffle" size={20} color="#ffffff" />
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
        data={isShowingRemoteLibrary ? (remoteDisplayedList as any) : displayedList}
        keyExtractor={(item: any) => (isShowingRemoteLibrary ? item.id : item.asset.id)}
        renderItem={isShowingRemoteLibrary ? (renderRemoteItem as any) : renderItem}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <>
            {isShowingRemoteLibrary && (
              <View style={[styles.remoteBanner, { borderColor: theme.border, backgroundColor: theme.surface }]}>
                <Ionicons name="wifi" size={16} color={theme.primary} style={{ marginRight: 8 }} />
                <Text style={styles.remoteBannerText} numberOfLines={1}>
                  {connectedDeviceName ? `${connectedDeviceName} Kütüphanesi` : 'Uzak Kütüphane'}
                </Text>
                <TouchableOpacity
                  style={[styles.remoteRefreshBtn, { borderColor: theme.border }]}
                  onPress={() => remoteSyncManager.fetchRemoteLibrary()}
                  disabled={isRemoteLibraryLoading}>
                  <Ionicons
                    name="refresh"
                    size={14}
                    color="#ffffff"
                    style={isRemoteLibraryLoading ? { opacity: 0.5 } : undefined}
                  />
                </TouchableOpacity>
              </View>
            )}
            {(isShowingRemoteLibrary ? remoteDisplayedList.length > 0 : displayedList.length > 0) ? (
              <AdBanner style={{ marginBottom: 8 }} />
            ) : null}
          </>
        }
        ListFooterComponent={
          (isShowingRemoteLibrary ? remoteDisplayedList.length : displayedList.length) >= 20 ? (
            <AdBanner style={{ marginTop: 8, marginBottom: 16 }} />
          ) : null
        }
        initialNumToRender={15}
        maxToRenderPerBatch={10}
        windowSize={7}
        removeClippedSubviews={true}
        refreshControl={
          isShowingRemoteLibrary ? (
            <RefreshControl
              refreshing={isRemoteLibraryLoading}
              onRefresh={() => remoteSyncManager.fetchRemoteLibrary()}
              tintColor={theme.primary}
              colors={[theme.primary]}
            />
          ) : (
            <RefreshControl
              refreshing={isScanning}
              onRefresh={scanMedia}
              tintColor={theme.primary}
              colors={[theme.primary]}
            />
          )
        }
        ListEmptyComponent={
          isShowingRemoteLibrary ? (
            isRemoteLibraryLoading ? (
              <View style={styles.centerBox}>
                <ActivityIndicator size="large" color={theme.primary} />
                <Text style={[styles.statusText, { color: theme.primary }]}>
                  {t('remote.fetching_library') || 'Kütüphane alınıyor...'}
                </Text>
              </View>
            ) : (
              <View style={styles.centerBox}>
                <Ionicons name="wifi-outline" size={48} color="#3f3f46" />
                <Text style={styles.emptyText}>
                  {searchQuery ? t('library.no_matching_tracks') : 'Uzak kütüphanede şarkı bulunamadı'}
                </Text>
                {!searchQuery && (
                  <TouchableOpacity
                    style={[styles.rescanBtn, { backgroundColor: theme.primary }]}
                    onPress={() => remoteSyncManager.fetchRemoteLibrary()}>
                    <Text style={styles.rescanBtnText}>{t('library.rescan')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )
          ) : (
            (isScanning || !hasScannedOnce) ? (
              <View style={styles.centerBox}>
                <ActivityIndicator size="large" color={theme.primary} />
                <Text style={[styles.statusText, { color: theme.primary }]}>
                  {statusMessage || t('library.scanning')}
                </Text>
              </View>
            ) : (
              <View style={styles.centerBox}>
                <Ionicons name="musical-notes-outline" size={48} color="#3f3f46" />
                <Text style={styles.emptyText}>
                  {searchQuery ? t('library.no_matching_tracks') : t('library.no_tracks_yet')}
                </Text>
                {!searchQuery && (
                  <TouchableOpacity style={[styles.rescanBtn, { backgroundColor: theme.primary }]} onPress={scanMedia}>
                    <Text style={styles.rescanBtnText}>{t('library.rescan')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )
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
              <Text style={styles.sortModalTitle}>{t('library.sort_options_title')}</Text>
              <TouchableOpacity onPress={() => setIsSortModalOpen(false)}>
                <Ionicons name="close" size={20} color="#a1a1aa" />
              </TouchableOpacity>
            </View>
            {sortOptions.map((item) => {
              const isSelected = sortOption === item.id;
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[
                    styles.sortOptionRow,
                    isSelected && [styles.sortOptionRowActive, { borderColor: theme.primary }],
                  ]}
                  onPress={() => {
                    updatePreferences({ defaultSortOption: item.id });
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
                    {getTrackDisplayInfo(selectedTrackForMenu).artist || t('common.unknown_artist')}
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.actionMenuItem}
                  onPress={() => {
                    handlePlayNext(selectedTrackForMenu);
                    setSelectedTrackForMenu(null);
                  }}>
                  <Ionicons name="play-skip-forward" size={18} color={theme.primary} style={{ marginRight: 12 }} />
                  <Text style={styles.actionMenuText}>{t('library.play_next')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.actionMenuItem}
                  onPress={() => {
                    handleAddToQueue(selectedTrackForMenu);
                    setSelectedTrackForMenu(null);
                  }}>
                  <Ionicons name="list" size={18} color={theme.primary} style={{ marginRight: 12 }} />
                  <Text style={styles.actionMenuText}>{t('library.add_to_queue')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.actionMenuItem}
                  onPress={() => {
                    const info = getTrackDisplayInfo(selectedTrackForMenu);
                    setTrackToEdit({
                      id: selectedTrackForMenu.id,
                      uri: selectedTrackForMenu.uri,
                      title: info.title,
                      artist: info.artist,
                      album: metadataMap[selectedTrackForMenu.id]?.album,
                      artwork: metadataMap[selectedTrackForMenu.id]?.artwork || artworkMap[selectedTrackForMenu.id] || null,
                      originalArtwork: null,
                    });
                    setSelectedTrackForMenu(null);
                  }}>
                  <Ionicons name="pencil-outline" size={18} color={theme.primary} style={{ marginRight: 12 }} />
                  <Text style={styles.actionMenuText}>{t('library.edit_info')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionMenuItem, styles.actionMenuItemDestructive]}
                  onPress={() => {
                    Alert.alert(
                      t('library.hide_track'),
                      t('library.hide_confirm_msg'),
                      [
                        { text: t('common.cancel'), style: 'cancel' },
                        {
                          text: t('library.hide_track'),
                          style: 'destructive',
                          onPress: () => handleHideTrack(selectedTrackForMenu),
                        },
                      ]
                    );
                  }}>
                  <Ionicons name="eye-off-outline" size={18} color="#ef4444" style={{ marginRight: 12 }} />
                  <Text style={styles.actionMenuTextDestructive}>{t('library.hide_track')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionMenuItem, styles.actionMenuItemDestructive]}
                  onPress={() => handleDeleteTrack(selectedTrackForMenu)}>
                  <Ionicons name="trash-outline" size={18} color="#ef4444" style={{ marginRight: 12 }} />
                  <Text style={styles.actionMenuTextDestructive}>{t('library.delete_track')}</Text>
                </TouchableOpacity>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Track Metadata & Artwork Editor Modal */}
      <EditTrackModal
        visible={trackToEdit != null}
        track={trackToEdit}
        onClose={() => setTrackToEdit(null)}
      />
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
    paddingBottom: 136, // MiniPlayer ve TabBar'ın altında kalmaması için
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
  remoteBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
  },
  remoteBannerText: {
    flex: 1,
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  remoteRefreshBtn: {
    padding: 6,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
