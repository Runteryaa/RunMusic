import { useState, useEffect, useMemo, useRef } from 'react';
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
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import TrackPlayer, {
  useActiveTrack,
  useIsPlaying,
  useProgress,
  RepeatMode,
  Track,
} from 'react-native-track-player';
import { useStore } from '../store/useStore';
import { TrackArtwork } from '../components/TrackArtwork';
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
  stripArtistFromTitle,
} from '../services/lyricsService';

export default function PlayerScreen() {
  const activeTrack = useActiveTrack();
  const { playing } = useIsPlaying();
  const progress = useProgress(250);

  const {
    isShuffle,
    setIsShuffle,
    repeatMode,
    setRepeatMode,
    artworkMap,
    metadataMap,
    lyricsCache,
    setLyrics,
    getLyricsFromCache,
    setLastPlaybackState,
    setLastPlaybackPosition,
  } = useStore();

  const [barWidth, setBarWidth] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragTime, setDragTime] = useState(0);

  // Queue Sheet state
  const [isQueueModalOpen, setIsQueueModalOpen] = useState(false);
  const [queue, setQueue] = useState<Track[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(0);

  // Lyrics Sheet state
  const [isLyricsModalOpen, setIsLyricsModalOpen] = useState(false);
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

  const cleanTitle = (raw?: string) => {
    if (!raw) return 'No Song Playing';
    return cleanYouTubeTitle(raw);
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
  const displayTitle =
    stripArtistFromTitle(rawTitle, displayArtist !== 'Bilinmeyen Sanatçı' ? displayArtist : undefined) ||
    rawTitle;

  useEffect(() => {
    if (activeTrack && activeIndex >= 0) {
      const meta = activeTrack.id ? metadataMap[activeTrack.id] : undefined;
      const needsArtwork = !activeTrack.artwork && (meta?.artwork || (activeTrack.id && artworkMap[activeTrack.id]));
      const needsTitle = meta?.title && activeTrack.title !== meta.title;
      const needsArtist = meta?.artist && meta.artist !== 'Local Audio' && activeTrack.artist !== meta.artist;

      if (needsArtwork || needsTitle || needsArtist) {
        TrackPlayer.updateMetadataForTrack(activeIndex, {
          ...(needsArtwork ? { artwork: meta?.artwork || artworkMap[activeTrack.id] } : {}),
          ...(needsTitle ? { title: meta!.title } : {}),
          ...(needsArtist ? { artist: meta!.artist } : {}),
        }).catch(() => {});
      }
    }
  }, [activeTrack, activeIndex, artworkMap, metadataMap]);

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
    // Eğer senkronize söz var ama parsedLines önbellekte eksikse anında parse et
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

      // 1. Zaten tam senkronize sözümüz varsa (LRCLIB), tekrar aramaya gerek yok!
      if (cached && cached.syncedLyrics) {
        if (cached.candidates && cached.candidates.length > 0) {
          setCandidatesList(cached.candidates);
        }
        return;
      }

      // 2. Eğer önbellekteki söz sadece düz metinse veya Genius'tan geldiyse,
      // kullanıcıya mevcut sözü hemen göster (yükleme çarkı olmadan) AMA arka planda LRCLIB'den
      // kontrol et ve senkronize veya LRCLIB sözü bulunursa otomatik olarak LRCLIB'e yükselt!
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
      setManualQuery(searchArtist ? `${searchArtist} - ${displayTitle}` : displayTitle);

      const cached = getLyricsFromCache({
        id: activeTrack.id,
        url: activeTrack.url,
        title: displayTitle,
        artist: searchArtist,
        rawTitle: activeTrack.title,
      });

      // Eğer önbellekte hiç söz yoksa veya senkronize söz yoksa aramayı başlat
      if (!cached || !cached.syncedLyrics) {
        loadLyricsForTrack(displayTitle, searchArtist, false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTrack?.id, activeTrack?.url, displayTitle, displayArtist]);

  // En son dinlenen şarkıyı, sırayı ve konumu kalıcı olarak sakla
  useEffect(() => {
    if (activeTrack) {
      TrackPlayer.getQueue()
        .then((q) => {
          TrackPlayer.getActiveTrackIndex().then((idx) => {
            setLastPlaybackState({
              trackId: activeTrack.id || activeTrack.url,
              trackIndex: idx ?? 0,
              track: {
                id: activeTrack.id || activeTrack.url,
                url: activeTrack.url,
                title: activeTrack.title,
                artist: activeTrack.artist,
                artwork: typeof activeTrack.artwork === 'string' ? activeTrack.artwork : undefined,
              },
              queue: q.map((item) => ({
                id: item.id || item.url,
                url: item.url,
                title: item.title,
                artist: item.artist,
                artwork: typeof item.artwork === 'string' ? item.artwork : undefined,
              })),
              position: progress.position > 0 ? progress.position : undefined,
            });
          });
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTrack?.id, activeTrack?.url]);

  const lastSavedPosRef = useRef<number>(0);
  useEffect(() => {
    if (progress.position > 0 && Math.abs(progress.position - lastSavedPosRef.current) >= 5) {
      lastSavedPosRef.current = progress.position;
      setLastPlaybackPosition(progress.position);
    }
  }, [progress.position, setLastPlaybackPosition]);

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
      isLyricsModalOpen &&
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
        // FlatList scrollToIndex before layout fallback
      }
    }
  }, [activeLineIndex, isLyricsModalOpen, parsedLines.length]);

  const handleManualSearch = async () => {
    if (!manualQuery.trim() || !activeTrack) return;
    setIsSearchingCandidates(true);
    try {
      const searchArtist = displayArtist !== 'Bilinmeyen Sanatçı' ? displayArtist : '';
      const results = await searchAllCandidates(manualQuery.trim(), searchArtist);
      setCandidatesList(results);
      if (results.length === 0) {
        Alert.alert('Sonuç Bulunamadı', 'Bu arama için şarkı sözü bulunamadı.');
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
      if (progress.position > 0) {
        setLastPlaybackPosition(progress.position);
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

  const toggleShuffle = () => {
    setIsShuffle(!isShuffle);
  };

  const handlePlayFromQueue = async (index: number) => {
    try {
      await TrackPlayer.skip(index);
      await TrackPlayer.play();
      await refreshQueue();
    } catch (e) {
      console.warn('Failed to skip track from queue', e);
    }
  };

  const handleRemoveTrack = async (index: number) => {
    try {
      await TrackPlayer.remove(index);
      await refreshQueue();
    } catch (e) {
      console.warn('Failed to remove track', e);
    }
  };

  const handleClearUpcoming = async () => {
    try {
      await TrackPlayer.removeUpcomingTracks();
      await refreshQueue();
    } catch (e) {
      console.warn('Failed to clear upcoming tracks', e);
    }
  };

  const renderQueueItem = ({ item, index }: { item: Track; index: number }) => {
    const isCurrent = index === activeIndex;
    const qMeta = item.id ? metadataMap[item.id] : undefined;
    const qKeywords = getSearchKeywords(item.title || '', item.artist || '');
    const qTitle =
      (qMeta?.title?.trim() ? cleanYouTubeTitle(qMeta.title) : '') ||
      qKeywords.expectedTrack ||
      cleanTitle(item.title) ||
      'Bilinmeyen Parça';
    const qArtist =
      (qMeta?.artist?.trim() && qMeta.artist !== 'Local Audio' && qMeta.artist !== 'Bilinmeyen Sanatçı'
        ? cleanYouTubeTitle(qMeta.artist)
        : '') ||
      (qKeywords.expectedArtist && qKeywords.expectedArtist !== 'Local Audio' && qKeywords.expectedArtist !== 'Bilinmeyen Sanatçı'
        ? qKeywords.expectedArtist
        : (item.artist && item.artist !== 'Local Audio' && item.artist !== 'Bilinmeyen Sanatçı'
            ? cleanYouTubeTitle(item.artist)
            : 'Bilinmeyen Sanatçı'));

    return (
      <TouchableOpacity
        style={[styles.queueItemRow, isCurrent && styles.queueItemRowActive]}
        onPress={() => handlePlayFromQueue(index)}>
        <View style={styles.queueItemLeft}>
          <View style={{ marginRight: 12 }}>
            <TrackArtwork
              uri={(item.id && (metadataMap[item.id]?.artwork || artworkMap[item.id])) || item.artwork}
              trackId={item.id}
              trackUri={item.url}
              size={40}
              borderRadius={8}
              iconSize={18}
            />
          </View>
          <View style={styles.queueItemInfo}>
            <Text
              style={[styles.queueItemTitle, isCurrent && styles.queueItemTitleActive]}
              numberOfLines={1}>
              {qTitle}
            </Text>
            <Text style={styles.queueItemArtist} numberOfLines={1}>
              {isCurrent ? 'Şu An Çalıyor' : qArtist}
            </Text>
          </View>
        </View>

        {!isCurrent && (
          <TouchableOpacity
            style={styles.queueItemRemoveBtn}
            onPress={() => handleRemoveTrack(index)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="trash-outline" size={18} color="#ef4444" />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Album Art Card */}
      <View style={styles.albumArtContainer}>
        <TrackArtwork
          uri={(activeTrack?.id && (metadataMap[activeTrack.id]?.artwork || artworkMap[activeTrack.id])) || activeTrack?.artwork}
          trackId={activeTrack?.id}
          trackUri={activeTrack?.url}
          size={250}
          borderRadius={24}
          iconSize={90}
          shadow={true}
        />
      </View>

      {/* Track Info */}
      <View style={styles.infoContainer}>
        <Text style={styles.title} numberOfLines={1}>
          {displayTitle}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {displayArtist}
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

      {/* Bottom Triggers Row: Lyrics (50%) + Queue (50%) */}
      <View style={styles.bottomTriggersRow}>
        <TouchableOpacity
          style={styles.triggerButton}
          activeOpacity={0.7}
          onPress={() => setIsLyricsModalOpen(true)}>
          <View style={styles.triggerLeft}>
            <Ionicons name="mic-outline" size={17} color="#3b82f6" style={styles.triggerIcon} />
            <Text style={styles.triggerText} numberOfLines={1}>Şarkı Sözleri</Text>
          </View>
          <Ionicons name="chevron-up" size={16} color="#71717a" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.triggerButton}
          activeOpacity={0.7}
          onPress={() => {
            refreshQueue();
            setIsQueueModalOpen(true);
          }}>
          <View style={styles.triggerLeft}>
            <Ionicons name="list" size={17} color="#3b82f6" style={styles.triggerIcon} />
            <Text style={styles.triggerText} numberOfLines={1}>Sırada</Text>
            {queue.length > 0 && (
              <View style={styles.triggerBadge}>
                <Text style={styles.triggerBadgeText}>{queue.length}</Text>
              </View>
            )}
          </View>
          <Ionicons name="chevron-up" size={16} color="#71717a" />
        </TouchableOpacity>
      </View>

      {/* Up Next / Queue Full Bottom Sheet Modal */}
      <Modal
        visible={isQueueModalOpen}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setIsQueueModalOpen(false)}>
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setIsQueueModalOpen(false)}>
          <Pressable style={styles.queueModalContent} onPress={(e) => e.stopPropagation()}>
            <View style={styles.dragHandleContainer}>
              <View style={styles.dragHandle} />
            </View>

            {/* Queue Header */}
            <View style={styles.queueHeader}>
              <View style={styles.queueHeaderLeft}>
                <Text style={styles.queueTitle}>Sıradaki Parçalar</Text>
                {queue.length > 0 && (
                  <View style={styles.queueCountBadge}>
                    <Text style={styles.queueCountText}>{queue.length}</Text>
                  </View>
                )}
              </View>

              <View style={styles.queueHeaderActions}>
                {queue.length > activeIndex + 1 && (
                  <TouchableOpacity
                    style={styles.clearUpcomingBtn}
                    onPress={handleClearUpcoming}>
                    <Text style={styles.clearUpcomingText}>Kalanları Temizle</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.closeQueueBtn}
                  onPress={() => setIsQueueModalOpen(false)}>
                  <Ionicons name="chevron-down" size={24} color="#a1a1aa" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Queue Track List */}
            <FlatList
              data={queue}
              keyExtractor={(item, index) => `${item.id || item.url}_${index}`}
              renderItem={renderQueueItem}
              contentContainerStyle={
                queue.length === 0 ? styles.emptyQueueContainer : styles.queueListContainer
              }
              ListEmptyComponent={
                <View style={styles.emptyQueueState}>
                  <Ionicons
                    name="musical-notes-outline"
                    size={48}
                    color="#52525b"
                    style={{ marginBottom: 12 }}
                  />
                  <Text style={styles.emptyQueueTitle}>Sırada şarkı yok</Text>
                  <Text style={styles.emptyQueueText}>
                    Kütüphaneden şarkı seçerek çalma sırası oluşturabilirsiniz.
                  </Text>
                </View>
              }
            />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Lyrics Full Bottom Sheet Modal */}
      <Modal
        visible={isLyricsModalOpen}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setIsLyricsModalOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setIsLyricsModalOpen(false)}>
          <Pressable style={styles.lyricsModalContent} onPress={(e) => e.stopPropagation()}>
            <View style={styles.dragHandleContainer}>
              <View style={styles.dragHandle} />
            </View>

            {/* Lyrics Header */}
            <View style={styles.lyricsHeader}>
              <View style={styles.lyricsHeaderLeft}>
                <Text style={styles.lyricsHeaderTitle} numberOfLines={1}>
                  {displayTitle}
                </Text>
                <View style={styles.lyricsSourceBadgeRow}>
                  {currentLyrics ? (
                    <View style={styles.lyricsSourceBadge}>
                      <Ionicons
                        name={currentLyrics.syncedLyrics ? 'flash' : 'document-text'}
                        size={11}
                        color="#3b82f6"
                      />
                      <Text style={styles.lyricsSourceText}>
                        {currentLyrics.source === 'lrclib'
                          ? currentLyrics.syncedLyrics
                            ? 'LRCLIB (Senkronize)'
                            : 'LRCLIB (Düz Metin)'
                          : 'Genius (Düz Metin)'}
                      </Text>
                    </View>
                  ) : null}
                  {candidatesList.length > 1 || (currentLyrics?.candidates && currentLyrics.candidates.length > 1) ? (
                    <TouchableOpacity
                      style={styles.candidatesPillBtn}
                      activeOpacity={0.7}
                      onPress={toggleManualSearch}>
                      <Ionicons name="list" size={12} color="#3b82f6" />
                      <Text style={styles.candidatesPillText}>
                        Sonuçlar ({candidatesList.length || currentLyrics?.candidates?.length || 0})
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                  {currentLyrics?.syncedLyrics ? (
                    <Text style={styles.lyricsHintText}>• Satıra dokunarak atla</Text>
                  ) : null}
                </View>
              </View>

              <View style={styles.lyricsHeaderActions}>
                <TouchableOpacity
                  style={styles.lyricsRefreshBtn}
                  activeOpacity={0.7}
                  onPress={() => {
                    const searchArtist = displayArtist !== 'Bilinmeyen Sanatçı' ? displayArtist : '';
                    loadLyricsForTrack(displayTitle, searchArtist, true);
                  }}
                  disabled={isLoadingLyrics}>
                  {isLoadingLyrics ? (
                    <ActivityIndicator size="small" color="#3b82f6" />
                  ) : (
                    <Ionicons name="refresh" size={18} color="#a1a1aa" />
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.lyricsSearchToggleBtn}
                  onPress={toggleManualSearch}>
                  <Ionicons
                    name={isManualSearchOpen ? 'close' : 'search'}
                    size={20}
                    color={isManualSearchOpen ? '#ef4444' : '#a1a1aa'}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.closeLyricsBtn}
                  onPress={() => setIsLyricsModalOpen(false)}>
                  <Ionicons name="chevron-down" size={24} color="#a1a1aa" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Manual Search & Candidates Drawer */}
            {isManualSearchOpen && (
              <View style={styles.manualSearchWrapper}>
                <View style={styles.manualSearchContainer}>
                  <TextInput
                    style={styles.manualSearchInput}
                    placeholder="Şarkı veya sanatçı adı..."
                    placeholderTextColor="#71717a"
                    value={manualQuery}
                    onChangeText={setManualQuery}
                    returnKeyType="search"
                    onSubmitEditing={handleManualSearch}
                  />
                  <TouchableOpacity
                    style={styles.manualSearchBtn}
                    onPress={handleManualSearch}
                    disabled={isSearchingCandidates}>
                    {isSearchingCandidates ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <Text style={styles.manualSearchBtnText}>Ara</Text>
                    )}
                  </TouchableOpacity>
                </View>

                {isSearchingCandidates ? (
                  <View style={styles.searchingCandidatesBox}>
                    <ActivityIndicator size="small" color="#3b82f6" />
                    <Text style={styles.searchingCandidatesText}>
                      Sonuçlar aranıyor (LRCLIB & Genius)...
                    </Text>
                  </View>
                ) : candidatesList.length > 0 ? (
                  <View style={styles.candidatesListBox}>
                    <Text style={styles.candidatesListHeader}>
                      Bulunan Sonuçlar ({candidatesList.length}) • Tercih ettiğinize dokunun:
                    </Text>
                    <ScrollView style={styles.candidatesScroll} nestedScrollEnabled={true}>
                      {candidatesList.map((item) => {
                        const isSelected = currentLyrics?.id === item.id;
                        const isResolving = resolvingCandidateId === item.id;
                        const dur = item.duration
                          ? `${Math.floor(item.duration / 60)}:${String(
                              Math.floor(item.duration % 60)
                            ).padStart(2, '0')}`
                          : '';

                        return (
                          <TouchableOpacity
                            key={item.id}
                            style={[styles.candidateItem, isSelected && styles.candidateItemActive]}
                            onPress={() => handleSelectCandidate(item)}
                            disabled={isResolving}>
                            <View style={styles.candidateLeft}>
                              <View style={styles.candidateTopRow}>
                                <Text
                                  style={[
                                    styles.candidateTrack,
                                    isSelected && styles.candidateTrackActive,
                                  ]}
                                  numberOfLines={1}>
                                  {item.trackName}
                                </Text>
                                {item.hasSynced ? (
                                  <View style={styles.badgeSynced}>
                                    <Ionicons name="flash" size={10} color="#4ade80" />
                                    <Text style={styles.badgeSyncedText}>Senkronize (LRCLIB)</Text>
                                  </View>
                                ) : item.source === 'lrclib' ? (
                                  <View style={styles.badgeLrclibPlain}>
                                    <Ionicons name="document-text" size={10} color="#60a5fa" />
                                    <Text style={styles.badgeLrclibPlainText}>Düz (LRCLIB)</Text>
                                  </View>
                                ) : (
                                  <View style={styles.badgeGeniusPlain}>
                                    <Ionicons name="document-text" size={10} color="#fbbf24" />
                                    <Text style={styles.badgeGeniusPlainText}>Düz (Genius)</Text>
                                  </View>
                                )}
                              </View>
                              <View style={styles.candidateBottomRow}>
                                <Text style={styles.candidateArtist} numberOfLines={1}>
                                  {item.artistName} {item.albumName ? `• ${item.albumName}` : ''}
                                </Text>
                                {dur ? <Text style={styles.candidateDur}>⏱ {dur}</Text> : null}
                              </View>
                            </View>

                            <View style={styles.candidateRight}>
                              {isResolving ? (
                                <ActivityIndicator size="small" color="#3b82f6" />
                              ) : isSelected ? (
                                <View style={styles.selectedBadge}>
                                  <Ionicons name="checkmark-circle" size={18} color="#3b82f6" />
                                </View>
                              ) : (
                                <Ionicons name="chevron-forward" size={16} color="#52525b" />
                              )}
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>
                ) : null}
              </View>
            )}

            {/* Lyrics Body */}
            {isLoadingLyrics ? (
              <View style={styles.lyricsLoadingContainer}>
                <ActivityIndicator size="large" color="#3b82f6" />
                <Text style={styles.lyricsLoadingText}>Şarkı sözleri aranıyor...</Text>
                <Text style={styles.lyricsLoadingSubtext}>LRCLIB & Genius taranıyor</Text>
              </View>
            ) : currentLyrics?.syncedLyrics && parsedLines.length > 0 ? (
              /* Synchronized Lyrics List */
              <FlatList
                ref={lyricsFlatListRef}
                data={parsedLines}
                keyExtractor={(_, index) => `line_${index}`}
                contentContainerStyle={styles.syncedLyricsListContent}
                showsVerticalScrollIndicator={false}
                onScrollBeginDrag={() => {
                  isUserScrollingRef.current = true;
                  if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
                }}
                onMomentumScrollBegin={() => {
                  isUserScrollingRef.current = true;
                  if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
                }}
                onMomentumScrollEnd={() => {
                  if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
                  scrollTimeoutRef.current = setTimeout(() => {
                    isUserScrollingRef.current = false;
                  }, 1500);
                }}
                onScrollEndDrag={() => {
                  if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
                  scrollTimeoutRef.current = setTimeout(() => {
                    isUserScrollingRef.current = false;
                  }, 2000);
                }}
                onScrollToIndexFailed={(info) => {
                  lyricsFlatListRef.current?.scrollToOffset({
                    offset: Math.max(0, info.index * 56 - 100),
                    animated: true,
                  });
                }}
                renderItem={({ item, index }) => {
                  const isActive = index === activeLineIndex;
                  return (
                    <TouchableOpacity
                      activeOpacity={0.6}
                      onPress={async () => {
                        await TrackPlayer.seekTo(item.time);
                      }}
                      style={[
                        styles.syncedLyricItem,
                        isActive && styles.syncedLyricItemActive,
                      ]}>
                      <Text
                        style={[
                          styles.syncedLyricText,
                          isActive && styles.syncedLyricTextActive,
                        ]}>
                        {item.text}
                      </Text>
                    </TouchableOpacity>
                  );
                }}
              />
            ) : currentLyrics?.plainLyrics ? (
              /* Plain Text Lyrics */
              <ScrollView
                style={styles.plainLyricsScroll}
                contentContainerStyle={styles.plainLyricsContent}
                showsVerticalScrollIndicator={false}>
                <Text style={styles.plainLyricsText}>{currentLyrics.plainLyrics}</Text>
              </ScrollView>
            ) : (
              /* Empty state */
              <View style={styles.lyricsEmptyContainer}>
                <Ionicons name="document-text-outline" size={48} color="#52525b" />
                <Text style={styles.lyricsEmptyTitle}>Şarkı Sözü Bulunamadı</Text>
                <Text style={styles.lyricsEmptySubtitle}>
                  Bu şarkı için otomatik söz bulunamadı. Yukarıdaki arama butonuna dokunarak şarkıyı elle aratabilirsiniz.
                </Text>
                <TouchableOpacity
                  style={styles.retrySearchBtn}
                  onPress={toggleManualSearch}>
                  <Ionicons name="search" size={16} color="#3b82f6" />
                  <Text style={styles.retrySearchBtnText}>Arama Yap / Sonuçları Gör</Text>
                </TouchableOpacity>
              </View>
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
    paddingHorizontal: 25,
    paddingTop: 16,
    paddingBottom: 20,
    justifyContent: 'space-between',
  },
  albumArtContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 10,
  },
  albumArtBox: {
    width: 240,
    height: 240,
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
    marginBottom: 8,
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
    marginVertical: 10,
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
    paddingHorizontal: 8,
    marginBottom: 12,
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
    width: 68,
    height: 68,
    borderRadius: 34,
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
  bottomTriggersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  triggerButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#18181b',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#27272a',
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  triggerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 4,
  },
  triggerIcon: {
    marginRight: 6,
  },
  triggerText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  triggerBadge: {
    backgroundColor: '#27272a',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 6,
  },
  triggerBadgeText: {
    color: '#3b82f6',
    fontSize: 11,
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  queueModalContent: {
    height: '80%',
    backgroundColor: '#18181b',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: '#27272a',
    paddingTop: 10,
    paddingBottom: 24,
    paddingHorizontal: 16,
  },
  dragHandleContainer: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#3f3f46',
  },
  queueHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
  },
  queueHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  queueTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
  },
  queueCountBadge: {
    backgroundColor: '#27272a',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 8,
  },
  queueCountText: {
    color: '#3b82f6',
    fontSize: 12,
    fontWeight: '700',
  },
  queueHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  clearUpcomingBtn: {
    backgroundColor: '#27272a',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  clearUpcomingText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '600',
  },
  closeQueueBtn: {
    padding: 4,
  },
  queueListContainer: {
    paddingBottom: 20,
  },
  queueItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    marginVertical: 2,
  },
  queueItemRowActive: {
    backgroundColor: '#27272a',
    borderWidth: 1,
    borderColor: '#3b82f6',
  },
  queueItemLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  queueItemIconBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#27272a',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  queueItemIconBoxActive: {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
  },
  queueItemInfo: {
    flex: 1,
  },
  queueItemTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: '#ffffff',
    marginBottom: 2,
  },
  queueItemTitleActive: {
    color: '#3b82f6',
    fontWeight: '700',
  },
  queueItemArtist: {
    fontSize: 12,
    color: '#71717a',
  },
  queueItemRemoveBtn: {
    padding: 8,
    marginLeft: 8,
  },
  emptyQueueContainer: {
    flexGrow: 1,
  },
  emptyQueueState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 20,
  },
  emptyQueueTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 6,
  },
  emptyQueueText: {
    fontSize: 14,
    color: '#71717a',
    textAlign: 'center',
  },
  lyricsModalContent: {
    height: '82%',
    backgroundColor: '#18181b',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: '#27272a',
    paddingTop: 10,
    paddingBottom: 24,
    paddingHorizontal: 18,
  },
  lyricsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
    marginBottom: 12,
  },
  lyricsHeaderLeft: {
    flex: 1,
    marginRight: 12,
  },
  lyricsHeaderTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#ffffff',
  },
  lyricsSourceBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    flexWrap: 'wrap',
    gap: 8,
  },
  lyricsSourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#27272a',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
  },
  lyricsSourceText: {
    fontSize: 11,
    color: '#3b82f6',
    fontWeight: '600',
  },
  candidatesPillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#27272a',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#3b82f6',
  },
  candidatesPillText: {
    fontSize: 11,
    color: '#3b82f6',
    fontWeight: '600',
  },
  lyricsHintText: {
    fontSize: 11,
    color: '#71717a',
  },
  lyricsHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  lyricsRefreshBtn: {
    padding: 7,
    backgroundColor: '#27272a',
    borderRadius: 8,
  },
  lyricsSearchToggleBtn: {
    padding: 7,
    backgroundColor: '#27272a',
    borderRadius: 8,
  },
  closeLyricsBtn: {
    padding: 4,
  },
  manualSearchWrapper: {
    marginBottom: 12,
  },
  manualSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#27272a',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  manualSearchInput: {
    flex: 1,
    color: '#ffffff',
    fontSize: 14,
    paddingVertical: 8,
  },
  manualSearchBtn: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  manualSearchBtnText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 13,
  },
  searchingCandidatesBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  searchingCandidatesText: {
    fontSize: 12,
    color: '#a1a1aa',
  },
  candidatesListBox: {
    backgroundColor: '#18181b',
    borderRadius: 12,
    padding: 10,
    marginTop: 8,
    maxHeight: 250,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  candidatesListHeader: {
    fontSize: 12,
    fontWeight: '600',
    color: '#a1a1aa',
    marginBottom: 8,
  },
  candidatesScroll: {
    maxHeight: 210,
  },
  candidateItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: '#27272a',
    borderRadius: 8,
    marginBottom: 6,
  },
  candidateItemActive: {
    borderColor: '#3b82f6',
    borderWidth: 1.5,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
  },
  candidateLeft: {
    flex: 1,
    marginRight: 8,
  },
  candidateTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  candidateTrack: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
    flex: 1,
  },
  candidateTrackActive: {
    color: '#60a5fa',
  },
  candidateBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 3,
  },
  candidateArtist: {
    fontSize: 12,
    color: '#a1a1aa',
    flex: 1,
  },
  candidateDur: {
    fontSize: 11,
    color: '#71717a',
    marginLeft: 6,
  },
  candidateRight: {
    marginLeft: 6,
  },
  badgeSynced: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(74, 222, 128, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeSyncedText: {
    fontSize: 10,
    color: '#4ade80',
    fontWeight: '700',
  },
  badgeLrclibPlain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(96, 165, 250, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeLrclibPlainText: {
    fontSize: 10,
    color: '#60a5fa',
    fontWeight: '600',
  },
  badgeGeniusPlain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(251, 191, 36, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeGeniusPlainText: {
    fontSize: 10,
    color: '#fbbf24',
    fontWeight: '600',
  },
  selectedBadge: {
    padding: 2,
  },
  lyricsLoadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  lyricsLoadingText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
    marginTop: 14,
  },
  lyricsLoadingSubtext: {
    color: '#71717a',
    fontSize: 12,
    marginTop: 4,
  },
  syncedLyricsListContent: {
    paddingVertical: 120,
    paddingHorizontal: 4,
  },
  syncedLyricItem: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginVertical: 4,
  },
  syncedLyricItemActive: {
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
  },
  syncedLyricText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#52525b',
    textAlign: 'center',
    lineHeight: 28,
  },
  syncedLyricTextActive: {
    fontSize: 22,
    fontWeight: '800',
    color: '#ffffff',
    textAlign: 'center',
    lineHeight: 32,
  },
  plainLyricsScroll: {
    flex: 1,
  },
  plainLyricsContent: {
    paddingVertical: 16,
    paddingHorizontal: 8,
  },
  plainLyricsText: {
    fontSize: 16,
    lineHeight: 28,
    color: '#d4d4d8',
    textAlign: 'center',
  },
  lyricsEmptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  lyricsEmptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#ffffff',
    marginTop: 12,
    marginBottom: 6,
  },
  lyricsEmptySubtitle: {
    fontSize: 13,
    color: '#71717a',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  retrySearchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#27272a',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  retrySearchBtnText: {
    color: '#3b82f6',
    fontSize: 13,
    fontWeight: '600',
  },
});
