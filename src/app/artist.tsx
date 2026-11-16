import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useActiveTrack } from 'react-native-track-player';

import { useStore } from '../store/useStore';
import { useThemeStore } from '../store/useThemeStore';
import { TrackArtwork } from '../components/TrackArtwork';
import { AdBanner } from '../components/AdBanner';
import { getHistoryInRange, type PlayHistoryItem } from '../services/statsDatabase';
import {
  buildArtistProfile,
  buildArtistIndex,
  getArtistTracks,
  sortTracksByPlays,
  type ArtistTrack,
  type ArtistProfile,
} from '../services/artistProfile';
import { normalizeArtistKey, artistNamesFromRow } from '../services/artistMatch';
import {
  formatWrappedDuration,
  resolveWrappedWindow,
  type WrappedPeriod,
} from '../services/wrappedStats';
import { cleanTrackFields, cleanArtistName, isPlaceholderArtist } from '../services/displayNames';
import { getSearchKeywords } from '../services/lyricsService';
import { loadArtistImages } from '../services/artistImages';
import { startPlaybackFromLibrary } from '../services/queueController';
import { useTranslation } from '../services/i18n';

const PERIODS: WrappedPeriod[] = ['year', 'last12m', 'all'];
const TOP_TRACK_COUNT = 5;

const TRACK_INFO_CACHE = new Map<string, { title: string; artist: string }>();
const MAX_TRACK_INFO_CACHE = 4000;

/** Apple Music'in ince ayraç çizgisi. */
const HAIRLINE = '#2c2c2e';
const SECONDARY_TEXT = '#a1a1a6';

type MetadataLike = { title?: string; artist?: string; album?: string; artwork?: string };

/**
 * Kütüphane varlığını görünen başlık/sanatçıya çözer.
 *
 * `index.tsx` içindeki kütüphane listesiyle **aynı** sıra izlenir (önce
 * metadataMap, sonra dosya adı ayrıştırma). Böylece listede "UZI, MODD" yazan
 * parça sanatçı sayfasında da aynı sanatçılara düşer.
 */
function resolveLibraryInfo(
  asset: { id: string; uri: string; filename: string; modificationTime?: number },
  metadataMap: Record<string, MetadataLike>
): { title: string; artist: string } {
  const meta = metadataMap[asset.id] || metadataMap[asset.uri];
  const cacheKey = `${asset.id}_${asset.modificationTime || 0}_${meta?.title || ''}_${meta?.artist || ''}`;
  const cached = TRACK_INFO_CACHE.get(cacheKey);
  if (cached) return cached;

  const metaTitle = meta?.title?.trim() || '';
  const rawMetaArtist = meta?.artist?.trim() || '';
  const metaArtist = isPlaceholderArtist(rawMetaArtist) ? '' : cleanArtistName(rawMetaArtist);

  let info: { title: string; artist: string };
  if (metaTitle && metaArtist) {
    info = { title: cleanTrackFields(metaTitle, metaArtist).title, artist: metaArtist };
  } else {
    const keywords = getSearchKeywords(asset.filename);
    const keywordArtist = isPlaceholderArtist(keywords.expectedArtist)
      ? ''
      : cleanArtistName(keywords.expectedArtist);
    const fields = cleanTrackFields(metaTitle || keywords.expectedTrack || asset.filename, metaArtist);
    info = { title: fields.title, artist: fields.artist || keywordArtist };
  }

  if (TRACK_INFO_CACHE.size >= MAX_TRACK_INFO_CACHE) TRACK_INFO_CACHE.clear();
  TRACK_INFO_CACHE.set(cacheKey, info);
  return info;
}

/** `199` → `3:19` (Apple Music satır sonundaki süre biçimi). */
function formatTrackDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds || 0));
  if (total <= 0) return '';
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/** Bölüm başlığı: Apple'ınkiler gibi büyük, kalın ve çerçevesiz. */
function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export default function ArtistScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ name?: string | string[] }>();
  const theme = useThemeStore((s) => s.theme);
  const { t, resolvedLanguage } = useTranslation();
  const activeTrack = useActiveTrack();

  const artistName = Array.isArray(params.name) ? params.name[0] : params.name || '';
  const artistKey = normalizeArtistKey(artistName);

  const library = useStore((s) => s.library);
  const metadataMap = useStore((s) => s.metadataMap);
  const artworkMap = useStore((s) => s.artworkMap);

  const [period, setPeriod] = useState<WrappedPeriod>('all');
  const [profile, setProfile] = useState<ArtistProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [artistImage, setArtistImage] = useState<string | null>(null);

  const durationLabels = {
    hour: t('wrapped.unit_hour'),
    minute: t('wrapped.unit_minute'),
    second: t('wrapped.unit_second'),
  };

  /** Cihazdaki sanatçı parçaları (önbellekli çözümlemeyle). */
  const artistTracks = useMemo<ArtistTrack[]>(() => {
    const inputs: ArtistTrack[] = library.map((asset) => {
      const info = resolveLibraryInfo(asset, metadataMap);
      return {
        id: asset.id,
        uri: asset.uri,
        title: info.title,
        artist: info.artist,
        album: metadataMap[asset.id]?.album || undefined,
        artwork: metadataMap[asset.id]?.artwork || artworkMap[asset.id] || undefined,
        duration: asset.duration || 0,
      };
    });

    const index = buildArtistIndex(inputs);
    return getArtistTracks(index, artistKey);
  }, [library, metadataMap, artworkMap, artistKey]);

  /** Dönem değiştikçe o sanatçının istatistikleri yeniden hesaplanır. */
  const loadProfile = useCallback(
    async (nextPeriod: WrappedPeriod) => {
      setLoading(true);
      try {
        const range = resolveWrappedWindow(nextPeriod, Date.now());
        const rows = await getHistoryInRange(range.startSql, range.endSql);
        // İsim politikası: geçmişteki ham etiketler de temizlenir.
        const cleaned: PlayHistoryItem[] = rows.map((row) => {
          const fields = cleanTrackFields(row.title, row.artist);
          return { ...row, title: fields.title || row.title, artist: fields.artist };
        });
        setProfile(buildArtistProfile(cleaned, artistKey, { limit: TOP_TRACK_COUNT }));
      } catch (e) {
        console.warn('Artist stats fetch error:', e);
        setProfile(buildArtistProfile([], artistKey));
      } finally {
        setLoading(false);
      }
    },
    [artistKey]
  );

  useEffect(() => {
    void loadProfile(period);
  }, [period, loadProfile]);

  // Fotoğraf dönemden bağımsız olarak bir kez getirilir.
  useEffect(() => {
    let cancelled = false;
    if (!artistName) return;
    void loadArtistImages([artistName])
      .then((images) => {
        if (cancelled) return;
        setArtistImage(images[normalizeArtistKey(artistName)] || null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [artistName]);

  const sortedTracks = useMemo(() => {
    const playCounts = profile?.playCounts ?? new Map<string, number>();
    return sortTracksByPlays(artistTracks, playCounts);
  }, [artistTracks, profile]);

  /** Başlıkta gösterilecek isim: geçmiş → kütüphane → ham parametre. */
  const displayName = useMemo(() => {
    if (profile?.displayName) return profile.displayName;
    for (const track of artistTracks) {
      const match = artistNamesFromRow(track.artist).find(
        (part) => normalizeArtistKey(part) === artistKey
      );
      if (match?.trim()) return match.trim();
    }
    return artistName;
  }, [profile, artistTracks, artistKey, artistName]);

  const stats = profile?.stats;
  const artistHistoryCount = stats?.totalPlays ?? 0;

  const queueFrom = useCallback(
    (tracks: ArtistTrack[], startId: string, shuffle = false) =>
      startPlaybackFromLibrary({
        tracks: tracks.map((track) => ({
          id: track.id,
          url: track.uri,
          title: track.title,
          artist: track.artist,
          artwork: track.artwork || undefined,
          duration: track.duration,
        })),
        startId,
        shuffle,
      }),
    []
  );

  const startPlayback = useCallback(
    async (shuffle: boolean) => {
      if (sortedTracks.length === 0) return;
      try {
        await queueFrom(sortedTracks, sortedTracks[0].id, shuffle);
      } catch (e) {
        console.warn('Failed to play artist queue:', e);
      }
    },
    [sortedTracks, queueFrom]
  );

  const playTrack = useCallback(
    async (track: ArtistTrack) => {
      if (sortedTracks.length === 0) return;
      try {
        await queueFrom(sortedTracks, track.id);
      } catch (e) {
        console.warn('Failed to play artist track:', e);
      }
    },
    [sortedTracks, queueFrom]
  );

  const formatDay = (ms: number | null) => {
    if (!ms) return t('artist.never');
    return new Date(ms).toLocaleDateString(resolvedLanguage === 'tr' ? 'tr-TR' : 'en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const initial = (displayName || '?').trim().charAt(0).toUpperCase();
  const topTracks = stats?.topTracks ?? [];

  /** Apple Music'teki düz metrik satırları (kart/çerçeve yok). */
  const metrics: { label: string; value: string }[] = [
    { label: t('wrapped.total_plays'), value: String(stats?.totalPlays ?? 0) },
    {
      label: t('wrapped.total_time'),
      value: formatWrappedDuration(stats?.totalSeconds ?? 0, durationLabels),
    },
    { label: t('wrapped.total_tracks'), value: String(stats?.uniqueTracks ?? 0) },
    { label: t('wrapped.streak_active'), value: String(stats?.activeDays ?? 0) },
  ];

  const detailRows: { label: string; value: string }[] = [
    { label: t('artist.first_play'), value: formatDay(stats?.firstPlayAt ?? null) },
    { label: t('artist.last_play'), value: formatDay(stats?.lastPlayAt ?? null) },
  ];
  if (stats?.busiestHour != null) {
    detailRows.push({
      label: t('wrapped.time_busiest_hour'),
      value: t('wrapped.time_hour_format', { hour: stats.busiestHour }),
    });
  }
  if (stats?.longestStreak) {
    detailRows.push({
      label: t('wrapped.streak_longest'),
      value: t('wrapped.streak_days', { count: stats.longestStreak }),
    });
  }

  const renderHeader = () => (
    <View>
      {/* ── HERO: tam genişlik bulanık zemin + dev yuvarlak fotoğraf + dev isim ── */}
      <View style={[styles.hero, { paddingTop: Math.max(insets.top, 12) }]}>
        {artistImage ? (
          <Image
            source={{ uri: artistImage }}
            style={styles.heroBackdrop}
            contentFit="cover"
            blurRadius={60}
          />
        ) : null}
        <View style={styles.heroScrim} />
        <View style={styles.heroScrimBottom} />

        <View style={styles.heroBody}>
          {artistImage ? (
            <Image source={{ uri: artistImage }} style={styles.heroPhoto} contentFit="cover" />
          ) : (
            <View style={[styles.heroPhoto, styles.heroPhotoFallback]}>
              <Text style={styles.heroPhotoText}>{initial}</Text>
            </View>
          )}

          <Text style={styles.heroName} numberOfLines={2}>
            {displayName || t('common.unknown_artist')}
          </Text>
          <Text style={styles.heroMeta}>
            {t('artist.songs_count', { count: artistTracks.length })}
            {artistHistoryCount > 0
              ? ` · ${t('artist.plays_total', { count: artistHistoryCount })}`
              : ''}
          </Text>
        </View>
      </View>

      {/* ── Eylemler: büyük dolu "Çal" + ikincil "Karıştır" ── */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[
            styles.primaryButton,
            { backgroundColor: artistTracks.length > 0 ? theme.primary : '#2c2c2e' },
          ]}
          activeOpacity={0.82}
          disabled={artistTracks.length === 0}
          onPress={() => void startPlayback(false)}>
          <Ionicons name="play" size={19} color="#ffffff" />
          <Text style={styles.primaryButtonText}>{t('artist.play')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryButton}
          activeOpacity={0.82}
          disabled={artistTracks.length === 0}
          onPress={() => void startPlayback(true)}>
          <Ionicons name="shuffle" size={19} color={theme.primary} />
          <Text style={[styles.secondaryButtonText, { color: theme.primary }]}>
            {t('artist.shuffle')}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Dönem: iOS segmentli kontrol görünümü ── */}
      <View style={styles.segmented}>
        {PERIODS.map((item) => {
          const active = period === item;
          const labelKey =
            item === 'year'
              ? 'wrapped.period_year'
              : item === 'last12m'
                ? 'wrapped.period_last12m'
                : 'wrapped.period_all';
          return (
            <TouchableOpacity
              key={item}
              style={[styles.segment, active && styles.segmentActive]}
              onPress={() => setPeriod(item)}
              activeOpacity={0.8}>
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                {t(labelKey)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── İstatistikler: Apple'ın editoryal blokları gibi çerçevesiz ── */}
      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="small" color={theme.primary} />
        </View>
      ) : artistHistoryCount === 0 ? (
        <Text style={styles.emptyNote}>{t('artist.no_stats')}</Text>
      ) : (
        <>
          <View style={styles.metricGrid}>
            {metrics.map((metric) => (
              <View key={metric.label} style={styles.metricCell}>
                <Text style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit>
                  {metric.value}
                </Text>
                <Text style={styles.metricLabel} numberOfLines={1}>
                  {metric.label}
                </Text>
              </View>
            ))}
          </View>

          <View style={styles.detailBlock}>
            {detailRows.map((row) => (
              <View key={row.label} style={styles.detailRow}>
                <Text style={styles.detailLabel}>{row.label}</Text>
                <Text style={styles.detailValue} numberOfLines={1}>
                  {row.value}
                </Text>
              </View>
            ))}
          </View>

          {/* ── En Çok Dinlediklerin ── */}
          {topTracks.length > 0 ? (
            <View style={styles.section}>
              <SectionHeader title={t('artist.top_tracks')} />
              {topTracks.map((item, index) => {
                const match = sortedTracks.find(
                  (track) => track.id === item.key || track.uri === item.key
                );
                return (
                  <TouchableOpacity
                    key={`top-${item.key}`}
                    style={styles.row}
                    activeOpacity={match ? 0.6 : 1}
                    onPress={() => {
                      if (match) void playTrack(match);
                    }}>
                    <View style={styles.rankSlot}>
                      <Text style={styles.rankText}>{index + 1}</Text>
                    </View>
                    {item.artwork ? (
                      <Image
                        source={{ uri: item.artwork }}
                        style={styles.rowArtwork}
                        contentFit="cover"
                      />
                    ) : (
                      <View style={[styles.rowArtwork, styles.rowArtworkFallback]}>
                        <Ionicons name="musical-note" size={18} color="#6e6e73" />
                      </View>
                    )}
                    <View style={styles.rowText}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {item.label || '—'}
                      </Text>
                      <Text style={styles.rowSubtitle} numberOfLines={1}>
                        {item.plays} {t('stats.plays_suffix')}
                      </Text>
                    </View>
                    <Ionicons name="ellipsis-horizontal" size={16} color="#6e6e73" />
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}
        </>
      )}

      <View style={styles.section}>
        <SectionHeader
          title={t('artist.songs')}
          subtitle={
            artistTracks.length > 0
              ? t('artist.songs_count', { count: artistTracks.length })
              : undefined
          }
        />
      </View>
    </View>
  );

  const renderTrack = ({ item, index }: { item: ArtistTrack; index: number }) => {
    const isCurrent =
      activeTrack != null && (activeTrack.id === item.id || activeTrack.url === item.uri);
    const plays =
      profile?.playCounts.get(item.id) ?? (item.uri ? profile?.playCounts.get(item.uri) : 0) ?? 0;

    return (
      <TouchableOpacity
        style={styles.row}
        activeOpacity={0.6}
        onPress={() => void playTrack(item)}>
        <TrackArtwork
          uri={item.artwork || metadataMap[item.id]?.artwork || artworkMap[item.id]}
          trackId={item.id}
          trackUri={item.uri}
          size={52}
          borderRadius={4}
          iconSize={20}
        />
        <View style={styles.rowText}>
          <Text
            style={[styles.rowTitle, isCurrent && { color: theme.primary }]}
            numberOfLines={1}>
            {item.title || t('common.unknown_track')}
          </Text>
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {item.album ? `${item.album} · ` : ''}
            {plays > 0 ? t('artist.plays_total', { count: plays }) : t('artist.not_played')}
          </Text>
        </View>
        {isCurrent ? (
          <Ionicons name="volume-medium" size={17} color={theme.primary} />
        ) : (
          <Text style={styles.rowDuration}>{formatTrackDuration(item.duration)}</Text>
        )}
        <View style={styles.rowDivider} />
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={sortedTracks}
        keyExtractor={(item) => `artist-track-${item.id}`}
        renderItem={renderTrack}
        ListHeaderComponent={renderHeader()}
        ListEmptyComponent={
          <Text style={[styles.emptyNote, { paddingHorizontal: 20 }]}>{t('artist.no_songs')}</Text>
        }
        ListFooterComponent={
          <View style={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 130 }}>
            <AdBanner style={{ marginTop: 20 }} />
          </View>
        }
        contentContainerStyle={{ paddingBottom: 16 }}
        showsVerticalScrollIndicator={false}
      />

      {/* Geri / menü: hero üzerinde yüzen düğmeler */}
      <View style={[styles.topBar, { top: Math.max(insets.top, 12) }]} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.circleButton}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/statistics'))}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={22} color="#ffffff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },

  // ── Hero ────────────────────────────────────────────────────────────────
  hero: {
    paddingBottom: 4,
    overflow: 'hidden',
  },
  heroBackdrop: {
    position: 'absolute',
    top: -40,
    left: -40,
    right: -40,
    bottom: -40,
    opacity: 0.85,
  },
  heroScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  heroScrimBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 160,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  heroBody: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 20,
  },
  heroPhoto: {
    width: 186,
    height: 186,
    borderRadius: 93,
    backgroundColor: '#1c1c1e',
  },
  heroPhotoFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  heroPhotoText: {
    fontSize: 64,
    fontWeight: '800',
    color: '#ffffff',
  },
  heroName: {
    marginTop: 18,
    fontSize: 34,
    lineHeight: 39,
    fontWeight: '800',
    letterSpacing: -0.8,
    color: '#ffffff',
    textAlign: 'center',
  },
  heroMeta: {
    marginTop: 6,
    fontSize: 14,
    color: SECONDARY_TEXT,
    textAlign: 'center',
  },
  topBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  circleButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },

  // ── Eylemler ────────────────────────────────────────────────────────────
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 18,
  },
  primaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 13,
    borderRadius: 12,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: '#1c1c1e',
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },

  // ── Segmentli dönem seçici ──────────────────────────────────────────────
  segmented: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 20,
    padding: 2,
    borderRadius: 9,
    backgroundColor: '#1c1c1e',
  },
  segment: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 7,
    alignItems: 'center',
  },
  segmentActive: {
    backgroundColor: '#48484a',
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '500',
    color: SECONDARY_TEXT,
  },
  segmentTextActive: {
    color: '#ffffff',
    fontWeight: '600',
  },

  // ── Metrikler (çerçevesiz) ──────────────────────────────────────────────
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 14,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  metricCell: {
    flexBasis: '50%',
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  metricValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: -0.3,
  },
  metricLabel: {
    marginTop: 2,
    fontSize: 12,
    color: SECONDARY_TEXT,
  },
  detailBlock: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 6,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 7,
    gap: 12,
  },
  detailLabel: {
    fontSize: 14,
    color: SECONDARY_TEXT,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
    flexShrink: 1,
    textAlign: 'right',
  },

  // ── Bölümler ────────────────────────────────────────────────────────────
  section: {
    marginTop: 18,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.4,
    color: '#ffffff',
  },
  sectionSubtitle: {
    marginTop: 2,
    fontSize: 13,
    color: SECONDARY_TEXT,
  },
  loadingBox: {
    paddingVertical: 26,
    alignItems: 'center',
  },
  emptyNote: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    fontSize: 14,
    color: '#6e6e73',
  },

  // ── Düz liste satırları ─────────────────────────────────────────────────
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 8,
    gap: 12,
  },
  rowArtwork: {
    width: 52,
    height: 52,
    borderRadius: 4,
    backgroundColor: '#1c1c1e',
  },
  rowArtworkFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  rowSubtitle: {
    fontSize: 13,
    color: SECONDARY_TEXT,
  },
  rowDuration: {
    fontSize: 13,
    color: SECONDARY_TEXT,
    fontVariant: ['tabular-nums'],
  },
  rowDivider: {
    position: 'absolute',
    left: 20,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: HAIRLINE,
  },
  rankSlot: {
    width: 18,
    alignItems: 'center',
  },
  rankText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6e6e73',
    fontVariant: ['tabular-nums'],
  },
});
