import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getRecentHistory, getMostPlayed, getTotalListeningTime, PlayHistoryItem, MostPlayedItem } from '../services/statsDatabase';
import { useThemeStore } from '../store/useThemeStore';
import { useStore } from '../store/useStore';
import { TrackArtwork } from '../components/TrackArtwork';
import { cleanYouTubeTitle } from '../services/lyricsService';

export default function StatisticsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useThemeStore((s) => s.theme);
  
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

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours} sa ${minutes} dk`;
    }
    return `${minutes} dakika`;
  };

  const getTrackInfo = (trackId: string) => {
    const asset = allAssets.find((a) => a.id === trackId);
    const meta = metadataMap[trackId];
    
    let title = meta?.title?.trim() || '';
    if (!title && asset) {
      title = cleanYouTubeTitle(asset.filename);
    } else if (title) {
      title = cleanYouTubeTitle(title);
    } else {
      title = `Bilinmeyen Şarkı`;
    }

    let artist = meta?.artist?.trim() || 'Bilinmeyen Sanatçı';
    if (artist === 'Local Audio') artist = 'Bilinmeyen Sanatçı';

    return { title, artist, uri: asset?.uri };
  };

  const renderTrackItem = (trackId: string, subtitle: string, rightText?: string) => {
    const info = getTrackInfo(trackId);
    return (
      <View key={Math.random().toString()} style={styles.trackItem}>
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
        <Text style={styles.headerTitle}>İstatistikler ve Geçmiş</Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabContainer}>
        <TouchableOpacity 
          style={[styles.tabBtn, activeTab === 'overview' && { borderBottomColor: theme.primary, borderBottomWidth: 2 }]}
          onPress={() => setActiveTab('overview')}
        >
          <Text style={[styles.tabText, activeTab === 'overview' && { color: theme.primary, fontWeight: '700' }]}>
            Genel Bakış
          </Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.tabBtn, activeTab === 'history' && { borderBottomColor: theme.primary, borderBottomWidth: 2 }]}
          onPress={() => setActiveTab('history')}
        >
          <Text style={[styles.tabText, activeTab === 'history' && { color: theme.primary, fontWeight: '700' }]}>
            Dinleme Geçmişi
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
              {/* Total Time Card */}
              <View style={styles.card}>
                <Ionicons name="time-outline" size={32} color={theme.primary} />
                <View style={styles.cardTextContent}>
                  <Text style={styles.cardTitle}>Toplam Dinleme Süresi</Text>
                  <Text style={styles.cardValue}>{formatDuration(totalTime)}</Text>
                </View>
              </View>

              {/* Most Played This Month */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Bu Ay En Çok Dinlenenler</Text>
                {mostPlayedMonth.length > 0 ? (
                  mostPlayedMonth.map((item) => renderTrackItem(item.track_id, getTrackInfo(item.track_id).artist, `${item.play_count} kez`))
                ) : (
                  <Text style={styles.emptyText}>Henüz yeterli veri yok.</Text>
                )}
              </View>

              {/* Most Played All Time */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Tüm Zamanların En Çok Dinlenenleri</Text>
                {mostPlayedAllTime.length > 0 ? (
                  mostPlayedAllTime.map((item) => renderTrackItem(item.track_id, getTrackInfo(item.track_id).artist, `${item.play_count} kez`))
                ) : (
                  <Text style={styles.emptyText}>Henüz yeterli veri yok.</Text>
                )}
              </View>
            </>
          ) : (
            /* History Tab */
            <View style={styles.section}>
              {recentHistory.length > 0 ? (
                recentHistory.map((item) => {
                  const date = new Date(item.played_at);
                  const dateStr = date.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
                  return renderTrackItem(item.track_id, dateStr);
                })
              ) : (
                <Text style={styles.emptyText}>Dinleme geçmişi boş.</Text>
              )}
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
