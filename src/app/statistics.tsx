import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getRecentHistory, getMostPlayed, getTotalListeningTime, PlayHistoryItem, MostPlayedItem } from '../services/statsDatabase';
import { useThemeStore } from '../store/useThemeStore';
import { useStore } from '../store/useStore';
import { TrackArtwork } from '../components/TrackArtwork';
import { AdBanner } from '../components/AdBanner';
import { cleanDisplayTitle } from '../services/lyricsService';
import { useTranslation } from '../services/i18n';

export default function StatisticsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useThemeStore((s) => s.theme);
  const { t, resolvedLanguage } = useTranslation();
  
  const allAssets = useStore((s) => s.allAssets);
  const metadataMap = useStore((s) => s.metadataMap);
  const artworkMap = useStore((s) => s.artworkMap);

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
      const [time, history, mostAll, mostMonth] = await Promise.all([
        getTotalListeningTime(),
        getRecentHistory(30),
        getMostPlayed(10),
        getMostPlayed(10, 'month'),
      ]);
      setTotalTime(time);
      setRecentHistory(history);
      setMostPlayedAllTime(mostAll);
      setMostPlayedMonth(mostMonth);
    } catch (e) {
      console.warn('Stats fetch error:', e);
    } finally {
      if (!isRefresh) setLoading(false);
      if (isRefresh) setRefreshing(false);
    }
  }, []);

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

  const getTrackInfo = (trackId: string) => {
    const asset = allAssets.find((a) => a.id === trackId);
    const meta = metadataMap[trackId];
    const unknownArtist = t('common.unknown_artist');

    let artist = meta?.artist?.trim() || unknownArtist;
    if (artist === 'Local Audio' || artist === 'Bilinmeyen Sanatçı') artist = unknownArtist;

    let rawTitle = meta?.title?.trim() || '';
    if (!rawTitle && asset) {
      rawTitle = asset.filename;
    }

    let title = rawTitle
      ? cleanDisplayTitle(rawTitle, artist !== unknownArtist ? artist : undefined)
      : t('common.unknown_track');

    return { title, artist, uri: asset?.uri };
  };

  const renderTrackItem = (trackId: string, subtitle: string, rightText?: string, keySuffix?: string | number) => {
    const info = getTrackInfo(trackId);
    const itemKey = keySuffix != null ? `${trackId}-${keySuffix}` : trackId;
    return (
      <View key={itemKey} style={styles.trackItem}>
        <TrackArtwork
          uri={metadataMap[trackId]?.artwork || artworkMap[trackId]}
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
      </View>
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
                      getTrackInfo(item.track_id).artist,
                      `${item.play_count} ${resolvedLanguage === 'tr' ? 'kez' : 'plays'}`,
                      `month-${idx}`
                    )
                  )
                ) : (
                  <Text style={styles.emptyText}>{t('stats.no_data')}</Text>
                )}
              </View>

              {/* Ad Banner - Orta Bölüm */}
              <AdBanner style={{ marginVertical: 8 }} />

              {/* Most Played All Time */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  {t('stats.top_tracks_all_time')}
                </Text>
                {mostPlayedAllTime.length > 0 ? (
                  mostPlayedAllTime.map((item, idx) =>
                    renderTrackItem(
                      item.track_id,
                      getTrackInfo(item.track_id).artist,
                      `${item.play_count} ${resolvedLanguage === 'tr' ? 'kez' : 'plays'}`,
                      `all-${idx}`
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

              {recentHistory.length > 0 ? (
                recentHistory.map((item, idx) => {
                  const date = new Date(item.played_at);
                  const dateStr = date.toLocaleDateString(resolvedLanguage === 'tr' ? 'tr-TR' : 'en-US', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  });
                  return (
                    <React.Fragment key={`hist-${item.played_at}-${idx}`}>
                      {renderTrackItem(item.track_id, dateStr, undefined, `hist-${item.played_at}-${idx}`)}
                      {(idx + 1) % 15 === 0 && idx !== recentHistory.length - 1 ? (
                        <AdBanner style={{ marginVertical: 6 }} />
                      ) : null}
                    </React.Fragment>
                  );
                })
              ) : (
                <Text style={styles.emptyText}>
                  {t('stats.history_empty')}
                </Text>
              )}

              {/* Ad Banner - Geçmiş Sonu */}
              {recentHistory.length > 0 && <AdBanner style={{ marginTop: 8 }} />}
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
