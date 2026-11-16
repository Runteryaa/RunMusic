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

  // Fotoğraf yalnızca bir kez (dönemden bağımsız) getirilir.
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

  const startPlayback = useCallback(
    async (shuffle: boolean) => {
      if (sortedTracks.length === 0) return;
      try {
        await startPlaybackFromLibrary({
          tracks: sortedTracks.map((track) => ({
            id: track.id,
            url: track.uri,
            title: track.title,
            artist: track.artist,
            artwork: track.artwork || undefined,
            duration: track.duration,
          })),
          startId: sortedTracks[0].id,
          shuffle,
        });
      } catch (e) {
        console.warn('Failed to play artist queue:', e);
      }
    },
    [sortedTracks]
  );

  const playTrack = useCallback(
    async (track: ArtistTrack) => {
      if (sortedTracks.length === 0) return;
      try {
        await startPlaybackFromLibrary({
          tracks: sortedTracks.map((item) => ({
            id: item.id,
            url: item.uri,
            title: item.title,
            artist: item.artist,
            artwork: item.artwork || undefined,
            duration: item.duration,
          })),
          startId: track.id,
          shuffle: false,
        });
      } catch (e) {
        console.warn('Failed to play artist track:', e);
      }
    },
    [sortedTracks]
  );

  const formatDay = (ms: number | null) => {
    if (!ms) return t('artist.never');
    return new Date(ms).toLocaleDateString(resolvedLanguage === 'tr' ? 'tr-TR' : 'en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const summaryTiles = [
    {
      key: 'plays',
      icon: 'play-circle-outline' as const,
      value: String(stats?.totalPlays ?? 0),
      label: t('wrapped.total_plays'),
    },
    {
      key: 'time',
      icon: 'time-outline' as const,
      value: formatWrappedDuration(stats?.totalSeconds ?? 0, durationLabels),
      label: t('wrapped.total_time'),
    },
    {
      key: 'tracks',
      icon: 'musical-notes-outline' as const,
      value: String(stats?.uniqueTracks ?? 0),
      label: t('wrapped.total_tracks'),
    },
    {
      key: 'days',
      icon: 'calendar-outline' as const,
      value: String(stats?.activeDays ?? 0),
      label: t('wrapped.streak_active'),
    },
  ];

  const habitRows: { label: string; value: string }[] = [
    { label: t('artist.first_play'), value: formatDay(stats?.firstPlayAt ?? null) },
    { label: t('artist.last_play'), value: formatDay(stats?.lastPlayAt ?? null) },
  ];
  if (stats?.busiestHour != null) {
    habitRows.push({
      label: t('wrapped.time_busiest_hour'),
      value: t('wrapped.time_hour_format', { hour: stats.busiestHour }),
    });
  }
  if (stats?.longestStreak) {
    habitRows.push({
      label: t('wrapped.streak_longest'),
      value: t('wrapped.streak_days', { count: stats.longestStreak }),
    });
  }

  const topTracks = stats?.topTracks ?? [];
  const initial = (displayName || '?').trim().charAt(0).toUpperCase();

  const renderHeader = () => (
    <View>
      {/* Hero: bulanık fotoğraf + katman + yuvarlak fotoğraf */}
      <View style={styles.hero}>
        {artistImage ? (
          <Image
            source={{ uri: artistImage }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            blurRadius={40}
          />
        ) : null}
        <View style={styles.heroOverlay} />
        <View style={styles.heroContent}>
          {artistImage ? (
            <Image source={{ uri: artistImage }} style={styles.heroAvatar} contentFit="cover" />
          ) : (
            <View style={[styles.heroAvatar, styles.heroAvatarFallback]}>
              <Text style={[styles.heroAvatarText, { color: '#ffffff' }]}>{initial}</Text>
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

      <View style={styles.body}>
        {/* Çal / Karıştır */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[
              styles.playButton,
              { backgroundColor: artistTracks.length > 0 ? theme.primary : '#27272a' },
            ]}
            activeOpacity={0.85}
            disabled={artistTracks.length === 0}
            onPress={() => void startPlayback(false)}>
            <Ionicons name="play" size={18} color="#ffffff" />
            <Text style={styles.playButtonText}>{t('artist.play')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.shuffleButton, { borderColor: `${theme.primary}88` }]}
            activeOpacity={0.85}
            disabled={artistTracks.length === 0}
            onPress={() => void startPlayback(true)}>
            <Ionicons name="shuffle" size={18} color={theme.primary} />
            <Text style={[styles.shuffleButtonText, { color: theme.primary }]}>
              {t('artist.shuffle')}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Dönem seçici */}
        <View style={styles.periodRow}>
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
                style={[
                  styles.periodChip,
                  active && { backgroundColor: `${theme.primary}26`, borderColor: theme.primary },
                ]}
                onPress={() => setPeriod(item)}
                activeOpacity={0.8}>
                <Text
                  style={[
                    styles.periodChipText,
                    active && { color: theme.primary, fontWeight: '700' },
                  ]}>
                  {t(labelKey)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color={theme.primary} />
          </View>
        ) : !stats || stats.totalPlays === 0 ? (
          <Text style={styles.emptyText}>{t('artist.no_stats')}</Text>
        ) : (
          <>
            {/* Özet kutuları */}
            <View style={styles.summaryGrid}>
              {summaryTiles.map((tile) => (
                <View key={tile.key} style={styles.summaryTile}>
                  <Ionicons name={tile.icon} size={16} color={theme.primary} />
                  <Text style={styles.summaryValue} numberOfLines={1}>
                    {tile.value}
                  </Text>
                  <Text style={styles.summaryLabel} numberOfLines={1}>
                    {tile.label}
                  </Text>
                </View>
              ))}
            </View>

            {/* Alışkanlıklar */}
            <View style={[styles.habitCard, { borderColor: `${theme.primary}33` }]}>
              {habitRows.map((row) => (
                <View key={row.label} style={styles.habitRow}>
                  <Text style={styles.habitLabel}>{row.label}</Text>
                  <Text style={styles.habitValue} numberOfLines={1}>
                    {row.value}
                  </Text>
                </View>
              ))}
            </View>

            {/* En çok dinlediğin */}
            {topTracks.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{t('artist.top_tracks')}</Text>
                {topTracks.map((item, index) => (
                  <TouchableOpacity
                    key={`top-${item.key}`}
                    style={styles.topRow}
                    activeOpacity={0.75}
                    onPress={() => {
                      const match = sortedTracks.find(
                        (track) => track.id === item.key || track.uri === item.key
                      );
                      if (match) void playTrack(match);
                    }}>
                    <Text style={[styles.rankIndex, index === 0 && { color: theme.primary }]}>
                      {index + 1}
                    </Text>
                    {item.artwork ? (
                      <Image
                        source={{ uri: item.artwork }}
                        style={styles.rankArtwork}
                        contentFit="cover"
                      />
                    ) : (
                      <View style={[styles.rankArtwork, styles.rankArtworkFallback]}>
                        <Ionicons name="musical-note" size={16} color="#71717a" />
                      </View>
                    )}
                    <View style={styles.trackInfo}>
                      <Text style={styles.trackTitle} numberOfLines={1}>
                        {item.label || '—'}
                      </Text>
                      <Text style={styles.trackSubtitle} numberOfLines={1}>
                        {formatWrappedDuration(item.seconds, durationLabels)}
                      </Text>
                    </View>
                    <Text style={[styles.rightText, { color: theme.primary }]}>
                      {item.plays} {t('stats.plays_suffix')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
          </>
        )}

        <Text style={styles.sectionTitle}>
          {t('artist.songs')}
          {artistTracks.length > 0 ? ` (${artistTracks.length})` : ''}
        </Text>
      </View>
    </View>
  );

  const renderTrack = ({ item }: { item: ArtistTrack }) => {
    const isCurrent = activeTrack != null && (activeTrack.id === item.id || activeTrack.url === item.uri);
    const plays =
      profile?.playCounts.get(item.id) ?? (item.uri ? profile?.playCounts.get(item.uri) : 0) ?? 0;

    return (
      <TouchableOpacity
        style={[styles.trackRow, isCurrent && { backgroundColor: `${theme.primary}1f` }]}
        activeOpacity={0.7}
        onPress={() => void playTrack(item)}>
        <TrackArtwork
          uri={item.artwork || metadataMap[item.id]?.artwork || artworkMap[item.id]}
          trackId={item.id}
          trackUri={item.uri}
          size={48}
          borderRadius={8}
          iconSize={20}
        />
        <View style={styles.trackInfo}>
          <Text
            style={[styles.trackTitle, isCurrent && { color: theme.primary }]}
            numberOfLines={1}>
            {item.title || t('common.unknown_track')}
          </Text>
          <Text style={styles.trackSubtitle} numberOfLines={1}>
            {item.album ? `${item.album} · ` : ''}
            {plays > 0 ? t('artist.plays_total', { count: plays }) : t('artist.not_played')}
          </Text>
        </View>
        {isCurrent ? <Ionicons name="volume-medium" size={18} color={theme.primary} /> : null}
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
          <View style={styles.body}>
            <Text style={styles.emptyText}>{t('artist.no_songs')}</Text>
          </View>
        }
        ListFooterComponent={
          <View style={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 120 }}>
            <AdBanner style={{ marginTop: 12 }} />
          </View>
        }
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      />

      {/* Geri düğmesi hero üzerinde */}
      <TouchableOpacity
        style={[styles.backBtn, { top: Math.max(insets.top, 12) }]}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/statistics'))}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Ionicons name="chevron-back" size={24} color="#ffffff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  hero: {
    height: 300,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    backgroundColor: '#18181b',
  },
  heroOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(18,18,18,0.62)',
  },
  heroContent: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 20,
  },
  heroAvatar: {
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: '#27272a',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  heroAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroAvatarText: {
    fontSize: 48,
    fontWeight: '800',
  },
  heroName: {
    marginTop: 12,
    fontSize: 26,
    fontWeight: '800',
    color: '#ffffff',
    textAlign: 'center',
  },
  heroMeta: {
    marginTop: 4,
    fontSize: 13,
    color: '#d4d4d8',
    textAlign: 'center',
  },
  backBtn: {
    position: 'absolute',
    left: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  body: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 18,
  },
  playButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 999,
  },
  playButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  shuffleButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: '#18181b',
  },
  shuffleButtonText: {
    fontSize: 15,
    fontWeight: '700',
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
  loadingBox: {
    paddingVertical: 30,
    alignItems: 'center',
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  summaryTile: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 96,
    backgroundColor: '#18181b',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#27272a',
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 3,
  },
  summaryValue: {
    fontSize: 17,
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
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 18,
  },
  habitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
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
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 10,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 10,
  },
  rankIndex: {
    width: 16,
    fontSize: 12,
    fontWeight: '800',
    color: '#52525b',
    textAlign: 'center',
  },
  rankArtwork: {
    width: 40,
    height: 40,
    borderRadius: 7,
    backgroundColor: '#27272a',
  },
  rankArtworkFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  rightText: {
    fontSize: 12,
    fontWeight: '700',
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 12,
  },
  trackInfo: {
    flex: 1,
  },
  trackTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 3,
  },
  trackSubtitle: {
    fontSize: 12,
    color: '#a1a1aa',
  },
  emptyText: {
    color: '#71717a',
    fontSize: 14,
    fontStyle: 'italic',
    paddingVertical: 16,
  },
});
