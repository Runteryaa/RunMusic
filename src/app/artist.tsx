import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useActiveTrack } from 'react-native-track-player';

import { GradientSurface, withAlpha } from '../components/ui/GradientSurface';
import { useStore } from '../store/useStore';
import { useThemeStore } from '../store/useThemeStore';
import { TrackArtwork } from '../components/TrackArtwork';
import { AdBanner } from '../components/AdBanner';
import {
  getHistoryInRangeForArtists,
  type PlayHistoryItem,
} from '../services/statsDatabase';
import {
  buildArtistProfileFromRows,
  buildArtistIndex,
  collectArtistNameVariants,
  getArtistTracks,
  sortTracksByPlays,
  type ArtistLibraryEntry,
  type ArtistProfile,
  type ArtistTrack,
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
import { useBackToLibrary } from '../hooks/useBackToLibrary';

const PERIODS: WrappedPeriod[] = ['year', 'last12m', 'all'];
const TOP_TRACK_COUNT = 5;

/**
 * Kütüphane bilgisi önbelleği.
 *
 * `clear()` yerine en eski kayıtların bir kısmı atılır: büyük kütüphanelerde
 * her taşmada tüm önbelleği boşaltmak aynı parçaların yeniden ayrıştırılmasına
 * yol açıyordu.
 */
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

  if (TRACK_INFO_CACHE.size >= MAX_TRACK_INFO_CACHE) {
    const drop = Math.floor(MAX_TRACK_INFO_CACHE * 0.15);
    let removed = 0;
    for (const key of TRACK_INFO_CACHE.keys()) {
      TRACK_INFO_CACHE.delete(key);
      if (++removed >= drop) break;
    }
  }
  TRACK_INFO_CACHE.set(cacheKey, info);
  return info;
}

/**
 * Sanatçı indeksi önbelleği.
 *
 * Tüm kütüphaneyi her açılışta yeniden gruplamak büyük kütüphanelerde
 * gözle görülür bir gecikme yaratıyordu. İndeks yalnızca `library` veya
 * `metadataMap` referansı değişince yeniden kurulur.
 */
let indexCache: {
  library: unknown;
  metadataMap: unknown;
  index: Map<string, ArtistLibraryEntry>;
} | null = null;

function getCachedArtistIndex(
  library: { id: string; uri: string; filename: string; modificationTime?: number; duration?: number }[],
  metadataMap: Record<string, MetadataLike>
): Map<string, ArtistLibraryEntry> {
  if (indexCache && indexCache.library === library && indexCache.metadataMap === metadataMap) {
    return indexCache.index;
  }

  const inputs: ArtistTrack[] = library.map((asset) => {
    const info = resolveLibraryInfo(asset, metadataMap);
    return {
      id: asset.id,
      uri: asset.uri,
      title: info.title,
      artist: info.artist,
      album: metadataMap[asset.id]?.album || undefined,
      artwork: metadataMap[asset.id]?.artwork || undefined,
      duration: asset.duration || 0,
    };
  });

  const index = buildArtistIndex(inputs);
  indexCache = { library, metadataMap, index };
  return index;
}

/** `199` → `3:19` (satır sonundaki süre). */
function formatTrackDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds || 0));
  if (total <= 0) return '';
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export default function ArtistScreen() {
  const router = useRouter();
  // Geri tuşu kütüphaneye döner; oynatıcı çalmaya devam eder.
  useBackToLibrary();
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

  // Ekran kapandıktan sonra gelen sonuçların state yazmasını engeller
  // (hızlı geri dönüşlerde gereksiz iş yapılmaz).
  const mountedRef = useRef(true);
  /** Yalnızca en son dönem isteğinin sonucu uygulanır. */
  const requestRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const durationLabels = {
    hour: t('wrapped.unit_hour'),
    minute: t('wrapped.unit_minute'),
    second: t('wrapped.unit_second'),
  };

  /** Cihazdaki sanatçı parçaları (indeks önbellekli). */
  const artistTracks = useMemo<ArtistTrack[]>(() => {
    const index = getCachedArtistIndex(library, metadataMap);
    return getArtistTracks(index, artistKey);
  }, [library, metadataMap, artistKey]);

  /**
   * İstatistikler artık SQL'de ön süzülür: yalnızca bu sanatçının satırları
   * çekilir. Önceden tüm geçmiş (`SELECT *`) köprüden geçip JS'te süzülüyordu;
   * "Tüm Zamanlar" seçiliyken on binlerce satırda bu, ekranı saniyelerce
   * kilitliyordu.
   */
  const loadProfile = useCallback(
    async (nextPeriod: WrappedPeriod) => {
      // Dönem hızlıca değiştirilirse eski isteğin sonucu yenisini ezmesin.
      const requestId = ++requestRef.current;
      setLoading(true);
      try {
        const range = resolveWrappedWindow(nextPeriod, Date.now());
        const names = [
          artistName,
          ...collectArtistNameVariants(artistTracks, artistKey),
        ].filter(Boolean);

        const rows = await getHistoryInRangeForArtists(range.startSql, range.endSql, names);

        // SQL ön süzmesi alt dize eşleşmesidir; kesin eşleşme JS'te doğrulanır.
        const cleaned: PlayHistoryItem[] = [];
        for (const row of rows) {
          const matches = artistNamesFromRow(row.artist).some(
            (name) => normalizeArtistKey(name) === artistKey
          );
          if (!matches) continue;
          const fields = cleanTrackFields(row.title, row.artist);
          cleaned.push({ ...row, title: fields.title || row.title, artist: fields.artist });
        }

        if (!mountedRef.current || requestId !== requestRef.current) return;
        setProfile(buildArtistProfileFromRows(cleaned, artistKey, { limit: TOP_TRACK_COUNT }));
      } catch (e) {
        console.warn('Artist stats fetch error:', e);
        if (mountedRef.current && requestId === requestRef.current) {
          setProfile(buildArtistProfileFromRows([], artistKey));
        }
      } finally {
        if (mountedRef.current && requestId === requestRef.current) setLoading(false);
      }
    },
    [artistKey, artistName, artistTracks]
  );

  useEffect(() => {
    void loadProfile(period);
  }, [period, loadProfile]);

  /**
   * Fotoğraf: sanatçı sayfası açılır açılmaz (istatistiklerden bağımsız)
   * yüklenir. Kütüphanedeki parça adları ipucu olarak verilir ki Deezer'da
   * aynı adı taşıyan yanlış sanatçı seçilmesin.
   */
  useEffect(() => {
    let cancelled = false;
    if (!artistName) return;
    const titles = artistTracks.slice(0, 12).map((track) => track.title).filter(Boolean);
    void loadArtistImages([artistName], { [artistKey]: titles })
      .then((images) => {
        if (!cancelled) setArtistImage(images[artistKey] || null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [artistName, artistKey, artistTracks]);

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

  const header = (
    <View>
      {/* ── Sanatçı kartı: uygulamanın kart dilinde, tema rengiyle ── */}
      <View style={[styles.heroCard, { borderColor: `${theme.primary}44` }]}>
        {/* Tema renginden koyu karta akan yüzey; düz #18181b yerine derinlik. */}
        <GradientSurface
          pointerEvents="none"
          colors={[withAlpha(theme.primary, 0.3), withAlpha(theme.primary, 0.04), '#18181b']}
          locations={[0, 0.55, 1]}
          direction="diagonal"
          borderRadius={20}
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.heroGlow, { backgroundColor: theme.glowColor }]} />
        {artistImage ? (
          <Image source={{ uri: artistImage }} style={styles.heroPhoto} contentFit="cover" />
        ) : (
          <View style={[styles.heroPhoto, { backgroundColor: `${theme.primary}26` }]}>
            <Text style={[styles.heroPhotoText, { color: theme.primary }]}>{initial}</Text>
          </View>
        )}
        <Text style={styles.heroName} numberOfLines={2}>
          {displayName || t('common.unknown_artist')}
        </Text>
        <Text style={styles.heroMeta}>
          {t('artist.songs_count', { count: artistTracks.length })}
          {artistHistoryCount > 0 ? ` · ${t('artist.plays_total', { count: artistHistoryCount })}` : ''}
        </Text>
      </View>

      {/* ── Çal / Karıştır ── */}
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

      {/* ── Dönem ── */}
      <Text style={styles.sectionLabel}>{t('stats.period_label')}</Text>
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
                style={[styles.periodChipText, active && { color: theme.primary, fontWeight: '700' }]}>
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
      ) : artistHistoryCount === 0 ? (
        <Text style={styles.emptyText}>{t('artist.no_stats')}</Text>
      ) : (
        <>
          {/* Özet kartları */}
          <View style={styles.summaryGrid}>
            {summaryTiles.map((tile) => (
              <View key={tile.key} style={styles.summaryTile}>
                <Ionicons name={tile.icon} size={18} color={theme.primary} />
                <Text style={styles.summaryValue} numberOfLines={1} adjustsFontSizeToFit>
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

          {/* En çok dinlediklerin */}
          {topTracks.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('artist.top_tracks')}</Text>
              {topTracks.map((item, index) => {
                const match = sortedTracks.find(
                  (track) => track.id === item.key || track.uri === item.key
                );
                return (
                  <TouchableOpacity
                    key={`top-${item.key}`}
                    style={styles.row}
                    activeOpacity={match ? 0.75 : 1}
                    onPress={() => {
                      if (match) void playTrack(match);
                    }}>
                    <Text style={[styles.rankIndex, index === 0 && { color: theme.primary }]}>
                      {index + 1}
                    </Text>
                    {item.artwork ? (
                      <Image source={{ uri: item.artwork }} style={styles.rankArtwork} contentFit="cover" />
                    ) : (
                      <View style={[styles.rankArtwork, styles.rankArtworkFallback]}>
                        <Ionicons name="musical-note" size={16} color="#71717a" />
                      </View>
                    )}
                    <View style={styles.rowInfo}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {item.label || '—'}
                      </Text>
                      <Text style={styles.rowSubtitle} numberOfLines={1}>
                        {formatWrappedDuration(item.seconds, durationLabels)}
                      </Text>
                    </View>
                    <Text style={[styles.rowRight, { color: theme.primary }]}>
                      {item.plays} {t('stats.plays_suffix')}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}
        </>
      )}

      <Text style={styles.sectionTitle}>
        {t('artist.songs')}
        {artistTracks.length > 0 ? ` (${artistTracks.length})` : ''}
      </Text>
    </View>
  );

  const renderTrack = ({ item }: { item: ArtistTrack }) => {
    const isCurrent =
      activeTrack != null && (activeTrack.id === item.id || activeTrack.url === item.uri);
    const plays =
      profile?.playCounts.get(item.id) ?? (item.uri ? profile?.playCounts.get(item.uri) : 0) ?? 0;

    return (
      <TouchableOpacity
        style={[
          styles.trackCard,
          isCurrent && { borderColor: `${theme.primary}66`, backgroundColor: `${theme.primary}14` },
        ]}
        activeOpacity={0.75}
        onPress={() => void playTrack(item)}>
        <TrackArtwork
          uri={item.artwork || metadataMap[item.id]?.artwork || artworkMap[item.id]}
          trackId={item.id}
          trackUri={item.uri}
          size={46}
          borderRadius={8}
          iconSize={20}
        />
        <View style={styles.rowInfo}>
          <Text style={[styles.rowTitle, isCurrent && { color: theme.primary }]} numberOfLines={1}>
            {item.title || t('common.unknown_track')}
          </Text>
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {item.album ? `${item.album} · ` : ''}
            {plays > 0 ? t('artist.plays_total', { count: plays }) : t('artist.not_played')}
          </Text>
        </View>
        {isCurrent ? (
          <Ionicons name="volume-medium" size={18} color={theme.primary} />
        ) : (
          <Text style={styles.trackDuration}>{formatTrackDuration(item.duration)}</Text>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 12) }]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/statistics'))}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {t('artist.title')}
        </Text>
      </View>

      <FlashList
        data={sortedTracks}
        keyExtractor={(item) => `artist-track-${item.id}`}
        renderItem={renderTrack}
        style={{ flex: 1 }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <Text style={[styles.emptyText, { paddingHorizontal: 16 }]}>{t('artist.no_songs')}</Text>
        }
        ListFooterComponent={
          <View style={{ paddingBottom: insets.bottom + 110 }}>
            <AdBanner style={{ marginTop: 12 }} />
          </View>
        }
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />
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
    paddingBottom: 12,
  },
  backBtn: {
    marginRight: 14,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },

  // ── Sanatçı kartı ───────────────────────────────────────────────────────
  heroCard: {
    alignItems: 'center',
    backgroundColor: '#18181b',
    borderRadius: 20,
    borderWidth: 1,
    paddingVertical: 22,
    paddingHorizontal: 20,
    marginBottom: 16,
    overflow: 'hidden',
  },
  heroGlow: {
    position: 'absolute',
    top: -80,
    right: -60,
    width: 190,
    height: 190,
    borderRadius: 95,
    opacity: 0.5,
  },
  heroPhoto: {
    width: 112,
    height: 112,
    borderRadius: 56,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#27272a',
  },
  heroPhotoText: {
    fontSize: 42,
    fontWeight: '800',
  },
  heroName: {
    marginTop: 14,
    fontSize: 26,
    fontWeight: '800',
    color: '#ffffff',
    textAlign: 'center',
    letterSpacing: -0.4,
  },
  heroMeta: {
    marginTop: 5,
    fontSize: 13,
    color: '#a1a1aa',
    textAlign: 'center',
  },

  // ── Eylemler ────────────────────────────────────────────────────────────
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
    gap: 7,
    paddingVertical: 13,
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
    gap: 7,
    paddingVertical: 13,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: '#18181b',
  },
  shuffleButtonText: {
    fontSize: 15,
    fontWeight: '700',
  },

  // ── Dönem ───────────────────────────────────────────────────────────────
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

  // ── Özet / alışkanlık ───────────────────────────────────────────────────
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  summaryTile: {
    flexGrow: 1,
    flexBasis: '45%',
    minWidth: 120,
    backgroundColor: '#18181b',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#27272a',
    paddingVertical: 13,
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

  // ── Listeler ────────────────────────────────────────────────────────────
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    backgroundColor: '#18181b',
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 12,
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
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: '#27272a',
  },
  rankArtworkFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowInfo: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 3,
  },
  rowSubtitle: {
    fontSize: 12,
    color: '#a1a1aa',
  },
  rowRight: {
    fontSize: 12,
    fontWeight: '700',
  },
  trackCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 12,
    gap: 12,
  },
  trackDuration: {
    fontSize: 12,
    color: '#71717a',
    fontVariant: ['tabular-nums'],
  },
  loadingBox: {
    paddingVertical: 30,
    alignItems: 'center',
  },
  emptyText: {
    color: '#71717a',
    fontSize: 14,
    fontStyle: 'italic',
    paddingVertical: 12,
  },
});
