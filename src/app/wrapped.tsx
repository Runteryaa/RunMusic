import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getHistoryInRange } from '../services/statsDatabase';
import { useStore } from '../store/useStore';
import { useThemeStore } from '../store/useThemeStore';
import { useTranslation } from '../services/i18n';
import type { ThemeColors } from '../services/colorThemeService';
import {
  WRAPPED_SLIDE_IDS,
  buildWrappedStats,
  formatDateInput,
  formatWrappedDuration,
  normalizeWrappedPreferences,
  parseDateInput,
  resolveWrappedPersona,
  resolveWrappedWindow,
  type WrappedPeriod,
  type WrappedPreferences,
  type WrappedRankedItem,
  type WrappedSlideId,
  type WrappedStats,
} from '../services/wrappedStats';

/**
 * RunMusic Wrapped.
 *
 * Tek veri kaynağı uygulamanın kendi dinleme geçmişidir (`play_history`).
 * Bağlantılar (Last.fm / ListenBrainz) burada okunmaz; iki özellik birbirinden
 * tamamen bağımsızdır.
 *
 * Görsel derinlik gradient yerine tema renginden türetilen yarı saydam
 * katmanlarla sağlanır: `expo-linear-gradient` native modül olduğu için
 * eklenmedi (mevcut APK'ların OTA alabilmesi için runtimeVersion sabit).
 */

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const SLIDE_TITLE_KEYS: Record<WrappedSlideId, string> = {
  intro: 'wrapped.slide_intro',
  totals: 'wrapped.slide_totals',
  tracks: 'wrapped.slide_tracks',
  artists: 'wrapped.slide_artists',
  albums: 'wrapped.slide_albums',
  time: 'wrapped.slide_time',
  streak: 'wrapped.slide_streak',
  persona: 'wrapped.slide_persona',
};

const WEEKDAY_KEYS = [
  'wrapped.weekday_mon',
  'wrapped.weekday_tue',
  'wrapped.weekday_wed',
  'wrapped.weekday_thu',
  'wrapped.weekday_fri',
  'wrapped.weekday_sat',
  'wrapped.weekday_sun',
];

const EMPTY_STATS: WrappedStats = buildWrappedStats([]);

export default function WrappedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useThemeStore((s) => s.theme);
  const { t, resolvedLanguage } = useTranslation();
  const { width } = useWindowDimensions();

  const preferences = useStore((s) => s.preferences);
  const updatePreferences = useStore((s) => s.updatePreferences);
  const wrappedPrefs = preferences.wrapped;

  const [period, setPeriod] = useState<WrappedPeriod>('year');
  const [customStart, setCustomStart] = useState(() =>
    formatDateInput(new Date(new Date().getFullYear(), 0, 1).getTime())
  );
  const [customEnd, setCustomEnd] = useState(() => formatDateInput(Date.now()));
  const [customError, setCustomError] = useState(false);

  const [stats, setStats] = useState<WrappedStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [pageIndex, setPageIndex] = useState(0);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const slides = useMemo(() => {
    const selected = wrappedPrefs?.slides?.length ? wrappedPrefs.slides : [...WRAPPED_SLIDE_IDS];
    return selected;
  }, [wrappedPrefs]);

  const loadStats = useCallback(
    async (nextPeriod: WrappedPeriod, startText: string, endText: string) => {
      setLoading(true);
      try {
        let customRange: { startMs: number; endMs: number } | undefined;
        if (nextPeriod === 'custom') {
          const startMs = parseDateInput(startText);
          const endMs = parseDateInput(endText);
          if (startMs === null || endMs === null) {
            setCustomError(true);
            setStats(EMPTY_STATS);
            return;
          }
          setCustomError(false);
          customRange = {
            startMs,
            // Bitiş günü dahil: o günün son anına kadar.
            endMs: endMs + ONE_DAY_MS - 1,
          };
        }

        const range = resolveWrappedWindow(nextPeriod, Date.now(), customRange);
        const rows = await getHistoryInRange(range.startSql, range.endSql);
        setStats(buildWrappedStats(rows, { limit: 5 }));
        setPageIndex(0);
        scrollRef.current?.scrollTo({ x: 0, animated: false });
      } catch {
        setStats(EMPTY_STATS);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Hazır dönemlerde anında yükle.
  useEffect(() => {
    if (period === 'custom') return;
    void loadStats(period, customStart, customEnd);
    // Özel aralık metinleri hazır dönemlerde kullanılmaz; bağımlılığa gerek yok.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, loadStats]);

  // Özel aralıkta her tuş vuruşunda sorgu atmamak için kısa bir bekleme.
  useEffect(() => {
    if (period !== 'custom') return;
    const timer = setTimeout(() => {
      void loadStats('custom', customStart, customEnd);
    }, 450);
    return () => clearTimeout(timer);
  }, [period, customStart, customEnd, loadStats]);

  // Kişiselleştirmede slayt kapatılırsa mevcut sayfa aralık dışında kalabilir.
  useEffect(() => {
    if (pageIndex <= slides.length - 1) return;
    const lastIndex = Math.max(0, slides.length - 1);
    setPageIndex(lastIndex);
    scrollRef.current?.scrollTo({ x: lastIndex * width, animated: false });
  }, [slides.length, pageIndex, width]);

  const goToPage = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(slides.length - 1, index));
      setPageIndex(clamped);
      scrollRef.current?.scrollTo({ x: clamped * width, animated: true });
    },
    [slides.length, width]
  );

  const periodLabel = t(
    period === 'year'
      ? 'wrapped.period_year'
      : period === 'last12m'
        ? 'wrapped.period_last12m'
        : period === 'all'
          ? 'wrapped.period_all'
          : 'wrapped.period_custom'
  );

  const durationLabels = {
    hour: t('wrapped.unit_hour'),
    minute: t('wrapped.unit_minute'),
    second: t('wrapped.unit_second'),
  };

  return (
    <View style={styles.container}>
      <View style={[styles.glowTop, { backgroundColor: theme.glowColor }]} />
      <View style={[styles.glowBottom, { backgroundColor: theme.glowColor }]} />

      {/* Başlık */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 14) }]}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="arrow-back" size={22} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {t('wrapped.title')}
        </Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => setCustomizeOpen(true)}
            hitSlop={10}>
            <Ionicons name="options-outline" size={21} color="#d4d4d8" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => setShareOpen(true)}
            hitSlop={10}
            disabled={stats.totalPlays === 0}>
            <Ionicons
              name="share-outline"
              size={21}
              color={stats.totalPlays === 0 ? '#3f3f46' : '#d4d4d8'}
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* Dönem seçici */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.periodRow}
        style={styles.periodScroll}>
        {(['year', 'last12m', 'all', 'custom'] as WrappedPeriod[]).map((value) => {
          const active = period === value;
          const label = t(
            value === 'year'
              ? 'wrapped.period_year'
              : value === 'last12m'
                ? 'wrapped.period_last12m'
                : value === 'all'
                  ? 'wrapped.period_all'
                  : 'wrapped.period_custom'
          );
          return (
            <TouchableOpacity
              key={value}
              style={[styles.periodChip, active && { backgroundColor: theme.primary }]}
              onPress={() => setPeriod(value)}
              activeOpacity={0.8}>
              <Text style={[styles.periodChipText, active && styles.periodChipTextActive]}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {period === 'custom' ? (
        <View style={styles.customRow}>
          <View style={styles.customField}>
            <Text style={styles.customLabel}>{t('wrapped.custom_start')}</Text>
            <TextInput
              style={styles.customInput}
              value={customStart}
              onChangeText={setCustomStart}
              placeholder={t('wrapped.custom_hint')}
              placeholderTextColor="#52525b"
              keyboardType="numbers-and-punctuation"
              autoCorrect={false}
            />
          </View>
          <View style={styles.customField}>
            <Text style={styles.customLabel}>{t('wrapped.custom_end')}</Text>
            <TextInput
              style={styles.customInput}
              value={customEnd}
              onChangeText={setCustomEnd}
              placeholder={t('wrapped.custom_hint')}
              placeholderTextColor="#52525b"
              keyboardType="numbers-and-punctuation"
              autoCorrect={false}
            />
          </View>
        </View>
      ) : null}
      {period === 'custom' && customError ? (
        <Text style={styles.customError}>{t('wrapped.custom_invalid')}</Text>
      ) : null}

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={styles.loadingText}>{t('wrapped.loading')}</Text>
        </View>
      ) : stats.totalPlays === 0 ? (
        <View style={styles.emptyContainer}>
          <View style={[styles.emptyIcon, { backgroundColor: `${theme.primary}22` }]}>
            <Ionicons name="sparkles-outline" size={30} color={theme.primary} />
          </View>
          <Text style={styles.emptyTitle}>{t('wrapped.empty_title')}</Text>
          <Text style={styles.emptyHint}>{t('wrapped.empty_hint')}</Text>
        </View>
      ) : (
        <>
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(event) =>
              setPageIndex(Math.round(event.nativeEvent.contentOffset.x / width))
            }>
            {slides.map((slide, index) => (
              <ScrollView
                key={slide}
                style={{ width }}
                contentContainerStyle={styles.pageContent}
                showsVerticalScrollIndicator={false}>
                <Slide
                  slide={slide}
                  stats={stats}
                  theme={theme}
                  width={width}
                  periodLabel={periodLabel}
                  durationLabels={durationLabels}
                  language={resolvedLanguage}
                  showArtwork={wrappedPrefs?.showArtwork !== false}
                  onNext={() => goToPage(index + 1)}
                  t={t}
                />
              </ScrollView>
            ))}
          </ScrollView>

          {/* Sayfa göstergesi + oklar */}
          <View style={[styles.pagerBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <TouchableOpacity
              style={styles.pagerArrow}
              onPress={() => goToPage(pageIndex - 1)}
              disabled={pageIndex === 0}
              hitSlop={8}>
              <Ionicons
                name="chevron-back"
                size={20}
                color={pageIndex === 0 ? '#3f3f46' : '#d4d4d8'}
              />
            </TouchableOpacity>
            <View style={styles.dots}>
              {slides.map((slide, index) => (
                <View
                  key={slide}
                  style={[
                    styles.dot,
                    index === pageIndex && { backgroundColor: theme.primary, width: 18 },
                  ]}
                />
              ))}
            </View>
            <TouchableOpacity
              style={styles.pagerArrow}
              onPress={() => goToPage(pageIndex + 1)}
              disabled={pageIndex >= slides.length - 1}
              hitSlop={8}>
              <Ionicons
                name="chevron-forward"
                size={20}
                color={pageIndex >= slides.length - 1 ? '#3f3f46' : '#d4d4d8'}
              />
            </TouchableOpacity>
          </View>
        </>
      )}

      <CustomizeSheet
        visible={customizeOpen}
        onClose={() => setCustomizeOpen(false)}
        theme={theme}
        current={wrappedPrefs}
        onChange={(next) => updatePreferences({ wrapped: next })}
      />

      <SharePreviewModal
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        stats={stats}
        periodLabel={periodLabel}
        theme={theme}
        durationLabels={durationLabels}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Slaytlar

interface SlideProps {
  slide: WrappedSlideId;
  stats: WrappedStats;
  theme: ThemeColors;
  width: number;
  periodLabel: string;
  durationLabels: { hour: string; minute: string; second: string };
  language: string;
  showArtwork: boolean;
  onNext: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

function Slide({
  slide,
  stats,
  theme,
  width,
  periodLabel,
  durationLabels,
  language,
  showArtwork,
  onNext,
  t,
}: SlideProps) {
  const innerWidth = Math.min(width - 48, 460);

  if (slide === 'intro') {
    return (
      <View style={[styles.slideBody, { width: innerWidth }]}>
        <Text style={[styles.kicker, { color: theme.primary }]}>{t('wrapped.intro_kicker')}</Text>
        <Text style={styles.introTitle}>RunMusic Wrapped</Text>
        <Text style={styles.introPeriod}>{periodLabel}</Text>
        <View style={[styles.introBadge, { borderColor: `${theme.primary}55` }]}>
          <Text style={styles.introBadgeValue}>{stats.totalPlays}</Text>
          <Text style={styles.introBadgeLabel}>{t('wrapped.total_plays')}</Text>
        </View>
        <Text style={styles.introTime}>
          {formatWrappedDuration(stats.totalSeconds, durationLabels)}
        </Text>
        <TouchableOpacity
          style={[styles.primaryAction, { backgroundColor: theme.primary }]}
          onPress={onNext}
          activeOpacity={0.85}>
          <Text style={styles.primaryActionText}>{t('wrapped.intro_button')}</Text>
          <Ionicons name="arrow-forward" size={16} color="#ffffff" />
        </TouchableOpacity>
      </View>
    );
  }

  if (slide === 'totals') {
    return (
      <View style={[styles.slideBody, { width: innerWidth }]}>
        <Text style={styles.slideTitle}>{t('wrapped.totals_title')}</Text>
        <View style={styles.statGrid}>
          <StatTile
            value={String(stats.totalPlays)}
            label={t('wrapped.total_plays')}
            theme={theme}
          />
          <StatTile
            value={formatWrappedDuration(stats.totalSeconds, durationLabels)}
            label={t('wrapped.total_time')}
            theme={theme}
          />
          <StatTile
            value={String(stats.uniqueTracks)}
            label={t('wrapped.total_tracks')}
            theme={theme}
          />
          <StatTile
            value={String(stats.uniqueArtists)}
            label={t('wrapped.total_artists')}
            theme={theme}
          />
          <StatTile
            value={String(stats.uniqueAlbums)}
            label={t('wrapped.total_albums')}
            theme={theme}
          />
        </View>
      </View>
    );
  }

  if (slide === 'tracks' || slide === 'artists' || slide === 'albums') {
    const titleKey =
      slide === 'tracks'
        ? 'wrapped.tracks_title'
        : slide === 'artists'
          ? 'wrapped.artists_title'
          : 'wrapped.albums_title';
    const items =
      slide === 'tracks'
        ? stats.topTracks
        : slide === 'artists'
          ? stats.topArtists
          : stats.topAlbums;

    return (
      <View style={[styles.slideBody, { width: innerWidth }]}>
        <Text style={styles.slideTitle}>{t(titleKey)}</Text>
        <View style={styles.rankList}>
          {items.map((item, index) => (
            <RankRow
              key={item.key}
              index={index}
              item={item}
              theme={theme}
              showArtwork={showArtwork}
              playsLabel={t('wrapped.plays', { count: item.plays })}
            />
          ))}
        </View>
      </View>
    );
  }

  if (slide === 'time') {
    const maxHour = Math.max(1, ...stats.hourHistogram);
    return (
      <View style={[styles.slideBody, { width: innerWidth }]}>
        <Text style={styles.slideTitle}>{t('wrapped.time_title')}</Text>
        <View style={styles.hourChart}>
          {stats.hourHistogram.map((count, hour) => (
            <View key={hour} style={styles.hourBarTrack}>
              <View
                style={[
                  styles.hourBar,
                  {
                    height: Math.max(3, Math.round((count / maxHour) * 92)),
                    backgroundColor:
                      stats.busiestHour === hour ? theme.primary : `${theme.primary}44`,
                  },
                ]}
              />
            </View>
          ))}
        </View>
        <View style={styles.hourAxis}>
          <Text style={styles.axisText}>00</Text>
          <Text style={styles.axisText}>06</Text>
          <Text style={styles.axisText}>12</Text>
          <Text style={styles.axisText}>18</Text>
          <Text style={styles.axisText}>23</Text>
        </View>
        <View style={styles.factRow}>
          <Fact
            icon="time-outline"
            label={t('wrapped.time_busiest_hour')}
            value={
              stats.busiestHour === null
                ? '—'
                : t('wrapped.time_hour_format', { hour: stats.busiestHour })
            }
            theme={theme}
          />
          <Fact
            icon="calendar-outline"
            label={t('wrapped.time_busiest_day')}
            value={
              stats.busiestWeekday === null
                ? '—'
                : t(WEEKDAY_KEYS[stats.busiestWeekday])
            }
            theme={theme}
          />
        </View>
      </View>
    );
  }

  if (slide === 'streak') {
    return (
      <View style={[styles.slideBody, { width: innerWidth }]}>
        <Text style={styles.slideTitle}>{t('wrapped.streak_title')}</Text>
        <View style={styles.statGrid}>
          <StatTile
            value={t('wrapped.streak_days', { count: stats.longestStreak })}
            label={t('wrapped.streak_longest')}
            theme={theme}
          />
          <StatTile
            value={String(stats.activeDays)}
            label={t('wrapped.streak_active')}
            theme={theme}
          />
          <StatTile
            value={String(stats.onePlayArtists)}
            label={t('wrapped.streak_discovery')}
            theme={theme}
          />
          {stats.busiestDay ? (
            <StatTile
              value={formatLocalDateKey(stats.busiestDay.dateKey, language)}
              label={t('wrapped.streak_busiest')}
              theme={theme}
            />
          ) : null}
        </View>
      </View>
    );
  }

  // persona
  const persona = resolveWrappedPersona(stats);
  const personaTitleKey =
    persona === 'explorer'
      ? 'wrapped.persona_explorer'
      : persona === 'devoted'
        ? 'wrapped.persona_devoted'
        : persona === 'nightowl'
          ? 'wrapped.persona_nightowl'
          : persona === 'marathoner'
            ? 'wrapped.persona_marathoner'
            : 'wrapped.persona_balanced';
  const personaDescKey =
    persona === 'explorer'
      ? 'wrapped.persona_explorer_desc'
      : persona === 'devoted'
        ? 'wrapped.persona_devoted_desc'
        : persona === 'nightowl'
          ? 'wrapped.persona_nightowl_desc'
          : persona === 'marathoner'
            ? 'wrapped.persona_marathoner_desc'
            : 'wrapped.persona_balanced_desc';

  return (
    <View style={[styles.slideBody, { width: innerWidth }]}>
      <Text style={[styles.kicker, { color: theme.primary }]}>{t('wrapped.persona_title')}</Text>
      <Text style={styles.personaTitle}>{t(personaTitleKey)}</Text>
      <Text style={styles.personaDesc}>{t(personaDescKey)}</Text>
      {stats.topTracks[0] ? (
        <View style={[styles.personaHighlight, { borderColor: `${theme.primary}44` }]}>
          <Text style={styles.personaHighlightLabel}>{t('wrapped.tracks_title')}</Text>
          <Text style={styles.personaHighlightValue} numberOfLines={1}>
            {stats.topTracks[0].label || t('common.unknown_track')}
          </Text>
          {stats.topTracks[0].subtitle ? (
            <Text style={styles.personaHighlightSub} numberOfLines={1}>
              {stats.topTracks[0].subtitle}
            </Text>
          ) : null}
        </View>
      ) : null}
      <Text style={styles.personaFooter}>{periodLabel}</Text>
    </View>
  );
}

function formatLocalDateKey(dateKey: string, language: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  try {
    return new Date(year, month - 1, day).toLocaleDateString(language === 'tr' ? 'tr-TR' : 'en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return dateKey;
  }
}

function StatTile({ value, label, theme }: { value: string; label: string; theme: ThemeColors }) {
  return (
    <View style={[styles.statTile, { borderColor: `${theme.primary}33` }]}>
      <Text style={styles.statTileValue} numberOfLines={2}>
        {value}
      </Text>
      <Text style={styles.statTileLabel}>{label}</Text>
    </View>
  );
}

function Fact({
  icon,
  label,
  value,
  theme,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  theme: ThemeColors;
}) {
  return (
    <View style={styles.fact}>
      <Ionicons name={icon} size={16} color={theme.primary} />
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

function RankRow({
  index,
  item,
  theme,
  showArtwork,
  playsLabel,
}: {
  index: number;
  item: WrappedRankedItem;
  theme: ThemeColors;
  showArtwork: boolean;
  playsLabel: string;
}) {
  const initial = (item.label || '?').trim().charAt(0).toUpperCase();
  return (
    <View style={styles.rankRow}>
      <Text style={[styles.rankIndex, index === 0 && { color: theme.primary }]}>{index + 1}</Text>
      {showArtwork ? (
        item.artwork ? (
          <Image source={{ uri: item.artwork }} style={styles.rankArtwork} contentFit="cover" />
        ) : (
          <View style={[styles.rankArtwork, styles.rankFallback, { backgroundColor: `${theme.primary}33` }]}>
            <Text style={styles.rankFallbackText}>{initial}</Text>
          </View>
        )
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={styles.rankLabel} numberOfLines={1}>
          {item.label || '—'}
        </Text>
        {item.subtitle ? (
          <Text style={styles.rankSubtitle} numberOfLines={1}>
            {item.subtitle}
          </Text>
        ) : null}
      </View>
      <Text style={styles.rankPlays}>{playsLabel}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Kişiselleştirme

function CustomizeSheet({
  visible,
  onClose,
  theme,
  current,
  onChange,
}: {
  visible: boolean;
  onClose: () => void;
  theme: ThemeColors;
  current: WrappedPreferences;
  onChange: (next: WrappedPreferences) => void;
}) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const pref = normalizeWrappedPreferences(current);

  const toggleSlide = (slide: WrappedSlideId) => {
    const has = pref.slides.includes(slide);
    const nextSlides = has
      ? pref.slides.filter((value) => value !== slide)
      : [...pref.slides, slide];
    // En az bir slayt kalmalı; hepsi kapatılırsa dokunulan slayt geri açılır.
    onChange(
      normalizeWrappedPreferences({
        ...pref,
        slides: nextSlides.length > 0 ? nextSlides : [slide],
      })
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetOverlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{t('wrapped.customize')}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Text style={[styles.sheetDone, { color: theme.primary }]}>{t('wrapped.done')}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.sheetHint}>{t('wrapped.customize_hint')}</Text>

          <View style={styles.slideToggleList}>
            {WRAPPED_SLIDE_IDS.map((slide) => {
              const enabled = pref.slides.includes(slide);
              return (
                <TouchableOpacity
                  key={slide}
                  style={styles.slideToggleRow}
                  activeOpacity={0.7}
                  onPress={() => toggleSlide(slide)}>
                  <View style={styles.slideToggleText}>
                    <Text style={styles.slideToggleLabel}>{t(SLIDE_TITLE_KEYS[slide])}</Text>
                  </View>
                  <View
                    style={[
                      styles.checkBox,
                      enabled && { backgroundColor: theme.primary, borderColor: theme.primary },
                    ]}>
                    {enabled ? <Ionicons name="checkmark" size={14} color="#ffffff" /> : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.artworkRow}>
            <Text style={styles.slideToggleLabel}>{t('wrapped.customize_artwork')}</Text>
            <Switch
              value={pref.showArtwork}
              onValueChange={(value) => onChange({ ...pref, showArtwork: value })}
              trackColor={{ false: '#3f3f46', true: theme.primary }}
              thumbColor="#ffffff"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Paylaşım

interface CaptureModules {
  captureRef: (ref: React.RefObject<View | null>, options: Record<string, unknown>) => Promise<string>;
  shareAsync?: (uri: string, options?: Record<string, unknown>) => Promise<void>;
  isAvailableAsync?: () => Promise<boolean>;
  saveToLibraryAsync?: (uri: string) => Promise<void>;
  requestPermissionsAsync?: (
    writeOnly?: boolean,
    granularPermissions?: string[]
  ) => Promise<{ granted: boolean }>;
}

/**
 * Native modüller yalnızca gerektiğinde yükleniyor: bu özellikten önce
 * derlenmiş bir APK'ya OTA ile düşen JS, modülü üstte import ederse açılışta
 * çöker. Dinamik import ile yalnızca ilgili buton "güncelleme gerekli" der.
 */
async function loadCaptureModules(): Promise<CaptureModules | null> {
  let captureRef: CaptureModules['captureRef'] | undefined;
  try {
    const viewShot: any = await import('react-native-view-shot');
    captureRef = viewShot?.captureRef ?? viewShot?.default?.captureRef;
  } catch {
    return null;
  }
  if (!captureRef) return null;

  const modules: CaptureModules = { captureRef };

  try {
    const sharing: any = await import('expo-sharing');
    modules.isAvailableAsync = sharing?.isAvailableAsync ?? sharing?.default?.isAvailableAsync;
    modules.shareAsync = sharing?.shareAsync ?? sharing?.default?.shareAsync;
  } catch {
    // Paylaşım yoksa indirme yine çalışsın.
  }

  try {
    const media: any = await import('expo-media-library/legacy');
    modules.saveToLibraryAsync =
      media?.saveToLibraryAsync ?? media?.default?.saveToLibraryAsync;
    modules.requestPermissionsAsync =
      media?.requestPermissionsAsync ?? media?.default?.requestPermissionsAsync;
  } catch {
    // Galeriye kaydetme yoksa paylaşım yine çalışsın.
  }

  return modules;
}

function SharePreviewModal({
  visible,
  onClose,
  stats,
  periodLabel,
  theme,
  durationLabels,
}: {
  visible: boolean;
  onClose: () => void;
  stats: WrappedStats;
  periodLabel: string;
  theme: ThemeColors;
  durationLabels: { hour: string; minute: string; second: string };
}) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const cardRef = useRef<View>(null);
  const mountedRef = useRef(true);
  const [busy, setBusy] = useState<'share' | 'download' | null>(null);
  const [status, setStatus] = useState<'saved' | 'error' | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    setBusy(null);
    setStatus(null);
  }, [visible]);

  const capture = useCallback(async () => {
    const modules = await loadCaptureModules();
    if (!modules || !cardRef.current) return null;
    const uri = await modules.captureRef(cardRef, {
      format: 'png',
      quality: 1,
      result: 'tmpfile',
    });
    const fileUri = uri.startsWith('file://') ? uri : `file://${uri}`;
    return { modules, fileUri };
  }, []);

  const handleShare = useCallback(async () => {
    if (busy) return;
    setBusy('share');
    setStatus(null);
    try {
      const captured = await capture();
      if (!captured || !captured.modules.shareAsync || !captured.modules.isAvailableAsync) {
        if (mountedRef.current) setStatus('error');
        return;
      }
      if (!(await captured.modules.isAvailableAsync())) {
        if (mountedRef.current) setStatus('error');
        return;
      }
      await captured.modules.shareAsync(captured.fileUri, {
        mimeType: 'image/png',
        dialogTitle: t('wrapped.share_title'),
        UTI: 'public.png',
      });
    } catch {
      if (mountedRef.current) setStatus('error');
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }, [busy, capture, t]);

  const handleDownload = useCallback(async () => {
    if (busy) return;
    setBusy('download');
    setStatus(null);
    try {
      const captured = await capture();
      if (
        !captured ||
        !captured.modules.saveToLibraryAsync ||
        !captured.modules.requestPermissionsAsync
      ) {
        if (mountedRef.current) setStatus('error');
        return;
      }
      const permission = await captured.modules.requestPermissionsAsync(true, ['photo']);
      if (!permission.granted) {
        if (mountedRef.current) setStatus('error');
        return;
      }
      await captured.modules.saveToLibraryAsync(captured.fileUri);
      if (mountedRef.current) setStatus('saved');
    } catch {
      if (mountedRef.current) setStatus('error');
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }, [busy, capture]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.shareOverlay}>
        <View style={[styles.shareSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{t('wrapped.share_title')}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color="#a1a1aa" />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.shareCardArea} showsVerticalScrollIndicator={false}>
            <View ref={cardRef} collapsable={false} style={[styles.shareCard, { borderColor: `${theme.primary}55` }]}>
              <View style={[styles.shareCardGlow, { backgroundColor: theme.glowColor }]} />
              <Text style={[styles.shareKicker, { color: theme.primary }]}>
                {t('wrapped.share_card_kicker')}
              </Text>
              <Text style={styles.sharePeriod}>{periodLabel}</Text>
              <Text style={styles.sharePlays}>{stats.totalPlays}</Text>
              <Text style={styles.sharePlaysLabel}>{t('wrapped.total_plays')}</Text>
              <Text style={styles.shareDuration}>
                {formatWrappedDuration(stats.totalSeconds, durationLabels)}
              </Text>

              <View style={styles.shareDivider} />

              {stats.topArtists[0] ? (
                <View style={styles.shareLine}>
                  <Text style={styles.shareLineLabel}>{t('wrapped.artists_title')}</Text>
                  <Text style={styles.shareLineValue} numberOfLines={1}>
                    {stats.topArtists[0].label}
                  </Text>
                </View>
              ) : null}
              {stats.topTracks[0] ? (
                <View style={styles.shareLine}>
                  <Text style={styles.shareLineLabel}>{t('wrapped.tracks_title')}</Text>
                  <Text style={styles.shareLineValue} numberOfLines={1}>
                    {stats.topTracks[0].label}
                  </Text>
                </View>
              ) : null}

              <Text style={styles.shareBrand}>RunMusic</Text>
            </View>
          </ScrollView>

          {status === 'saved' ? (
            <Text style={styles.shareStatus}>{t('player.share_downloaded')}</Text>
          ) : status === 'error' ? (
            <Text style={[styles.shareStatus, { color: '#f87171' }]}>
              {t('player.share_unavailable')}
            </Text>
          ) : null}

          <View style={styles.shareActions}>
            <TouchableOpacity
              style={[styles.shareButton, { backgroundColor: theme.primary }]}
              onPress={handleShare}
              disabled={busy !== null}
              activeOpacity={0.85}>
              {busy === 'share' ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.shareButtonText}>{t('player.share_lyrics_action')}</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.shareButton, styles.shareButtonGhost]}
              onPress={handleDownload}
              disabled={busy !== null}
              activeOpacity={0.85}>
              {busy === 'download' ? (
                <ActivityIndicator size="small" color={theme.primary} />
              ) : (
                <Text style={[styles.shareButtonText, { color: theme.primary }]}>
                  {t('player.share_download')}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090b',
  },
  glowTop: {
    position: 'absolute',
    top: -120,
    left: -80,
    width: 320,
    height: 320,
    borderRadius: 160,
    opacity: 0.55,
  },
  glowBottom: {
    position: 'absolute',
    bottom: -140,
    right: -100,
    width: 360,
    height: 360,
    borderRadius: 180,
    opacity: 0.4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 6,
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: '#ffffff',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff0d',
  },
  periodScroll: {
    flexGrow: 0,
  },
  periodRow: {
    paddingHorizontal: 16,
    gap: 8,
    paddingVertical: 4,
  },
  periodChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#ffffff0d',
  },
  periodChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#a1a1aa',
  },
  periodChipTextActive: {
    color: '#ffffff',
  },
  customRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  customField: {
    flex: 1,
  },
  customLabel: {
    fontSize: 11,
    color: '#a1a1aa',
    marginBottom: 4,
  },
  customInput: {
    backgroundColor: '#ffffff0d',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#27272a',
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: '#ffffff',
    fontSize: 13,
  },
  customError: {
    paddingHorizontal: 16,
    paddingTop: 8,
    fontSize: 12,
    color: '#f87171',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 13,
    color: '#71717a',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 10,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#ffffff',
  },
  emptyHint: {
    fontSize: 13,
    color: '#a1a1aa',
    textAlign: 'center',
    lineHeight: 19,
  },
  pageContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 18,
    paddingHorizontal: 24,
  },
  slideBody: {
    gap: 14,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
  },
  slideTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 4,
  },
  introTitle: {
    fontSize: 38,
    fontWeight: '900',
    color: '#ffffff',
    lineHeight: 42,
  },
  introPeriod: {
    fontSize: 14,
    color: '#a1a1aa',
    marginTop: -6,
  },
  introBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 1,
    backgroundColor: '#ffffff0a',
    marginTop: 6,
  },
  introBadgeValue: {
    fontSize: 26,
    fontWeight: '900',
    color: '#ffffff',
  },
  introBadgeLabel: {
    fontSize: 13,
    color: '#a1a1aa',
  },
  introTime: {
    fontSize: 15,
    color: '#d4d4d8',
  },
  primaryAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 14,
    marginTop: 10,
  },
  primaryActionText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statTile: {
    minWidth: '45%',
    flexGrow: 1,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    backgroundColor: '#ffffff08',
    gap: 4,
  },
  statTileValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#ffffff',
  },
  statTileLabel: {
    fontSize: 12,
    color: '#a1a1aa',
  },
  rankList: {
    gap: 12,
    marginTop: 4,
  },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rankIndex: {
    width: 18,
    fontSize: 15,
    fontWeight: '800',
    color: '#71717a',
  },
  rankArtwork: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#18181b',
  },
  rankFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankFallbackText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#ffffff',
  },
  rankLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  rankSubtitle: {
    fontSize: 12,
    color: '#a1a1aa',
    marginTop: 2,
  },
  rankPlays: {
    fontSize: 11,
    color: '#71717a',
  },
  hourChart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 100,
    gap: 3,
    marginTop: 10,
  },
  hourBarTrack: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  hourBar: {
    width: '100%',
    borderRadius: 3,
  },
  hourAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  axisText: {
    fontSize: 10,
    color: '#71717a',
  },
  factRow: {
    gap: 10,
    marginTop: 14,
  },
  fact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: '#ffffff08',
  },
  factLabel: {
    flex: 1,
    fontSize: 13,
    color: '#a1a1aa',
  },
  factValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },
  personaTitle: {
    fontSize: 30,
    fontWeight: '900',
    color: '#ffffff',
    lineHeight: 36,
  },
  personaDesc: {
    fontSize: 14,
    color: '#d4d4d8',
    lineHeight: 20,
  },
  personaHighlight: {
    marginTop: 8,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    backgroundColor: '#ffffff08',
    gap: 3,
  },
  personaHighlightLabel: {
    fontSize: 11,
    color: '#a1a1aa',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  personaHighlightValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  personaHighlightSub: {
    fontSize: 12,
    color: '#a1a1aa',
  },
  personaFooter: {
    fontSize: 12,
    color: '#71717a',
    marginTop: 6,
  },
  pagerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  pagerArrow: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff0d',
  },
  dots: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#3f3f46',
  },
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#18181b',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#3f3f46',
    marginBottom: 14,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#ffffff',
  },
  sheetDone: {
    fontSize: 14,
    fontWeight: '700',
  },
  sheetHint: {
    fontSize: 12,
    color: '#71717a',
    marginBottom: 10,
  },
  slideToggleList: {
    marginBottom: 6,
  },
  slideToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a55',
  },
  slideToggleText: {
    flex: 1,
  },
  slideToggleLabel: {
    fontSize: 14,
    color: '#ffffff',
    fontWeight: '500',
  },
  checkBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#3f3f46',
    alignItems: 'center',
    justifyContent: 'center',
  },
  artworkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  shareOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  shareSheet: {
    backgroundColor: '#18181b',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 14,
  },
  shareCardArea: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  shareCard: {
    width: 300,
    borderRadius: 22,
    borderWidth: 1,
    backgroundColor: '#101013',
    padding: 20,
    gap: 4,
    overflow: 'hidden',
  },
  shareCardGlow: {
    position: 'absolute',
    top: -80,
    right: -60,
    width: 200,
    height: 200,
    borderRadius: 100,
    opacity: 0.55,
  },
  shareKicker: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.6,
  },
  sharePeriod: {
    fontSize: 12,
    color: '#a1a1aa',
    marginBottom: 10,
  },
  sharePlays: {
    fontSize: 46,
    fontWeight: '900',
    color: '#ffffff',
    lineHeight: 50,
  },
  sharePlaysLabel: {
    fontSize: 12,
    color: '#a1a1aa',
  },
  shareDuration: {
    fontSize: 13,
    color: '#d4d4d8',
    marginTop: 2,
  },
  shareDivider: {
    height: 1,
    backgroundColor: '#27272a',
    marginVertical: 14,
  },
  shareLine: {
    marginBottom: 10,
    gap: 2,
  },
  shareLineLabel: {
    fontSize: 10,
    color: '#71717a',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  shareLineValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
  },
  shareBrand: {
    fontSize: 11,
    color: '#71717a',
    marginTop: 6,
  },
  shareStatus: {
    fontSize: 12,
    color: '#10b981',
    textAlign: 'center',
    paddingTop: 6,
  },
  shareActions: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 12,
  },
  shareButton: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareButtonGhost: {
    backgroundColor: '#ffffff0d',
  },
  shareButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },
});
