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
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import TrackPlayer, {
  useActiveTrack,
  useIsPlaying,
  useProgress,
  RepeatMode,
  Track,
} from 'react-native-track-player';
import { useStore } from '../store/useStore';
import { usePlayerUIStore } from '../store/usePlayerUIStore';
import { useThemeStore } from '../store/useThemeStore';
import { TrackArtwork } from './TrackArtwork';
import {
  LyricLine,
  LyricsResult,
  LyricsCandidate,
  fetchLyricsOnline,
  searchLrclib,
  searchAllCandidates,
  resolveCandidateToLyricsResult,
  parseLRC,
  getLyricsCacheKeys,
  cleanYouTubeTitle,
  getSearchKeywords,
} from '../services/lyricsService';
import { saveLastPlayback } from '../services/playbackStorage';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const ARTWORK_SIZE = Math.min(SCREEN_WIDTH - 56, 350);

function getRandomIndex(length: number): number {
  return Math.floor(Math.random() * length);
}

export function FullscreenPlayerModal() {
  const { isFullscreenPlayerOpen, closeFullscreenPlayer, isLyricsMode, toggleLyricsMode } =
    usePlayerUIStore();

  const theme = useThemeStore((s) => s.theme);
  const activeTrack = useActiveTrack();
  const { playing } = useIsPlaying();
  const progress = useProgress(250);

  const isShuffle = useStore((s) => s.isShuffle);
  const setIsShuffle = useStore((s) => s.setIsShuffle);
  const repeatMode = useStore((s) => s.repeatMode);
  const setRepeatMode = useStore((s) => s.setRepeatMode);
  const artworkMap = useStore((s) => s.artworkMap);
  const metadataMap = useStore((s) => s.metadataMap);
  const lyricsCache = useStore((s) => s.lyricsCache);
  const setLyrics = useStore((s) => s.setLyrics);
  const getLyricsFromCache = useStore((s) => s.getLyricsFromCache);

  const [barWidth, setBarWidth] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragTime, setDragTime] = useState(0);

  // Queue Sheet state
  const [isQueueModalOpen, setIsQueueModalOpen] = useState(false);
  const [queue, setQueue] = useState<Track[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(0);

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

  const activeMeta = activeTrack?.id ? metadataMap[activeTrack.id] : undefined;
  const activeKeywords = getSearchKeywords(activeTrack?.title || '', activeTrack?.artist || '');
  const rawArtist =
    (activeMeta?.artist?.trim() && activeMeta.artist !== 'Local Audio' && activeMeta.artist !== 'Bilinmeyen Sanatçı'
      ? cleanYouTubeTitle(activeMeta.artist)
      : '') ||
    (activeKeywords.expectedArtist && activeKeywords.expectedArtist !== 'Local Audio' && activeKeywords.expectedArtist !== 'Bilinmeyen Sanatçı'
      ? activeKeywords.expectedArtist
      : (activeTrack?.artist && activeTrack.artist !== 'Local Audio' && activeTrack.artist !== 'Bilinmeyen Sanatçı'
          ? cleanYouTubeTitle(activeTrack.artist)
          : 'Bilinmeyen Sanatçı'));

  const rawTitle =
    (activeMeta?.title?.trim() ? cleanYouTubeTitle(activeMeta.title) : '') ||
    activeKeywords.expectedTrack ||
    cleanYouTubeTitle(activeTrack?.title || '') ||
    'Bilinmeyen Parça';

  const displayArtist = rawArtist;
  const displayTitle = rawTitle;

  const currentArtworkUri =
    (activeTrack?.id ? metadataMap[activeTrack.id]?.artwork || artworkMap[activeTrack.id] : undefined) ||
    (typeof activeTrack?.artwork === 'string' ? activeTrack.artwork : undefined);

  // Önceki ve sonraki şarkıyı belirleme (Kapak geçiş önizlemesi için)
  const prevTrack = useMemo(() => {
    if (queue.length <= 1) return null;
    if (activeIndex > 0) return queue[activeIndex - 1];
    if (repeatMode === RepeatMode.Queue) return queue[queue.length - 1];
    return null;
  }, [queue, activeIndex, repeatMode]);

  const nextTrack = useMemo(() => {
    if (queue.length <= 1) return null;
    if (activeIndex < queue.length - 1) return queue[activeIndex + 1];
    if (repeatMode === RepeatMode.Queue) return queue[0];
    return null;
  }, [queue, activeIndex, repeatMode]);

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

  // Metadata check (tek seferlik ref korumalı)
  const updatedMetadataTrackIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeTrack && activeIndex >= 0) {
      const trackId = activeTrack.id || activeTrack.url;
      if (updatedMetadataTrackIdRef.current === trackId) {
        return;
      }

      const meta = activeTrack.id ? metadataMap[activeTrack.id] : undefined;
      const needsArtwork = !activeTrack.artwork && (meta?.artwork || (activeTrack.id && artworkMap[activeTrack.id]));
      const needsTitle = meta?.title && activeTrack.title !== meta.title;
      const needsArtist = meta?.artist && meta.artist !== 'Local Audio' && activeTrack.artist !== meta.artist;

      if (needsArtwork || needsTitle || needsArtist) {
        updatedMetadataTrackIdRef.current = trackId;
        TrackPlayer.updateMetadataForTrack(activeIndex, {
          ...(needsArtwork ? { artwork: meta?.artwork || artworkMap[activeTrack.id] } : {}),
          ...(needsTitle ? { title: meta!.title } : {}),
          ...(needsArtist ? { artist: meta!.artist } : {}),
        }).catch(() => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTrack?.id, activeTrack?.url, activeIndex]);

  const currentLyrics: LyricsResult | null = useMemo(() => {
    if (!activeTrack || !lyricsCache) return null;
    const item = getLyricsFromCache({
      id: activeTrack.id,
      url: activeTrack.url,
      title: displayTitle,
      artist: displayArtist !== 'Bilinmeyen Sanatçı' ? displayArtist : '',
      rawTitle: activeTrack.title,
    });
    if (!item) return null;
    if (item.syncedLyrics && (!item.parsedLines || item.parsedLines.length === 0)) {
      return {
        ...item,
        parsedLines: parseLRC(item.syncedLyrics),
      };
    }
    return item;
  }, [activeTrack, lyricsCache, getLyricsFromCache, displayTitle, displayArtist]);

  const parsedLines = useMemo(() => {
    if (!currentLyrics) return [];
    if (currentLyrics.parsedLines && currentLyrics.parsedLines.length > 0) {
      return currentLyrics.parsedLines;
    }
    if (currentLyrics.syncedLyrics) {
      return parseLRC(currentLyrics.syncedLyrics);
    }
    return [];
  }, [currentLyrics]);

  const loadLyricsForTrack = async (title: string, artist?: string, force = false) => {
    if (!activeTrack) return;
    const cleanArtist = artist && artist !== 'Local Audio' && artist !== 'Bilinmeyen Sanatçı' ? artist : '';

    if (!force) {
      const cached = getLyricsFromCache({
        id: activeTrack.id,
        url: activeTrack.url,
        title,
        artist: cleanArtist,
        rawTitle: activeTrack.title,
      });

      if (cached && cached.syncedLyrics) {
        if (cached.candidates && cached.candidates.length > 0) {
          setCandidatesList(cached.candidates);
        }
        return;
      }

      if (cached && (!cached.syncedLyrics || cached.source === 'genius')) {
        if (cached.candidates && cached.candidates.length > 0) {
          setCandidatesList(cached.candidates);
        }
        searchLrclib(title, cleanArtist)
          .then((lrclibResult) => {
            if (lrclibResult && (lrclibResult.syncedLyrics || cached.source === 'genius')) {
              if (lrclibResult.candidates && lrclibResult.candidates.length > 0) {
                setCandidatesList(lrclibResult.candidates);
              }
              const altKeys = getLyricsCacheKeys({
                id: activeTrack.id,
                url: activeTrack.url,
                title,
                artist: cleanArtist,
                rawTitle: activeTrack.title,
              });
              const saveId = activeTrack.id || activeTrack.url || title;
              setLyrics(saveId, lrclibResult, altKeys);
            }
          })
          .catch(() => {});
        return;
      }
    }

    setIsLoadingLyrics(true);
    try {
      const result = await fetchLyricsOnline(title, cleanArtist);
      if (result) {
        if (result.candidates && result.candidates.length > 0) {
          setCandidatesList(result.candidates);
        }
        const altKeys = getLyricsCacheKeys({
          id: activeTrack.id,
          url: activeTrack.url,
          title,
          artist: cleanArtist,
          rawTitle: activeTrack.title,
        });
        const saveId = activeTrack.id || activeTrack.url || title;
        setLyrics(saveId, result, altKeys);
      }
    } catch (e) {
      console.warn('Failed to load lyrics', e);
    } finally {
      setIsLoadingLyrics(false);
    }
  };

  useEffect(() => {
    if (activeTrack) {
      const searchArtist = displayArtist !== 'Bilinmeyen Sanatçı' ? displayArtist : '';
      const titleLower = displayTitle.toLowerCase();
      const artistLower = searchArtist.toLowerCase();
      let initialQuery = displayTitle;
      if (searchArtist && !titleLower.includes(artistLower)) {
        initialQuery = `${searchArtist} - ${displayTitle}`;
      }
      setManualQuery(initialQuery);

      const cached = getLyricsFromCache({
        id: activeTrack.id,
        url: activeTrack.url,
        title: displayTitle,
        artist: searchArtist,
        rawTitle: activeTrack.title,
      });

      if (!cached || !cached.syncedLyrics) {
        loadLyricsForTrack(displayTitle, searchArtist, false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTrack?.id, activeTrack?.url, displayTitle, displayArtist]);

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

  useEffect(() => {
    if (
      isFullscreenPlayerOpen &&
      isLyricsMode &&
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
  }, [activeLineIndex, isFullscreenPlayerOpen, isLyricsMode, parsedLines.length]);

  // Düz metin (Genius / LRCLIB plain) şarkı sözlerini şarkının saniyesine göre aşağıya doğru orantılı kaydır
  useEffect(() => {
    if (
      isFullscreenPlayerOpen &&
      isLyricsMode &&
      !currentLyrics?.syncedLyrics &&
      currentLyrics?.plainLyrics &&
      duration > 0 &&
      !isPlainUserScrollingRef.current
    ) {
      const maxScroll = Math.max(0, plainContentHeightRef.current - plainScrollViewHeightRef.current);
      if (maxScroll > 0) {
        const progressRatio = Math.min(1, Math.max(0, progress.position / duration));
        plainLyricsScrollRef.current?.scrollTo({
          y: progressRatio * maxScroll,
          animated: true,
        });
      }
    }
  }, [
    progress.position,
    duration,
    isFullscreenPlayerOpen,
    isLyricsMode,
    currentLyrics?.syncedLyrics,
    currentLyrics?.plainLyrics,
  ]);

  // Şarkı değiştiğinde düz metin kaydırma pozisyonunu sıfırla
  useEffect(() => {
    if (activeTrack) {
      isPlainUserScrollingRef.current = false;
      if (plainScrollTimeoutRef.current) clearTimeout(plainScrollTimeoutRef.current);
      plainLyricsScrollRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [activeTrack]);

  const handleManualSearch = async () => {
    if (!manualQuery.trim() || !activeTrack) return;
    setIsSearchingCandidates(true);
    try {
      const searchArtist = displayArtist !== 'Bilinmeyen Sanatçı' ? displayArtist : '';
      const results = await searchAllCandidates(manualQuery.trim(), searchArtist);
      setCandidatesList(results);
      if (results.length === 0) {
        alert('Eşleşen sonuç bulunamadı.');
      }
    } catch (e) {
      console.warn('Manual lyrics search failed', e);
    } finally {
      setIsSearchingCandidates(false);
    }
  };

  const handleSelectCandidate = async (candidate: LyricsCandidate) => {
    if (!activeTrack) return;
    setResolvingCandidateId(candidate.id);
    try {
      const resolved = await resolveCandidateToLyricsResult(candidate, candidatesList);
      if (resolved) {
        const searchArtist = displayArtist !== 'Bilinmeyen Sanatçı' ? displayArtist : '';
        const altKeys = getLyricsCacheKeys({
          id: activeTrack.id,
          url: activeTrack.url,
          title: displayTitle,
          artist: searchArtist,
          rawTitle: activeTrack.title,
        });
        const saveId = activeTrack.id || activeTrack.url || displayTitle;
        setLyrics(saveId, resolved, altKeys);
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
      const hasLrclibCandidates = currentLyrics?.candidates?.some((c) => c.source === 'lrclib');
      if (hasLrclibCandidates && currentLyrics?.candidates && currentLyrics.candidates.length > 0) {
        setCandidatesList(currentLyrics.candidates);
      } else if (activeTrack) {
        const queryToSearch = manualQuery.trim() || displayTitle;
        setIsSearchingCandidates(true);
        searchAllCandidates(queryToSearch, searchArtist)
          .then((results) => setCandidatesList(results))
          .catch(() => {})
          .finally(() => setIsSearchingCandidates(false));
      }
    }
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
      if (activeTrack && progress.position > 0) {
        saveLastPlayback(
          {
            trackId: activeTrack.id || activeTrack.url,
            trackIndex: activeIndex,
            position: progress.position,
            track: {
              id: activeTrack.id || activeTrack.url,
              url: activeTrack.url,
              title: activeTrack.title,
              artist: activeTrack.artist,
              artwork: typeof activeTrack.artwork === 'string' ? activeTrack.artwork : undefined,
            },
          },
          true
        );
      }
    } else {
      await TrackPlayer.play();
    }
  };

  const artworkScale = useMemo(() => new Animated.Value(1), []);
  const panX = useMemo(() => new Animated.Value(0), []);
  const lyricsTransition = useMemo(() => new Animated.Value(0), []);
  const playBtnScale = useMemo(() => new Animated.Value(1), []);
  const [isSkipping, setIsSkipping] = useState(false);

  const CARD_OFFSET = ARTWORK_SIZE + 24;

  useEffect(() => {
    Animated.spring(artworkScale, {
      toValue: playing ? 1 : 0.88,
      damping: 18,
      mass: 0.9,
      stiffness: 140,
      useNativeDriver: true,
    }).start();
  }, [playing, artworkScale]);

  useEffect(() => {
    Animated.spring(lyricsTransition, {
      toValue: isLyricsMode ? 1 : 0,
      damping: 20,
      mass: 0.9,
      stiffness: 150,
      useNativeDriver: true,
    }).start();
  }, [isLyricsMode, lyricsTransition]);

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

  const skipNext = useCallback(async () => {
    try {
      if (isShuffle) {
        const q = await TrackPlayer.getQueue();
        if (q.length > 1) {
          const currentIndex = await TrackPlayer.getActiveTrackIndex();
          let nextIndex = getRandomIndex(q.length);
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
  }, [isShuffle]);

  const skipPrev = useCallback(async () => {
    try {
      const { position } = await TrackPlayer.getProgress();
      if (position > 3) {
        await TrackPlayer.seekTo(0);
      } else {
        await TrackPlayer.skipToPrevious();
        await TrackPlayer.play();
      }
    } catch (e) {
      console.warn('Skip prev failed', e);
    }
  }, []);

  const toggleRepeat = useCallback(async () => {
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
  }, [repeatMode, setRepeatMode]);

  // Gestures: Middle container (Interactive Carousel Artwork / Lyrics)
  const artworkPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !isLyricsMode && !isSkipping,
        onMoveShouldSetPanResponder: (_, gesture) => {
          if (isLyricsMode || isSkipping) return false;
          return Math.abs(gesture.dx) > 10 || Math.abs(gesture.dy) > 12;
        },
        onPanResponderMove: (_, gesture) => {
          if (isSkipping) return;
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
          if (isSkipping) return;

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
              skipPrev();
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
      isSkipping,
      nextTrack,
      prevTrack,
      panX,
      CARD_OFFSET,
      toggleLyricsMode,
      closeFullscreenPlayer,
      skipNext,
      skipPrev,
    ]
  );

  // Gestures: Top grabber handle - Pull down closes modal
  const headerPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 12,
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy > 30) {
            closeFullscreenPlayer();
          }
        },
      }),
    [closeFullscreenPlayer]
  );

  if (!activeTrack) {
    return null;
  }

  const remainingSeconds = Math.max(0, duration - currentPosition);

  return (
    <Modal
      visible={isFullscreenPlayerOpen}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={closeFullscreenPlayer}>
      <View style={styles.fullscreenContainer}>
        {/* Dynamic Blurred Background based on Cover Art */}
        {currentArtworkUri ? (
          <Image
            source={{ uri: currentArtworkUri }}
            style={StyleSheet.absoluteFill}
            blurRadius={70}
            contentFit="cover"
          />
        ) : null}
        <View style={[StyleSheet.absoluteFill, styles.backdropOverlay]} />
        {/* Subtle Ambient Color Glow from Cover Art */}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.glowColor, opacity: 0.14 }]} />

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
            <Text style={styles.headerSmallLabel}>ŞU AN ÇALIYOR</Text>
            <Text style={styles.headerAlbumName} numberOfLines={1}>
              {displayArtist}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.headerIconBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            onPress={() => setIsQueueModalOpen(true)}>
            <Ionicons name="ellipsis-horizontal-circle" size={24} color="rgba(255, 255, 255, 0.75)" />
          </TouchableOpacity>
        </View>

        {/* ORTA BÖLÜM: Kapak Fotoğrafı Carousel <---> Senkronize Şarkı Sözleri Değişimi */}
        <View style={styles.middleContainer} {...artworkPanResponder.panHandlers}>
          {/* 1. Kapak Carousel Görünümü (Apple Music etkileşimli kenar önizlemeli geçiş) */}
          <Animated.View
            style={[
              styles.coverCenterBox,
              {
                opacity: lyricsTransition.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 0],
                }),
                transform: [
                  {
                    scale: lyricsTransition.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, 0.9],
                    }),
                  },
                ],
              },
            ]}
            pointerEvents={isLyricsMode ? 'none' : 'auto'}>
            {/* Önceki Şarkı Kapağı (Soldan süzülen önizleme) */}
            {prevTrack ? (
              <Animated.View
                style={[
                  styles.neighborArtworkWrapper,
                  {
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
                  },
                ]}
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
              style={[
                styles.artworkWrapper,
                {
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
                },
              ]}>
              <TrackArtwork
                uri={currentArtworkUri}
                trackId={activeTrack.id}
                trackUri={activeTrack.url}
                size={ARTWORK_SIZE}
                borderRadius={18}
                iconSize={84}
              />
            </Animated.View>

            {/* Sonraki Şarkı Kapağı (Sağdan süzülen önizleme) */}
            {nextTrack ? (
              <Animated.View
                style={[
                  styles.neighborArtworkWrapper,
                  {
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
                  },
                ]}
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

            <View style={styles.swipeHintRow}>
              <Ionicons
                name="swap-horizontal"
                size={14}
                color="rgba(255, 255, 255, 0.45)"
                style={{ marginRight: 6 }}
              />
              <Text style={styles.swipeHintText}>Geçiş için kaydırın • Sözler için dokunun</Text>
            </View>
          </Animated.View>

          {/* 2. Senkronize Şarkı Sözleri Görünümü (Yumuşak solma ve büyüme geçişi) */}
          <Animated.View
            style={[
              styles.lyricsCardContainer,
              {
                opacity: lyricsTransition,
                transform: [
                  {
                    scale: lyricsTransition.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.92, 1],
                    }),
                  },
                ],
              },
            ]}
            pointerEvents={isLyricsMode ? 'auto' : 'none'}>
            <View style={styles.lyricsCardHeader}>
              <View style={[styles.lyricsSourceBadge, { backgroundColor: theme.surface }]}>
                <Ionicons
                  name={currentLyrics?.source === 'lrclib' ? 'sparkles' : 'document-text-outline'}
                  size={12}
                  color={theme.primary}
                  style={{ marginRight: 4 }}
                />
                <Text style={[styles.lyricsSourceText, { color: theme.textAccent }]}>
                  {currentLyrics?.syncedLyrics
                    ? 'LRCLIB (Senkronize)'
                    : currentLyrics?.source === 'genius'
                    ? 'Genius (Düz Metin)'
                    : 'Şarkı Sözleri'}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.lyricsSearchBtn}
                activeOpacity={0.7}
                onPress={toggleManualSearch}>
                <Ionicons name="search" size={14} color={theme.primary} />
                <Text style={[styles.lyricsSearchBtnText, { color: theme.primary }]}>Manuel Ara</Text>
              </TouchableOpacity>
            </View>

            {isLoadingLyrics ? (
              <View style={styles.lyricsLoadingCenter}>
                <ActivityIndicator size="large" color={theme.primary} />
                <Text style={styles.lyricsLoadingText}>Sözler aranıyor...</Text>
              </View>
            ) : currentLyrics?.syncedLyrics && parsedLines.length > 0 ? (
              /* Senkronize Söz Akışı (Apple Music Tipografisi) */
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
                      onPress={() => TrackPlayer.seekTo(item.time)}
                      style={[styles.lyricRow, isActive && styles.lyricRowActive]}>
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
                }}>
                <Text style={styles.plainLyricsText}>{currentLyrics.plainLyrics}</Text>
              </ScrollView>
            ) : (
              /* Söz Bulunamadı Durumu */
              <View style={styles.lyricsEmptyState}>
                <Ionicons name="mic-off-outline" size={38} color="#52525b" />
                <Text style={styles.lyricsEmptyTitle}>Şarkı sözü bulunamadı</Text>
                <Text style={styles.lyricsEmptySubtitle}>
                  Farklı bir başlık veya sanatçı ile aramak için butona dokunun
                </Text>
                <TouchableOpacity
                  style={[styles.lyricsEmptySearchBtn, { backgroundColor: theme.primary }]}
                  activeOpacity={0.8}
                  onPress={toggleManualSearch}>
                  <Ionicons name="search" size={16} color="#ffffff" style={{ marginRight: 6 }} />
                  <Text style={styles.lyricsEmptySearchBtnText}>Arama Yap</Text>
                </TouchableOpacity>
              </View>
            )}
          </Animated.View>
        </View>

        {/* ALT BÖLÜM: Apple Music Şarkı Bilgileri, Scrubber ve Kontroller */}
        <View style={styles.bottomSection}>
          {/* Şarkı Başlığı & Sanatçı */}
          <View style={styles.metaRow}>
            <View style={{ flex: 1, marginRight: 16 }}>
              <Text style={styles.trackTitle} numberOfLines={1}>
                {displayTitle}
              </Text>
              <Text style={styles.trackArtist} numberOfLines={1}>
                {displayArtist}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.metaActionBtn}
              activeOpacity={0.7}
              onPress={() => setIsQueueModalOpen(true)}>
              <Ionicons name="star-outline" size={22} color="rgba(255, 255, 255, 0.75)" />
            </TouchableOpacity>
          </View>

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
              <View style={styles.progressBarBackground}>
                <View
                  style={[
                    styles.progressBarFill,
                    { backgroundColor: theme.primary, width: `${progressPercent * 100}%` },
                  ]}
                />
              </View>
              {duration > 0 ? (
                <View
                  style={[
                    styles.progressKnob,
                    {
                      backgroundColor: theme.primaryLight,
                      left: Math.max(0, Math.min(barWidth - 10, barWidth * progressPercent - 5)),
                    },
                  ]}
                />
              ) : null}
            </View>
            <View style={styles.timeRow}>
              <Text style={styles.timeText}>{formatTime(currentPosition)}</Text>
              <Text style={styles.timeText}>
                {duration > 0 ? `-${formatTime(remainingSeconds)}` : '0:00'}
              </Text>
            </View>
          </View>

          {/* Oynatma Kontrolleri (Apple Music Minimalist Glyphs) */}
          <View style={styles.controlsRow}>
            <TouchableOpacity
              style={styles.appleNavBtn}
              onPress={skipPrev}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              activeOpacity={0.65}>
              <Ionicons name="play-skip-back" size={38} color="#ffffff" />
            </TouchableOpacity>

            <Animated.View style={{ transform: [{ scale: playBtnScale }] }}>
              <TouchableOpacity
                style={styles.applePlayBtn}
                activeOpacity={0.85}
                onPressIn={handlePlayPressIn}
                onPressOut={handlePlayPressOut}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
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
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
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
              onPress={toggleLyricsMode}>
              <Ionicons
                name="chatbubble-ellipses"
                size={22}
                color={isLyricsMode ? theme.primary : 'rgba(255, 255, 255, 0.55)'}
              />
            </TouchableOpacity>

            {/* Orta: Karışık ve Tekrar Kontrolleri */}
            <View style={styles.appleCenterUtilRow}>
              <TouchableOpacity
                style={styles.appleSubUtilBtn}
                onPress={() => setIsShuffle(!isShuffle)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons
                  name="shuffle"
                  size={20}
                  color={isShuffle ? theme.primary : 'rgba(255, 255, 255, 0.5)'}
                />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.appleSubUtilBtn}
                onPress={toggleRepeat}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons
                  name="repeat"
                  size={20}
                  color={repeatMode !== RepeatMode.Off ? theme.primary : 'rgba(255, 255, 255, 0.5)'}
                />
                {repeatMode === RepeatMode.Track ? (
                  <Text style={[styles.repeatBadge, { color: theme.primary }]}>1</Text>
                ) : null}
              </TouchableOpacity>
            </View>

            {/* Çalma Sırası Butonu */}
            <TouchableOpacity
              style={[styles.appleUtilBtn, isQueueModalOpen && styles.appleUtilBtnActive]}
              activeOpacity={0.7}
              onPress={() => setIsQueueModalOpen(true)}>
              <Ionicons
                name="list"
                size={22}
                color="rgba(255, 255, 255, 0.55)"
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* Manuel Söz Arama Modalı */}
        <Modal
          visible={isManualSearchOpen}
          animationType="fade"
          transparent
          onRequestClose={() => setIsManualSearchOpen(false)}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setIsManualSearchOpen(false)}>
            <Pressable style={styles.searchModalBox} onPress={(e) => e.stopPropagation()}>
              <View style={styles.searchModalHeader}>
                <Text style={styles.searchModalTitle}>Şarkı Sözü Arama</Text>
                <TouchableOpacity onPress={() => setIsManualSearchOpen(false)}>
                  <Ionicons name="close" size={22} color="#a1a1aa" />
                </TouchableOpacity>
              </View>

              <View style={styles.searchModalInputRow}>
                <TextInput
                  style={styles.searchModalInput}
                  placeholder="Sanatçı - Şarkı Adı..."
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

              <Text style={styles.candidatesSectionTitle}>Arama Sonuçları:</Text>

              {candidatesList.length > 0 ? (
                <FlatList
                  data={candidatesList}
                  keyExtractor={(item) => item.id}
                  style={{ maxHeight: 280 }}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={styles.candidateRow}
                      activeOpacity={0.7}
                      onPress={() => handleSelectCandidate(item)}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.candidateTrack} numberOfLines={1}>
                          {item.trackName}
                        </Text>
                        <Text style={styles.candidateArtist} numberOfLines={1}>
                          {item.artistName}
                        </Text>
                      </View>
                      <View style={styles.candidateBadgeBox}>
                        {item.hasSynced ? (
                          <View style={styles.candidateSyncedBadge}>
                            <Text style={styles.candidateSyncedBadgeText}>SYNC</Text>
                          </View>
                        ) : null}
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
                  )}
                />
              ) : (
                <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                  <Text style={{ color: '#71717a', fontSize: 14 }}>
                    {isSearchingCandidates ? 'Sonuçlar aranıyor...' : 'Arama yapmak için yukarıya yazın.'}
                  </Text>
                </View>
              )}
            </Pressable>
          </Pressable>
        </Modal>

        {/* Çalma Sırası (Queue) Modalı */}
        <Modal
          visible={isQueueModalOpen}
          animationType="slide"
          transparent
          onRequestClose={() => setIsQueueModalOpen(false)}>
          <View style={styles.queueModalBackdrop}>
            <View style={styles.queueModalCard}>
              <View style={styles.queueHeader}>
                <View style={styles.queueHeaderHandle} />
                <View style={styles.queueHeaderRow}>
                  <Text style={styles.queueTitle}>Çalma Sırası ({queue.length})</Text>
                  <TouchableOpacity
                    style={styles.queueCloseBtn}
                    onPress={() => setIsQueueModalOpen(false)}>
                    <Ionicons name="close" size={22} color="#ffffff" />
                  </TouchableOpacity>
                </View>
              </View>
              <FlatList
                data={queue}
                keyExtractor={(item, idx) => `${item.id || item.url}-${idx}`}
                renderItem={({ item, index }) => {
                  const isCurrent = index === activeIndex;
                  return (
                    <TouchableOpacity
                      style={[
                        styles.queueItem,
                        isCurrent && [styles.queueItemActive, { backgroundColor: theme.surface }],
                      ]}
                      onPress={async () => {
                        await TrackPlayer.skip(index);
                        await TrackPlayer.play();
                        setIsQueueModalOpen(false);
                      }}>
                      <Text
                        style={[
                          styles.queueIndex,
                          isCurrent && [styles.queueIndexActive, { color: theme.primary }],
                        ]}>
                        {index + 1}
                      </Text>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.queueTrackTitle,
                            isCurrent && [styles.queueTrackTitleActive, { color: theme.primary }],
                          ]}
                          numberOfLines={1}>
                          {item.title}
                        </Text>
                        <Text style={styles.queueTrackArtist} numberOfLines={1}>
                          {item.artist}
                        </Text>
                      </View>
                      {isCurrent ? (
                        <Ionicons name="volume-high" size={20} color={theme.primary} />
                      ) : null}
                    </TouchableOpacity>
                  );
                }}
              />
            </View>
          </View>
        </Modal>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fullscreenContainer: {
    flex: 1,
    backgroundColor: '#0c0c0e',
    paddingTop: 36,
    paddingBottom: 28,
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
    top: 8,
    bottom: 8,
    left: 16,
    right: 16,
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
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
  lyricsSearchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  lyricsSearchBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
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
  scrubberBox: {
    marginBottom: 6,
  },
  progressTouchContainer: {
    height: 24,
    justifyContent: 'center',
  },
  progressBarBackground: {
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#ffffff',
  },
  progressKnob: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ffffff',
    top: 7,
  },
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
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
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
  queueModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  queueModalCard: {
    backgroundColor: '#18181b',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '75%',
    paddingBottom: 24,
  },
  queueHeader: {
    paddingTop: 12,
    paddingBottom: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
    alignItems: 'center',
  },
  queueHeaderHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#3f3f46',
    borderRadius: 2,
    marginBottom: 12,
  },
  queueHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  queueTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  queueCloseBtn: {
    padding: 4,
  },
  queueItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
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
});
