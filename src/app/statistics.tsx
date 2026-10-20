import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getRecentHistory,
  getMostPlayed,
  getTotalListeningTime,
  getTotalHistoryCount,
  PlayHistoryItem,
  MostPlayedItem,
} from '../services/statsDatabase';
import { useDownloadStore } from '../store/useDownloadStore';
import { startPlaybackFromLibrary } from '../services/queueController';

import { useThemeStore } from '../store/useThemeStore';
import { useStore } from '../store/useStore';
import { TrackArtwork } from '../components/TrackArtwork';
import { AdBanner } from '../components/AdBanner';
import { cleanDisplayTitle } from '../services/lyricsService';
import { useTranslation } from '../services/i18n';

const PAGE_SIZE = 50;

export default function StatisticsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useThemeStore((s) => s.theme);
  const { t, resolvedLanguage } = useTranslation();
  
  const allAssets = useStore((s) => s.allAssets);
  const metadataMap = useStore((s) => s.metadataMap);
  const artworkMap = useStore((s) => s.artworkMap);
  const library = useStore((s) => s.library);
  const downloadTasks = useDownloadStore((s) => s.tasks);

  const [historyPage, setHistoryPage] = useState(1);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [totalHistoryCount, setTotalHistoryCount] = useState(0);

  const [loading, setLoading] = useState(true);
  const [totalTime, setTotalTime] = useState(0);
  const [recentHistory, setRecentHistory] = useState<PlayHistoryItem[]>([]);
  const [mostPlayedAllTime, setMostPlayedAllTime] = useState<MostPlayedItem[]>([]);
  const [mostPlayedMonth, setMostPlayedMonth] = useState<MostPlayedItem[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'history'>('overview');

  const [refreshing, setRefreshing] = useState(false);

  const loadStats = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const [time, history, mostAll, mostMonth, count] = await Promise.all([
        getTotalListeningTime(),
        getRecentHistory(PAGE_SIZE, 0),
        getMostPlayed(10),
        getMostPlayed(10, 'month'),
        getTotalHistoryCount(),
      ]);
      setTotalTime(time);
      setRecentHistory(history);
      setMostPlayedAllTime(mostAll);
      setMostPlayedMonth(mostMonth);
      setTotalHistoryCount(count);
      setHistoryPage(1);
      setHasMoreHistory(history.length < count);
    } catch (e) {
      console.warn('Stats fetch error:', e);
    } finally {
      if (!isRefresh) setLoading(false);
      if (isRefresh) setRefreshing(false);
    }
  }, []);

  const loadMoreHistory = useCallback(async () => {
    if (loadingMore || !hasMoreHistory) return;
    setLoadingMore(true);
    try {
      const nextPage = historyPage + 1;
      const offset = (nextPage - 1) * PAGE_SIZE;
      const moreItems = await getRecentHistory(PAGE_SIZE, offset);
      if (moreItems.length > 0) {
        setRecentHistory((prev) => [...prev, ...moreItems]);
        setHistoryPage(nextPage);
        if (moreItems.length < PAGE_SIZE || recentHistory.length + moreItems.length >= totalHistoryCount) {
          setHasMoreHistory(false);
        }
      } else {
        setHasMoreHistory(false);
      }
    } catch (e) {
      console.warn('Failed to load more history:', e);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMoreHistory, historyPage, recentHistory.length, totalHistoryCount]);

  useFocusEffect(
    useCallback(() => {
      loadStats();
    }, [loadStats])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadStats(true);
  }, [loadStats]);

  const formatDurationDetailed = (totalSeconds: number) => {
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    let parts = [];
    if (days > 0) parts.push(`${days} ${resolvedLanguage === 'tr' ? 'gün' : 'd'}`);
    if (hours > 0) parts.push(`${hours} ${resolvedLanguage === 'tr' ? 'saat' : 'h'}`);
    if (minutes > 0) parts.push(`${minutes} ${resolvedLanguage === 'tr' ? 'dk' : 'm'}`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds} ${resolvedLanguage === 'tr' ? 'sn' : 's'}`);
    
    const mainText = parts.join(' ');
    const totalMinutes = Math.floor(totalSeconds / 60);
    
    return {
      mainText,
      subText: totalMinutes > 0 ? (resolvedLanguage === 'tr' ? `(Toplam ${totalMinutes} dk)` : `(Total ${totalMinutes} min)`) : ''
    };
  };

  const formatDateDetailed = (dateStr: string) => {
    try {
      const isoStr = dateStr.includes('T') ? dateStr : `${dateStr.replace(' ', 'T')}Z`;
      const date = new Date(isoStr);
      if (isNaN(date.getTime())) {
        return dateStr;
      }

      const now = new Date();
      const isToday =
        date.getDate() === now.getDate() &&
        date.getMonth() === now.getMonth() &&
        date.getFullYear() === now.getFullYear();

      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const isYesterday =
        date.getDate() === yesterday.getDate() &&
        date.getMonth() === yesterday.getMonth() &&
        date.getFullYear() === yesterday.getFullYear();

      const timeStr = date.toLocaleTimeString(resolvedLanguage === 'tr' ? 'tr-TR' : 'en-US', {
        hour: '2-digit',
        minute: '2-digit',
      });

      if (isToday) {
        return resolvedLanguage === 'tr' ? `Bugün, ${timeStr}` : `Today, ${timeStr}`;
      }
      if (isYesterday) {
        return resolvedLanguage === 'tr' ? `Dün, ${timeStr}` : `Yesterday, ${timeStr}`;
      }

      const isCurrentYear = date.getFullYear() === now.getFullYear();
      return date.toLocaleDateString(resolvedLanguage === 'tr' ? 'tr-TR' : 'en-US', {
        day: 'numeric',
        month: 'short',
        year: isCurrentYear ? undefined : 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  const getTrackInfo = (trackId: string, historyItem?: PlayHistoryItem | MostPlayedItem) => {
    const unknownArtist = t('common.unknown_artist');
    const unknownTrack = t('common.unknown_track');

    if (historyItem?.title) {
      const artist = historyItem.artist?.trim() || unknownArtist;
      const asset = allAssets.find((a) => a.id === trackId) || library.find((a) => a.id === trackId);
      const task = downloadTasks.find((t) => t.id === trackId || t.mediaLibraryAssetId === trackId);
      return {
        title: cleanDisplayTitle(historyItem.title, artist !== unknownArtist ? artist : undefined),
        artist: artist === 'Local Audio' || artist === 'Bilinmeyen Sanatçı' ? unknownArtist : artist,
        uri: asset?.uri || task?.localFileUri,
        artwork: historyItem.artwork || metadataMap[trackId]?.artwork || artworkMap[trackId],
      };
    }

    const meta = metadataMap[trackId];
    const asset = allAssets.find((a) => a.id === trackId) || library.find((a) => a.id === trackId);
    const task = downloadTasks.find((t) => t.id === trackId || t.mediaLibraryAssetId === trackId);

    let artist = meta?.artist?.trim() || task?.artist?.trim() || unknownArtist;
    if (artist === 'Local Audio' || artist === 'Bilinmeyen Sanatçı') artist = unknownArtist;

    let rawTitle = meta?.title?.trim() || task?.title?.trim() || '';
    if (!rawTitle && asset) {
      rawTitle = asset.filename;
    }

    let title = rawTitle
      ? cleanDisplayTitle(rawTitle, artist !== unknownArtist ? artist : undefined)
      : unknownTrack;

    return {
      title,
      artist,
      uri: asset?.uri || task?.localFileUri,
      artwork: meta?.artwork || task?.artwork || artworkMap[trackId],
    };
  };

  const handlePlayTrack = async (trackId: string, historyItem?: PlayHistoryItem | MostPlayedItem) => {
    try {
      const asset = allAssets.find((a) => a.id === trackId) || library.find((a) => a.id === trackId);
      const task = downloadTasks.find((t) => t.id === trackId || t.mediaLibraryAssetId === trackId);
      const uri = asset?.uri || task?.localFileUri;
      if (!uri) return;

      const trackList = (allAssets.length > 0 ? allAssets : library).map((a) => ({
        id: a.id,
        url: a.uri,
        title: metadataMap[a.id]?.title || a.filename,
        artist: metadataMap[a.id]?.artist || t('common.unknown_artist'),
        duration: a.duration,
      }));

      const startTrackId = asset?.id || trackId;
      if (!trackList.some((t) => t.id === startTrackId)) {
        const info = getTrackInfo(trackId, historyItem);
        trackList.unshift({
          id: startTrackId,
          url: uri,
          title: info.title,
          artist: info.artist,
          duration: metadataMap[trackId]?.duration || task?.duration || 0,
        });
      }

      await startPlaybackFromLibrary({
        tracks: trackList,
        startId: startTrackId,
        shuffle: false,
      });
    } catch (e) {
      console.warn('Failed to play track from stats:', e);
    }
  };

  const renderTrackItem = (
    trackId: string,
    subtitle: string,
    rightText?: string,
    keySuffix?: string | number,
    historyItem?: PlayHistoryItem | MostPlayedItem
  ) => {
    const info = getTrackInfo(trackId, historyItem);
    const itemKey = keySuffix != null ? `${trackId}-${keySuffix}` : trackId;
    const canPlay = Boolean(info.uri);

    return (
      <TouchableOpacity
        key={itemKey}
        style={styles.trackItem}
        activeOpacity={canPlay ? 0.7 : 1}
        onPress={() => {
          if (canPlay) handlePlayTrack(trackId, historyItem);
        }}
      >
        <TrackArtwork
          uri={info.artwork || metadataMap[trackId]?.artwork || artworkMap[trackId]}
          trackId={trackId}
          trackUri={info.uri}
          size={44}
          borderRadius={8}
          iconSize={20}
        />
        <View style={styles.trackInfo}>
          <Text style={styles.trackTitle} numberOfLines={1}>{info.title}</Text>
          <Text style={styles.trackSubtitle} numberOfLines={1}>{subtitle}</Text>
        </View>
        {rightText ? (
          <View style={styles.trackRight}>
            <Text style={[styles.rightText, { color: theme.primary }]}>{rightText}</Text>
          </View>
        ) : null}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 16) }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('stats.title')}</Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabContainer}>
        <TouchableOpacity 
          style={[styles.tabBtn, activeTab === 'overview' && { borderBottomColor: theme.primary, borderBottomWidth: 2 }]}
          onPress={() => setActiveTab('overview')}
        >
          <Text style={[styles.tabText, activeTab === 'overview' && { color: theme.primary, fontWeight: '700' }]}>
            {t('stats.overview')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.tabBtn, activeTab === 'history' && { borderBottomColor: theme.primary, borderBottomWidth: 2 }]}
          onPress={() => setActiveTab('history')}
        >
          <Text style={[styles.tabText, activeTab === 'history' && { color: theme.primary, fontWeight: '700' }]}>
            {t('stats.listening_history')}
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : (
        <ScrollView 
          style={styles.scrollContent} 
          contentContainerStyle={{ paddingBottom: 100 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.primary}
              colors={[theme.primary]}
            />
          }
        >
          {activeTab === 'overview' ? (
            <>
              {/* Ad Banner - Sayfa Başı */}
              <AdBanner style={{ marginBottom: 12 }} />

              {/* Total Time Card */}
              <View style={styles.card}>
                <Ionicons name="time-outline" size={32} color={theme.primary} />
                <View style={styles.cardTextContent}>
                  <Text style={styles.cardTitle}>{t('stats.total_time')}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <Text style={styles.cardValue}>{formatDurationDetailed(totalTime).mainText}</Text>
                    {formatDurationDetailed(totalTime).subText ? (
                      <Text style={styles.cardSubtitle}>
                        {formatDurationDetailed(totalTime).subText}
                      </Text>
                    ) : null}
                  </View>
                </View>
              </View>

              {/* Most Played This Month */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  {t('stats.top_tracks_month')}
                </Text>
                {mostPlayedMonth.length > 0 ? (
                  mostPlayedMonth.map((item, idx) =>
                    renderTrackItem(
                      item.track_id,
                      getTrackInfo(item.track_id, item).artist,
                      `${item.play_count} ${t('stats.plays_count')}`,
                      `month-${idx}`,
                      item
                    )
                  )
                ) : (
                  <Text style={styles.emptyText}>{t('stats.no_data')}</Text>
                )}
              </View>

              {/* Most Played All Time */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  {t('stats.top_tracks_all_time')}
                </Text>
                {mostPlayedAllTime.length > 0 ? (
                  mostPlayedAllTime.map((item, idx) =>
                    renderTrackItem(
                      item.track_id,
                      getTrackInfo(item.track_id, item).artist,
                      `${item.play_count} ${t('stats.plays_count')}`,
                      `all-${idx}`,
                      item
                    )
                  )
                ) : (
                  <Text style={styles.emptyText}>{t('stats.no_data')}</Text>
                )}
              </View>

              {/* Ad Banner - Sayfa Sonu */}
              <AdBanner style={{ marginTop: 8 }} />
            </>
          ) : (
            /* History Tab */
            <View style={styles.section}>
              {/* Ad Banner - Geçmiş Başı */}
              <AdBanner style={{ marginBottom: 12 }} />

              <View style={styles.historyHeaderRow}>
                <Text style={styles.sectionTitle}>
                  {t('stats.listening_history')}
                  {totalHistoryCount > 0 ? ` (${totalHistoryCount})` : ''}
                </Text>
              </View>

              {recentHistory.length > 0 ? (
                <>
                  {recentHistory.map((item, idx) => {
                    const dateFormatted = formatDateDetailed(item.played_at);
                    const info = getTrackInfo(item.track_id, item);
                    const subtitle = info.artist && info.artist !== t('common.unknown_artist')
                      ? `${info.artist} • ${dateFormatted}`
                      : dateFormatted;
                    return (
                      <React.Fragment key={`hist-${item.played_at}-${idx}`}>
                        {renderTrackItem(item.track_id, subtitle, undefined, `hist-${item.played_at}-${idx}`, item)}
                        {(idx + 1) % 15 === 0 && idx !== recentHistory.length - 1 ? (
                          <AdBanner style={{ marginVertical: 6 }} />
                        ) : null}
                      </React.Fragment>
                    );
                  })}

                  {hasMoreHistory && (
                    <TouchableOpacity
                      style={[styles.loadMoreBtn, { borderColor: theme.primary }]}
                      onPress={loadMoreHistory}
                      disabled={loadingMore}
                    >
                      {loadingMore ? (
                        <ActivityIndicator size="small" color={theme.primary} />
                      ) : (
                        <Text style={[styles.loadMoreText, { color: theme.primary }]}>
                          {t('stats.load_more')}
                        </Text>
                      )}
                    </TouchableOpacity>
                  )}

                  {!hasMoreHistory && recentHistory.length >= PAGE_SIZE && (
                    <Text style={styles.endOfHistoryText}>
                      {t('stats.all_history_loaded')}
                    </Text>
                  )}
                </>
              ) : (
                <Text style={styles.emptyText}>
                  {t('stats.history_empty')}
                </Text>
              )}

              {/* Ad Banner - Geçmiş Sonu (Yalnızca 20 ve üzeri geçmiş kaydı varsa) */}
              {recentHistory.length >= 20 && <AdBanner style={{ marginTop: 8 }} />}
            </View>
          )}
        </ScrollView>
      )}
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
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  backBtn: {
    marginRight: 16,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
  },
  tabContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
  },
  tabText: {
    fontSize: 15,
    color: '#a1a1aa',
    fontWeight: '500',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    flex: 1,
    padding: 16,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: '#18181b',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  cardTextContent: {
    marginLeft: 16,
  },
  cardTitle: {
    fontSize: 14,
    color: '#a1a1aa',
    marginBottom: 4,
  },
  cardValue: {
    fontSize: 24,
    fontWeight: '800',
    color: '#ffffff',
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#a1a1aa',
    marginLeft: 6,
    fontWeight: '600',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 12,
  },
  historyHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  loadMoreBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    marginBottom: 16,
    backgroundColor: '#18181b',
  },
  loadMoreText: {
    fontSize: 14,
    fontWeight: '600',
  },
  endOfHistoryText: {
    textAlign: 'center',
    color: '#71717a',
    fontSize: 13,
    marginTop: 12,
    marginBottom: 16,
    fontStyle: 'italic',
  },
  emptyText: {
    color: '#71717a',
    fontSize: 14,
    fontStyle: 'italic',
  },
  trackItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    backgroundColor: '#18181b',
    padding: 10,
    borderRadius: 12,
  },
  trackInfo: {
    flex: 1,
    marginLeft: 12,
  },
  trackTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  trackSubtitle: {
    color: '#a1a1aa',
    fontSize: 13,
  },
  trackRight: {
    marginLeft: 10,
  },
  rightText: {
    fontSize: 13,
    fontWeight: '700',
  }
});
