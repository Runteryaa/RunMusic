import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  GestureResponderEvent,
  Modal,
  Pressable,
  FlatList,
  ActivityIndicator,
  TextInput,
  ScrollView,
  Dimensions,
  Animated,
  PanResponder,
  BackHandler,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as MediaLibrary from 'expo-media-library/legacy';
import { Ionicons } from '@expo/vector-icons';
import TrackPlayer, {
  useActiveTrack,
  RepeatMode,
  Track,
} from 'react-native-track-player';
import { useStore } from '../store/useStore';
import { usePlayerUIStore } from '../store/usePlayerUIStore';
import { useThemeStore } from '../store/useThemeStore';
import { useSleepTimerStore } from '../store/useSleepTimerStore';
import { useRemoteConnectStore } from '../store/useRemoteConnectStore';
import { useOptimisticPlayerStore } from '../store/useOptimisticPlayerStore';
import { useDownloadStore } from '../store/useDownloadStore';
import { useExtensionStore } from '../store/useExtensionStore';
import { startDownload } from '../services/downloadManager';
import { useActivePlayer } from '../hooks/useActivePlayer';
import { useActiveProgress } from '../hooks/useActiveProgress';
import { remoteSyncManager } from '../services/remote/remoteSyncManager';
import { wsRoomClient } from '../services/remote/wsRoomClient';
import { udpDiscoveryService } from '../services/remote/udpDiscovery';
import { bleCentralService } from '../services/remote/bleCentralService';
import type { DiscoveredPeer } from '../services/remote/IRemoteTransport';
import { RUNMUSIC_TCP_PORT, type DiscoveredHost, type RemoteTrackSummary } from '../services/remote/remoteTypes';
import { TrackArtwork } from './TrackArtwork';
import { EditTrackModal } from './EditTrackModal';
import { MarqueeText } from './ui/MarqueeText';
import { useTranslation } from '../services/i18n';
import { showRewardedAd } from '../services/adService';
import {
  LyricLine,
  LyricsResult,
  LyricsCandidate,
  fetchLyricsOnline,
  searchAllCandidates,
  resolveCandidateToLyricsResult,
  parseAnySyncedLyrics,
  getLyricsCacheKeys,
  cleanYouTubeTitle,
  cleanDisplayTitle,
  getSearchKeywords,
  LRCLIB_HEADERS,
  fetchGeniusLyricsByUrl,
} from '../services/lyricsService';
import { saveLastPlayback, updateQueueSnapshotActiveIndex } from '../services/playbackStorage';
import {
  buildQueueRows,
  clearUpNextQueue,
  cyclePlaybackMode,
  deriveQueueSections,
  getQueueSections,
  markUpNextConsumed,
  moveUpNext,
  playQueueTrack,
  promoteContextTrackToUpNext,
  removeQueueItem,
  playHistoryTrack,
  resolveTrackId,
  trackKey,
  type QueueEntry,
  type QueueRow,
  type QueueSections,
  type QueueTrackLike,
} from '../services/queueController';
import { QueueUpNextList, type UpNextItem } from './QueueUpNextList';
import { Swipeable } from 'react-native-gesture-handler';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const ARTWORK_SIZE = Math.min(SCREEN_WIDTH - 56, 350);


function FullscreenPlayerModalImpl({ expandAnim }: { expandAnim?: Animated.Value } = {}) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const {
    isFullscreenPlayerOpen,
    closeFullscreenPlayer,
    isLyricsMode,
    toggleLyricsMode,
    isQueueMode,
    toggleQueueMode,
    isSleepTimerMode,
    toggleSleepTimerMode,
    isConnectMode,
    toggleConnectMode,
  } = usePlayerUIStore();

  const theme = useThemeStore((s) => s.theme);
  const player = useActivePlayer();
  const progress = useActiveProgress();
  const localActiveTrack = useActiveTrack();
  const activeTrack = player.activeTrack;
  const playing = player.isPlaying;
  const remoteState = useRemoteConnectStore((s) => s.remoteState);
  const discoveredHosts = useRemoteConnectStore((s) => s.discoveredHosts);
  const setDiscoveredHosts = useRemoteConnectStore((s) => s.setDiscoveredHosts);
  const discoveredBlePeers = useRemoteConnectStore((s) => s.discoveredBlePeers);
  const setDiscoveredBlePeers = useRemoteConnectStore((s) => s.setDiscoveredBlePeers);
  const activeTransportTab = useRemoteConnectStore((s) => s.activeTransportTab);
  const setActiveTransportTab = useRemoteConnectStore((s) => s.setActiveTransportTab);
  const isRemoteServiceEnabled = useRemoteConnectStore((s) => s.isServiceEnabled);
  const setRemoteServiceEnabled = useRemoteConnectStore((s) => s.setServiceEnabled);
  const remoteMode = useRemoteConnectStore((s) => s.mode);
  const remoteConnectionStatus = useRemoteConnectStore((s) => s.connectionStatus);
  const errorMessage = useRemoteConnectStore((s) => s.errorMessage);
  const connectedDeviceName = useRemoteConnectStore((s) => s.connectedDeviceName);
  const connectedClients = useRemoteConnectStore((s) => s.connectedClients);

  const internetRoomCode = useRemoteConnectStore((s) => s.internetRoomCode);
  const internetHostStatus = useRemoteConnectStore((s) => s.internetHostStatus);

  const [inputRoomCode, setInputRoomCode] = useState('');
  const [showManualIp, setShowManualIp] = useState(false);
  const [manualIp, setManualIp] = useState('');
  const [manualPort, setManualPort] = useState(RUNMUSIC_TCP_PORT.toString());

  // Connecto ekranı açıldığı anda servisi otomatik olarak aktif hale getir
  const prevIsConnectModeRef = useRef(false);
  useEffect(() => {
    if (isConnectMode && !prevIsConnectModeRef.current) {
      if (!isRemoteServiceEnabled) {
        setRemoteServiceEnabled(true);
      }
    }
    prevIsConnectModeRef.current = isConnectMode;
  }, [isConnectMode, isRemoteServiceEnabled, setRemoteServiceEnabled]);

  useEffect(() => {
    if (!isConnectMode || remoteMode === 'client') {
      if (remoteMode !== 'client') {
        setDiscoveredHosts([]);
        setDiscoveredBlePeers([]);
      }
      return;
    }

    if (activeTransportTab === 'ble') {
      const unsubscribe = bleCentralService.startDiscovery((peers) => {
        setDiscoveredBlePeers(peers);
      });
      return () => {
        unsubscribe();
      };
    } else if (activeTransportTab === 'wifi') {
      const unsubscribe = udpDiscoveryService.startClientListener((hosts) => {
        setDiscoveredHosts(hosts);
      });
      return () => {
        unsubscribe();
      };
    } else if (activeTransportTab === 'internet') {
      if (isRemoteServiceEnabled && remoteMode === 'host' && !wsRoomClient.isConnected()) {
        remoteSyncManager.startInternetHostRoom().catch(() => {});
      }
    }
  }, [
    isConnectMode,
    remoteMode,
    activeTransportTab,
    isRemoteServiceEnabled,
    setDiscoveredHosts,
    setDiscoveredBlePeers,
  ]);

  const handleSelectLocalDevice = useCallback(() => {
    if (remoteMode === 'client') {
      remoteSyncManager.disconnectClient();
    }
    toggleConnectMode();
  }, [remoteMode, toggleConnectMode]);

  const handleSelectRemoteHost = useCallback(async (host: DiscoveredHost | DiscoveredPeer) => {
    try {
      await remoteSyncManager.connectToHost(host);
    } catch (err: any) {
      Alert.alert(t('remote.connection_error'), err?.message || t('remote.device_unreachable'));
    }
  }, [t]);

  const handleManualConnect = useCallback(async () => {
    const ip = manualIp.trim();
    if (!ip) return;
    const port = parseInt(manualPort.trim(), 10) || RUNMUSIC_TCP_PORT;
    const manualHost: DiscoveredHost = {
      deviceId: `manual_${ip}`,
      deviceName: `Cihaz (${ip})`,
      hostIp: ip,
      port,
      lastSeen: Date.now(),
    };
    setShowManualIp(false);
    await remoteSyncManager.connectToHost(manualHost);
  }, [manualIp, manualPort]);

  // Android hardware back button listener
  useEffect(() => {
    if (!isFullscreenPlayerOpen) return;
    const backSub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isConnectMode) {
        toggleConnectMode();
        return true;
      }
      if (isSleepTimerMode) {
        toggleSleepTimerMode();
        return true;
      }
      if (isQueueMode) {
        toggleQueueMode();
        return true;
      }
      if (isLyricsMode) {
        toggleLyricsMode();
        return true;
      }
      closeFullscreenPlayer();
      return true;
    });
    return () => backSub.remove();
  }, [
    isFullscreenPlayerOpen,
    isConnectMode,
    isSleepTimerMode,
    isQueueMode,
    isLyricsMode,
    toggleConnectMode,
    toggleSleepTimerMode,
    toggleQueueMode,
    toggleLyricsMode,
    closeFullscreenPlayer,
  ]);

  // Morph transforms synchronized with expanding card (zarif, akıcı ve GPU dostu)
  const headerMorphY = useMemo(() => {
    if (!expandAnim) return 0;
    return expandAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [-24, 0],
      extrapolate: 'clamp',
    });
  }, [expandAnim]);

  const middleMorphScale = useMemo(() => {
    if (!expandAnim) return 1;
    return expandAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0.94, 1],
      extrapolate: 'clamp',
    });
  }, [expandAnim]);

  const middleMorphX = useMemo(() => {
    return 0;
  }, []);

  const middleMorphY = useMemo(() => {
    if (!expandAnim) return 0;
    return expandAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [18, 0],
      extrapolate: 'clamp',
    });
  }, [expandAnim]);

  const bottomMorphY = useMemo(() => {
    if (!expandAnim) return 0;
    return expandAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [24, 0],
      extrapolate: 'clamp',
    });
  }, [expandAnim]);

  const textMorphX = useMemo(() => {
    return 0;
  }, []);

  const textMorphY = useMemo(() => {
    if (!expandAnim) return 0;
    return expandAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [14, 0],
      extrapolate: 'clamp',
    });
  }, [expandAnim]);

  const storeIsShuffle = useStore((s) => s.isShuffle);
  const storeIsSmartShuffle = useStore((s) => s.isSmartShuffle);
  const storeRepeatMode = useStore((s) => s.repeatMode);
  const isShuffle = player.isRemote ? player.isShuffle : storeIsShuffle;
  const isSmartShuffle = player.isRemote ? false : storeIsSmartShuffle;
  const library = useStore((s) => s.library);
  const allAssets = useStore((s) => s.allAssets);
  const repeatMode = player.isRemote ? player.repeatMode : storeRepeatMode;
  const upNextIds = useStore((s) => s.upNextIds);
  const contextIds = useStore((s) => s.contextIds);
  const playedHistory = useStore((s) => s.playedHistory);
  const queueRevision = useStore((s) => s.queueRevision);
  const artworkMap = useStore((s) => s.artworkMap);
  const metadataMap = useStore((s) => s.metadataMap);
  const lyricsCache = useStore((s) => s.lyricsCache);
  const setLyrics = useStore((s) => s.setLyrics);
  const getLyricsFromCache = useStore((s) => s.getLyricsFromCache);
  const hideTrack = useStore((s) => s.hideTrack);
  const isHydrated = useStore((s) => s.isHydrated);
  const autoFetchLyrics = useStore((s) => s.preferences.autoFetchLyrics);
  const reduceMotion = useStore((s) => s.preferences.reduceMotion);
  const isDynamicColorUnlocked = useStore((s) => s.preferences.isDynamicColorUnlocked);
  const isDevModeActive = useStore((s) => s.preferences.isDevModeActive);
  const hasDismissedDynamicColorBanner = useStore((s) => s.preferences.hasDismissedDynamicColorBanner);
  const unlockDynamicColor = useStore((s) => s.unlockDynamicColor);
  const dismissDynamicColorBanner = useStore((s) => s.dismissDynamicColorBanner);

  const [isLoadingDynamicAd, setIsLoadingDynamicAd] = useState(false);

  const [barWidth, setBarWidth] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragTime, setDragTime] = useState(0);

  const [isOptionsModalOpen, setIsOptionsModalOpen] = useState(false);
  const [isEditTrackModalOpen, setIsEditTrackModalOpen] = useState(false);
  const [customTimerMinutes, setCustomTimerMinutes] = useState('');
  const [sleepTimerRemaining, setSleepTimerRemaining] = useState<string>('');
  const [isLyricsAutoScrollPaused, setIsLyricsAutoScrollPaused] = useState(false);

  useEffect(() => {
    setIsLyricsAutoScrollPaused(false);
  }, [activeTrack?.id]);

  // Sleep Timer store
  const isSleepTimerActive = useSleepTimerStore((s) => s.isActive);
  const sleepTimerEndTime = useSleepTimerStore((s) => s.endTime);
  const sleepTimerDurationOption = useSleepTimerStore((s) => s.durationOption);
  const startTimer = useSleepTimerStore((s) => s.startTimer);
  const startTrackTimer = useSleepTimerStore((s) => s.startTrackTimer);
  const stopTimer = useSleepTimerStore((s) => s.stopTimer);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (isSleepTimerActive) {
      const updateRemaining = () => {
        if (sleepTimerDurationOption === 'track') {
          setSleepTimerRemaining(t('player.after_track'));
        } else if (sleepTimerEndTime) {
          const diff = Math.max(0, sleepTimerEndTime - Date.now());
          const mins = Math.ceil(diff / 60000);
          setSleepTimerRemaining(`${mins} ${t('player.minutes_left')}`);
        }
      };
      updateRemaining();
      interval = setInterval(updateRemaining, 2000);
    } else {
      setSleepTimerRemaining('');
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isSleepTimerActive, sleepTimerEndTime, sleepTimerDurationOption, t]);

  const [queue, setQueue] = useState<Track[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(0);
  /** Kuyruk bölümleri (şu an / sırada / kütüphaneden) — modal açıkken hesaplanır. */
  const [queueSections, setQueueSections] = useState<QueueSections<Track> | null>(null);

  const handleUnlockDynamicColorFromBanner = async () => {
    setIsLoadingDynamicAd(true);
    try {
      const shown = await showRewardedAd({
        onRewarded: () => {
          unlockDynamicColor();
          if (currentArtworkUri) {
            useThemeStore.getState().updateThemeFromArtwork(currentArtworkUri);
          }
          setTimeout(() => {
            Alert.alert(
              '🎉 ' + t('settings.unlock_dynamic_theme_title'),
              t('settings.dynamic_theme_unlocked_success')
            );
          }, 400);
        },
        onError: () => {
          setIsLoadingDynamicAd(false);
          Alert.alert(
            t('settings.unlock_dynamic_theme_title'),
            t('settings.theme_ad_failed')
          );
        },
        onClosed: () => {
          setIsLoadingDynamicAd(false);
        },
      });
      if (!shown) {
        setIsLoadingDynamicAd(false);
      }
    } catch {
      setIsLoadingDynamicAd(false);
    }
  };

  const createModalPanResponder = useCallback((closeFn: () => void) => {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, gesture) => {
        return gesture.dy > 20 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.5;
      },
      onMoveShouldSetPanResponderCapture: () => false,
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > 40) {
          closeFn();
        }
      },
    });
  }, []);

  const searchModalPanResponder = createModalPanResponder(() => setIsManualSearchOpen(false));
  const optionsModalPanResponder = createModalPanResponder(() => setIsOptionsModalOpen(false));

  // Manual Lyrics Search state
  const [isLoadingLyrics, setIsLoadingLyrics] = useState(false);
  const [isManualSearchOpen, setIsManualSearchOpen] = useState(false);
  const [manualQuery, setManualQuery] = useState('');
  const [candidatesList, setCandidatesList] = useState<LyricsCandidate[]>([]);
  const [isSearchingCandidates, setIsSearchingCandidates] = useState(false);
  const [resolvingCandidateId, setResolvingCandidateId] = useState<string | null>(null);

  const lyricsFlatListRef = useRef<FlatList<LyricLine>>(null);
  const isUserScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<any>(null);

  const plainLyricsScrollRef = useRef<ScrollView>(null);
  const plainContentHeightRef = useRef(0);
  const plainScrollViewHeightRef = useRef(0);
  const isPlainUserScrollingRef = useRef(false);
  const plainScrollTimeoutRef = useRef<any>(null);

  const currentPosition = isDragging ? dragTime : progress.position;
  const duration = progress.duration > 0 ? progress.duration : 0;
  const progressPercent = duration > 0 ? Math.min(1, Math.max(0, currentPosition / duration)) : 0;

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const refreshQueue = useCallback(async () => {
    if (player.isRemote) return;
    try {
      const q = await TrackPlayer.getQueue();
      const idx = await TrackPlayer.getActiveTrackIndex();
      setQueue(q);
      setActiveIndex(idx ?? 0);
    } catch (e) {
      console.warn('Failed to load queue', e);
    }
  }, [player.isRemote]);

  /** Kuyruk bölümlerini native kuyruktan yeniden türetir. */
  const refreshQueueSections = useCallback(async () => {
    if (player.isRemote) return;
    try {
      setQueueSections(await getQueueSections());
    } catch (e) {
      console.warn('Failed to derive queue sections', e);
    }
  }, [player.isRemote]);

  // Oynatıcı açıkken veya aktif parça değiştiğinde kuyruğu ve bölümleri önceden hazırla (pre-warm)
  useEffect(() => {
    if (activeTrack || isFullscreenPlayerOpen) {
      refreshQueue();
      refreshQueueSections();
    }
  }, [activeTrack, isFullscreenPlayerOpen, refreshQueue, refreshQueueSections]);

  // Kuyruk modu açıkken veya aktif parça / kuyruk / modlar değiştiğinde bölümleri tazele.
  useEffect(() => {
    if (isQueueMode) {
      refreshQueueSections();
      refreshQueue();
    }
  }, [
    isQueueMode,
    activeTrack?.id,
    isShuffle,
    isSmartShuffle,
    repeatMode,
    upNextIds,
    contextIds,
    playedHistory,
    queueRevision,
    refreshQueueSections,
    refreshQueue,
  ]);

  // Çalınan parça manuel kuyruktan geldiyse listeden düşür.
  useEffect(() => {
    if (!player.isRemote && localActiveTrack) {
      markUpNextConsumed(localActiveTrack);
    }
  }, [player.isRemote, localActiveTrack]);

  const derivedRemoteQueueSections = useMemo((): QueueSections<Track> | null => {
    if (!player.isRemote) return null;
    const currentTrackSummary = player.activeTrack;
    const queueList: Track[] = (Array.isArray(remoteState.queue) ? remoteState.queue : [])
      .filter(Boolean)
      .map((t) => ({
        id: t.id,
        url: t.id,
        title: t.title,
        artist: t.artist,
        duration: t.duration,
      } as Track));

    let currentIndex = queueList.findIndex((t) => t && t.id === currentTrackSummary?.id);
    if (currentIndex === -1 && currentTrackSummary) {
      const normTitle = (currentTrackSummary.title || '').trim().toLowerCase();
      const normArtist = (currentTrackSummary.artist || '').trim().toLowerCase();
      currentIndex = queueList.findIndex((t) => {
        if (!t) return false;
        const tTitle = (t.title || '').trim().toLowerCase();
        const tArtist = (t.artist || '').trim().toLowerCase();
        return tTitle === normTitle && (!normArtist || tArtist === normArtist);
      });
    }

    const upNextIds = (Array.isArray(remoteState.upNext) ? remoteState.upNext : [])
      .filter(Boolean)
      .map((t) => t.id);

    const sections = deriveQueueSections(
      queueList,
      currentIndex >= 0 ? currentIndex : 0,
      upNextIds
    );

    if (currentTrackSummary && sections.current) {
      sections.current.track.artwork = player.artworkUri || undefined;
    }

    return sections;
  }, [player.isRemote, player.activeTrack, player.artworkUri, remoteState.queue, remoteState.upNext]);

  const effectiveQueueSections = useMemo(() => {
    if (player.isRemote) return derivedRemoteQueueSections;
    if (!queueSections) return null;
    const realKey = trackKey(activeTrack || localActiveTrack);
    if (!realKey || (queueSections.current && trackKey(queueSections.current.track) === realKey)) {
      return queueSections;
    }
    // Eğer native activeIndex kaymış ve queueSections.current sahte bir parçayı gösteriyorsa doğrula
    const foundIdx = queue.findIndex((t) => trackKey(t) === realKey);
    if (foundIdx >= 0) {
      return deriveQueueSections(
        queue,
        foundIdx,
        useStore.getState().upNextIds,
        useStore.getState().playedHistory as any,
        realKey
      );
    }
    return queueSections;
  }, [player.isRemote, derivedRemoteQueueSections, queueSections, activeTrack, localActiveTrack, queue]);

  const resolveTrackDisplay = useCallback(
    (track: Track | QueueTrackLike) => {
      const rawId = String(track.id ?? track.url ?? '').trim();
      const rawUrl = String(track.url ?? '').trim();

      const baseAssets = allAssets.length > 0 ? allAssets : library;
      const asset = baseAssets.find(
        (a) => a.id === rawId || a.uri === rawId || (rawUrl && (a.uri === rawUrl || a.id === rawUrl))
      );
      const canonicalId = asset ? asset.id : rawId;

      const meta =
        (canonicalId && metadataMap[canonicalId]) ||
        (track.id && metadataMap[track.id]) ||
        (rawUrl && metadataMap[rawUrl]) ||
        undefined;

      const artwork =
        meta?.artwork ||
        (canonicalId ? artworkMap[canonicalId] : undefined) ||
        (track.id ? artworkMap[track.id] : undefined) ||
        (rawUrl ? artworkMap[rawUrl] : undefined) ||
        (typeof track.artwork === 'string' ? track.artwork : undefined);

      const rawArtist = meta?.artist || track.artist || '';
      const displayArtist =
        rawArtist && rawArtist !== 'Local Audio' && rawArtist !== 'Bilinmeyen Sanatçı'
          ? cleanYouTubeTitle(rawArtist)
          : (rawArtist || t('common.unknown_artist'));

      const rawTitle = meta?.title || track.title || '';
      const displayTitle =
        cleanDisplayTitle(rawTitle, displayArtist !== t('common.unknown_artist') ? displayArtist : undefined) ||
        rawTitle ||
        t('common.unknown_track');

      return {
        canonicalId,
        title: displayTitle,
        artist: displayArtist,
        artwork,
        trackId: canonicalId || track.id || null,
        trackUri: track.url || null,
      };
    },
    [allAssets, library, metadataMap, artworkMap, t]
  );

  /** Manuel "Sırada" listesi (anında 0ms optimistik görsel model). */
  const upNextItems: UpNextItem[] = useMemo(() => {
    const targetIds = player.isRemote
      ? (Array.isArray(remoteState.upNext) ? remoteState.upNext : []).map(String)
      : upNextIds;

    if (!targetIds || targetIds.length === 0) return [];

    // Mevcut kuyruktaki ve bölümlerdeki parçaları hızlı erişim için haritala
    const trackMap = new Map<string, Track>();
    if (queue && queue.length > 0) {
      for (const t of queue) {
        const k = trackKey(t);
        if (k && !trackMap.has(k)) trackMap.set(k, t);
        if (t.id && !trackMap.has(t.id)) trackMap.set(t.id, t);
        if (t.url && !trackMap.has(t.url)) trackMap.set(t.url, t);
      }
    }
    if (effectiveQueueSections?.upNext) {
      for (const entry of effectiveQueueSections.upNext) {
        if (entry.track) {
          const k = trackKey(entry.track);
          if (k && !trackMap.has(k)) trackMap.set(k, entry.track);
          if (entry.track.id && !trackMap.has(entry.track.id)) trackMap.set(entry.track.id, entry.track);
          if (entry.track.url && !trackMap.has(entry.track.url)) trackMap.set(entry.track.url, entry.track);
        }
      }
    }

    const baseAssets = allAssets.length > 0 ? allAssets : library;

    return targetIds.map((id, i) => {
      let t = trackMap.get(id);
      if (!t) {
        const asset = baseAssets.find((a) => a.id === id || a.uri === id);
        if (asset) {
          const meta = metadataMap[asset.id];
          t = {
            id: asset.id,
            url: asset.uri,
            title: meta?.title || asset.filename,
            artist: meta?.artist || 'Unknown Artist',
            artwork: meta?.artwork || artworkMap[asset.id] || undefined,
            duration: asset.duration,
          } as Track;
        } else {
          t = {
            id,
            url: id,
            title: 'Track',
            artist: 'Unknown Artist',
          } as Track;
        }
      }

      const info = resolveTrackDisplay(t);
      return {
        key: `${info.canonicalId || id}-${i}`,
        title: info.title,
        artist: info.artist,
        artwork: info.artwork,
        trackId: info.trackId || id,
        trackUri: info.trackUri,
      };
    });
  }, [
    player.isRemote,
    remoteState.upNext,
    upNextIds,
    queue,
    effectiveQueueSections,
    allAssets,
    library,
    metadataMap,
    artworkMap,
    resolveTrackDisplay,
  ]);

  const handleMoveUpNext = useCallback(
    (from: number, to: number) => {
      if (player.isRemote) {
        remoteSyncManager.sendClientCommand({ type: 'COMMAND_QUEUE_MOVE', fromIndex: from, toIndex: to });
        return;
      }
      moveUpNext(from, to);
    },
    [player.isRemote]
  );

  const handleRemoveUpNext = useCallback(
    (sectionIndex: number) => {
      if (player.isRemote) {
        const target = effectiveQueueSections?.upNext[sectionIndex];
        const trackId = target?.track?.id;
        remoteSyncManager.sendClientCommand({
          type: 'COMMAND_QUEUE_REMOVE',
          trackId: trackId || undefined,
          trackIndex: target && target.index >= 0 ? target.index : undefined,
        });
        return;
      }
      const targetId = upNextIds[sectionIndex];
      const target = queueSections?.upNext?.find(
        (e) => (targetId && (trackKey(e.track) === targetId || e.track.id === targetId))
      );
      const trackId = targetId || target?.track?.id;
      const index = target ? target.index : -1;
      removeQueueItem(index, trackId);
    },
    [player.isRemote, effectiveQueueSections, upNextIds, queueSections]
  );

  const handleRemoveFromContext = useCallback(
    (queueIndex: number, trackId?: string) => {
      if (player.isRemote) {
        const target = effectiveQueueSections?.context.find((e) => e.index === queueIndex);
        const tId = trackId || target?.track?.id;
        remoteSyncManager.sendClientCommand({
          type: 'COMMAND_QUEUE_REMOVE',
          trackIndex: queueIndex,
          trackId: tId || undefined,
        });
        return;
      }
      removeQueueItem(queueIndex, trackId);
    },
    [player.isRemote, effectiveQueueSections]
  );

  const handlePromoteToUpNext = useCallback(
    (queueIndex: number, trackId?: string) => {
      if (player.isRemote) {
        return;
      }
      promoteContextTrackToUpNext(queueIndex, trackId);
    },
    [player.isRemote]
  );

  const handleClearUpNext = useCallback(() => {
    if (player.isRemote) {
      return;
    }
    clearUpNextQueue();
  }, [player.isRemote]);

  const handleQueueItemPress = useCallback(
    async (queueIndex: number, trackId?: string, title?: string, artist?: string) => {
      if (trackId || title) {
        const canonicalId = trackId ? resolveTrackId({ id: trackId }, allAssets) : '';
        const meta =
          (canonicalId && metadataMap[canonicalId]) ||
          (trackId && metadataMap[trackId]) ||
          undefined;
        const art =
          meta?.artwork ||
          (canonicalId && artworkMap[canonicalId]) ||
          (trackId && artworkMap[trackId]) ||
          null;

        const cleanArt =
          artist && artist !== 'Local Audio' && artist !== 'Bilinmeyen Sanatçı'
            ? cleanYouTubeTitle(artist)
            : (artist || 'Unknown Artist');
        const cleanTit =
          cleanDisplayTitle(title, cleanArt !== 'Unknown Artist' ? cleanArt : undefined) ||
          title ||
          'Unknown Title';

        const summary: RemoteTrackSummary = {
          id: canonicalId || trackId || `queue_${queueIndex}`,
          title: cleanTit,
          artist: cleanArt,
          duration: 0,
          hasArtwork: !!art,
        };
        useOptimisticPlayerStore.getState().setOptimisticTrack(summary, art);
        if (art && useStore.getState().preferences.dynamicColorFromArtwork) {
          useThemeStore.getState().updateThemeFromArtwork(art);
        }
      }
      if (player.isRemote) {
        remoteSyncManager.sendClientCommand({
          type: 'COMMAND_PLAY_TRACK',
          trackIndex: queueIndex >= 0 ? queueIndex : undefined,
          trackId,
          title,
          artist,
        });
        return;
      }
      try {
        await playQueueTrack(queueIndex, trackId);
        await refreshQueue();
        await refreshQueueSections();
      } catch (e) {
        console.warn('Queue skip failed', e);
      }
    },
    [player.isRemote, metadataMap, artworkMap, allAssets, refreshQueue, refreshQueueSections]
  );

  const queueSectionLabels = useMemo(
    () => ({
      history: t('queue.history_section'),
      smartShuffle: t('queue.smart_shuffle_section'),
      shuffle: t('queue.library_shuffle_section'),
      upcoming: t('queue.library_upcoming_section'),
    }),
    [t]
  );

  // Saf fonksiyonla üretilir; React Compiler kendi memoizasyonunu uygular.
  const queueRows = buildQueueRows(
    effectiveQueueSections,
    upNextItems.length,
    isShuffle,
    isSmartShuffle,
    queueSectionLabels
  );

  const currentRowIndex = useMemo(
    () => queueRows.findIndex((row) => row.kind === 'current'),
    [queueRows]
  );

  const queueListRef = useRef<FlatList<QueueRow<Track>>>(null);

  // Kuyruk açılınca mevcut parçaya zıplamasız ve kaymasız doğrudan konumlan
  useEffect(() => {
    if (!isQueueMode || currentRowIndex < 0) return;
    const timer = setTimeout(() => {
      try {
        if (currentRowIndex >= 0 && currentRowIndex < queueRows.length) {
          queueListRef.current?.scrollToIndex({
            index: currentRowIndex,
            animated: false,
            viewPosition: 0.15,
          });
        }
      } catch {
        // ignore
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [isQueueMode, currentRowIndex, queueRows.length]);

  const handleScrollToIndexFailed = useCallback(
    (info: { index: number; averageItemLength: number }) => {
      // Satır yükseklikleri değişken olduğu için (bölüm başlığı / parça / kapaklı
      // satır) ilk deneme başarısız olabilir: ortalamayla hemen konumlan, sonra tekrar dene.
      try {
        queueListRef.current?.scrollToOffset({
          offset: info.averageItemLength * info.index,
          animated: false,
        });
      } catch {
        // ignore
      }
      setTimeout(() => {
        try {
          if (info.index >= 0 && info.index < queueRows.length) {
            queueListRef.current?.scrollToIndex({
              index: info.index,
              animated: false,
              viewPosition: 0.15,
            });
          }
        } catch {
          // ignore
        }
      }, 50);
    },
    [queueRows.length]
  );

  /** Sıradaki/geçmiş bir parça satırı (dokununca o parçaya atlar). */
  const renderQueueTrackRow = (
    entry: QueueEntry<Track>,
    isCurrent = false,
    isHistory = false,
    historyIndex?: number,
    isContext = false
  ) => {
    const isExtensionTrack =
      entry.track.id?.startsWith('ext_') ||
      (typeof entry.track.url === 'string' && entry.track.url.startsWith('http'));

    const info = resolveTrackDisplay(entry.track);

    return (
      <TouchableOpacity
        style={[styles.queueItem, isCurrent && { backgroundColor: theme.surface }]}
        activeOpacity={0.7}
        onPress={() => {
          if (isHistory && typeof historyIndex === 'number') {
            if (player.isRemote) {
              handleQueueItemPress(
                entry.index,
                info.trackId || entry.track.id,
                info.title,
                info.artist
              );
            } else {
              playHistoryTrack(historyIndex, entry.track);
            }
          } else {
            handleQueueItemPress(
              entry.index,
              info.trackId || entry.track.id,
              info.title,
              info.artist
            );
          }
        }}>
        <Text style={[styles.queueIndex, isCurrent && { color: theme.primary }]}>
          {isHistory && typeof historyIndex === 'number' ? historyIndex + 1 : entry.index + 1}
        </Text>
        <View style={{ flex: 1 }}>
          <Text
            style={[styles.queueTrackTitle, isCurrent && { color: theme.primary }]}
            numberOfLines={1}>
            {info.title}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
            {isExtensionTrack && (
              <View style={styles.queueExtBadge}>
                <Ionicons name="globe-outline" size={10} color="rgba(255,255,255,0.7)" style={{ marginRight: 3 }} />
                <Text style={styles.queueExtBadgeText}>Eklenti</Text>
              </View>
            )}
            <Text style={styles.queueTrackArtist} numberOfLines={1}>
              {info.artist}
            </Text>
          </View>
        </View>
        {isCurrent ? (
          <Ionicons name="volume-high" size={20} color={theme.primary} />
        ) : isContext ? (
          <TouchableOpacity
            style={styles.queueQuickPromoteBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.7}
            onPress={(e) => {
              e.stopPropagation();
              handlePromoteToUpNext(entry.index, info.trackId || entry.track.id);
            }}>
            <Ionicons name="arrow-up-circle-outline" size={22} color="rgba(255,255,255,0.45)" />
          </TouchableOpacity>
        ) : null}
      </TouchableOpacity>
    );
  };

  const renderQueueRow = ({ item }: { item: QueueRow<Track> }) => {
    switch (item.kind) {
      case 'section':
        return <Text style={styles.queueSectionTitle}>{item.title}</Text>;

      case 'history':
        // Geçmiş salt görüntülenir; dokununca o parçaya geri döner.
        return renderQueueTrackRow(item.entry, false, true, item.historyIndex);

      case 'current': {
        const info = resolveTrackDisplay(item.entry.track);
        return (
          <>
            <Text style={styles.queueSectionTitle}>{t('queue.now_playing_section')}</Text>
            <View style={[styles.queueItem, { backgroundColor: theme.surface }]}>
              <TrackArtwork
                uri={info.artwork}
                trackId={info.trackId}
                trackUri={info.trackUri}
                size={40}
                borderRadius={6}
                iconSize={18}
              />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.queueTrackTitle, { color: theme.primary }]} numberOfLines={1}>
                  {info.title}
                </Text>
                <Text style={styles.queueTrackArtist} numberOfLines={1}>
                  {info.artist}
                </Text>
              </View>
              <Ionicons name="volume-high" size={20} color={theme.primary} />
            </View>
          </>
        );
      }

      case 'upnext':
        return (
          <View style={styles.upNextSectionWrapper}>
            <View style={styles.upNextSectionHeader}>
              <Text style={styles.queueSectionTitle}>
                {`${t('queue.up_next_header') || 'SIRADA (SENİN EKLEDİKLERİN)'} · ${upNextItems.length}`}
              </Text>
              <TouchableOpacity
                onPress={handleClearUpNext}
                style={styles.clearUpNextButton}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="trash-outline" size={12} color="#ef4444" style={{ marginRight: 4 }} />
                <Text style={styles.clearUpNextText}>{t('queue.clear_up_next') || 'Temizle'}</Text>
              </TouchableOpacity>
            </View>
            <QueueUpNextList
              items={upNextItems}
              accentColor={theme.primary}
              onMove={handleMoveUpNext}
              onRemove={handleRemoveUpNext}
              onItemPress={(item, idx) => {
                const target =
                  effectiveQueueSections?.upNext?.find(
                    (e) =>
                      item.trackId &&
                      (e.track.id === item.trackId || trackKey(e.track) === item.trackId)
                  ) || effectiveQueueSections?.upNext[idx];
                const trackId = item.trackId || target?.track?.id;
                const index = target ? target.index : -1;
                handleQueueItemPress(
                  index,
                  trackId,
                  item.title,
                  item.artist
                );
              }}
            />
          </View>
        );

      case 'context': {
        const info = resolveTrackDisplay(item.entry.track);
        return (
          <Swipeable
            friction={1}
            leftThreshold={130}
            rightThreshold={130}
            overshootLeft={false}
            overshootRight={false}
            activeOffsetX={[-20, 20]}
            failOffsetY={[-15, 15]}
            onSwipeableOpen={(direction, swipeable) => {
              swipeable?.close?.();
              if (direction === 'left') {
                handlePromoteToUpNext(item.entry.index, info.trackId || item.entry.track.id);
              } else if (direction === 'right') {
                handleRemoveFromContext(item.entry.index, info.trackId || item.entry.track.id);
              }
            }}
            renderLeftActions={() => (
              <TouchableOpacity
                style={[styles.queuePromoteAction, { backgroundColor: theme.primary }]}
                activeOpacity={0.8}
                onPress={() => handlePromoteToUpNext(item.entry.index, info.trackId || item.entry.track.id)}>
                <Ionicons name="arrow-up-circle-outline" size={22} color="#ffffff" />
                <Text style={styles.queuePromoteText}>{t('queue.promote_to_up_next') || 'Öne Al'}</Text>
              </TouchableOpacity>
            )}
            renderRightActions={() => (
              <TouchableOpacity
                style={[styles.queueRemoveAction, { backgroundColor: '#ef4444' }]}
                activeOpacity={0.8}
                onPress={() => handleRemoveFromContext(item.entry.index, info.trackId || item.entry.track.id)}>
                <Ionicons name="trash-outline" size={20} color="#ffffff" />
              </TouchableOpacity>
            )}>
            {renderQueueTrackRow(item.entry, false, false, undefined, true)}
          </Swipeable>
        );
      }

      default:
        return null;
    }
  };

  const currentAsset = useMemo(() => {
    if (player.isRemote || !localActiveTrack) return null;
    return (
      library.find(
        (a) =>
          (localActiveTrack.id && a.id === localActiveTrack.id) ||
          (localActiveTrack.url && (a.uri === localActiveTrack.url || a.id === localActiveTrack.url))
      ) || null
    );
  }, [player.isRemote, library, localActiveTrack]);

  const resolvedTrackId =
    player.activeTrack?.id || currentAsset?.id || localActiveTrack?.id || localActiveTrack?.url || '';

  const activeMeta = player.isRemote
    ? undefined
    : (resolvedTrackId ? metadataMap[resolvedTrackId] : undefined) ||
      (player.activeTrack?.id ? metadataMap[player.activeTrack.id] : undefined) ||
      (localActiveTrack?.id ? metadataMap[localActiveTrack.id] : undefined) ||
      (localActiveTrack?.url ? metadataMap[localActiveTrack.url] : undefined);

  const unknownArtist = t('common.unknown_artist');
  const unknownTrack = t('common.unknown_track');

  const sourceTitle = player.activeTrack?.title || localActiveTrack?.title || '';
  const sourceArtist = player.activeTrack?.artist || localActiveTrack?.artist || '';

  const activeKeywords = player.isRemote
    ? { expectedArtist: undefined, expectedTrack: undefined }
    : getSearchKeywords(sourceTitle, sourceArtist);

  const rawArtist = player.isRemote
    ? player.activeTrack?.artist || (player.remoteDeviceName ? `${t('remote.status_connected')} • ${player.remoteDeviceName}` : unknownArtist)
    : (activeMeta?.artist?.trim() && activeMeta.artist !== 'Local Audio' && activeMeta.artist !== 'Bilinmeyen Sanatçı'
        ? activeMeta.artist.trim()
        : '') ||
      (player.activeTrack?.artist && player.activeTrack.artist !== 'Local Audio' && player.activeTrack.artist !== 'Bilinmeyen Sanatçı' && player.activeTrack.artist !== 'Unknown Artist'
        ? cleanYouTubeTitle(player.activeTrack.artist)
        : '') ||
      (activeKeywords.expectedArtist && activeKeywords.expectedArtist !== 'Local Audio' && activeKeywords.expectedArtist !== 'Bilinmeyen Sanatçı'
        ? activeKeywords.expectedArtist
        : (sourceArtist && sourceArtist !== 'Local Audio' && sourceArtist !== 'Bilinmeyen Sanatçı'
            ? cleanYouTubeTitle(sourceArtist)
            : unknownArtist));

  const rawTitle = player.isRemote
    ? player.activeTrack?.title || t('remote.waiting_for_music')
    : (activeMeta?.title?.trim() ? activeMeta.title.trim() : '') ||
      (player.activeTrack?.title && player.activeTrack.title !== 'Unknown Title' ? player.activeTrack.title : '') ||
      activeKeywords.expectedTrack ||
      sourceTitle ||
      '';

  const displayArtist = rawArtist;
  const displayTitle = player.isRemote
    ? rawTitle
    : cleanDisplayTitle(rawTitle, displayArtist !== unknownArtist && displayArtist !== 'Bilinmeyen Sanatçı' ? displayArtist : undefined) ||
      unknownTrack;

  const currentArtworkUri =
    player.artworkUri ||
    activeMeta?.artwork ||
    (resolvedTrackId ? artworkMap[resolvedTrackId] : undefined) ||
    (player.activeTrack?.id ? artworkMap[player.activeTrack.id] : undefined) ||
    (localActiveTrack?.id ? artworkMap[localActiveTrack.id] : undefined) ||
    (typeof localActiveTrack?.artwork === 'string' ? localActiveTrack.artwork : undefined);

  // Önceki ve sonraki şarkıyı belirleme (Kapak geçiş önizlemesi için)
  const prevTrack = useMemo(() => {
    if (player.isRemote) {
      const q = Array.isArray(remoteState.queue) ? remoteState.queue : [];
      if (q.length <= 1) return null;
      const idx = q.findIndex((t) => t && t.id === player.activeTrack?.id);
      if (idx > 0 && q[idx - 1]) return q[idx - 1] as any;
      if (player.repeatMode === RepeatMode.Queue && q[q.length - 1]) return q[q.length - 1] as any;
      return null;
    }
    if (playedHistory.length > 0) {
      return playedHistory[playedHistory.length - 1];
    }
    if (queue.length <= 1) return null;
    if (activeIndex > 0) return queue[activeIndex - 1];
    if (repeatMode === RepeatMode.Queue) return queue[queue.length - 1];
    return null;
  }, [player.isRemote, player.activeTrack, player.repeatMode, remoteState.queue, playedHistory, queue, activeIndex, repeatMode]);

  const nextTrack = useMemo(() => {
    if (player.isRemote) {
      const q = Array.isArray(remoteState.queue) ? remoteState.queue : [];
      if (q.length <= 1) return null;
      const idx = q.findIndex((t) => t && t.id === player.activeTrack?.id);
      if (idx >= 0 && idx < q.length - 1 && q[idx + 1]) return q[idx + 1] as any;
      if (player.repeatMode === RepeatMode.Queue && q[0]) return q[0] as any;
      return null;
    }
    if (queue.length <= 1) return null;
    if (activeIndex < queue.length - 1) return queue[activeIndex + 1];
    if (repeatMode === RepeatMode.Queue) return queue[0];
    return null;
  }, [player.isRemote, player.activeTrack, player.repeatMode, remoteState.queue, queue, activeIndex, repeatMode]);

  const prevArtworkUri = useMemo(() => {
    if (!prevTrack) return undefined;
    const meta = prevTrack.id ? metadataMap[prevTrack.id] : undefined;
    return (
      meta?.artwork ||
      (prevTrack.id && artworkMap[prevTrack.id]) ||
      (typeof prevTrack.artwork === 'string' ? prevTrack.artwork : undefined)
    );
  }, [prevTrack, metadataMap, artworkMap]);

  const nextArtworkUri = useMemo(() => {
    if (!nextTrack) return undefined;
    const meta = nextTrack.id ? metadataMap[nextTrack.id] : undefined;
    return (
      meta?.artwork ||
      (nextTrack.id && artworkMap[nextTrack.id]) ||
      (typeof nextTrack.artwork === 'string' ? nextTrack.artwork : undefined)
    );
  }, [nextTrack, metadataMap, artworkMap]);

  // Şu an oynatılan parçayı hafızadan/akıştan indirme mantığı
  const targetDownloadUrl = useMemo(() => {
    return (
      (localActiveTrack as any)?.downloadUrl ||
      (localActiveTrack as any)?.url ||
      (activeTrack as any)?.downloadUrl ||
      (activeTrack as any)?.url ||
      ''
    );
  }, [localActiveTrack, activeTrack]);

  const isRemoteStream = useMemo(() => {
    return (
      typeof targetDownloadUrl === 'string' &&
      (targetDownloadUrl.startsWith('http://') || targetDownloadUrl.startsWith('https://'))
    );
  }, [targetDownloadUrl]);

  const downloadTasks = useDownloadStore((s) => s.tasks);
  const currentDownloadTask = useMemo(() => {
    if (!targetDownloadUrl) return undefined;
    return downloadTasks.find(
      (t) =>
        t.downloadUrl === targetDownloadUrl ||
        (localActiveTrack?.url && t.downloadUrl === localActiveTrack.url) ||
        (localActiveTrack?.id && t.id.includes(localActiveTrack.id)) ||
        (t.title === displayTitle && t.artist === displayArtist)
    );
  }, [downloadTasks, targetDownloadUrl, localActiveTrack, displayTitle, displayArtist]);

  const isCurrentTrackDownloading = currentDownloadTask?.status === 'downloading';
  const isCurrentTrackDownloaded = currentDownloadTask?.status === 'completed';

  const handleDownloadCurrentTrack = useCallback(async () => {
    if (!targetDownloadUrl || !isRemoteStream) {
      Alert.alert(t('common.info'), t('player.already_local'));
      return;
    }

    if (isCurrentTrackDownloaded) {
      Alert.alert(
        t('player.already_downloaded_title'),
        t('player.already_downloaded_msg', { title: displayTitle }),
        [
          { text: t('common.ok') },
          {
            text: t('downloads.title'),
            onPress: () => useExtensionStore.getState().openDownloadsModal(),
          },
        ]
      );
      return;
    }

    if (isCurrentTrackDownloading) {
      Alert.alert(t('player.downloading_title'), t('player.downloading_msg', { title: displayTitle }));
      return;
    }

    try {
      const finalTitle = displayTitle || localActiveTrack?.title || 'Unknown Title';
      const finalArtist = displayArtist || localActiveTrack?.artist || 'Unknown Artist';
      const artwork =
        currentArtworkUri ||
        (typeof localActiveTrack?.artwork === 'string' ? localActiveTrack.artwork : undefined);

      await startDownload({
        title: finalTitle,
        artist: finalArtist,
        artwork: artwork,
        downloadUrl: targetDownloadUrl,
        suggestedFileName: `${finalArtist} - ${finalTitle}.mp3`,
        storageTarget: 'private',
      });

      Alert.alert(
        t('player.download_started_title'),
        t('player.download_started_msg', { title: finalTitle })
      );
    } catch (err: any) {
      console.warn('[FullscreenPlayerModal] İndirme hatası:', err);
      Alert.alert(t('player.download_error_title'), err?.message || t('player.download_error_msg'));
    }
  }, [targetDownloadUrl, isRemoteStream, isCurrentTrackDownloaded, isCurrentTrackDownloading, displayTitle, displayArtist, localActiveTrack, currentArtworkUri, t]);

  // Metadata senkronizasyonu.
  //
  // ÖNEMLİ: native `TrackMetadata.setMetadata` (TrackMetadata.kt) TÜM alanları
  // koşulsuz atar — `artwork = BundleUtils.getUri(...)`, `title = getString(...)`.
  // Yani `updateMetadataForTrack`'e gönderilmeyen her alan NULL'lanır. Yalnızca
  // `{ title }` göndermek bildirim kapağını siliyordu (kullanıcının gördüğü
  // "coverlar görünmüyor" hatası). Bu yüzden bilinen TÜM alanlar birlikte
  // gönderilir.
  //
  // Kuyruktaki mevcut değerler yedek olarak kullanılır ki store'da karşılığı
  // olmayan bir alan null'lanmasın.
  const activeStoreMeta = activeMeta;
  const activeStoreArtwork = currentArtworkUri;

  const lastWrittenMetadataRef = useRef<{
    trackId: string;
    title?: string;
    artist?: string;
    artwork?: string;
  } | null>(null);

  useEffect(() => {
    if (player.isRemote || !localActiveTrack) return;

    const trackId = resolvedTrackId || localActiveTrack.id || localActiveTrack.url;
    const queueTitle = typeof localActiveTrack.title === 'string' ? localActiveTrack.title : undefined;
    const queueArtist = typeof localActiveTrack.artist === 'string' ? localActiveTrack.artist : undefined;
    const queueArtwork = typeof localActiveTrack.artwork === 'string' ? localActiveTrack.artwork : undefined;

    const resolvedTitle = activeStoreMeta?.title?.trim() || queueTitle;
    const resolvedArtist =
      activeStoreMeta?.artist &&
      activeStoreMeta.artist !== 'Local Audio' &&
      activeStoreMeta.artist !== 'Bilinmeyen Sanatçı'
        ? activeStoreMeta.artist
        : queueArtist;
    const resolvedArtwork = activeStoreArtwork || activeStoreMeta?.artwork || queueArtwork;

    const needsTitle = !!resolvedTitle && resolvedTitle !== queueTitle;
    const needsArtist = !!resolvedArtist && resolvedArtist !== queueArtist;
    const needsArtwork = !!resolvedArtwork && resolvedArtwork !== queueArtwork;
    if (!needsTitle && !needsArtist && !needsArtwork) return;

    // Aynı track için aynı değerler zaten yazıldıysa tekrar yazma. (Kapak sonradan
    // geldiğinde değerler değişir, dolayısıyla yeniden yazılır ve bildirim
    // kapağı güncellenir — eski "tek seferlik" koruma bunu engelliyordu.)
    const previous = lastWrittenMetadataRef.current;
    if (
      previous &&
      previous.trackId === trackId &&
      previous.title === resolvedTitle &&
      previous.artist === resolvedArtist &&
      previous.artwork === resolvedArtwork
    ) {
      return;
    }
    lastWrittenMetadataRef.current = {
      trackId,
      title: resolvedTitle,
      artist: resolvedArtist,
      artwork: resolvedArtwork,
    };

    // İndeks `refreshQueue`'dan ASENKRON geldiği için şarkı değişimi sırasında
    // bir an önceki parçayı gösterebilir. Doğrudan `activeIndex`'e yazmak, yeni
    // parçanın adını/kapağını ÖNCEKİ parçanın kuyruk girdisine (ya da tersi)
    // yazıp ekranda yanlış şarkı gösterebiliyordu. Bunun yerine parçayı
    // kimliğinden bulup yalnızca doğru girdiye yazıyoruz.
    void (async () => {
      try {
        const currentQueue = await TrackPlayer.getQueue();
        const targetIndex = currentQueue.findIndex((t) => (t.id || t.url) === trackId);
        if (targetIndex < 0) return;

        await TrackPlayer.updateMetadataForTrack(targetIndex, {
          ...(resolvedTitle ? { title: resolvedTitle } : {}),
          ...(resolvedArtist ? { artist: resolvedArtist } : {}),
          ...(resolvedArtwork ? { artwork: resolvedArtwork } : {}),
        });
      } catch {
        // Sessizce yoksay: metadata zaten store'dan okunuyor.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.isRemote, localActiveTrack?.id, localActiveTrack?.url, activeIndex, activeStoreArtwork, activeStoreMeta]);

  const currentLyrics: LyricsResult | null = useMemo(() => {
    if (player.isRemote) {
      if (!player.lyrics) return null;
      return {
        id: player.lyrics.lrclibId
          ? `lrclib-${player.lyrics.lrclibId}`
          : player.lyrics.geniusId
          ? `genius-${player.lyrics.geniusId}`
          : undefined,
        syncedLyrics: player.lyrics.syncedLyrics || (player.lyrics.isSynced ? 'synced' : null),
        plainLyrics: player.lyrics.plainLyrics || null,
        lyricsfile: player.lyrics.lyricsfile || null,
        parsedLines: player.lyrics.lines || [],
        source: (player.lyrics.source as any) || 'lrclib',
        trackName: player.activeTrack?.title || '',
        artistName: player.activeTrack?.artist || '',
        hasWordSync:
          !!player.lyrics.lyricsfile ||
          player.lyrics.lines?.some((l) => !!l.words && l.words.length > 0),
      } as LyricsResult;
    }

    if (!localActiveTrack || !lyricsCache) return null;
    const item = getLyricsFromCache({
      id: localActiveTrack.id,
      url: localActiveTrack.url,
      title: displayTitle,
      artist: displayArtist !== 'Bilinmeyen Sanatçı' ? displayArtist : '',
      rawTitle: localActiveTrack.title,
    });
    if (!item) return null;
    if ((item.syncedLyrics || item.lyricsfile) && (!item.parsedLines || item.parsedLines.length === 0)) {
      return {
        ...item,
        parsedLines: parseAnySyncedLyrics(item.lyricsfile, item.syncedLyrics),
      };
    }
    return item;
  }, [player.isRemote, player.lyrics, player.activeTrack, localActiveTrack, lyricsCache, getLyricsFromCache, displayTitle, displayArtist]);

  const parsedLines = useMemo(() => {
    if (!currentLyrics) return [];
    if (currentLyrics.parsedLines && currentLyrics.parsedLines.length > 0) {
      return currentLyrics.parsedLines;
    }
    return parseAnySyncedLyrics(currentLyrics.lyricsfile, currentLyrics.syncedLyrics);
  }, [currentLyrics]);

  const hasWordSync = useMemo(() => {
    if (!currentLyrics) return false;
    if (currentLyrics.hasWordSync) return true;
    return parsedLines.some((l) => !!l.words && l.words.length > 0);
  }, [currentLyrics, parsedLines]);

  const remoteLyrics = player.lyrics;
  const remoteLrclibId = remoteLyrics?.lrclibId;
  const remoteGeniusId = remoteLyrics?.geniusId;
  const remoteGeniusUrl = remoteLyrics?.geniusUrl;
  const remoteHasContent = !!(
    (remoteLyrics?.lines && remoteLyrics.lines.length > 0) ||
    remoteLyrics?.plainLyrics
  );
  const lastFetchedRemoteLyricsKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!player.isRemote || !remoteLyrics || remoteHasContent) {
      return;
    }

    const currentKey = `${player.activeTrack?.id || ''}_${remoteLrclibId || remoteGeniusUrl || ''}`;
    if (lastFetchedRemoteLyricsKeyRef.current === currentKey) {
      return;
    }
    lastFetchedRemoteLyricsKeyRef.current = currentKey;

    if (remoteLrclibId) {
      const rawId = String(remoteLrclibId).replace('lrclib-', '');
      fetch(`https://lrclib.net/api/get/${rawId}`, { headers: LRCLIB_HEADERS })
        .then((res) => res.json())
        .then((d) => {
          if (d) {
            const lines = parseAnySyncedLyrics(d.lyricsfile, d.syncedLyrics);
            const current = useRemoteConnectStore.getState().remoteState.lyrics;
            if (current) {
              useRemoteConnectStore.getState().setRemoteLyrics({
                ...current,
                lines,
                syncedLyrics: d.syncedLyrics,
                plainLyrics: d.plainLyrics,
                lyricsfile: d.lyricsfile,
                isSynced: !!d.syncedLyrics && lines.length > 0,
              });
            }
          }
        })
        .catch(() => {});
    } else if (remoteGeniusUrl) {
      fetchGeniusLyricsByUrl(remoteGeniusUrl).then((plain) => {
        if (plain) {
          const current = useRemoteConnectStore.getState().remoteState.lyrics;
          if (current) {
            useRemoteConnectStore.getState().setRemoteLyrics({
              ...current,
              lines: [],
              plainLyrics: plain,
              isSynced: false,
            });
          }
        }
      });
    }
  }, [
    player.isRemote,
    remoteLyrics,
    remoteHasContent,
    remoteLrclibId,
    remoteGeniusId,
    remoteGeniusUrl,
    player.activeTrack?.id,
  ]);

  const loadLyricsForTrack = async (title: string, artist?: string, force = false) => {
    if (player.isRemote || !localActiveTrack) return;
    const cleanArtist = artist && artist !== 'Local Audio' && artist !== 'Bilinmeyen Sanatçı' ? artist : '';

    if (!force) {
      const cached = getLyricsFromCache({
        id: localActiveTrack.id,
        url: localActiveTrack.url,
        title,
        artist: cleanArtist,
        rawTitle: localActiveTrack.title,
      });

      // Kaydedilmiş/seçilmiş herhangi bir lyric varsa (senkronize, word sync veya düz metin),
      // varsayılan olarak kesinlikle o kullanılır. Arka planda asla ezilmez.
      if (cached) {
        if (cached.candidates && cached.candidates.length > 0) {
          setCandidatesList(cached.candidates);
        }
        return;
      }
    }

    setIsLoadingLyrics(true);
    try {
      const result = await fetchLyricsOnline(
        title,
        cleanArtist,
        useStore.getState().preferences.lyricsSourcePreference
      );
      if (result) {
        // Asenkron istek dönerken kullanıcı manuel bir seçim yaptıysa veya cache'e lyric kaydedildiyse ezme!
        const existing = getLyricsFromCache({
          id: localActiveTrack.id,
          url: localActiveTrack.url,
          title,
          artist: cleanArtist,
          rawTitle: localActiveTrack.title,
        });
        if (existing && !force) {
          return;
        }

        if (result.candidates && result.candidates.length > 0) {
          setCandidatesList(result.candidates);
        }
        const altKeys = getLyricsCacheKeys({
          id: localActiveTrack.id,
          url: localActiveTrack.url,
          title,
          artist: cleanArtist,
          rawTitle: localActiveTrack.title,
        });
        const saveId = localActiveTrack.id || localActiveTrack.url || title;
        const initialSaved: LyricsResult = {
          ...result,
          selectedCandidateId: result.id,
        };
        setLyrics(saveId, initialSaved, altKeys);
        if (localActiveTrack?.id) {
          remoteSyncManager.broadcastLyricsUpdate(localActiveTrack.id);
        }
      }
    } catch (e) {
      console.warn('Failed to load lyrics', e);
    } finally {
      setIsLoadingLyrics(false);
    }
  };

  useEffect(() => {
    if (!player.isRemote && localActiveTrack && isHydrated) {
      const searchArtist = displayArtist !== 'Bilinmeyen Sanatçı' ? displayArtist : '';
      const titleLower = displayTitle.toLowerCase();
      const artistLower = searchArtist.toLowerCase();
      let initialQuery = displayTitle;
      if (searchArtist && !titleLower.includes(artistLower)) {
        initialQuery = `${searchArtist} ${displayTitle}`;
      }
      setManualQuery(initialQuery);

      const cached = getLyricsFromCache({
        id: localActiveTrack.id,
        url: localActiveTrack.url,
        title: displayTitle,
        artist: searchArtist,
        rawTitle: localActiveTrack.title,
      });

      if (!cached && autoFetchLyrics) {
        // Bu parça için henüz kaydedilmiş bir söz yoksa ilk kez internetten ara ve kaydet
        loadLyricsForTrack(displayTitle, searchArtist, false);
      } else if (cached?.candidates && cached.candidates.length > 0) {
        setCandidatesList(cached.candidates);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.isRemote, localActiveTrack?.id, localActiveTrack?.url, displayTitle, displayArtist, isHydrated, autoFetchLyrics]);

  const activeLineIndex = useMemo(() => {
    if (!parsedLines || parsedLines.length === 0) return -1;
    const pos = progress.position;
    for (let i = parsedLines.length - 1; i >= 0; i--) {
      if (pos >= parsedLines[i].time) {
        return i;
      }
    }
    return -1;
  }, [parsedLines, progress.position]);

  const toggleLyricsAutoScroll = useCallback(() => {
    setIsLyricsAutoScrollPaused((prev) => {
      const next = !prev;
      if (!next && activeLineIndex >= 0 && parsedLines.length > 0) {
        try {
          lyricsFlatListRef.current?.scrollToIndex({
            index: activeLineIndex,
            animated: true,
            viewPosition: 0.35,
          });
        } catch {
          // Fallback
        }
      }
      return next;
    });
  }, [activeLineIndex, parsedLines.length]);

  useEffect(() => {
    if (
      isFullscreenPlayerOpen &&
      isLyricsMode &&
      !isLyricsAutoScrollPaused &&
      activeLineIndex >= 0 &&
      parsedLines.length > 0 &&
      !isUserScrollingRef.current
    ) {
      try {
        lyricsFlatListRef.current?.scrollToIndex({
          index: activeLineIndex,
          animated: true,
          viewPosition: 0.35,
        });
      } catch {
        // Fallback
      }
    }
  }, [activeLineIndex, isFullscreenPlayerOpen, isLyricsMode, isLyricsAutoScrollPaused, parsedLines.length]);

  // Düz metin (Genius / LRCLIB plain) şarkı sözlerini şarkının saniyesine göre aşağıya doğru orantılı kaydır
  const lastTargetPlainYRef = useRef<number>(0);
  useEffect(() => {
    if (
      isFullscreenPlayerOpen &&
      isLyricsMode &&
      !isLyricsAutoScrollPaused &&
      !currentLyrics?.syncedLyrics &&
      currentLyrics?.plainLyrics &&
      duration > 0 &&
      !isPlainUserScrollingRef.current
    ) {
      const maxScroll = Math.max(0, plainContentHeightRef.current - plainScrollViewHeightRef.current);
      if (maxScroll > 0) {
        const progressRatio = Math.min(1, Math.max(0, progress.position / duration));
        const targetY = progressRatio * maxScroll;
        // Animasyon çatışmasını (jitter/glitch) önlemek için en az 3 piksellik fark olunca kaydır
        if (Math.abs(targetY - lastTargetPlainYRef.current) >= 3) {
          lastTargetPlainYRef.current = targetY;
          plainLyricsScrollRef.current?.scrollTo({
            y: targetY,
            animated: true,
          });
        }
      }
    }
  }, [
    progress.position,
    duration,
    isFullscreenPlayerOpen,
    isLyricsMode,
    isLyricsAutoScrollPaused,
    currentLyrics?.syncedLyrics,
    currentLyrics?.plainLyrics,
  ]);

  // Sadece parça kimliği (ID/URL) gerçekten değiştiğinde düz metin kaydırma pozisyonunu sıfırla
  const activeTrackKey = activeTrack?.id || (activeTrack as any)?.url || null;
  const lastPlainResetTrackIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeTrackKey && activeTrackKey !== lastPlainResetTrackIdRef.current) {
      lastPlainResetTrackIdRef.current = activeTrackKey;
      lastTargetPlainYRef.current = 0;
      isPlainUserScrollingRef.current = false;
      if (plainScrollTimeoutRef.current) clearTimeout(plainScrollTimeoutRef.current);
      plainLyricsScrollRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [activeTrackKey]);

  const handleManualSearch = async () => {
    if (!manualQuery.trim() || !activeTrack) return;
    setIsSearchingCandidates(true);
    try {
      const searchArtist = displayArtist !== 'Bilinmeyen Sanatçı' ? displayArtist : '';
      const results = await searchAllCandidates(manualQuery.trim(), searchArtist);
      setCandidatesList(results);
      if (results.length === 0) {
        alert(t('player.no_lyrics_results'));
      }
    } catch (e) {
      console.warn('Manual lyrics search failed', e);
    } finally {
      setIsSearchingCandidates(false);
    }
  };

  const handleSelectCandidate = async (candidate: LyricsCandidate) => {
    if (player.isRemote) {
      if (player.activeTrack) {
        setResolvingCandidateId(candidate.id);
        remoteSyncManager.sendSelectLyrics(player.activeTrack.id, candidate);
        setIsManualSearchOpen(false);
        setResolvingCandidateId(null);
      }
      return;
    }
    if (!localActiveTrack) return;
    setResolvingCandidateId(candidate.id);
    try {
      const resolved = await resolveCandidateToLyricsResult(candidate, candidatesList);
      if (resolved) {
        const searchArtist = displayArtist !== 'Bilinmeyen Sanatçı' ? displayArtist : '';
        const altKeys = getLyricsCacheKeys({
          id: localActiveTrack.id,
          url: localActiveTrack.url,
          title: displayTitle,
          artist: searchArtist,
          rawTitle: localActiveTrack.title,
        });
        const saveId = localActiveTrack.id || localActiveTrack.url || displayTitle;
        const selectedResult: LyricsResult = {
          ...resolved,
          isUserSelected: true,
          selectedCandidateId: candidate.id,
          candidates: candidatesList.length > 0 ? candidatesList : resolved.candidates,
        };
        setLyrics(saveId, selectedResult, altKeys);
        if (localActiveTrack?.id) {
          remoteSyncManager.broadcastLyricsUpdate(localActiveTrack.id);
        }
        setIsManualSearchOpen(false);
      }
    } catch (e) {
      console.warn('Failed to resolve candidate', e);
    } finally {
      setResolvingCandidateId(null);
    }
  };

  const toggleManualSearch = () => {
    const nextState = !isManualSearchOpen;
    setIsManualSearchOpen(nextState);
    if (nextState) {
      const searchArtist = displayArtist !== 'Bilinmeyen Sanatçı' ? displayArtist : '';
      if (currentLyrics?.candidates && currentLyrics.candidates.length > 0) {
        setCandidatesList(currentLyrics.candidates);
      } else if (!player.isRemote && localActiveTrack) {
        const queryToSearch = manualQuery.trim() || displayTitle;
        setIsSearchingCandidates(true);
        searchAllCandidates(queryToSearch, searchArtist)
          .then((results) => {
            setCandidatesList(results);
            if (currentLyrics) {
              const altKeys = getLyricsCacheKeys({
                id: localActiveTrack.id,
                url: localActiveTrack.url,
                title: displayTitle,
                artist: searchArtist,
                rawTitle: localActiveTrack.title,
              });
              const saveId = localActiveTrack.id || localActiveTrack.url || displayTitle;
              setLyrics(saveId, { ...currentLyrics, candidates: results }, altKeys);
            }
          })
          .catch(() => {})
          .finally(() => setIsSearchingCandidates(false));
      }
    }
  };

  const handleTouchCalc = (e: GestureResponderEvent) => {
    if (barWidth <= 0 || duration <= 0) return 0;
    const x = Math.max(0, Math.min(barWidth, e.nativeEvent.pageX - 24));
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
    await player.seekTo(target);
  };

  const togglePlayback = async () => {
    if (player.isPlaying) {
      await player.pause();
      if (!player.isRemote && localActiveTrack && progress.position > 0) {
        saveLastPlayback(
          {
            trackId: localActiveTrack.id || localActiveTrack.url,
            trackIndex: activeIndex,
            position: progress.position,
            track: {
              id: localActiveTrack.id || localActiveTrack.url,
              url: localActiveTrack.url,
              title: localActiveTrack.title,
              artist: localActiveTrack.artist,
              artwork: typeof localActiveTrack.artwork === 'string' ? localActiveTrack.artwork : undefined,
            },
          },
          true
        );
        updateQueueSnapshotActiveIndex(activeIndex, progress.position);
      }
    } else {
      await player.play();
    }
  };

  const artworkScale = useMemo(() => new Animated.Value(1), []);
  const panX = useMemo(() => new Animated.Value(0), []);
  const lyricsTransition = useMemo(() => new Animated.Value(0), []);
  const queueTransition = useMemo(() => new Animated.Value(0), []);
  const sleepTimerTransition = useMemo(() => new Animated.Value(0), []);
  const connectTransition = useMemo(() => new Animated.Value(0), []);
  const coverTransition = useMemo(() => new Animated.Value(1), []);
  const playBtnScale = useMemo(() => new Animated.Value(1), []);
  const [isSkipping, setIsSkipping] = useState(false);

  const CARD_OFFSET = ARTWORK_SIZE + 24;

  // IMPORTANT: Interpolations must be memoized.
  //
  // This component re-renders on every progress tick (4x/sec while playing).
  // Creating `Animated.Value.interpolate(...)` inline on each render creates a
  // new native Animated node graph every time. On long background playback
  // this churns/leaks native nodes until Android aborts with OutOfMemoryError
  // in NativeAnimatedNodesManager.createAnimatedNode.
  const headerMorphStyle = useMemo(
    () => ({ transform: [{ translateY: headerMorphY }] }),
    [headerMorphY]
  );

  const middleMorphStyle = useMemo(
    () => ({
      transform: [
        { scale: middleMorphScale },
        { translateX: middleMorphX },
        { translateY: middleMorphY },
      ],
    }),
    [middleMorphScale, middleMorphX, middleMorphY]
  );

  const bottomMorphStyle = useMemo(
    () => ({ transform: [{ translateY: bottomMorphY }] }),
    [bottomMorphY]
  );

  const metaMorphStyle = useMemo(
    () => ({
      transform: [{ translateX: textMorphX }, { translateY: textMorphY }],
    }),
    [textMorphX, textMorphY]
  );

  const coverTransitionStyle = useMemo(
    () => ({
      opacity: coverTransition.interpolate({
        inputRange: [0, 0.45, 1],
        outputRange: [0, 0.2, 1],
      }),
      transform: [
        {
          scale: coverTransition.interpolate({
            inputRange: [0, 1],
            outputRange: [0.55, 1],
          }),
        },
        {
          translateY: coverTransition.interpolate({
            inputRange: [0, 1],
            outputRange: [90, 0],
          }),
        },
      ],
    }),
    [coverTransition]
  );

  const prevArtworkTransitionStyle = useMemo(
    () => ({
      transform: [
        {
          translateX: panX.interpolate({
            inputRange: [-CARD_OFFSET, 0, CARD_OFFSET],
            outputRange: [-CARD_OFFSET * 2, -CARD_OFFSET, 0],
            extrapolate: 'clamp',
          }),
        },
        {
          scale: panX.interpolate({
            inputRange: [0, CARD_OFFSET],
            outputRange: [0.82, 1],
            extrapolate: 'clamp',
          }),
        },
      ],
      opacity: panX.interpolate({
        inputRange: [0, CARD_OFFSET * 0.75],
        outputRange: [0.25, 1],
        extrapolate: 'clamp',
      }),
    }),
    [panX, CARD_OFFSET]
  );

  const artworkTransitionStyle = useMemo(
    () => ({
      transform: [
        { translateX: panX },
        { scale: artworkScale },
        {
          scale: panX.interpolate({
            inputRange: [-CARD_OFFSET, 0, CARD_OFFSET],
            outputRange: [0.85, 1, 0.85],
            extrapolate: 'clamp',
          }),
        },
        {
          rotate: panX.interpolate({
            inputRange: [-CARD_OFFSET, 0, CARD_OFFSET],
            outputRange: ['-5deg', '0deg', '5deg'],
            extrapolate: 'clamp',
          }),
        },
      ],
      opacity: panX.interpolate({
        inputRange: [-CARD_OFFSET, 0, CARD_OFFSET],
        outputRange: [0.45, 1, 0.45],
        extrapolate: 'clamp',
      }),
    }),
    [panX, artworkScale, CARD_OFFSET]
  );

  const nextArtworkTransitionStyle = useMemo(
    () => ({
      transform: [
        {
          translateX: panX.interpolate({
            inputRange: [-CARD_OFFSET, 0, CARD_OFFSET],
            outputRange: [0, CARD_OFFSET, CARD_OFFSET * 2],
            extrapolate: 'clamp',
          }),
        },
        {
          scale: panX.interpolate({
            inputRange: [-CARD_OFFSET, 0],
            outputRange: [1, 0.82],
            extrapolate: 'clamp',
          }),
        },
      ],
      opacity: panX.interpolate({
        inputRange: [-CARD_OFFSET * 0.75, 0],
        outputRange: [1, 0.25],
        extrapolate: 'clamp',
      }),
    }),
    [panX, CARD_OFFSET]
  );

  const lyricsCardTransitionStyle = useMemo(
    () => ({
      opacity: lyricsTransition,
      transform: [
        {
          scale: lyricsTransition.interpolate({
            inputRange: [0, 1],
            outputRange: [0.92, 1],
          }),
        },
        { scale: artworkScale },
      ],
    }),
    [lyricsTransition, artworkScale]
  );

  const queueCardTransitionStyle = useMemo(
    () => ({
      opacity: queueTransition,
      transform: [
        {
          scale: queueTransition.interpolate({
            inputRange: [0, 1],
            outputRange: [0.92, 1],
          }),
        },
        { scale: artworkScale },
      ],
    }),
    [queueTransition, artworkScale]
  );

  const sleepTimerCardTransitionStyle = useMemo(
    () => ({
      opacity: sleepTimerTransition,
      transform: [
        {
          scale: sleepTimerTransition.interpolate({
            inputRange: [0, 1],
            outputRange: [0.92, 1],
          }),
        },
        { scale: artworkScale },
      ],
    }),
    [sleepTimerTransition, artworkScale]
  );

  const connectCardTransitionStyle = useMemo(
    () => ({
      opacity: connectTransition,
      transform: [
        {
          scale: connectTransition.interpolate({
            inputRange: [0, 1],
            outputRange: [0.92, 1],
          }),
        },
        { scale: artworkScale },
      ],
    }),
    [connectTransition, artworkScale]
  );

  const miniCoverTransitionStyle = useMemo(
    () => ({
      opacity: coverTransition.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 0],
      }),
      transform: [
        {
          scale: coverTransition.interpolate({
            inputRange: [0, 1],
            outputRange: [1, 0.4],
          }),
        },
      ],
    }),
    [coverTransition]
  );

  useEffect(() => {
    // "Hareketleri azalt" açıkken duraklatma ölçek animasyonu uygulanmaz.
    Animated.spring(artworkScale, {
      toValue: reduceMotion || playing ? 1 : 0.88,
      damping: 18,
      mass: 0.9,
      stiffness: 140,
      useNativeDriver: true,
    }).start();
  }, [playing, artworkScale, reduceMotion]);

  useEffect(() => {
    const isCover = !isLyricsMode && !isQueueMode && !isSleepTimerMode && !isConnectMode;
    if (reduceMotion) {
      lyricsTransition.setValue(isLyricsMode ? 1 : 0);
      queueTransition.setValue(isQueueMode ? 1 : 0);
      sleepTimerTransition.setValue(isSleepTimerMode ? 1 : 0);
      connectTransition.setValue(isConnectMode ? 1 : 0);
      coverTransition.setValue(isCover ? 1 : 0);
      return;
    }
    Animated.parallel([
      Animated.spring(lyricsTransition, {
        toValue: isLyricsMode ? 1 : 0,
        damping: 20,
        mass: 0.9,
        stiffness: 150,
        useNativeDriver: true,
      }),
      Animated.spring(queueTransition, {
        toValue: isQueueMode ? 1 : 0,
        damping: 20,
        mass: 0.9,
        stiffness: 150,
        useNativeDriver: true,
      }),
      Animated.spring(sleepTimerTransition, {
        toValue: isSleepTimerMode ? 1 : 0,
        damping: 20,
        mass: 0.9,
        stiffness: 150,
        useNativeDriver: true,
      }),
      Animated.spring(connectTransition, {
        toValue: isConnectMode ? 1 : 0,
        damping: 20,
        mass: 0.9,
        stiffness: 150,
        useNativeDriver: true,
      }),
      Animated.spring(coverTransition, {
        toValue: isCover ? 1 : 0,
        damping: 20,
        mass: 0.9,
        stiffness: 150,
        useNativeDriver: true,
      }),
    ]).start();
  }, [
    isLyricsMode,
    isQueueMode,
    isSleepTimerMode,
    isConnectMode,
    lyricsTransition,
    queueTransition,
    sleepTimerTransition,
    connectTransition,
    coverTransition,
    reduceMotion,
  ]);

  const handlePlayPressIn = useCallback(() => {
    Animated.spring(playBtnScale, {
      toValue: 0.88,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  }, [playBtnScale]);

  const handlePlayPressOut = useCallback(() => {
    Animated.spring(playBtnScale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 30,
      bounciness: 12,
    }).start();
  }, [playBtnScale]);

  // Sıra (shuffle/repeat dahil) doğrudan kuyruğa gömülü olduğu için native
  // next/prev her zaman doğru parçayı çalar; ekstra indeks hesabı gerekmez.
  const skipNext = useCallback(async () => {
    try {
      await player.skipToNext();
    } catch (e) {
      console.warn('Skip next failed', e);
    }
  }, [player]);

  const skipPrev = useCallback(async () => {
    try {
      await player.skipToPrevious();
    } catch (e) {
      console.warn('Skip prev failed', e);
    }
  }, [player]);

  const handleHideTrack = useCallback(() => {
    if (!player.isRemote && localActiveTrack?.id) {
      hideTrack(localActiveTrack.id);
      setIsOptionsModalOpen(false);
      skipNext();
    }
  }, [player.isRemote, localActiveTrack, hideTrack, skipNext]);

  const handleDeleteTrack = useCallback(async () => {
    if (!player.isRemote && localActiveTrack?.id) {
      try {
        await MediaLibrary.deleteAssetsAsync([localActiveTrack.id]);
        setIsOptionsModalOpen(false);
        skipNext();
      } catch (e) {
        console.warn('Could not delete track', e);
      }
    }
  }, [player.isRemote, localActiveTrack, skipNext]);

  const gestureSkipPrev = useCallback(async () => {
    try {
      await player.skipToPrevious();
    } catch (e) {
      console.warn('Gesture skip prev failed', e);
    }
  }, [player]);

  const handleSeekBackward = useCallback(async () => {
    try {
      await player.seekTo(Math.max(0, progress.position - 5));
    } catch (e) {
      console.warn('Seek backward failed', e);
    }
  }, [player, progress.position]);

  const handleSeekForward = useCallback(async () => {
    try {
      await player.seekTo(Math.min(duration, progress.position + 5));
    } catch (e) {
      console.warn('Seek forward failed', e);
    }
  }, [player, progress.position, duration]);

  const togglePlaybackMode = useCallback(async () => {
    if (player.isRemote) {
      if (player.isShuffle) {
        // Karışık -> Tek Şarkı Tekrarla
        await player.setShuffle(false);
        await player.setRepeatMode(RepeatMode.Track);
      } else if (player.repeatMode === RepeatMode.Track) {
        // Tek Şarkı Tekrarla -> Sırayla (Sequential)
        await player.setRepeatMode(RepeatMode.Queue);
      } else {
        // Sırayla -> Karışık (Shuffle)
        await player.setRepeatMode(RepeatMode.Off);
        await player.setShuffle(true);
      }
      return;
    }
    await cyclePlaybackMode();
    if (isQueueMode) {
      await refreshQueueSections();
      await refreshQueue();
    }
  }, [player, isQueueMode, refreshQueueSections, refreshQueue]);

  // Gestures: Middle container (Interactive Carousel Artwork / Lyrics)
  const artworkPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_, gesture) => {
          if (isLyricsMode || isQueueMode || isSleepTimerMode || isConnectMode || isSkipping) return false;
          return Math.abs(gesture.dx) > 12 || gesture.dy > 15;
        },
        onMoveShouldSetPanResponderCapture: (_, gesture) => {
          if (isLyricsMode || isQueueMode || isSleepTimerMode || isConnectMode || isSkipping) return false;
          return Math.abs(gesture.dx) > 12 || gesture.dy > 15;
        },
        onPanResponderMove: (_, gesture) => {
          if (isSkipping || isConnectMode) return;
          // Belirgin dikey kaydırma varsa (aşağı çekip kapatma) yatay hareketi engelle
          if (gesture.dy > 18 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.4) {
            return;
          }
          let targetDx = gesture.dx;
          // Eğer sonraki veya önceki şarkı yoksa lastik direnci uygula
          if (targetDx < 0 && !nextTrack) {
            targetDx = targetDx * 0.28;
          } else if (targetDx > 0 && !prevTrack) {
            targetDx = targetDx * 0.28;
          }
          panX.setValue(targetDx);
        },
        onPanResponderRelease: (_, gesture) => {
          if (isSkipping || isConnectMode) return;

          // 1. Dokunma (Tap): Sözler moduna geç
          if (Math.abs(gesture.dx) < 10 && Math.abs(gesture.dy) < 10) {
            toggleLyricsMode();
            return;
          }

          // 2. Aşağı kaydırma: Tam ekran çaları kapat
          if (gesture.dy > 50 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.1) {
            Animated.spring(panX, { toValue: 0, useNativeDriver: true }).start();
            closeFullscreenPlayer();
            return;
          }

          // 3. Yatay kaydırma: Şarkı değiştirme eşiği
          const threshold = ARTWORK_SIZE * 0.25;
          const isQuickFlingLeft = gesture.dx < -30 && gesture.vx < -0.4;
          const isQuickFlingRight = gesture.dx > 30 && gesture.vx > 0.4;

          if ((gesture.dx < -threshold || isQuickFlingLeft) && nextTrack) {
            // Sola kaydırıldı -> Sonraki şarkıya yumuşak animasyonla geç
            setIsSkipping(true);
            Animated.spring(panX, {
              toValue: -CARD_OFFSET,
              velocity: gesture.vx,
              tension: 65,
              friction: 9,
              useNativeDriver: true,
            }).start(() => {
              skipNext();
              panX.setValue(0);
              setIsSkipping(false);
            });
          } else if ((gesture.dx > threshold || isQuickFlingRight) && prevTrack) {
            // Sağa kaydırıldı -> Önceki şarkıya yumuşak animasyonla geç
            setIsSkipping(true);
            Animated.spring(panX, {
              toValue: CARD_OFFSET,
              velocity: gesture.vx,
              tension: 65,
              friction: 9,
              useNativeDriver: true,
            }).start(() => {
              gestureSkipPrev();
              panX.setValue(0);
              setIsSkipping(false);
            });
          } else {
            // Eşik geçilmedi -> Merkeze tatlı bir yay efektiyle geri dön
            Animated.spring(panX, {
              toValue: 0,
              velocity: gesture.vx,
              tension: 70,
              friction: 8,
              useNativeDriver: true,
            }).start();
          }
        },
      }),
    [
      isLyricsMode,
      isQueueMode,
      isSleepTimerMode,
      isConnectMode,
      isSkipping,
      nextTrack,
      prevTrack,
      panX,
      CARD_OFFSET,
      toggleLyricsMode,
      closeFullscreenPlayer,
      skipNext,
      gestureSkipPrev,
    ]
  );

  // Gestures: Top grabber handle - Pull down closes modal
  const headerPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 12,
        onMoveShouldSetPanResponderCapture: (_, gesture) => gesture.dy > 12,
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy > 25) {
            closeFullscreenPlayer();
          }
        },
      }),
    [closeFullscreenPlayer]
  );

  const isLyricsModeRef = useRef(isLyricsMode);
  useEffect(() => {
    isLyricsModeRef.current = isLyricsMode;
  }, [isLyricsMode]);

  const globalPanResponder = useMemo(
    () => {
      return PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_, gesture) => {
          if (isLyricsMode || isQueueMode || isSleepTimerMode || isConnectMode) return false;
          // Sadece net aşağı kaydırmalarda aktif ol (diğer gesture'larla çakışmamak için)
          return gesture.dy > 20 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.5;
        },
        onMoveShouldSetPanResponderCapture: (_, gesture) => {
          if (isLyricsMode || isQueueMode || isSleepTimerMode || isConnectMode) return false;
          return gesture.dy > 20 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.5;
        },
        onPanResponderRelease: (_, gesture) => {
          if (isLyricsMode || isQueueMode || isSleepTimerMode || isConnectMode) return;
          if (gesture.dy > 40) {
            closeFullscreenPlayer();
          }
        },
      });
    },
    [closeFullscreenPlayer, isLyricsMode, isQueueMode, isSleepTimerMode, isConnectMode]
  );

  if (!activeTrack) {
    return null;
  }

  return (
    <View
      {...globalPanResponder.panHandlers}
      style={[
        styles.fullscreenContainer,
        {
          paddingTop: Math.max(insets.top, 16),
          paddingBottom: Math.max(insets.bottom, 16),
        },
      ]}>
      {/* Dynamic Blurred Background based on Cover Art */}
      {currentArtworkUri ? (
        <Image
          source={{ uri: currentArtworkUri }}
          style={StyleSheet.absoluteFill}
          blurRadius={35}
          contentFit="cover"
          transition={500}
        />
      ) : null}
      <View style={[StyleSheet.absoluteFill, styles.backdropOverlay]} />
      {/* Subtle Ambient Color Glow from Cover Art */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.glowColor, opacity: 0.14 }]} />

      {/* TOP HEADER & GRABBER (Morph animasyonu ile yukarıdan süzülür) */}
      <Animated.View style={headerMorphStyle}>
        {/* Apple Music Style Top Grabber Bar */}
        <View style={styles.topGrabberContainer} {...headerPanResponder.panHandlers}>
          <View style={styles.topGrabberBar} />
        </View>

        {/* Top Header */}
        <View style={styles.topHeader}>
          <TouchableOpacity
            style={styles.headerIconBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            onPress={closeFullscreenPlayer}>
            <Ionicons name="chevron-down" size={26} color="rgba(255, 255, 255, 0.75)" />
          </TouchableOpacity>
          <View style={styles.headerTitleBox}>
            {player.isRemote ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                <View style={styles.remoteHeaderDot} />
                <Text style={styles.headerSmallLabelRemote} numberOfLines={1}>
                  {player.remoteDeviceName || 'Remote Device'}
                </Text>
              </View>
            ) : (
              <Text style={styles.headerSmallLabel}>{t('player.now_playing')}</Text>
            )}
            <Text style={styles.headerAlbumName} numberOfLines={1}>
              {displayArtist}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {/* Hafızadaki Oynatılan Parçayı İndirme Butonu */}
            {isRemoteStream && (
              <TouchableOpacity
                style={styles.headerIconBtn}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                onPress={handleDownloadCurrentTrack}>
                <Ionicons
                  name={
                    isCurrentTrackDownloaded
                      ? 'checkmark-circle'
                      : isCurrentTrackDownloading
                      ? 'cloud-download'
                      : 'arrow-down-circle-outline'
                  }
                  size={24}
                  color={
                    isCurrentTrackDownloaded
                      ? '#10b981'
                      : isCurrentTrackDownloading
                      ? theme.primary
                      : 'rgba(255, 255, 255, 0.85)'
                  }
                />
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.headerIconBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              onPress={() => setIsOptionsModalOpen(true)}>
              <Ionicons name="ellipsis-horizontal-circle" size={24} color="rgba(255, 255, 255, 0.75)" />
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>

      {/* ORTA BÖLÜM: Kapak Fotoğrafı Carousel <---> Senkronize Şarkı Sözleri Değişimi */}
      <Animated.View
        style={[styles.middleContainer, middleMorphStyle]}
        {...artworkPanResponder.panHandlers}>
          {/* 1. Kapak Carousel Görünümü (Apple Music etkileşimli kenar önizlemeli geçiş) */}
          <Animated.View
            style={[styles.coverCenterBox, coverTransitionStyle]}
            pointerEvents={(!isLyricsMode && !isQueueMode && !isSleepTimerMode && !isConnectMode) ? 'auto' : 'none'}>
            {/* Önceki Şarkı Kapağı (Soldan süzülen önizleme) */}
            {prevTrack ? (
              <Animated.View
                style={[styles.neighborArtworkWrapper, prevArtworkTransitionStyle]}
                pointerEvents="none">
                <TrackArtwork
                  uri={prevArtworkUri}
                  trackId={prevTrack.id}
                  trackUri={prevTrack.url}
                  size={ARTWORK_SIZE}
                  borderRadius={18}
                  iconSize={84}
                />
              </Animated.View>
            ) : null}

            {/* Mevcut Şarkı Kapağı (Merkezde, kaydırılan ana kart) */}
            <Animated.View
              style={[styles.artworkWrapper, artworkTransitionStyle]}>
              <TouchableOpacity
                activeOpacity={0.92}
                onPress={toggleLyricsMode}>
                <TrackArtwork
                  uri={currentArtworkUri}
                  trackId={activeTrack?.id}
                  trackUri={(activeTrack as any)?.url}
                  size={ARTWORK_SIZE}
                  borderRadius={18}
                  iconSize={84}
                />
              </TouchableOpacity>
            </Animated.View>

            {/* Sonraki Şarkı Kapağı (Sağdan süzülen önizleme) */}
            {nextTrack ? (
              <Animated.View
                style={[styles.neighborArtworkWrapper, nextArtworkTransitionStyle]}
                pointerEvents="none">
                <TrackArtwork
                  uri={nextArtworkUri}
                  trackId={nextTrack.id}
                  trackUri={nextTrack.url}
                  size={ARTWORK_SIZE}
                  borderRadius={18}
                  iconSize={84}
                />
              </Animated.View>
            ) : null}
          </Animated.View>

          {/* 2. Senkronize Şarkı Sözleri Görünümü (Yumuşak solma ve büyüme geçişi) */}
          <Animated.View
            style={[styles.lyricsCardContainer, lyricsCardTransitionStyle]}
            pointerEvents={isLyricsMode ? 'auto' : 'none'}>
            <View style={styles.lyricsCardHeader}>
              <View style={[styles.lyricsSourceBadge, { backgroundColor: theme.surface }]}>
                <Ionicons
                  name={
                    hasWordSync
                      ? 'sparkles'
                      : currentLyrics?.syncedLyrics || parsedLines.length > 0
                      ? 'musical-notes'
                      : 'document-text-outline'
                  }
                  size={12}
                  color={hasWordSync ? '#10b981' : theme.primary}
                  style={{ marginRight: 4 }}
                />
                <Text style={[styles.lyricsSourceText, { color: hasWordSync ? '#10b981' : theme.textAccent }]}>
                  {hasWordSync
                    ? 'LRCLIB (Word Sync)'
                    : currentLyrics?.syncedLyrics || parsedLines.length > 0
                    ? 'LRCLIB (Sync)'
                    : currentLyrics?.source === 'lrclib'
                    ? 'LRCLIB (Plain Text)'
                    : currentLyrics?.source === 'genius'
                    ? 'Genius (Plain Text)'
                    : t('player.lyrics')}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {(parsedLines.length > 0 || currentLyrics?.plainLyrics) ? (
                  <TouchableOpacity
                    style={[
                      styles.lyricsActionBtn,
                      { backgroundColor: theme.surface },
                      isLyricsAutoScrollPaused && { backgroundColor: 'rgba(239, 68, 68, 0.18)' },
                    ]}
                    activeOpacity={0.7}
                    onPress={toggleLyricsAutoScroll}
                    hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
                    <Ionicons
                      name={isLyricsAutoScrollPaused ? 'play' : 'pause'}
                      size={12}
                      color={isLyricsAutoScrollPaused ? '#ef4444' : theme.primary}
                    />
                    <Text
                      style={[
                        styles.lyricsActionBtnText,
                        { color: isLyricsAutoScrollPaused ? '#ef4444' : theme.primary },
                      ]}>
                      {isLyricsAutoScrollPaused ? t('player.auto_scroll') : t('player.pause_scroll')}
                    </Text>
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                  style={[styles.lyricsSearchBtn, { backgroundColor: theme.surface }]}
                  activeOpacity={0.7}
                  onPress={toggleManualSearch}>
                  <Ionicons name="search" size={12} color={theme.primary} />
                  <Text style={[styles.lyricsSearchBtnText, { color: theme.primary }]}>{t('player.manual_search')}</Text>
                </TouchableOpacity>
              </View>
            </View>

            {isLoadingLyrics ? (
              <View style={styles.lyricsLoadingCenter}>
                <ActivityIndicator size="large" color={theme.primary} />
                <Text style={styles.lyricsLoadingText}>{t('player.searching_lyrics')}</Text>
              </View>
            ) : parsedLines.length > 0 ? (
              /* Senkronize Söz Akışı (Apple Music Tipografisi & Kelime Senkronizasyonu) */
              <FlatList
                ref={lyricsFlatListRef}
                data={parsedLines}
                keyExtractor={(_, index) => `lyric-line-${index}`}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.lyricsListContent}
                onScrollBeginDrag={() => {
                  isUserScrollingRef.current = true;
                  if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
                }}
                onScrollEndDrag={() => {
                  if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
                  scrollTimeoutRef.current = setTimeout(() => {
                    isUserScrollingRef.current = false;
                  }, 4000);
                }}
                renderItem={({ item, index }) => {
                  const isActive = index === activeLineIndex;
                  return (
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => player.seekTo(item.time)}
                      style={[styles.lyricRow, isActive && styles.lyricRowActive]}>
                      {isActive && item.words && item.words.length > 0 ? (
                        <Text
                          style={[
                            styles.lyricText,
                            styles.lyricTextActive,
                            { textShadowColor: theme.glowColor },
                          ]}>
                          {item.words.map((word, wIdx) => {
                            const isSung = progress.position >= word.time;
                            const displayWord =
                              wIdx < item.words!.length - 1 &&
                              !word.text.endsWith(' ') &&
                              !item.words![wIdx + 1].text.startsWith(' ')
                                ? word.text + ' '
                                : word.text;
                            return (
                              <Text
                                key={`word-${wIdx}`}
                                style={
                                  isSung
                                    ? [
                                        styles.lyricWordSung,
                                        { textShadowColor: theme.glowColor },
                                      ]
                                    : styles.lyricWordUpcoming
                                }>
                                {displayWord}
                              </Text>
                            );
                          })}
                        </Text>
                      ) : (
                        <Text
                          style={[
                            styles.lyricText,
                            isActive && [
                              styles.lyricTextActive,
                              { textShadowColor: theme.glowColor },
                            ],
                          ]}>
                          {item.text}
                        </Text>
                      )}
                    </TouchableOpacity>
                  );
                }}
              />
            ) : currentLyrics?.plainLyrics ? (
              /* Düz Metin Söz Akışı (Şarkının süresine göre orantılı kaydırma) */
              <ScrollView
                ref={plainLyricsScrollRef}
                style={styles.plainLyricsScroll}
                contentContainerStyle={styles.lyricsListContent}
                showsVerticalScrollIndicator={false}
                onContentSizeChange={(_, h) => {
                  plainContentHeightRef.current = h;
                }}
                onLayout={(e) => {
                  plainScrollViewHeightRef.current = e.nativeEvent.layout.height;
                }}
                onScrollBeginDrag={() => {
                  isPlainUserScrollingRef.current = true;
                  if (plainScrollTimeoutRef.current) clearTimeout(plainScrollTimeoutRef.current);
                }}
                onScrollEndDrag={() => {
                  if (plainScrollTimeoutRef.current) clearTimeout(plainScrollTimeoutRef.current);
                  plainScrollTimeoutRef.current = setTimeout(() => {
                    isPlainUserScrollingRef.current = false;
                  }, 4000);
                }}
                onMomentumScrollBegin={() => {
                  isPlainUserScrollingRef.current = true;
                  if (plainScrollTimeoutRef.current) clearTimeout(plainScrollTimeoutRef.current);
                }}
                onMomentumScrollEnd={() => {
                  if (plainScrollTimeoutRef.current) clearTimeout(plainScrollTimeoutRef.current);
                  plainScrollTimeoutRef.current = setTimeout(() => {
                    isPlainUserScrollingRef.current = false;
                  }, 4000);
                }}>
                <Text style={styles.plainLyricsText}>{currentLyrics.plainLyrics}</Text>
              </ScrollView>
            ) : (
              /* Söz Bulunamadı Durumu */
              <View style={styles.lyricsEmptyState}>
                <Ionicons name="mic-off-outline" size={38} color="#52525b" />
                <Text style={styles.lyricsEmptyTitle}>{t('player.no_lyrics_found')}</Text>
                <Text style={styles.lyricsEmptySubtitle}>
                  {t('player.no_lyrics_subtitle')}
                </Text>
                <TouchableOpacity
                  style={[styles.lyricsEmptySearchBtn, { backgroundColor: theme.primary }]}
                  activeOpacity={0.8}
                  onPress={toggleManualSearch}>
                  <Ionicons name="search" size={16} color="#ffffff" style={{ marginRight: 6 }} />
                  <Text style={styles.lyricsEmptySearchBtnText}>{t('player.search_lyrics_btn')}</Text>
                </TouchableOpacity>
              </View>
            )}
          </Animated.View>

          {/* 3. Çalma Sırası (Queue) Görünümü (Kapak yerine aynı boyutta yumuşak geçiş) */}
          <Animated.View
            style={[styles.queueCardContainer, queueCardTransitionStyle]}
            pointerEvents={isQueueMode ? 'auto' : 'none'}>
            <View style={styles.queueCardHeader}>
              <View style={[styles.queueSourceBadge, { backgroundColor: theme.surface }]}>
                <Ionicons name="list" size={13} color={theme.primary} style={{ marginRight: 6 }} />
                <Text style={[styles.queueSourceText, { color: theme.textAccent }]}>
                  {t('player.queue_title')}{' '}
                  {(player.isRemote ? (remoteState.queue?.length || 0) : queue.length) > 0
                    ? `(${player.isRemote ? (remoteState.queue?.length || 0) : queue.length})`
                    : ''}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {currentRowIndex >= 0 ? (
                  <TouchableOpacity
                    style={styles.queueLocateBtn}
                    activeOpacity={0.7}
                    onPress={() => {
                      if (currentRowIndex >= 0) {
                        queueListRef.current?.scrollToIndex({
                          index: currentRowIndex,
                          animated: true,
                          viewPosition: 0.15,
                        });
                      }
                    }}>
                    <Ionicons name="locate-outline" size={13} color={theme.primary} style={{ marginRight: 4 }} />
                    <Text style={[styles.queueLocateBtnText, { color: theme.primary }]}>{t('player.go_to_current')}</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  style={styles.queueCardCloseBtn}
                  activeOpacity={0.7}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  onPress={toggleQueueMode}>
                  <Ionicons name="close" size={18} color="rgba(255, 255, 255, 0.7)" />
                </TouchableOpacity>
              </View>
            </View>

            <FlatList
              ref={queueListRef}
              data={queueRows}
              initialScrollIndex={currentRowIndex >= 0 ? currentRowIndex : undefined}
              extraData={`${isShuffle}-${isSmartShuffle}-${repeatMode}-${queueRevision}-${remoteState.queue?.length}-${player.activeTrack?.id}-${activeTrack?.id ?? localActiveTrack?.id ?? ''}-${Object.keys(metadataMap).length}-${Object.keys(artworkMap).length}`}
              keyExtractor={(row) => row.key}
              renderItem={renderQueueRow}
              contentContainerStyle={styles.queueScrollContent}
              showsVerticalScrollIndicator={false}
              initialNumToRender={16}
              maxToRenderPerBatch={16}
              updateCellsBatchingPeriod={50}
              windowSize={7}
              onScrollToIndexFailed={handleScrollToIndexFailed}
              ListEmptyComponent={
                effectiveQueueSections ? (
                  <View style={{ paddingVertical: 32, alignItems: 'center' }}>
                    <Text style={{ color: '#71717a', fontSize: 14 }}>{t('player.queue_empty')}</Text>
                  </View>
                ) : (
                  <ActivityIndicator size="small" color={theme.primary} style={{ marginTop: 24 }} />
                )
              }
            />
          </Animated.View>

          {/* 4. Uyku Zamanlayıcısı Görünümü (Kapak yerine aynı boyutta yumuşak geçiş) */}
          <Animated.View
            style={[styles.sleepTimerCardContainer, sleepTimerCardTransitionStyle]}
            pointerEvents={isSleepTimerMode ? 'auto' : 'none'}>
            <View style={styles.queueCardHeader}>
              <View style={[styles.queueSourceBadge, { backgroundColor: theme.surface }]}>
                <Ionicons name="moon" size={13} color={theme.primary} style={{ marginRight: 6 }} />
                <Text style={[styles.queueSourceText, { color: theme.textAccent }]}>
                  {t('player.sleep_timer')}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.queueCardCloseBtn}
                activeOpacity={0.7}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                onPress={toggleSleepTimerMode}>
                <Ionicons name="close" size={18} color="rgba(255, 255, 255, 0.7)" />
              </TouchableOpacity>
            </View>

            <View style={styles.sleepTimerBody}>
              {/* Aktif Zamanlayıcı Kompakt Bilgi Çubuğu */}
              {isSleepTimerActive ? (
                <View
                  style={[
                    styles.sleepTimerActiveBar,
                    { backgroundColor: theme.surface, borderColor: `${theme.primary}40` },
                  ]}>
                  <View style={styles.sleepTimerActiveBarLeft}>
                    <View
                      style={[
                        styles.sleepTimerIconBubble,
                        { backgroundColor: `${theme.primary}25` },
                      ]}>
                      <Ionicons name="moon" size={17} color={theme.primary} />
                    </View>
                    <View style={{ marginLeft: 10 }}>
                      <Text style={[styles.sleepTimerActiveBarTitle, { color: theme.textAccent }]}>
                        {t('player.remaining_time')}
                      </Text>
                      <Text style={[styles.sleepTimerActiveBarRemaining, { color: theme.primary }]}>
                        {sleepTimerRemaining || t('player.calculating')}
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={styles.stopTimerPillBtn}
                    activeOpacity={0.75}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    onPress={stopTimer}>
                    <Ionicons name="close-circle" size={16} color="#ef4444" style={{ marginRight: 5 }} />
                    <Text style={styles.stopTimerPillBtnText}>{t('player.cancel_timer')}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              <Text style={[styles.sleepTimerSectionLabel, { color: theme.textAccent }]}>
                {isSleepTimerActive ? t('player.change_duration') : t('player.select_sleep_duration')}
              </Text>

              {/* Hızlı Seçenekler Grid (15, 30, 45, 60 dk) */}
              <View style={styles.timerOptionsGrid}>
                {([15, 30, 45, 60] as const).map((min) => {
                  const isSelected = isSleepTimerActive && sleepTimerDurationOption === min;
                  return (
                    <TouchableOpacity
                      key={min}
                      style={[
                        styles.timerOptionBtn,
                        { backgroundColor: theme.surface },
                        isSelected && {
                          borderColor: theme.primary,
                          borderWidth: 1.5,
                          backgroundColor: `${theme.primary}20`,
                        },
                      ]}
                      activeOpacity={0.75}
                      onPress={() => startTimer(min, min)}>
                      <Text
                        style={[
                          styles.timerOptionText,
                          isSelected && { color: theme.primary, fontWeight: '700' },
                        ]}>
                        {min} {t('player.minutes')}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Şarkı Bitince Durdur */}
              <TouchableOpacity
                style={[
                  styles.timerFullWidthBtn,
                  { backgroundColor: theme.surface },
                  isSleepTimerActive && sleepTimerDurationOption === 'track' && {
                    borderColor: theme.primary,
                    borderWidth: 1.5,
                    backgroundColor: `${theme.primary}20`,
                  },
                ]}
                activeOpacity={0.75}
                onPress={startTrackTimer}>
                <Ionicons
                  name="musical-note"
                  size={18}
                  color={
                    isSleepTimerActive && sleepTimerDurationOption === 'track'
                      ? theme.primary
                      : '#ffffff'
                  }
                  style={{ marginRight: 8 }}
                />
                <Text
                  style={[
                    styles.timerOptionText,
                    isSleepTimerActive && sleepTimerDurationOption === 'track' && {
                      color: theme.primary,
                      fontWeight: '700',
                    },
                  ]}>
                  {t('player.stop_after_track')}
                </Text>
              </TouchableOpacity>

              <View style={styles.customTimerRow}>
                <TextInput
                  style={[styles.customTimerInput, { backgroundColor: theme.surface }]}
                  placeholder={t('player.custom_minutes_placeholder')}
                  placeholderTextColor="#71717a"
                  keyboardType="numeric"
                  value={customTimerMinutes}
                  onChangeText={setCustomTimerMinutes}
                />
                <TouchableOpacity
                  style={[
                    styles.customTimerBtn,
                    { backgroundColor: customTimerMinutes.trim() ? theme.primary : '#27272a' },
                  ]}
                  activeOpacity={0.8}
                  disabled={!customTimerMinutes.trim()}
                  onPress={() => {
                    const mins = parseInt(customTimerMinutes, 10);
                    if (!isNaN(mins) && mins > 0) {
                      startTimer(mins, 'custom');
                      setCustomTimerMinutes('');
                    }
                  }}>
                  <Text
                    style={[
                      styles.customTimerBtnText,
                      { color: customTimerMinutes.trim() ? '#ffffff' : '#71717a' },
                    ]}>
                    {t('player.start')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </Animated.View>

          {/* 5. RunMusic Connect Görünümü (Kapak yerine aynı boyutta yumuşak geçiş) */}
          <Animated.View
            style={[styles.connectCardContainer, connectCardTransitionStyle]}
            pointerEvents={isConnectMode ? 'auto' : 'none'}>
            <View style={styles.queueCardHeader}>
              <View style={[styles.queueSourceBadge, { backgroundColor: theme.surface }]}>
                <Ionicons name="radio" size={13} color={theme.primary} style={{ marginRight: 6 }} />
                <Text style={[styles.queueSourceText, { color: theme.textAccent }]}>
                  RunMusic Connecto
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <TouchableOpacity
                  style={[
                    styles.lyricsActionBtn,
                    { backgroundColor: theme.surface },
                    !isRemoteServiceEnabled && { backgroundColor: 'rgba(239, 68, 68, 0.18)' },
                  ]}
                  activeOpacity={0.7}
                  onPress={() => setRemoteServiceEnabled(!isRemoteServiceEnabled)}
                  hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
                  <Ionicons
                    name={isRemoteServiceEnabled ? 'power' : 'power-outline'}
                    size={12}
                    color={isRemoteServiceEnabled ? theme.primary : '#ef4444'}
                  />
                  <Text
                    style={[
                      styles.lyricsActionBtnText,
                      { color: isRemoteServiceEnabled ? theme.primary : '#ef4444' },
                    ]}>
                    {isRemoteServiceEnabled ? t('common.enabled') : t('common.disabled')}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.queueCardCloseBtn}
                  activeOpacity={0.7}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  onPress={toggleConnectMode}>
                  <Ionicons name="close" size={18} color="rgba(255, 255, 255, 0.7)" />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.connectBody}>
              {/* Segment Kontrolü: Wi-Fi | Bluetooth | İnternet */}
              <View style={[styles.connectSegmentContainer, { backgroundColor: theme.surface }]}>
                <TouchableOpacity
                  style={[
                    styles.connectSegmentTab,
                    activeTransportTab === 'wifi' && {
                      backgroundColor: theme.primary,
                    },
                  ]}
                  activeOpacity={0.8}
                  onPress={() => setActiveTransportTab('wifi')}>
                  <Ionicons
                    name="wifi-outline"
                    size={14}
                    color={activeTransportTab === 'wifi' ? '#ffffff' : 'rgba(255, 255, 255, 0.6)'}
                    style={{ marginRight: 6 }}
                  />
                  <Text
                    style={[
                      styles.connectSegmentText,
                      activeTransportTab === 'wifi' && { color: '#ffffff', fontWeight: '700' },
                    ]}>
                    Wi-Fi
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.connectSegmentTab,
                    activeTransportTab === 'ble' && {
                      backgroundColor: theme.primary,
                    },
                  ]}
                  activeOpacity={0.8}
                  onPress={() => setActiveTransportTab('ble')}>
                  <Ionicons
                    name="bluetooth-outline"
                    size={14}
                    color={activeTransportTab === 'ble' ? '#ffffff' : 'rgba(255, 255, 255, 0.6)'}
                    style={{ marginRight: 6 }}
                  />
                  <Text
                    style={[
                      styles.connectSegmentText,
                      activeTransportTab === 'ble' && { color: '#ffffff', fontWeight: '700' },
                    ]}>
                    Bluetooth
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.connectSegmentTab,
                    activeTransportTab === 'internet' && {
                      backgroundColor: theme.primary,
                    },
                  ]}
                  activeOpacity={0.8}
                  onPress={() => setActiveTransportTab('internet')}>
                  <Ionicons
                    name="globe-outline"
                    size={14}
                    color={activeTransportTab === 'internet' ? '#ffffff' : 'rgba(255, 255, 255, 0.6)'}
                    style={{ marginRight: 6 }}
                  />
                  <Text
                    style={[
                      styles.connectSegmentText,
                      activeTransportTab === 'internet' && { color: '#ffffff', fontWeight: '700' },
                    ]}>
                    {t('remote.internet')}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Bu Telefon (Yerel Cihaz) */}
              <TouchableOpacity
                style={[
                  styles.connectDeviceItem,
                  { backgroundColor: theme.surface },
                  !player.isRemote && {
                    borderColor: theme.primary,
                    borderWidth: 1.5,
                  },
                ]}
                activeOpacity={0.75}
                onPress={handleSelectLocalDevice}>
                <View
                  style={[
                    styles.connectDeviceIcon,
                    {
                      backgroundColor: !player.isRemote ? `${theme.primary}25` : 'rgba(255, 255, 255, 0.06)',
                    },
                  ]}>
                  <Ionicons
                    name="phone-portrait-outline"
                    size={20}
                    color={!player.isRemote ? theme.primary : 'rgba(255, 255, 255, 0.7)'}
                  />
                </View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={[styles.connectDeviceName, !player.isRemote && { color: theme.primary, fontWeight: '700' }]}>
                    {t('remote.this_device')}
                  </Text>
                  <Text style={styles.connectDeviceSubtext}>
                    {!player.isRemote ? t('remote.currently_playing') : t('remote.switch_to_local')}
                  </Text>
                </View>
                {!player.isRemote ? (
                  <Ionicons name="checkmark-circle" size={20} color={theme.primary} />
                ) : null}
              </TouchableOpacity>

              {/* Bağlı İstemci Cihazlar (Host Modunda) */}
              {connectedClients.length > 0 && (
                <View style={{ marginBottom: 10 }}>
                  <View style={styles.connectSectionHeader}>
                    <Text style={[styles.connectSectionLabel, { color: theme.primary, fontWeight: '700' }]}>
                      {`${t('remote.connected_devices_title')} (${connectedClients.length})`}
                    </Text>
                  </View>
                  {connectedClients.map((client) => (
                    <View
                      key={client.id}
                      style={[
                        styles.connectDeviceItem,
                        { backgroundColor: theme.surface, borderColor: `${theme.primary}55`, borderWidth: 1 },
                      ]}>
                      <View
                        style={[
                          styles.connectDeviceIcon,
                          { backgroundColor: `${theme.primary}25` },
                        ]}>
                        <Ionicons
                          name={client.transport === 'ble' ? 'bluetooth' : client.transport === 'internet' ? 'globe' : 'phone-portrait'}
                          size={18}
                          color={theme.primary}
                        />
                      </View>
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={[styles.connectDeviceName, { color: '#ffffff', fontWeight: '700' }]} numberOfLines={1}>
                          {client.deviceName}
                        </Text>
                        <Text style={[styles.connectDeviceSubtext, { color: theme.primary }]}>
                          {`${client.transport === 'ble' ? t('remote.ble_remote') : client.transport === 'internet' ? t('remote.internet_remote') : t('remote.wifi_remote')} • ${t('remote.status_connected')}`}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={styles.connectKickBtn}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        onPress={() => remoteSyncManager.disconnectConnectedClient(client.id)}>
                        <Ionicons name="close-circle-outline" size={22} color="#ef4444" />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}

              {/* İNTERNET MODU UI */}
              {activeTransportTab === 'internet' ? (
                <ScrollView
                  style={{ flex: 1 }}
                  contentContainerStyle={{ paddingBottom: 24 }}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled">
                  {/* Client Mode: Bağlı Kumanda Durum Kartı */}
                  {remoteMode === 'client' ? (
                    <View style={[styles.connectRoomCard, { backgroundColor: theme.surface }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={[styles.connectSectionLabel, { color: theme.textAccent, marginBottom: 0 }]}>
                          {t('remote.connected_remote')}
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                          <View
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: 4,
                              backgroundColor:
                                remoteConnectionStatus === 'connected'
                                  ? '#22c55e'
                                  : remoteConnectionStatus === 'connecting'
                                  ? '#f59e0b'
                                  : '#ef4444',
                            }}
                          />
                          <Text
                            style={{
                              fontSize: 11,
                              color:
                                remoteConnectionStatus === 'connected'
                                  ? '#22c55e'
                                  : remoteConnectionStatus === 'connecting'
                                  ? '#f59e0b'
                                  : '#ef4444',
                              fontWeight: '600',
                            }}>
                            {remoteConnectionStatus === 'connected'
                              ? t('remote.status_connected')
                              : remoteConnectionStatus === 'connecting'
                              ? t('remote.status_connecting')
                              : t('remote.status_error')}
                          </Text>
                        </View>
                      </View>

                      <Text style={[styles.connectRoomCodeBadge, { color: theme.primary, fontSize: 24, marginVertical: 8 }]}>
                        {connectedDeviceName || t('remote.remote_device')}
                      </Text>

                      {remoteConnectionStatus === 'error' && (
                        <Text style={{ color: '#ef4444', fontSize: 13, marginBottom: 12, textAlign: 'center', fontWeight: '500' }}>
                          {errorMessage || t('remote.room_not_found')}
                        </Text>
                      )}

                      <View style={styles.connectRoomActionsRow}>
                        {remoteConnectionStatus === 'error' && (
                          <TouchableOpacity
                            style={[styles.connectRoomBtn, { backgroundColor: `${theme.primary}35` }]}
                            activeOpacity={0.75}
                            onPress={() => {
                              const codeToRetry = inputRoomCode.trim().replace(/^RUN-/, '') || (connectedDeviceName?.replace('Oda: ', '').replace(/^RUN-/, '') || '');
                              if (codeToRetry) {
                                remoteSyncManager.connectToInternetRoom(codeToRetry).catch(() => {});
                              }
                            }}>
                            <Ionicons name="refresh-outline" size={16} color={theme.primary} />
                            <Text style={{ color: theme.primary, fontWeight: '700', fontSize: 12 }}>{t('common.retry')}</Text>
                          </TouchableOpacity>
                        )}

                        <TouchableOpacity
                          style={[styles.connectRoomBtn, { backgroundColor: 'rgba(239, 68, 68, 0.2)' }]}
                          activeOpacity={0.75}
                          onPress={() => {
                            remoteSyncManager.disconnectClient();
                          }}>
                          <Ionicons name="close-circle-outline" size={16} color="#ef4444" />
                          <Text style={{ color: '#ef4444', fontWeight: '700', fontSize: 12 }}>{t('remote.disconnect')}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    /* Host Section: Oda Kodu Kartı (Servis Açıksa) */
                    isRemoteServiceEnabled && (
                      <View style={[styles.connectRoomCard, { backgroundColor: theme.surface }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Text style={[styles.connectSectionLabel, { color: theme.textAccent, marginBottom: 0 }]}>
                            {t('remote.my_room_code')}
                          </Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                            <View
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: 4,
                                backgroundColor:
                                  internetHostStatus === 'connected'
                                    ? '#22c55e'
                                    : internetHostStatus === 'connecting'
                                    ? '#f59e0b'
                                    : '#ef4444',
                              }}
                            />
                            <Text
                              style={{
                                fontSize: 11,
                                color:
                                  internetHostStatus === 'connected'
                                    ? '#22c55e'
                                    : internetHostStatus === 'connecting'
                                    ? '#f59e0b'
                                    : '#ef4444',
                                fontWeight: '600',
                              }}>
                              {internetHostStatus === 'connected'
                                ? t('remote.status_live')
                                : internetHostStatus === 'connecting'
                                ? t('remote.status_connecting')
                                : t('remote.status_offline')}
                            </Text>
                          </View>
                        </View>

                        <Text style={[styles.connectRoomCodeBadge, { color: theme.primary }]}>
                          {internetRoomCode ? internetRoomCode.replace(/^RUN-/, '') : t('remote.starting_room')}
                        </Text>

                        {internetHostStatus !== 'connected' && (
                          <View style={styles.connectRoomActionsRow}>
                            <TouchableOpacity
                              style={[styles.connectRoomBtn, { backgroundColor: `${theme.primary}35` }]}
                              activeOpacity={0.75}
                              onPress={() => {
                                remoteSyncManager.startInternetHostRoom().catch(() => {});
                              }}>
                              <Ionicons name="link-outline" size={16} color={theme.primary} />
                              <Text style={{ color: theme.primary, fontWeight: '700', fontSize: 12 }}>{t('remote.reconnect')}</Text>
                            </TouchableOpacity>
                          </View>
                        )}

                        <Text style={[styles.connectEmptySubtext, { marginTop: 8, textAlign: 'center' }]}>
                          {t('remote.room_hint')}
                        </Text>
                      </View>
                    )
                  )}

                  {/* Client Section: Bir Odaya Bağlan */}
                  <View style={[styles.connectRoomCard, { backgroundColor: theme.surface }]}>
                    <Text style={[styles.connectSectionLabel, { color: theme.textAccent, marginBottom: 6 }]}>
                      {t('remote.join_room_title')}
                    </Text>

                    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                      <TextInput
                        style={[
                          styles.connectInput,
                          {
                            flex: 1,
                            textTransform: 'uppercase',
                            letterSpacing: 2,
                            fontWeight: '700',
                          },
                        ]}
                        placeholder="8284"
                        placeholderTextColor="#71717a"
                        keyboardType="number-pad"
                        maxLength={8}
                        value={inputRoomCode}
                        onChangeText={(t) => setInputRoomCode(t.toUpperCase().replace(/^RUN-/, ''))}
                      />
                      <TouchableOpacity
                        style={[
                          styles.connectRoomBtn,
                          {
                            backgroundColor: inputRoomCode.trim().length > 0 ? theme.primary : '#3f3f46',
                            paddingHorizontal: 16,
                            flex: 0,
                          },
                        ]}
                        activeOpacity={0.8}
                        disabled={
                          inputRoomCode.trim().length === 0 ||
                          (remoteMode === 'client' && remoteConnectionStatus === 'connecting')
                        }
                        onPress={() => {
                          const cleanCode = inputRoomCode.trim().replace(/^RUN-/, '');
                          if (cleanCode) {
                            remoteSyncManager.connectToInternetRoom(cleanCode).catch(() => {});
                          }
                        }}>
                        <Ionicons name="arrow-forward" size={16} color="#ffffff" />
                        <Text style={{ color: '#ffffff', fontWeight: '700', fontSize: 13 }}>
                          {remoteMode === 'client' && remoteConnectionStatus === 'connecting'
                            ? t('remote.status_connecting')
                            : t('remote.connect')}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </ScrollView>
              ) : (
                <>
                  {/* Bölüm Başlığı (Wi-Fi & Bluetooth) */}
                  <View style={styles.connectSectionHeader}>
                    <Text style={[styles.connectSectionLabel, { color: theme.textAccent }]}>
                      {activeTransportTab === 'ble'
                        ? t('remote.nearby_ble_devices')
                        : t('remote.same_wifi_devices')}
                    </Text>
                  </View>

                  {/* Cihazlar Listesi */}
                  <FlatList
                    data={
                      activeTransportTab === 'ble'
                        ? (discoveredBlePeers as any)
                        : (discoveredHosts as any)
                    }
                    keyExtractor={(item) => item.id || item.deviceId}
                    style={styles.connectList}
                    showsVerticalScrollIndicator={false}
                    ListEmptyComponent={
                      <View style={styles.connectEmptyContainer}>
                        <ActivityIndicator size="small" color={theme.primary} style={{ marginBottom: 6 }} />
                        <Text style={styles.connectEmptyTitle}>
                          {activeTransportTab === 'ble'
                            ? t('remote.searching_ble')
                            : t('remote.searching_devices')}
                        </Text>
                        <Text style={styles.connectEmptySubtext}>
                          {activeTransportTab === 'ble'
                            ? t('remote.ble_hint')
                            : t('remote.wifi_hint')}
                        </Text>
                      </View>
                    }
                    renderItem={({ item }) => {
                      const isThisConnected =
                        player.isRemote && connectedDeviceName === item.deviceName;
                      const isConnecting =
                        remoteMode === 'client' &&
                        (remoteConnectionStatus === 'connecting' || remoteConnectionStatus === 'pairing') &&
                        connectedDeviceName === item.deviceName;

                      return (
                        <TouchableOpacity
                          style={[
                            styles.connectDeviceItem,
                            { backgroundColor: theme.surface },
                            isThisConnected && {
                              borderColor: theme.primary,
                              borderWidth: 1.5,
                            },
                          ]}
                          activeOpacity={0.75}
                          onPress={() => handleSelectRemoteHost(item)}>
                          <View
                            style={[
                              styles.connectDeviceIcon,
                              {
                                backgroundColor: isThisConnected
                                  ? `${theme.primary}25`
                                  : 'rgba(255, 255, 255, 0.06)',
                              },
                            ]}>
                            <Ionicons
                              name={
                                item.transport === 'ble' || activeTransportTab === 'ble'
                                  ? 'bluetooth-outline'
                                  : 'laptop-outline'
                              }
                              size={20}
                              color={isThisConnected ? theme.primary : 'rgba(255, 255, 255, 0.7)'}
                            />
                          </View>
                          <View style={{ flex: 1, marginLeft: 10 }}>
                            <Text
                              style={[
                                styles.connectDeviceName,
                                isThisConnected && { color: theme.primary, fontWeight: '700' },
                              ]}
                              numberOfLines={1}>
                              {item.deviceName}
                            </Text>
                            <Text style={styles.connectDeviceSubtext}>
                              {isThisConnected
                                ? t('remote.status_connected')
                                : isConnecting
                                  ? t('remote.status_connecting')
                                  : item.transport === 'ble' || activeTransportTab === 'ble'
                                    ? t('remote.ble_subtext')
                                    : `${item.hostIp}:${item.port}`}
                            </Text>
                          </View>
                          {isConnecting ? (
                            <ActivityIndicator size="small" color={theme.primary} />
                          ) : isThisConnected ? (
                            <Ionicons name="checkmark-circle" size={20} color={theme.primary} />
                          ) : (
                            <Ionicons name="chevron-forward" size={18} color="rgba(255, 255, 255, 0.4)" />
                          )}
                        </TouchableOpacity>
                      );
                    }}
                  />

                  {/* Manuel IP Toggle / Giriş (Sadece Wi-Fi modunda gösterilir) */}
                  {isRemoteServiceEnabled && activeTransportTab === 'wifi' && (
                    showManualIp ? (
                      <View style={[styles.connectManualBox, { backgroundColor: theme.surface }]}>
                        <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
                          <TextInput
                            style={[styles.connectInput, { flex: 2 }]}
                            placeholder={t('remote.ip_placeholder')}
                            placeholderTextColor="#71717a"
                            keyboardType="numbers-and-punctuation"
                            value={manualIp}
                            onChangeText={setManualIp}
                            autoCapitalize="none"
                          />
                          <TextInput
                            style={[styles.connectInput, { flex: 1 }]}
                            placeholder={t('remote.port_placeholder')}
                            placeholderTextColor="#71717a"
                            keyboardType="numeric"
                            value={manualPort}
                            onChangeText={setManualPort}
                          />
                        </View>
                        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
                          <TouchableOpacity
                            style={styles.connectCancelBtn}
                            onPress={() => setShowManualIp(false)}>
                            <Text style={styles.connectCancelText}>{t('common.cancel')}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.connectSubmitBtn, { backgroundColor: theme.primary }]}
                            onPress={handleManualConnect}
                            disabled={!manualIp.trim()}>
                            <Text style={styles.connectSubmitText}>{t('remote.connect')}</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={styles.connectManualToggle}
                        onPress={() => setShowManualIp(true)}>
                        <Ionicons name="add-circle-outline" size={16} color={theme.primary} style={{ marginRight: 6 }} />
                        <Text style={[styles.connectManualToggleText, { color: theme.primary }]}>
                          {t('remote.manual_ip')}
                        </Text>
                      </TouchableOpacity>
                    )
                  )}
                </>
              )}
            </View>
          </Animated.View>
        </Animated.View>

        {/* ALT BÖLÜM: Apple Music Şarkı Bilgileri, Scrubber ve Kontroller */}
        <Animated.View style={[styles.bottomSection, bottomMorphStyle]}>
          {/* Şarkı Başlığı & Sanatçı */}
          <Animated.View style={[styles.metaRow, metaMorphStyle]}>
            <View style={{ flex: 1, marginRight: 14 }}>
              <MarqueeText text={displayTitle || ''} style={styles.trackTitle} />
              <MarqueeText text={displayArtist || ''} style={styles.trackArtist} />
            </View>

            {/* Sözler, Çalma Sırası veya Uyku Zamanlayıcısı Modundayken Sağ Tarafa Animasyonla Yerleşen Küçük Kapak */}
            <Animated.View
              style={miniCoverTransitionStyle}
              pointerEvents={(!isLyricsMode && !isQueueMode && !isSleepTimerMode && !isConnectMode) ? 'none' : 'auto'}>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => {
                  if (isConnectMode) toggleConnectMode();
                  if (isSleepTimerMode) toggleSleepTimerMode();
                  if (isQueueMode) toggleQueueMode();
                  if (isLyricsMode) toggleLyricsMode();
                }}
                style={styles.lyricsMiniCoverBtn}>
                <TrackArtwork
                  uri={currentArtworkUri}
                  trackId={activeTrack?.id}
                  trackUri={(activeTrack as any)?.url}
                  size={52}
                  borderRadius={10}
                  iconSize={26}
                />
              </TouchableOpacity>
            </Animated.View>
          </Animated.View>

          {/* İlerleme Çubuğu (Apple Music Scrubber) */}
          <View style={styles.scrubberBox}>
            <View
              style={styles.progressTouchContainer}
              onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              onResponderGrant={handleSeekGrant}
              onResponderMove={handleSeekMove}
              onResponderRelease={handleSeekRelease}>
              <View
                pointerEvents="none"
                style={[
                  styles.progressBarBackground,
                  {
                    height: isDragging ? 10 : 7,
                  }
                ]}>
                <View
                  style={[
                    styles.progressBarFill,
                    { backgroundColor: theme.primary, width: `${progressPercent * 100}%` },
                  ]}
                />
              </View>
            </View>
            <View style={styles.timeRow}>
              <Text style={styles.timeText}>{formatTime(currentPosition)}</Text>
              <Text style={styles.timeText}>
                {duration > 0 ? formatTime(duration) : '0:00'}
              </Text>
            </View>
          </View>

          {/* Oynatma Kontrolleri (Apple Music Minimalist Glyphs) */}
          <View style={styles.controlsRow}>
            <TouchableOpacity
              style={styles.appleNavBtn}
              onPress={skipPrev}
              onLongPress={handleSeekBackward}
              hitSlop={{ top: 18, bottom: 18, left: 16, right: 16 }}
              activeOpacity={0.65}>
              <Ionicons name="play-skip-back" size={38} color="#ffffff" />
            </TouchableOpacity>

            <Animated.View style={{ transform: [{ scale: playBtnScale }] }}>
              <TouchableOpacity
                style={styles.applePlayBtn}
                activeOpacity={0.85}
                onPressIn={handlePlayPressIn}
                onPressOut={handlePlayPressOut}
                hitSlop={{ top: 18, bottom: 18, left: 18, right: 18 }}
                onPress={togglePlayback}>
                <Ionicons
                  name={playing ? 'pause' : 'play'}
                  size={52}
                  color="#ffffff"
                  style={!playing ? { marginLeft: 4 } : undefined}
                />
              </TouchableOpacity>
            </Animated.View>

            <TouchableOpacity
              style={styles.appleNavBtn}
              onPress={skipNext}
              onLongPress={handleSeekForward}
              hitSlop={{ top: 18, bottom: 18, left: 16, right: 16 }}
              activeOpacity={0.65}>
              <Ionicons name="play-skip-forward" size={38} color="#ffffff" />
            </TouchableOpacity>
          </View>

          {/* Apple Music Alt Araç Çubuğu (Lyrics | Shuffle/Repeat | Queue) */}
          <View style={styles.appleBottomRow}>
            {/* Şarkı Sözleri Butonu */}
            <TouchableOpacity
              style={[
                styles.appleUtilBtn,
                isLyricsMode && {
                  backgroundColor: theme.surface,
                  borderWidth: 1,
                  borderColor: theme.border,
                },
              ]}
              activeOpacity={0.7}
              hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
              onPress={toggleLyricsMode}>
              <Ionicons
                name="chatbubble-ellipses"
                size={22}
                color={isLyricsMode ? theme.primary : 'rgba(255, 255, 255, 0.55)'}
              />
            </TouchableOpacity>

            {/* Orta: Karışık ve Tekrar Kontrolleri (Tek Buton) + Uyku Zamanlayıcısı */}
            <View style={styles.appleCenterUtilRow}>
              <TouchableOpacity
                style={styles.appleSubUtilBtn}
                onPress={togglePlaybackMode}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons
                  name={isShuffle ? (isSmartShuffle ? 'sparkles' : 'shuffle') : 'repeat'}
                  size={20}
                  color={theme.primary}
                />
                {repeatMode === RepeatMode.Track ? (
                  <Text style={[styles.repeatBadge, { color: theme.primary }]}>1</Text>
                ) : null}
              </TouchableOpacity>

              {/* RunMusic Connecto Butonu (Shuffle ile Sleep Timer arasında) */}
              <TouchableOpacity
                style={[
                  styles.appleSubUtilBtn,
                  isConnectMode && {
                    backgroundColor: theme.surface,
                    borderRadius: 20,
                  },
                ]}
                onPress={toggleConnectMode}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                {remoteMode !== 'client' && connectedClients.length > 0 && (
                  <View style={styles.connectClientsBadgeWrapper} pointerEvents="none">
                    <View style={[styles.connectClientsBadge, { backgroundColor: theme.primary }]}>
                      <Text style={styles.connectClientsBadgeText}>
                        {connectedClients.length}
                      </Text>
                    </View>
                  </View>
                )}
                <Ionicons
                  name={isRemoteServiceEnabled || player.isRemote ? 'radio' : 'radio-outline'}
                  size={20}
                  color={
                    isRemoteServiceEnabled || player.isRemote
                      ? theme.primary
                      : isConnectMode
                        ? '#ffffff'
                        : 'rgba(255, 255, 255, 0.45)'
                  }
                />
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.appleSubUtilBtn,
                  isSleepTimerMode && {
                    backgroundColor: theme.surface,
                    borderRadius: 20,
                  },
                ]}
                onPress={toggleSleepTimerMode}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons
                  name={isSleepTimerActive ? 'moon' : 'moon-outline'}
                  size={20}
                  color={
                    isSleepTimerActive
                      ? theme.primary
                      : isSleepTimerMode
                        ? '#ffffff'
                        : 'rgba(255, 255, 255, 0.5)'
                  }
                />
              </TouchableOpacity>
            </View>

            {/* Çalma Sırası Butonu */}
            <TouchableOpacity
              style={[
                styles.appleUtilBtn,
                isQueueMode && {
                  backgroundColor: theme.surface,
                  borderWidth: 1,
                  borderColor: theme.border,
                },
              ]}
              activeOpacity={0.7}
              hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
              onPress={toggleQueueMode}>
              <Ionicons
                name="list"
                size={22}
                color={isQueueMode ? theme.primary : 'rgba(255, 255, 255, 0.55)'}
              />
            </TouchableOpacity>
          </View>
        </Animated.View>

        {/* Manuel Söz Arama Modalı */}
        <Modal
          visible={isManualSearchOpen}
          animationType="fade"
          transparent
          onRequestClose={() => setIsManualSearchOpen(false)}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setIsManualSearchOpen(false)}
            {...searchModalPanResponder.panHandlers}>
            <Pressable style={styles.searchModalBox} onPress={(e) => e.stopPropagation()}>
              <View style={styles.searchModalHeader}>
                <Text style={styles.searchModalTitle}>{t('player.search_lyrics_modal_title')}</Text>
                <TouchableOpacity onPress={() => setIsManualSearchOpen(false)}>
                  <Ionicons name="close" size={22} color="#a1a1aa" />
                </TouchableOpacity>
              </View>

              <View style={styles.searchModalInputRow}>
                <TextInput
                  style={styles.searchModalInput}
                  placeholder={t('player.search_lyrics_placeholder')}
                  placeholderTextColor="#71717a"
                  value={manualQuery}
                  onChangeText={setManualQuery}
                  onSubmitEditing={handleManualSearch}
                  returnKeyType="search"
                  autoFocus
                />
                <TouchableOpacity
                  style={[styles.searchModalSubmitBtn, { backgroundColor: theme.primary }]}
                  onPress={handleManualSearch}
                  disabled={isSearchingCandidates}>
                  {isSearchingCandidates ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Ionicons name="search" size={18} color="#ffffff" />
                  )}
                </TouchableOpacity>
              </View>

              <Text style={styles.candidatesSectionTitle}>{t('player.search_results_title')}</Text>

              {candidatesList.length > 0 ? (
                <FlatList
                  data={candidatesList}
                  keyExtractor={(item) => item.id}
                  style={{ maxHeight: 280 }}
                  renderItem={({ item }) => {
                    const isSelected =
                      (currentLyrics?.selectedCandidateId && currentLyrics.selectedCandidateId === item.id) ||
                      (currentLyrics?.id && currentLyrics.id === item.id) ||
                      (currentLyrics?.source === item.source &&
                        currentLyrics?.trackName?.trim().toLowerCase() === item.trackName?.trim().toLowerCase() &&
                        currentLyrics?.artistName?.trim().toLowerCase() === item.artistName?.trim().toLowerCase() &&
                        Boolean(currentLyrics?.syncedLyrics || currentLyrics?.lyricsfile) === Boolean(item.syncedLyrics || item.lyricsfile));

                    return (
                      <TouchableOpacity
                        style={[
                          styles.candidateRow,
                          isSelected && [
                            styles.candidateRowSelected,
                            { borderColor: theme.primary, backgroundColor: `${theme.primary}20` },
                          ],
                        ]}
                        activeOpacity={0.7}
                        onPress={() => handleSelectCandidate(item)}>
                        <View style={{ flex: 1, marginRight: 8 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
                            <Text
                              style={[
                                styles.candidateTrack,
                                isSelected && { color: theme.primary, fontWeight: '700' },
                              ]}
                              numberOfLines={1}>
                              {item.trackName}
                            </Text>
                            {isSelected ? (
                              <View style={[styles.candidateSelectedBadge, { backgroundColor: theme.primary }]}>
                                <Ionicons name="checkmark-sharp" size={10} color="#ffffff" style={{ marginRight: 2 }} />
                                <Text style={styles.candidateSelectedBadgeText}>{t('player.candidate_selected')}</Text>
                              </View>
                            ) : null}
                          </View>
                          <Text style={styles.candidateArtist} numberOfLines={1}>
                            {item.artistName}
                          </Text>
                        </View>
                        <View style={styles.candidateBadgeBox}>
                          {item.hasWordSync ? (
                            <View style={[styles.candidateSyncedBadge, { backgroundColor: '#10b981' }]}>
                              <Text style={styles.candidateSyncedBadgeText}>WORD SYNC ✨</Text>
                            </View>
                          ) : item.hasSynced ? (
                            <View style={[styles.candidateSyncedBadge, { backgroundColor: theme.primary }]}>
                              <Text style={styles.candidateSyncedBadgeText}>SYNC</Text>
                            </View>
                          ) : (
                            <View style={[styles.candidateSyncedBadge, { backgroundColor: 'rgba(255, 255, 255, 0.12)' }]}>
                              <Text style={[styles.candidateSyncedBadgeText, { color: '#a1a1aa' }]}>{t('player.plain_lyrics_badge')}</Text>
                            </View>
                          )}
                          <Text style={styles.candidateSourceText}>
                            {item.source.toUpperCase()}
                          </Text>
                        </View>
                        {resolvingCandidateId === item.id ? (
                          <ActivityIndicator
                            size="small"
                            color={theme.primary}
                            style={{ marginLeft: 8 }}
                          />
                        ) : null}
                      </TouchableOpacity>
                    );
                  }}
                />
              ) : (
                <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                  <Text style={{ color: '#71717a', fontSize: 14 }}>
                    {isSearchingCandidates ? t('player.searching_candidates') : t('player.search_candidates_hint')}
                  </Text>
                </View>
              )}
            </Pressable>
          </Pressable>
        </Modal>

        {/* Seçenekler Modalı */}
        <Modal
          visible={isOptionsModalOpen}
          animationType="fade"
          transparent
          onRequestClose={() => setIsOptionsModalOpen(false)}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setIsOptionsModalOpen(false)}
            {...optionsModalPanResponder.panHandlers}>
            <Pressable style={styles.optionsModalBox} onPress={(e) => e.stopPropagation()}>
              {player.isRemote ? (
                <>
                  <TouchableOpacity
                    style={styles.optionsModalRow}
                    onPress={() => {
                      setIsOptionsModalOpen(false);
                      toggleConnectMode();
                    }}>
                    <Ionicons name="swap-horizontal-outline" size={24} color="#ffffff" style={{ marginRight: 16 }} />
                    <Text style={styles.optionsModalText}>{t('player.options_change_device')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.optionsModalRow}
                    onPress={() => {
                      setIsOptionsModalOpen(false);
                      player.disconnect();
                    }}>
                    <Ionicons name="close-circle-outline" size={24} color="#ef4444" style={{ marginRight: 16 }} />
                    <Text style={[styles.optionsModalText, { color: '#ef4444' }]}>{t('remote.disconnect')}</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  {isRemoteStream && (
                    <TouchableOpacity
                      style={styles.optionsModalRow}
                      onPress={() => {
                        setIsOptionsModalOpen(false);
                        handleDownloadCurrentTrack();
                      }}>
                      <Ionicons
                        name={isCurrentTrackDownloaded ? 'checkmark-circle-outline' : 'download-outline'}
                        size={24}
                        color={isCurrentTrackDownloaded ? '#10b981' : theme.primary}
                        style={{ marginRight: 16 }}
                      />
                      <Text style={[styles.optionsModalText, { color: isCurrentTrackDownloaded ? '#10b981' : theme.primary }]}>
                        {isCurrentTrackDownloaded
                          ? t('player.track_downloaded_custom')
                          : isCurrentTrackDownloading
                          ? t('player.track_downloading')
                          : t('player.download_current_track')}
                      </Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={styles.optionsModalRow}
                    onPress={() => {
                      setIsOptionsModalOpen(false);
                      toggleConnectMode();
                    }}>
                    <Ionicons name="radio-outline" size={24} color="#ffffff" style={{ marginRight: 16 }} />
                    <Text style={styles.optionsModalText}>RunMusic Connecto</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.optionsModalRow}
                    onPress={() => {
                      setIsOptionsModalOpen(false);
                      loadLyricsForTrack(displayTitle, displayArtist !== unknownArtist && displayArtist !== 'Bilinmeyen Sanatçı' ? displayArtist : '', true);
                    }}>
                    <Ionicons name="refresh-outline" size={24} color="#ffffff" style={{ marginRight: 16 }} />
                    <Text style={styles.optionsModalText}>{t('player.options_refetch_lyrics')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.optionsModalRow}
                    onPress={() => {
                      setIsOptionsModalOpen(false);
                      setIsEditTrackModalOpen(true);
                    }}>
                    <Ionicons name="pencil-outline" size={24} color="#ffffff" style={{ marginRight: 16 }} />
                    <Text style={styles.optionsModalText}>{t('player.options_edit_info')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.optionsModalRow}
                    onPress={handleHideTrack}>
                    <Ionicons name="eye-off-outline" size={24} color="#ffffff" style={{ marginRight: 16 }} />
                    <Text style={styles.optionsModalText}>{t('player.options_hide_track')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.optionsModalRow}
                    onPress={handleDeleteTrack}>
                    <Ionicons name="trash-outline" size={24} color="#ef4444" style={{ marginRight: 16 }} />
                    <Text style={[styles.optionsModalText, { color: '#ef4444' }]}>{t('player.options_delete_track')}</Text>
                  </TouchableOpacity>
                </>
              )}
            </Pressable>
          </Pressable>
        </Modal>

        {/* Şarkı Bilgilerini Düzenleme Modalı */}
        <EditTrackModal
          visible={isEditTrackModalOpen && !player.isRemote && localActiveTrack != null}
          track={
            localActiveTrack
              ? {
                  id: resolvedTrackId || localActiveTrack.id || localActiveTrack.url,
                  uri: currentAsset?.uri || localActiveTrack.url,
                  title: activeMeta?.title || displayTitle,
                  artist: activeMeta?.artist || (displayArtist !== unknownArtist && displayArtist !== 'Bilinmeyen Sanatçı' ? displayArtist : ''),
                  album: activeMeta?.album,
                  artwork: currentArtworkUri,
                  originalArtwork: currentAsset?.id ? artworkMap[currentAsset.id] : null,
                }
              : null
          }
          onClose={() => setIsEditTrackModalOpen(false)}
        />

        {/* Dinamik Renk Keşif Kartı (Snackbar) */}
        {!isDynamicColorUnlocked && !isDevModeActive && !hasDismissedDynamicColorBanner && !isLyricsMode && !isQueueMode && !isSleepTimerMode && !isConnectMode && (
          <View
            style={[
              styles.dynamicThemeBanner,
              { bottom: Math.max(insets.bottom, 16) + 4 },
            ]}>
            <View style={styles.dynamicThemeBannerIconBox}>
              <Ionicons name="sparkles" size={16} color="#f59e0b" />
            </View>
            <View style={styles.dynamicThemeBannerTextBox}>
              <Text style={styles.dynamicThemeBannerTitle}>
                {t('settings.dynamic_theme_banner_title')}
              </Text>
              <Text style={styles.dynamicThemeBannerDesc} numberOfLines={1}>
                {t('settings.dynamic_theme_banner_desc')}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.dynamicThemeBannerUnlockBtn}
              activeOpacity={0.8}
              onPress={handleUnlockDynamicColorFromBanner}>
              {isLoadingDynamicAd ? (
                <ActivityIndicator size="small" color="#000000" />
              ) : (
                <>
                  <Ionicons name="play" size={10} color="#000000" />
                  <Text style={styles.dynamicThemeBannerUnlockText}>
                    {t('settings.dynamic_theme_banner_unlock')}
                  </Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.dynamicThemeBannerCloseBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              onPress={dismissDynamicColorBanner}>
              <Ionicons name="close" size={18} color="rgba(255, 255, 255, 0.6)" />
            </TouchableOpacity>
          </View>
        )}

      </View>
  );
}

const styles = StyleSheet.create({
  fullscreenContainer: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'space-between',
  },
  backdropOverlay: {
    backgroundColor: 'rgba(10, 10, 14, 0.88)',
  },
  topGrabberContainer: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 6,
  },
  topGrabberBar: {
    width: 38,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 6,
  },
  headerIconBtn: {
    padding: 6,
  },
  headerTitleBox: {
    alignItems: 'center',
    maxWidth: '70%',
  },
  headerSmallLabel: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 2,
  },
  remoteHeaderDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10b981',
  },
  headerSmallLabelRemote: {
    color: '#10b981',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  headerAlbumName: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  middleContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    overflow: 'hidden',
    position: 'relative',
  },
  coverCenterBox: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  artworkWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.55,
    shadowRadius: 24,
    elevation: 20,
  },
  neighborArtworkWrapper: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.45,
    shadowRadius: 20,
    elevation: 16,
  },
  swipeHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 18,
    marginTop: 18,
  },
  swipeHintText: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 12,
    fontWeight: '500',
  },
  lyricsCardContainer: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 8,
    right: 8,
    alignSelf: 'stretch',
    borderRadius: 24,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
  },
  lyricsCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  lyricsSourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  lyricsSourceText: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 11,
    fontWeight: '600',
  },
  lyricsActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 12,
  },
  lyricsActionBtnText: {
    fontSize: 11,
    fontWeight: '600',
    marginLeft: 3,
  },
  lyricsSearchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 12,
  },
  lyricsSearchBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
    marginLeft: 3,
  },
  lyricsListContent: {
    paddingVertical: 24,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  lyricRow: {
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  lyricRowActive: {
    transform: [{ scale: 1.02 }],
  },
  lyricText: {
    color: 'rgba(255, 255, 255, 0.35)',
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 32,
    textAlign: 'center',
  },
  lyricTextActive: {
    color: '#ffffff',
    fontSize: 27,
    fontWeight: '800',
    lineHeight: 38,
    textAlign: 'center',
    textShadowColor: 'rgba(255, 255, 255, 0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
  lyricWordSung: {
    color: '#ffffff',
    fontWeight: '800',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 10,
  },
  lyricWordUpcoming: {
    color: 'rgba(255, 255, 255, 0.38)',
    fontWeight: '600',
    textShadowRadius: 0,
  },
  plainLyricsScroll: {
    flex: 1,
    width: '100%',
  },
  plainLyricsText: {
    color: '#e4e4e7',
    fontSize: 16,
    lineHeight: 28,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  lyricsLoadingCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lyricsLoadingText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 14,
    marginTop: 12,
  },
  lyricsEmptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  lyricsEmptyTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 12,
  },
  lyricsEmptySubtitle: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 16,
  },
  lyricsEmptySearchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#27272a',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  lyricsEmptySearchBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  bottomSection: {
    paddingHorizontal: 24,
    paddingTop: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  trackTitle: {
    color: '#ffffff',
    fontSize: 23,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  trackArtist: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 17,
    fontWeight: '500',
    marginTop: 2,
  },
  metaActionBtn: {
    padding: 6,
  },
  lyricsMiniCoverBtn: {
    borderRadius: 10,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 8,
    elevation: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  scrubberBox: {
    marginBottom: 6,
  },
  progressTouchContainer: {
    height: 40,
    justifyContent: 'center',
  },
  progressBarBackground: {
    height: 7,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  // progressKnob removed
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 3,
  },
  timeText: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 12,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    marginVertical: 12,
  },
  appleNavBtn: {
    width: 56,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
  },
  applePlayBtn: {
    width: 72,
    height: 72,
    justifyContent: 'center',
    alignItems: 'center',
  },
  appleBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    marginTop: 4,
  },
  appleUtilBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  appleUtilBtnActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  appleCenterUtilRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  appleSubUtilBtn: {
    padding: 8,
    position: 'relative',
  },
  repeatBadge: {
    position: 'absolute',
    right: 2,
    top: 2,
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '900',
  },
  connectClientsBadgeWrapper: {
    position: 'absolute',
    top: 1,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  connectClientsBadge: {
    minWidth: 15,
    height: 15,
    borderRadius: 7.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  connectClientsBadgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '800',
    textAlign: 'center',
    includeFontPadding: false,
    lineHeight: 11,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  searchModalBox: {
    width: '100%',
    backgroundColor: '#18181b',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  sleepTimerCardContainer: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 8,
    right: 8,
    alignSelf: 'stretch',
    borderRadius: 24,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 4,
  },
  sleepTimerBody: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  sleepTimerActiveBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 8,
  },
  sleepTimerActiveBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  sleepTimerIconBubble: {
    width: 36,
    height: 36,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sleepTimerActiveBarTitle: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  sleepTimerActiveBarRemaining: {
    fontSize: 15.5,
    fontWeight: '700',
  },
  stopTimerPillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.16)',
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 10,
  },
  stopTimerPillBtnText: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '700',
  },
  sleepTimerSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 6,
    marginTop: 2,
    paddingHorizontal: 2,
  },
  timerOptionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  timerOptionBtn: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#27272a',
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  timerOptionText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  timerFullWidthBtn: {
    flexDirection: 'row',
    backgroundColor: '#27272a',
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  customTimerRow: {
    flexDirection: 'row',
    gap: 8,
  },
  customTimerInput: {
    flex: 1,
    backgroundColor: '#27272a',
    borderRadius: 12,
    color: '#ffffff',
    paddingHorizontal: 14,
    fontSize: 14,
    height: 48,
  },
  customTimerBtn: {
    paddingHorizontal: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    height: 48,
  },
  customTimerBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  optionsModalBox: {
    width: '80%',
    backgroundColor: '#18181b',
    borderRadius: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  optionsModalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  optionsModalText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '500',
  },
  searchModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  searchModalTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  searchModalInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  searchModalInput: {
    flex: 1,
    height: 44,
    backgroundColor: '#27272a',
    borderRadius: 12,
    paddingHorizontal: 14,
    color: '#ffffff',
    fontSize: 14,
    marginRight: 10,
  },
  searchModalSubmitBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#27272a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  candidatesSectionTitle: {
    color: '#a1a1aa',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 10,
  },
  candidateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginVertical: 3,
    borderWidth: 1,
    borderColor: '#27272a',
    backgroundColor: '#18181b',
  },
  candidateRowSelected: {
    borderWidth: 1.5,
  },
  candidateSelectedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 6,
  },
  candidateSelectedBadgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  candidateTrack: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  candidateArtist: {
    color: '#a1a1aa',
    fontSize: 12,
    marginTop: 2,
  },
  candidateBadgeBox: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  candidateSyncedBadge: {
    backgroundColor: '#10b981',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginRight: 6,
  },
  candidateSyncedBadgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '800',
  },
  candidateSourceText: {
    color: '#71717a',
    fontSize: 11,
    fontWeight: '600',
  },
  queueCardContainer: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 8,
    right: 8,
    alignSelf: 'stretch',
    borderRadius: 24,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 4,
  },
  queueCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 4,
  },
  queueSourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  queueSourceText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  queueLocateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 12,
  },
  queueLocateBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  queueCardCloseBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueScrollContent: {
    paddingBottom: 24,
  },
  queueSectionTitle: {
    color: '#71717a',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    paddingHorizontal: 8,
    paddingTop: 14,
    paddingBottom: 6,
  },
  queueRemoveAction: {
    width: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    marginVertical: 2,
  },
  queuePromoteAction: {
    width: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    marginVertical: 2,
  },
  queuePromoteText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  upNextSectionWrapper: {
    marginVertical: 4,
  },
  upNextSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingRight: 8,
  },
  clearUpNextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  clearUpNextText: {
    color: '#ef4444',
    fontSize: 11,
    fontWeight: '700',
  },
  queueExtBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    marginRight: 6,
  },
  queueExtBadgeText: {
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 9,
    fontWeight: '600',
  },
  queueQuickPromoteBtn: {
    padding: 6,
    marginLeft: 6,
  },
  queueItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 12,
    marginVertical: 2,
  },
  queueItemActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  queueIndex: {
    color: '#71717a',
    width: 26,
    fontSize: 13,
    fontWeight: '600',
  },
  queueIndexActive: {
    color: '#ffffff',
  },
  queueTrackInfo: {
    flex: 1,
    marginHorizontal: 10,
  },
  queueTrackTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  queueTrackTitleActive: {
    color: '#ffffff',
  },
  queueTrackArtist: {
    color: '#71717a',
    fontSize: 12,
    marginTop: 2,
  },
  dynamicThemeBanner: {
    position: 'absolute',
    left: 14,
    right: 14,
    backgroundColor: '#18181b',
    borderWidth: 1.2,
    borderColor: 'rgba(245, 158, 11, 0.45)',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 999,
  },
  dynamicThemeBannerIconBox: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dynamicThemeBannerTextBox: {
    flex: 1,
  },
  dynamicThemeBannerTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  dynamicThemeBannerDesc: {
    color: '#a1a1aa',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 1,
  },
  dynamicThemeBannerUnlockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f59e0b',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
  },
  dynamicThemeBannerUnlockText: {
    color: '#000000',
    fontSize: 11,
    fontWeight: '800',
  },
  dynamicThemeBannerCloseBtn: {
    padding: 4,
    marginLeft: 2,
  },
  connectCardContainer: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 8,
    right: 8,
    alignSelf: 'stretch',
    borderRadius: 24,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 4,
  },
  connectBody: {
    flex: 1,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  connectSegmentContainer: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 3,
    marginBottom: 8,
  },
  connectSegmentTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    borderRadius: 10,
  },
  connectSegmentText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    fontWeight: '600',
  },
  connectDeviceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 14,
    marginBottom: 6,
  },
  connectDeviceIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectDeviceName: {
    fontSize: 13.5,
    fontWeight: '600',
    color: '#ffffff',
  },
  connectDeviceSubtext: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: 1,
  },
  connectSectionHeader: {
    marginTop: 6,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  connectSectionLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  connectList: {
    flex: 1,
  },
  connectEmptyContainer: {
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  connectEmptyTitle: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 4,
  },
  connectEmptySubtext: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.5)',
    textAlign: 'center',
    lineHeight: 15,
  },
  connectManualToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  connectManualToggleText: {
    fontSize: 12,
    fontWeight: '600',
  },
  connectManualBox: {
    padding: 10,
    borderRadius: 14,
    marginTop: 4,
  },
  connectInput: {
    height: 38,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 10,
    color: '#ffffff',
    fontSize: 12,
  },
  connectCancelBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  connectCancelText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  connectSubmitBtn: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  connectSubmitText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ffffff',
  },
  connectKickBtn: {
    padding: 6,
    marginLeft: 8,
  },
  connectRoomCard: {
    padding: 12,
    borderRadius: 14,
    marginBottom: 8,
  },
  connectRoomCodeBadge: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 2,
    textAlign: 'center',
    marginVertical: 6,
  },
  connectRoomActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  connectRoomBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: 10,
    gap: 6,
  },
  connectRecentPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginRight: 8,
  },
});

// Parent re-renders (progress ticks in ExpandingPlayer) must not re-render the
// entire fullscreen player tree. Internal store subscriptions still update it.
export const FullscreenPlayerModal = React.memo(FullscreenPlayerModalImpl);
