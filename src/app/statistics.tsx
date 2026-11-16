import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getRecentHistory,
  getMostPlayed,
  getTotalListeningTime,
  getTotalHistoryCount,
  getHistoryInRange,
  PlayHistoryItem,
  MostPlayedItem,
} from '../services/statsDatabase';
import {
  buildWrappedStats,
  formatWrappedDuration,
  resolveWrappedPersona,
  resolveWrappedWindow,
  type WrappedPeriod,
  type WrappedRankedItem,
  type WrappedStats,
} from '../services/wrappedStats';
import { useDownloadStore } from '../store/useDownloadStore';
import { startPlaybackFromLibrary } from '../services/queueController';

import { useThemeStore } from '../store/useThemeStore';
import { useStore } from '../store/useStore';
import { TrackArtwork } from '../components/TrackArtwork';
import { AdBanner } from '../components/AdBanner';
import { cleanTrackFields } from '../services/displayNames';
import { useTranslation } from '../services/i18n';

const PAGE_SIZE = 50;

/** Ayrıntılı istatistiklerde listelenecek en fazla satır sayısı. */
const DETAIL_LIMIT = 25;

const DETAIL_PERIODS: WrappedPeriod[] = ['year', 'last12m', 'all'];

const EMPTY_DETAIL: WrappedStats = buildWrappedStats([]);

const PERSONA_TITLE_KEYS: Record<string, string> = {
  explorer: 'wrapped.persona_explorer',
  devoted: 'wrapped.persona_devoted',
  nightowl: 'wrapped.persona_nightowl',
  marathoner: 'wrapped.persona_marathoner',
  balanced: 'wrapped.persona_balanced',
};

const PERSONA_DESC_KEYS: Record<string, string> = {
  explorer: 'wrapped.persona_explorer_desc',
  devoted: 'wrapped.persona_devoted_desc',
  nightowl: 'wrapped.persona_nightowl_desc',
  marathoner: 'wrapped.persona_marathoner_desc',
  balanced: 'wrapped.persona_balanced_desc',
};

const WEEKDAY_SHORT_KEYS = [
  'stats.weekday_short_mon',
  'stats.weekday_short_tue',
  'stats.weekday_short_wed',
  'stats.weekday_short_thu',
  'stats.weekday_short_fri',
  'stats.weekday_short_sat',
  'stats.weekday_short_sun',
];

export default function StatisticsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useThemeStore((s) => s.theme);
  const { t, resolvedLanguage } = useTranslation();

  const durationLabels = {
    hour: t('wrapped.unit_hour'),
    minute: t('wrapped.unit_minute'),
    second: t('wrapped.unit_second'),
  };

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
  const [mostPlayedMonth, setMostPlayedMonth] = useState<MostPlayedItem[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'history'>('overview');

  // Wrapped ile aynı hesapları kullanan ayrıntılı istatistikler.
  const [detailPeriod, setDetailPeriod] = useState<WrappedPeriod>('all');
  const [detail, setDetail] = useState<WrappedStats>(EMPTY_DETAIL);
  const [detailLoading, setDetailLoading] = useState(true);

  const [refreshing, setRefreshing] = useState(false);

  const loadStats = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const [time, history, mostMonth, count] = await Promise.all([
        getTotalListeningTime(),
        getRecentHistory(PAGE_SIZE, 0),
        getMostPlayed(10, 'month'),
        getTotalHistoryCount(),
      ]);
      setTotalTime(time);
      setRecentHistory(history);
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

  /**
   * Ayrıntılı istatistikler: seçilen dönemin tüm geçmişi çekilip Wrapped'in
   * saf istatistik modülüyle hesaplanır. Böylece buradaki sayılar Wrapped'teki
   * sayılarla birebir aynı olur; fark yalnızca liste uzunluğudur (burada 25).
   */
  const loadDetail = useCallback(async (period: WrappedPeriod) => {
    setDetailLoading(true);
    try {
      const range = resolveWrappedWindow(period, Date.now());
      const rows = await getHistoryInRange(range.startSql, range.endSql);
      // Geçmişteki ham isimler de uygulamanın genel isim politikasına uysun.
      const cleaned = rows.map((row) => {
        const fields = cleanTrackFields(row.title, row.artist);
        return { ...row, title: fields.title || row.title, artist: fields.artist };
      });
      setDetail(buildWrappedStats(cleaned, { limit: DETAIL_LIMIT }));
    } catch (e) {
      console.warn('Detailed stats fetch error:', e);
      setDetail(EMPTY_DETAIL);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDetail(detailPeriod);
  }, [detailPeriod, loadDetail]);

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
    void loadDetail(detailPeriod);
  }, [loadStats, loadDetail, detailPeriod]);

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
      const fields = cleanTrackFields(historyItem.title, historyItem.artist);
      const asset = allAssets.find((a) => a.id === trackId) || library.find((a) => a.id === trackId);
      const task = downloadTasks.find((t) => t.id === trackId || t.mediaLibraryAssetId === trackId);
      return {
        title: fields.title || unknownTrack,
        artist: fields.artist || unknownArtist,
        uri: asset?.uri || task?.localFileUri,
        artwork: historyItem.artwork || metadataMap[trackId]?.artwork || artworkMap[trackId],
      };
    }

    const meta = metadataMap[trackId];
    const asset = allAssets.find((a) => a.id === trackId) || library.find((a) => a.id === trackId);
    const task = downloadTasks.find((t) => t.id === trackId || t.mediaLibraryAssetId === trackId);

    const rawTitle = meta?.title?.trim() || task?.title?.trim() || asset?.filename || '';
    const fields = cleanTrackFields(rawTitle, meta?.artist || task?.artist);

    return {
      title: fields.title || unknownTrack,
      artist: fields.artist || unknownArtist,
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

  /** Ayrıntılı dönem listesindeki sanatçı satırı (harf rozeti). */
  const renderArtistRow = (item: WrappedRankedItem, index: number) => {
    const initial = (item.label || '?').trim().charAt(0).toUpperCase();
    return (
      <View key={`artist-${item.key}`} style={styles.trackItem}>
        <Text style={[styles.rankIndex, index === 0 && { color: theme.primary }]}>
          {index + 1}
        </Text>
        <View style={[styles.artistBadge, { backgroundColor: `${theme.primary}26` }]}>
          <Text style={[styles.artistBadgeText, { color: theme.primary }]}>{initial}</Text>
        </View>
        <View style={styles.trackInfo}>
          <Text style={styles.trackTitle} numberOfLines={1}>{item.label || '—'}</Text>
          <Text style={styles.trackSubtitle} numberOfLines={1}>
            {formatWrappedDuration(item.seconds, durationLabels)}
          </Text>
        </View>
        <Text style={[styles.rightText, { color: theme.primary }]}>
          {item.plays} {t('stats.plays_suffix')}
        </Text>
      </View>
    );
  };

  /** Ayrıntılı dönem listesindeki parça satırı (dokununca kütüphaneden çalar). */
  const renderRankedTrack = (item: WrappedRankedItem, index: number) => {
    const asset =
      allAssets.find((a) => a.id === item.key) || library.find((a) => a.id === item.key);
    const task = downloadTasks.find(
      (t) => t.id === item.key || t.mediaLibraryAssetId === item.key
    );
    const uri = asset?.uri || task?.localFileUri;
    const artwork = item.artwork || metadataMap[item.key]?.artwork || artworkMap[item.key];

    return (
      <TouchableOpacity
        key={`track-${item.key}`}
        style={styles.trackItem}
        activeOpacity={uri ? 0.7 : 1}
        onPress={() => {
          if (uri) void handlePlayTrack(item.key);
        }}>
        <Text style={[styles.rankIndex, index === 0 && { color: theme.primary }]}>
          {index + 1}
        </Text>
        {artwork ? (
          <Image source={{ uri: artwork }} style={styles.rankArtwork} contentFit="cover" />
        ) : (
          <View style={[styles.rankArtwork, styles.rankArtworkFallback]}>
            <Ionicons name="musical-note" size={18} color="#71717a" />
          </View>
        )}
        <View style={styles.trackInfo}>
          <Text style={styles.trackTitle} numberOfLines={1}>{item.label || '—'}</Text>
          <Text style={styles.trackSubtitle} numberOfLines={1}>
            {item.subtitle ? `${item.subtitle} · ` : ''}
            {formatWrappedDuration(item.seconds, durationLabels)}
          </Text>
        </View>
        <Text style={[styles.rightText, { color: theme.primary }]}>
          {item.plays} {t('stats.plays_suffix')}
        </Text>
      </TouchableOpacity>
    );
  };

  const summaryTiles = [
    {
      key: 'plays',
      icon: 'play-circle-outline' as const,
      label: t('stats.total_plays'),
      value: String(detail.totalPlays),
    },
    {
      key: 'time',
      icon: 'time-outline' as const,
      label: t('wrapped.total_time'),
      value: formatWrappedDuration(detail.totalSeconds, durationLabels),
    },
    {
      key: 'tracks',
      icon: 'musical-notes-outline' as const,
      label: t('wrapped.total_tracks'),
      value: String(detail.uniqueTracks),
    },
    {
      key: 'artists',
      icon: 'people-outline' as const,
      label: t('wrapped.total_artists'),
      value: String(detail.uniqueArtists),
    },
    {
      key: 'days',
      icon: 'calendar-outline' as const,
      label: t('wrapped.streak_active'),
      value: String(detail.activeDays),
    },
  ];

  const habitRows: { label: string; value: string }[] = [
    {
      label: t('wrapped.streak_longest'),
      value: t('wrapped.streak_days', { count: detail.longestStreak }),
    },
    {
      label: t('wrapped.streak_discovery'),
      value: String(detail.onePlayArtists),
    },
  ];
  if (detail.busiestHour !== null) {
    habitRows.unshift({
      label: t('wrapped.time_busiest_hour'),
      value: t('wrapped.time_hour_format', { hour: detail.busiestHour }),
    });
  }
  if (detail.busiestDay) {
    habitRows.unshift({
      label: t('wrapped.streak_busiest'),
      value: `${formatLocalDay(detail.busiestDay.dateKey, resolvedLanguage)} · ${detail.busiestDay.plays}`,
    });
  }

  const persona = resolveWrappedPersona(detail);
  const hourMax = Math.max(1, ...detail.hourHistogram);
  const weekdayMax = Math.max(1, ...detail.weekdayHistogram);

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

              {/* RunMusic Wrapped girişi */}
              <TouchableOpacity
                style={[styles.wrappedCard, { borderColor: `${theme.primary}55` }]}
                activeOpacity={0.85}
                onPress={() => router.push('/wrapped')}>
                <View style={[styles.wrappedGlow, { backgroundColor: theme.glowColor }]} />
                <View style={[styles.wrappedIcon, { backgroundColor: `${theme.primary}26` }]}>
                  <Ionicons name="sparkles" size={20} color={theme.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.wrappedTitle}>{t('wrapped.statistics_card_title')}</Text>
                  <Text style={styles.wrappedDesc}>{t('wrapped.statistics_card_desc')}</Text>
                </View>
                <View style={[styles.wrappedCta, { backgroundColor: theme.primary }]}>
                  <Text style={styles.wrappedCtaText}>{t('wrapped.statistics_card_cta')}</Text>
                </View>
              </TouchableOpacity>

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

              {/* Dönem seçici */}
              <Text style={styles.sectionLabel}>{t('stats.period_label')}</Text>
              <View style={styles.periodRow}>
                {DETAIL_PERIODS.map((period) => {
                  const active = detailPeriod === period;
                  const labelKey =
                    period === 'year'
                      ? 'wrapped.period_year'
                      : period === 'last12m'
                        ? 'wrapped.period_last12m'
                        : 'wrapped.period_all';
                  return (
                    <TouchableOpacity
                      key={period}
                      style={[
                        styles.periodChip,
                        active && { backgroundColor: `${theme.primary}26`, borderColor: theme.primary },
                      ]}
                      onPress={() => setDetailPeriod(period)}
                      activeOpacity={0.8}>
                      <Text
                        style={[styles.periodChipText, active && { color: theme.primary, fontWeight: '700' }]}>
                        {t(labelKey)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {detailLoading ? (
                <View style={styles.detailLoading}>
                  <ActivityIndicator size="small" color={theme.primary} />
                </View>
              ) : detail.totalPlays === 0 ? (
                <Text style={styles.emptyText}>{t('stats.detail_empty')}</Text>
              ) : (
                <>
                  {/* Özet kutuları */}
                  <View style={styles.summaryGrid}>
                    {summaryTiles.map((tile) => (
                      <View key={tile.key} style={styles.summaryTile}>
                        <Ionicons name={tile.icon} size={18} color={theme.primary} />
                        <Text style={styles.summaryValue} numberOfLines={1}>
                          {tile.value}
                        </Text>
                        <Text style={styles.summaryLabel} numberOfLines={1}>
                          {tile.label}
                        </Text>
                      </View>
                    ))}
                  </View>

                  {/* Dinleme alışkanlıkları */}
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{t('stats.detail_habits')}</Text>

                    <View style={[styles.habitCard, { borderColor: `${theme.primary}33` }]}>
                      <Text style={[styles.personaTitle, { color: theme.primary }]}>
                        {t(PERSONA_TITLE_KEYS[persona])}
                      </Text>
                      <Text style={styles.personaDesc}>{t(PERSONA_DESC_KEYS[persona])}</Text>

                      <View style={styles.habitDivider} />

                      {habitRows.map((row) => (
                        <View key={row.label} style={styles.habitRow}>
                          <Text style={styles.habitLabel}>{row.label}</Text>
                          <Text style={styles.habitValue} numberOfLines={1}>
                            {row.value}
                          </Text>
                        </View>
                      ))}
                    </View>

                    {/* Saat dağılımı */}
                    <Text style={styles.chartTitle}>{t('stats.hour_distribution')}</Text>
                    <View style={styles.chartCard}>
                      <View style={styles.hourBars}>
                        {detail.hourHistogram.map((count, hour) => (
                          <View key={`hour-${hour}`} style={styles.hourBarSlot}>
                            <View
                              style={[
                                styles.hourBar,
                                {
                                  height: Math.max(2, Math.round((count / hourMax) * 72)),
                                  backgroundColor:
                                    count === 0
                                      ? '#27272a'
                                      : detail.busiestHour === hour
                                        ? theme.primary
                                        : `${theme.primary}80`,
                                },
                              ]}
                            />
                          </View>
                        ))}
                      </View>
                      <View style={styles.hourLabels}>
                        {[0, 6, 12, 18, 23].map((hour) => (
                          <Text key={`hl-${hour}`} style={styles.hourLabel}>
                            {hour}
                          </Text>
                        ))}
                      </View>
                    </View>

                    {/* Hafta günü dağılımı */}
                    <Text style={styles.chartTitle}>{t('stats.weekday_distribution')}</Text>
                    <View style={[styles.chartCard, styles.weekdayCard]}>
                      {detail.weekdayHistogram.map((count, index) => (
                        <View key={`weekday-${index}`} style={styles.weekdaySlot}>
                          <View
                            style={[
                              styles.weekdayBar,
                              {
                                height: Math.max(2, Math.round((count / weekdayMax) * 56)),
                                backgroundColor:
                                  count === 0
                                    ? '#27272a'
                                    : detail.busiestWeekday === index
                                      ? theme.primary
                                      : `${theme.primary}80`,
                              },
                            ]}
                          />
                          <Text style={styles.weekdayLabel}>{t(WEEKDAY_SHORT_KEYS[index])}</Text>
                        </View>
                      ))}
                    </View>
                  </View>

                  {/* En çok dinlenen sanatçılar */}
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{t('stats.detail_artists')}</Text>
                    {detail.topArtists.length > 0 ? (
                      detail.topArtists.map((item, index) => renderArtistRow(item, index))
                    ) : (
                      <Text style={styles.emptyText}>{t('stats.no_data')}</Text>
                    )}
                  </View>

                  {/* En çok dinlenen parçalar */}
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{t('stats.detail_tracks')}</Text>
                    {detail.topTracks.length > 0 ? (
                      detail.topTracks.map((item, index) => renderRankedTrack(item, index))
                    ) : (
                      <Text style={styles.emptyText}>{t('stats.no_data')}</Text>
                    )}
                  </View>
                </>
              )}

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

/** `YYYY-MM-DD` yerel gün anahtarını okunur kısa tarihe çevirir. */
function formatLocalDay(dateKey: string, language: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month || !day) return dateKey;
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString(language === 'tr' ? 'tr-TR' : 'en-US', {
    day: 'numeric',
    month: 'short',
  });
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
  wrappedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#18181b',
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
    overflow: 'hidden',
  },
  wrappedGlow: {
    position: 'absolute',
    top: -60,
    right: -40,
    width: 150,
    height: 150,
    borderRadius: 75,
    opacity: 0.5,
  },
  wrappedIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wrappedTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },
  wrappedDesc: {
    fontSize: 12,
    color: '#a1a1aa',
    marginTop: 2,
  },
  wrappedCta: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  wrappedCtaText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ffffff',
  },
  card: {
    flexDirection: 'row',
    backgroundColor: '#18181b',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 20,
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
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#71717a',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  periodRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  periodChip: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#27272a',
    backgroundColor: '#18181b',
    alignItems: 'center',
  },
  periodChipText: {
    fontSize: 12,
    color: '#a1a1aa',
    fontWeight: '600',
  },
  detailLoading: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
  },
  summaryTile: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 96,
    backgroundColor: '#18181b',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#27272a',
    paddingVertical: 14,
    paddingHorizontal: 12,
    gap: 4,
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#ffffff',
  },
  summaryLabel: {
    fontSize: 11,
    color: '#a1a1aa',
  },
  habitCard: {
    backgroundColor: '#18181b',
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 18,
  },
  personaTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  personaDesc: {
    fontSize: 12,
    color: '#a1a1aa',
    marginTop: 3,
    lineHeight: 17,
  },
  habitDivider: {
    height: 1,
    backgroundColor: '#27272a',
    marginVertical: 12,
  },
  habitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 5,
    gap: 10,
  },
  habitLabel: {
    fontSize: 12,
    color: '#71717a',
  },
  habitValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
    flexShrink: 1,
    textAlign: 'right',
  },
  chartTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#d4d4d8',
    marginBottom: 8,
  },
  chartCard: {
    backgroundColor: '#18181b',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#27272a',
    padding: 12,
    marginBottom: 14,
  },
  hourBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 76,
    gap: 2,
  },
  hourBarSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  hourBar: {
    width: '100%',
    borderRadius: 2,
  },
  hourLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  hourLabel: {
    fontSize: 10,
    color: '#71717a',
  },
  weekdayCard: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 96,
  },
  weekdaySlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  weekdayBar: {
    width: '55%',
    borderRadius: 3,
  },
  weekdayLabel: {
    fontSize: 10,
    color: '#71717a',
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
  },
  rankIndex: {
    width: 18,
    fontSize: 12,
    fontWeight: '800',
    color: '#52525b',
    textAlign: 'center',
  },
  rankArtwork: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#27272a',
  },
  rankArtworkFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  artistBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  artistBadgeText: {
    fontSize: 16,
    fontWeight: '800',
  },
});
