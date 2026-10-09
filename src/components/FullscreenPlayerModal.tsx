import React, { useState, useEffect, useMemo, useRef } from 'react';
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
const ARTWORK_SIZE = Math.min(SCREEN_WIDTH - 64, 340);

export function FullscreenPlayerModal() {
  const { isFullscreenPlayerOpen, closeFullscreenPlayer, isLyricsMode, toggleLyricsMode } =
    usePlayerUIStore();

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

  if (!activeTrack) {
    return null;
  }

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

        {/* Top Header */}
        <View style={styles.topHeader}>
          <TouchableOpacity
            style={styles.headerIconBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            onPress={closeFullscreenPlayer}>
            <Ionicons name="chevron-down" size={28} color="#ffffff" />
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
            onPress={toggleLyricsMode}>
            <Ionicons
              name={isLyricsMode ? 'musical-notes' : 'mic-outline'}
              size={22}
              color={isLyricsMode ? '#3b82f6' : '#ffffff'}
            />
          </TouchableOpacity>
        </View>

        {/* ORTA BÖLÜM: Kapak Fotoğrafı <---> Senkronize Şarkı Sözleri Değişimi */}
        <View style={styles.middleContainer}>
          {!isLyricsMode ? (
            /* Kapak Görünümü */
            <TouchableOpacity
              activeOpacity={0.92}
              style={styles.artworkWrapper}
              onPress={toggleLyricsMode}>
              <TrackArtwork
                uri={currentArtworkUri}
                trackId={activeTrack.id}
                trackUri={activeTrack.url}
                size={ARTWORK_SIZE}
                borderRadius={24}
                iconSize={84}
              />
              <View style={styles.lyricsHintPill}>
                <Ionicons name="mic-outline" size={13} color="#ffffff" style={{ marginRight: 5 }} />
                <Text style={styles.lyricsHintText}>Sözler için dokun</Text>
              </View>
            </TouchableOpacity>
          ) : (
            /* Senkronize Şarkı Sözleri Görünümü (Kapak yerine gelen alan) */
            <View style={styles.lyricsCardContainer}>
              <View style={styles.lyricsCardHeader}>
                <View style={styles.lyricsSourceBadge}>
                  <Ionicons
                    name={currentLyrics?.source === 'lrclib' ? 'sparkles' : 'document-text-outline'}
                    size={12}
                    color="#ffffff"
                    style={{ marginRight: 4 }}
                  />
                  <Text style={styles.lyricsSourceText}>
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
                  <Ionicons name="search" size={14} color="#3b82f6" />
                  <Text style={styles.lyricsSearchBtnText}>Manuel Ara</Text>
                </TouchableOpacity>
              </View>

              {isLoadingLyrics ? (
                <View style={styles.lyricsLoadingCenter}>
                  <ActivityIndicator size="large" color="#3b82f6" />
                  <Text style={styles.lyricsLoadingText}>Sözler aranıyor...</Text>
                </View>
              ) : currentLyrics?.syncedLyrics && parsedLines.length > 0 ? (
                /* Senkronize Söz Akışı */
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
                        <Text style={[styles.lyricText, isActive && styles.lyricTextActive]}>
                          {item.text}
                        </Text>
                      </TouchableOpacity>
                    );
                  }}
                />
              ) : currentLyrics?.plainLyrics ? (
                /* Düz Metin Söz Akışı */
                <ScrollView
                  style={styles.plainLyricsScroll}
                  contentContainerStyle={styles.lyricsListContent}
                  showsVerticalScrollIndicator={false}>
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
                    style={styles.lyricsEmptySearchBtn}
                    activeOpacity={0.8}
                    onPress={toggleManualSearch}>
                    <Ionicons name="search" size={16} color="#ffffff" style={{ marginRight: 6 }} />
                    <Text style={styles.lyricsEmptySearchBtnText}>Arama Yap</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        </View>

        {/* ALT BÖLÜM: Şarkı Bilgileri, İlerleme Çubuğu ve Oynatma Butonları */}
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
          </View>

          {/* İlerleme Çubuğu (Scrubber) */}
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
                <View style={[styles.progressBarFill, { width: `${progressPercent * 100}%` }]} />
              </View>
              {duration > 0 ? (
                <View
                  style={[
                    styles.progressKnob,
                    { left: Math.max(0, Math.min(barWidth - 12, barWidth * progressPercent - 6)) },
                  ]}
                />
              ) : null}
            </View>
            <View style={styles.timeRow}>
              <Text style={styles.timeText}>{formatTime(currentPosition)}</Text>
              <Text style={styles.timeText}>{formatTime(duration)}</Text>
            </View>
          </View>

          {/* Oynatma Kontrolleri */}
          <View style={styles.controlsRow}>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => setIsShuffle(!isShuffle)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Ionicons
                name="shuffle"
                size={22}
                color={isShuffle ? '#3b82f6' : '#71717a'}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.navBtn}
              onPress={skipPrev}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Ionicons name="play-skip-back" size={28} color="#ffffff" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.playPauseMainBtn}
              activeOpacity={0.85}
              onPress={togglePlayback}>
              <Ionicons
                name={playing ? 'pause' : 'play'}
                size={32}
                color="#000000"
                style={!playing ? { marginLeft: 3 } : undefined}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.navBtn}
              onPress={skipNext}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Ionicons name="play-skip-forward" size={28} color="#ffffff" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={toggleRepeat}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Ionicons
                name={repeatMode === RepeatMode.Track ? 'repeat' : 'repeat'}
                size={22}
                color={repeatMode !== RepeatMode.Off ? '#3b82f6' : '#71717a'}
              />
              {repeatMode === RepeatMode.Track ? (
                <Text style={styles.repeatBadge}>1</Text>
              ) : null}
            </TouchableOpacity>
          </View>

          {/* Alt Eylem Butonları: [Şarkı Sözleri] | [Sırada] */}
          <View style={styles.bottomActionsRow}>
            <TouchableOpacity
              style={[
                styles.actionPillBtn,
                isLyricsMode && styles.actionPillBtnActive,
              ]}
              activeOpacity={0.75}
              onPress={toggleLyricsMode}>
              <Ionicons
                name="mic-outline"
                size={16}
                color={isLyricsMode ? '#ffffff' : '#a1a1aa'}
                style={{ marginRight: 6 }}
              />
              <Text
                style={[
                  styles.actionPillBtnText,
                  isLyricsMode && styles.actionPillBtnTextActive,
                ]}>
                Şarkı Sözleri
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionPillBtn}
              activeOpacity={0.75}
              onPress={() => setIsQueueModalOpen(true)}>
              <Ionicons
                name="list"
                size={16}
                color="#a1a1aa"
                style={{ marginRight: 6 }}
              />
              <Text style={styles.actionPillBtnText}>
                Sırada ({queue.length})
              </Text>
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
                  style={styles.searchModalSubmitBtn}
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
                          color="#3b82f6"
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
                      style={[styles.queueItem, isCurrent && styles.queueItemActive]}
                      onPress={async () => {
                        await TrackPlayer.skip(index);
                        await TrackPlayer.play();
                        setIsQueueModalOpen(false);
                      }}>
                      <Text style={[styles.queueIndex, isCurrent && styles.queueIndexActive]}>
                        {index + 1}
                      </Text>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[styles.queueTrackTitle, isCurrent && styles.queueTrackTitleActive]}
                          numberOfLines={1}>
                          {item.title}
                        </Text>
                        <Text style={styles.queueTrackArtist} numberOfLines={1}>
                          {item.artist}
                        </Text>
                      </View>
                      {isCurrent ? (
                        <Ionicons name="volume-high" size={20} color="#3b82f6" />
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
    backgroundColor: '#121214',
    paddingTop: 48,
    paddingBottom: 24,
    justifyContent: 'space-between',
  },
  backdropOverlay: {
    backgroundColor: 'rgba(14, 14, 18, 0.86)',
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  headerIconBtn: {
    padding: 6,
  },
  headerTitleBox: {
    alignItems: 'center',
    maxWidth: '70%',
  },
  headerSmallLabel: {
    color: '#94a3b8',
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
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  artworkWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 18,
    elevation: 16,
  },
  lyricsHintPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(24, 24, 27, 0.75)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    marginTop: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  lyricsHintText: {
    color: '#e4e4e7',
    fontSize: 12,
    fontWeight: '500',
  },
  lyricsCardContainer: {
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(18, 18, 22, 0.75)',
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  lyricsCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  lyricsSourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  lyricsSourceText: {
    color: '#93c5fd',
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
    color: '#3b82f6',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  lyricsListContent: {
    paddingVertical: 20,
    paddingHorizontal: 4,
  },
  lyricRow: {
    paddingVertical: 10,
  },
  lyricRowActive: {
    transform: [{ scale: 1.02 }],
  },
  lyricText: {
    color: '#71717a',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'left',
  },
  lyricTextActive: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '800',
    textShadowColor: 'rgba(59, 130, 246, 0.6)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  plainLyricsScroll: {
    flex: 1,
  },
  plainLyricsText: {
    color: '#e4e4e7',
    fontSize: 16,
    lineHeight: 28,
  },
  lyricsLoadingCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lyricsLoadingText: {
    color: '#a1a1aa',
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
    color: '#71717a',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 16,
  },
  lyricsEmptySearchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#3b82f6',
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
    paddingTop: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  trackTitle: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  trackArtist: {
    color: '#a1a1aa',
    fontSize: 15,
    fontWeight: '500',
    marginTop: 4,
  },
  scrubberBox: {
    marginBottom: 8,
  },
  progressTouchContainer: {
    height: 24,
    justifyContent: 'center',
  },
  progressBarBackground: {
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#3b82f6',
  },
  progressKnob: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#ffffff',
    top: 6,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  timeText: {
    color: '#71717a',
    fontSize: 12,
    fontWeight: '500',
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: 12,
    paddingHorizontal: 8,
  },
  secondaryBtn: {
    padding: 8,
    position: 'relative',
  },
  repeatBadge: {
    position: 'absolute',
    right: 2,
    top: 2,
    color: '#3b82f6',
    fontSize: 9,
    fontWeight: '900',
  },
  navBtn: {
    padding: 8,
  },
  playPauseMainBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#ffffff',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  bottomActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  actionPillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(39, 39, 42, 0.7)',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  actionPillBtnActive: {
    backgroundColor: '#3b82f6',
    borderColor: '#3b82f6',
  },
  actionPillBtnText: {
    color: '#a1a1aa',
    fontSize: 13,
    fontWeight: '600',
  },
  actionPillBtnTextActive: {
    color: '#ffffff',
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
    backgroundColor: '#3b82f6',
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
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
  },
  queueIndex: {
    color: '#71717a',
    width: 26,
    fontSize: 13,
    fontWeight: '600',
  },
  queueIndexActive: {
    color: '#3b82f6',
  },
  queueTrackTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  queueTrackTitleActive: {
    color: '#3b82f6',
  },
  queueTrackArtist: {
    color: '#71717a',
    fontSize: 12,
    marginTop: 2,
  },
});
