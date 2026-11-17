import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { TouchableOpacity } from '../components/ui/TouchableOpacity';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GradientSurface, withAlpha } from '../components/ui/GradientSurface';
import { getHistoryInRange } from '../services/statsDatabase';
import { cleanTrackFields } from '../services/displayNames';
import { loadArtistImages, normalizeArtistKey } from '../services/artistImages';
import { buildArtistTitleHints } from '../services/artistProfile';
import { useStore } from '../store/useStore';
import { useThemeStore } from '../store/useThemeStore';
import { useTranslation } from '../services/i18n';
import { useBackToLibrary } from '../hooks/useBackToLibrary';
import type { ThemeColors } from '../services/colorThemeService';
import {
  WRAPPED_SHARE_ITEMS,
  WRAPPED_SLIDE_IDS,
  buildWrappedStats,
  formatDateInput,
  formatWrappedDuration,
  normalizeWrappedPreferences,
  parseDateInput,
  resolveWrappedPersona,
  resolveWrappedWindow,
  type WrappedPeriod,
  type WrappedPersona,
  type WrappedPreferences,
  type WrappedRankedItem,
  type WrappedShareItem,
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
 * Görsel derinlik gerçek gradient ile sağlanır (`GradientSurface`): palet
 * renkleri slayt arka planına akar, üzerine yumuşak vurgu daireleri eklenir.
 * Renkler her zaman RunMusic paletinden gelir; düz siyah zemin korunur.
 */

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const SLIDE_TITLE_KEYS: Record<WrappedSlideId, string> = {
  intro: 'wrapped.slide_intro',
  totals: 'wrapped.slide_totals',
  tracks: 'wrapped.slide_tracks',
  artists: 'wrapped.slide_artists',
  time: 'wrapped.slide_time',
  streak: 'wrapped.slide_streak',
  persona: 'wrapped.slide_persona',
};

/**
 * Her slaytın kendi renk çifti. Tema rengi tek başına kullanıldığında ekran
 * siyah-beyazımsı görünüyordu; bu çiftler slayt arka planına ve vurgulara
 * renk katar. Slayt arka planına `GradientSurface` ile akan iki renkli geçiş
 * olarak uygulanır.
 */
const SLIDE_PALETTES: Record<WrappedSlideId, { a: string; b: string }> = {
  intro: { a: '#a855f7', b: '#ec4899' },
  totals: { a: '#38bdf8', b: '#818cf8' },
  tracks: { a: '#f472b6', b: '#a855f7' },
  artists: { a: '#fbbf24', b: '#f97316' },
  time: { a: '#22d3ee', b: '#3b82f6' },
  streak: { a: '#34d399', b: '#22d3ee' },
  persona: { a: '#f43f5e', b: '#fbbf24' },
};

function slidePalette(slide: WrappedSlideId | undefined) {
  return SLIDE_PALETTES[slide ?? 'intro'] ?? SLIDE_PALETTES.intro;
}

const SHARE_ITEM_KEYS: Record<WrappedShareItem, string> = {
  plays: 'wrapped.share_item_plays',
  time: 'wrapped.share_item_time',
  topTrack: 'wrapped.share_item_top_track',
  topArtist: 'wrapped.share_item_top_artist',
  persona: 'wrapped.share_item_persona',
  streak: 'wrapped.share_item_streak',
  busiestHour: 'wrapped.share_item_busiest_hour',
};

const PERSONA_TITLE_KEYS: Record<WrappedPersona, string> = {
  explorer: 'wrapped.persona_explorer',
  devoted: 'wrapped.persona_devoted',
  nightowl: 'wrapped.persona_nightowl',
  marathoner: 'wrapped.persona_marathoner',
  balanced: 'wrapped.persona_balanced',
};

const PERSONA_DESC_KEYS: Record<WrappedPersona, string> = {
  explorer: 'wrapped.persona_explorer_desc',
  devoted: 'wrapped.persona_devoted_desc',
  nightowl: 'wrapped.persona_nightowl_desc',
  marathoner: 'wrapped.persona_marathoner_desc',
  balanced: 'wrapped.persona_balanced_desc',
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
  // Geri tuşu kütüphaneye döner; oynatıcı çalmaya devam eder.
  useBackToLibrary();
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
  const [artistImages, setArtistImages] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [pageIndex, setPageIndex] = useState(0);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const slides = useMemo(() => {
    return normalizeWrappedPreferences(wrappedPrefs).slides;
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
        const rawRows = await getHistoryInRange(range.startSql, range.endSql);
        // Geçmişte kaydedilmiş ham isimler de düzenlenmiş halleriyle gösterilsin.
        const rows = rawRows.map((row) => {
          const fields = cleanTrackFields(row.title, row.artist);
          return {
            ...row,
            title: fields.title || row.title,
            artist: fields.artist,
          };
        });
        const nextStats = buildWrappedStats(rows, { limit: 5 });
        setStats(nextStats);
        setPageIndex(0);
        scrollRef.current?.scrollTo({ x: 0, animated: false });

        // Sanatçı fotoğrafları arka planda yüklenir; hazır olunca satırlar
        // harf rozetinden gerçek fotoğrafa geçer. Dinlenen parça adları ipucu
        // olarak verilir: Deezer'da aynı adda birden çok sanatçı olduğu için
        // doğru kaydı bunlar belirler.
        void loadArtistImages(
          nextStats.topArtists.map((artist) => artist.label),
          buildArtistTitleHints(rows)
        )
          .then((images) => setArtistImages(images))
          .catch(() => {});
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
      {/* Gerçek renk geçişi: üç yarı saydam daire yerine palet renklerinden
          akan tek bir gradient taban. Daireler üstte yumuşak vurgu olarak kalır. */}
      <GradientSurface
        pointerEvents="none"
        colors={[
          withAlpha(slidePalette(slides[pageIndex]).a, 0.32),
          withAlpha(slidePalette(slides[pageIndex]).b, 0.18),
          'rgba(9,9,11,0)',
        ]}
        locations={[0, 0.55, 1]}
        direction="vertical"
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.glowTop, { backgroundColor: slidePalette(slides[pageIndex]).a }]} />
      <View style={[styles.glowBottom, { backgroundColor: slidePalette(slides[pageIndex]).b }]} />
      <View style={[styles.glowMid, { backgroundColor: theme.primary }]} />

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
                  showArtwork={normalizeWrappedPreferences(wrappedPrefs).showArtwork !== false}
                  palette={slidePalette(slide)}
                  artistImages={artistImages}
                  onNext={() => goToPage(index + 1)}
                  onOpenArtist={(name) => router.push({ pathname: '/artist', params: { name } })}
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
        shareItems={normalizeWrappedPreferences(wrappedPrefs).shareItems}
        artistImages={artistImages}
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
  palette: { a: string; b: string };
  artistImages: Record<string, string>;
  onNext: () => void;
  onOpenArtist?: (name: string) => void;
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
  palette,
  artistImages,
  onNext,
  onOpenArtist,
  t,
}: SlideProps) {
  const innerWidth = Math.min(width - 48, 460);
  const accent = palette.a;
  const accentSoft = `${palette.a}55`;

  if (slide === 'intro') {
    return (
      <View style={[styles.slideBody, { width: innerWidth }]}>
        <Text style={[styles.kicker, { color: accent }]}>{t('wrapped.intro_kicker')}</Text>
        <Text style={styles.introTitle}>RunMusic Wrapped</Text>
        <Text style={styles.introPeriod}>{periodLabel}</Text>
        <View style={[styles.introBadge, { borderColor: accentSoft }]}>
          <Text style={styles.introBadgeValue}>{stats.totalPlays}</Text>
          <Text style={styles.introBadgeLabel}>{t('wrapped.total_plays')}</Text>
        </View>
        <Text style={styles.introTime}>
          {formatWrappedDuration(stats.totalSeconds, durationLabels)}
        </Text>
        <TouchableOpacity
          style={[styles.primaryAction, { backgroundColor: accent }]}
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
        <Text style={[styles.slideTitle, { color: accent }]}>{t('wrapped.totals_title')}</Text>
        <View style={styles.statGrid}>
          <StatTile
            value={String(stats.totalPlays)}
            label={t('wrapped.total_plays')}
            accent={accent}
            accentSoft={accentSoft}
          />
          <StatTile
            value={formatWrappedDuration(stats.totalSeconds, durationLabels)}
            label={t('wrapped.total_time')}
            accent={accent}
            accentSoft={accentSoft}
          />
          <StatTile
            value={String(stats.uniqueTracks)}
            label={t('wrapped.total_tracks')}
            accent={accent}
            accentSoft={accentSoft}
          />
          <StatTile
            value={String(stats.uniqueArtists)}
            label={t('wrapped.total_artists')}
            accent={accent}
            accentSoft={accentSoft}
          />
        </View>
      </View>
    );
  }

  if (slide === 'tracks' || slide === 'artists') {
    const titleKey = slide === 'tracks' ? 'wrapped.tracks_title' : 'wrapped.artists_title';
    const items = slide === 'tracks' ? stats.topTracks : stats.topArtists;

    return (
      <View style={[styles.slideBody, { width: innerWidth }]}>
        <Text style={[styles.slideTitle, { color: accent }]}>{t(titleKey)}</Text>
        <View style={styles.rankList}>
          {items.map((item, index) => (
            <RankRow
              key={item.key}
              index={index}
              item={item}
              accent={accent}
              showArtwork={showArtwork}
              artistImage={
                slide === 'artists'
                  ? artistImages[normalizeArtistKey(item.label)]
                  : undefined
              }
              playsLabel={t('wrapped.plays', { count: item.plays })}
              onPress={
                slide === 'artists' && onOpenArtist
                  ? () => onOpenArtist(item.label)
                  : undefined
              }
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
        <Text style={[styles.slideTitle, { color: accent }]}>{t('wrapped.time_title')}</Text>
        <View style={styles.hourChart}>
          {stats.hourHistogram.map((count, hour) => (
            <View key={hour} style={styles.hourBarTrack}>
              <View
                style={[
                  styles.hourBar,
                  {
                    height: Math.max(3, Math.round((count / maxHour) * 92)),
                    backgroundColor: stats.busiestHour === hour ? accent : `${accent}44`,
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
            accent={accent}
          />
          <Fact
            icon="calendar-outline"
            label={t('wrapped.time_busiest_day')}
            value={
              stats.busiestWeekday === null
                ? '—'
                : t(WEEKDAY_KEYS[stats.busiestWeekday])
            }
            accent={accent}
          />
        </View>
      </View>
    );
  }

  if (slide === 'streak') {
    return (
      <View style={[styles.slideBody, { width: innerWidth }]}>
        <Text style={[styles.slideTitle, { color: accent }]}>{t('wrapped.streak_title')}</Text>
        <View style={styles.statGrid}>
          <StatTile
            value={t('wrapped.streak_days', { count: stats.longestStreak })}
            label={t('wrapped.streak_longest')}
            accent={accent}
            accentSoft={accentSoft}
          />
          <StatTile
            value={String(stats.activeDays)}
            label={t('wrapped.streak_active')}
            accent={accent}
            accentSoft={accentSoft}
          />
          <StatTile
            value={String(stats.onePlayArtists)}
            label={t('wrapped.streak_discovery')}
            accent={accent}
            accentSoft={accentSoft}
          />
          {stats.busiestDay ? (
            <StatTile
              value={formatLocalDateKey(stats.busiestDay.dateKey, language)}
              label={t('wrapped.streak_busiest')}
              accent={accent}
              accentSoft={accentSoft}
            />
          ) : null}
        </View>
      </View>
    );
  }

  // persona
  const persona = resolveWrappedPersona(stats);

  return (
    <View style={[styles.slideBody, { width: innerWidth }]}>
      <Text style={[styles.kicker, { color: accent }]}>{t('wrapped.persona_title')}</Text>
      <Text style={[styles.personaTitle, { color: accent }]}>
        {t(PERSONA_TITLE_KEYS[persona])}
      </Text>
      <Text style={styles.personaDesc}>{t(PERSONA_DESC_KEYS[persona])}</Text>
      {stats.topTracks[0] ? (
        <View style={[styles.personaHighlight, { borderColor: accentSoft }]}>
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

function StatTile({
  value,
  label,
  accent,
  accentSoft,
}: {
  value: string;
  label: string;
  accent: string;
  accentSoft: string;
}) {
  return (
    <View style={[styles.statTile, { borderColor: accentSoft, backgroundColor: `${accent}14` }]}>
      <Text style={[styles.statTileValue, { color: accent }]} numberOfLines={2}>
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
  accent,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <View style={[styles.fact, { backgroundColor: `${accent}14` }]}>
      <Ionicons name={icon} size={16} color={accent} />
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

function RankRow({
  index,
  item,
  accent,
  showArtwork,
  artistImage,
  playsLabel,
  onPress,
}: {
  index: number;
  item: WrappedRankedItem;
  accent: string;
  showArtwork: boolean;
  artistImage?: string;
  playsLabel: string;
  onPress?: () => void;
}) {
  const initial = (item.label || '?').trim().charAt(0).toUpperCase();
  const artwork = artistImage || item.artwork;
  const content = (
    <View style={styles.rankRow}>
      <Text style={[styles.rankIndex, index === 0 && { color: accent }]}>{index + 1}</Text>
      {showArtwork ? (
        artwork ? (
          <Image
            source={{ uri: artwork }}
            style={[styles.rankArtwork, artistImage ? styles.rankArtistArtwork : null]}
            contentFit="cover"
          />
        ) : (
          <View
            style={[
              styles.rankArtwork,
              styles.rankFallback,
              { backgroundColor: `${accent}33` },
            ]}>
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

  if (!onPress) return content;

  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress}>
      {content}
    </TouchableOpacity>
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

  const toggleShareItem = (item: WrappedShareItem) => {
    const has = pref.shareItems.includes(item);
    onChange({
      ...pref,
      shareItems: has
        ? pref.shareItems.filter((value) => value !== item)
        : [...pref.shareItems, item],
    });
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

          <ScrollView
            style={styles.sheetScroll}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 8 }}>
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

            <Text style={styles.sheetSectionTitle}>{t('wrapped.customize_share')}</Text>
            <View style={styles.slideToggleList}>
              {WRAPPED_SHARE_ITEMS.map((item) => {
                const enabled = pref.shareItems.includes(item);
                return (
                  <TouchableOpacity
                    key={item}
                    style={styles.slideToggleRow}
                    activeOpacity={0.7}
                    onPress={() => toggleShareItem(item)}>
                    <View style={styles.slideToggleText}>
                      <Text style={styles.slideToggleLabel}>{t(SHARE_ITEM_KEYS[item])}</Text>
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
          </ScrollView>
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

/**
 * Paylaşım için hazır kart şablonları. Tek "her şey" kartı yerine Spotify'da
 * olduğu gibi yatay kaydırılan birden fazla kart sunulur: genel özet, yalnızca
 * sanatçılar, yalnızca parçalar ve dinleme alışkanlıkları. Kullanıcı hangi
 * kartı paylaşacağını seçer.
 */
const SHARE_CARD_IDS = ['overview', 'artists', 'tracks', 'habits'] as const;

type ShareCardId = (typeof SHARE_CARD_IDS)[number];

const SHARE_CARD_TITLE_KEYS: Record<ShareCardId, string> = {
  overview: 'wrapped.share_card_overview',
  artists: 'wrapped.share_card_artists',
  tracks: 'wrapped.share_card_tracks',
  habits: 'wrapped.share_card_habits',
};

const SHARE_CARD_PALETTES: Record<ShareCardId, { a: string; b: string }> = {
  overview: { a: '#a855f7', b: '#ec4899' },
  artists: { a: '#fbbf24', b: '#f97316' },
  tracks: { a: '#f472b6', b: '#a855f7' },
  habits: { a: '#22d3ee', b: '#3b82f6' },
};

const SHARE_CARD_WIDTH = 300;
const SHARE_CARD_GAP = 14;

function SharePreviewModal({
  visible,
  onClose,
  stats,
  periodLabel,
  theme,
  durationLabels,
  shareItems,
  artistImages,
}: {
  visible: boolean;
  onClose: () => void;
  stats: WrappedStats;
  periodLabel: string;
  theme: ThemeColors;
  durationLabels: { hour: string; minute: string; second: string };
  shareItems: WrappedShareItem[];
  artistImages: Record<string, string>;
}) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const cardRefs = useRef<Partial<Record<ShareCardId, View | null>>>({});
  const [cardIndex, setCardIndex] = useState(0);
  const pageWidth = SHARE_CARD_WIDTH + SHARE_CARD_GAP;

  const handleCardScroll = useCallback(
    (offsetX: number) => {
      const next = Math.round(offsetX / pageWidth);
      setCardIndex(Math.max(0, Math.min(SHARE_CARD_IDS.length - 1, next)));
    },
    [pageWidth]
  );
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

  const capture = useCallback(async (cardId: ShareCardId) => {
    const node = cardRefs.current[cardId];
    if (!node) return null;
    const modules = await loadCaptureModules();
    if (!modules) return null;
    const uri = await modules.captureRef(
      { current: node } as React.RefObject<View | null>,
      {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
      }
    );
    const fileUri = uri.startsWith('file://') ? uri : `file://${uri}`;
    return { modules, fileUri };
  }, []);

  const handleShare = useCallback(async () => {
    if (busy) return;
    const cardId = SHARE_CARD_IDS[cardIndex] ?? SHARE_CARD_IDS[0];
    setBusy('share');
    setStatus(null);
    try {
      const captured = await capture(cardId);
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
  }, [busy, capture, cardIndex, t]);

  const handleDownload = useCallback(async () => {
    if (busy) return;
    const cardId = SHARE_CARD_IDS[cardIndex] ?? SHARE_CARD_IDS[0];
    setBusy('download');
    setStatus(null);
    try {
      const captured = await capture(cardId);
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
  }, [busy, capture, cardIndex]);

  const included = new Set(shareItems);
  const persona = resolveWrappedPersona(stats);
  const showPlays = included.has('plays');
  const showTime = included.has('time');
  const heroValue = showPlays
    ? String(stats.totalPlays)
    : showTime
      ? formatWrappedDuration(stats.totalSeconds, durationLabels)
      : t(PERSONA_TITLE_KEYS[persona]);
  const heroLabel = showPlays
    ? t('wrapped.total_plays')
    : showTime
      ? t('wrapped.total_time')
      : t('wrapped.persona_title');

  const shareLines: { label: string; value: string }[] = [];
  if (showPlays && showTime) {
    shareLines.push({
      label: t('wrapped.total_time'),
      value: formatWrappedDuration(stats.totalSeconds, durationLabels),
    });
  }
  if (included.has('topArtist') && stats.topArtists[0]) {
    shareLines.push({
      label: t('wrapped.artists_title'),
      value: stats.topArtists[0].label,
    });
  }
  if (included.has('topTrack') && stats.topTracks[0]) {
    shareLines.push({
      label: t('wrapped.tracks_title'),
      value: stats.topTracks[0].label,
    });
  }
  if (included.has('persona')) {
    shareLines.push({
      label: t('wrapped.persona_title'),
      value: t(PERSONA_TITLE_KEYS[persona]),
    });
  }
  if (included.has('streak')) {
    shareLines.push({
      label: t('wrapped.streak_longest'),
      value: t('wrapped.streak_days', { count: stats.longestStreak }),
    });
  }
  if (included.has('busiestHour') && stats.busiestHour !== null) {
    shareLines.push({
      label: t('wrapped.time_busiest_hour'),
      value: t('wrapped.time_hour_format', { hour: stats.busiestHour }),
    });
  }

  const habitLines: { label: string; value: string }[] = [
    {
      label: t('wrapped.total_time'),
      value: formatWrappedDuration(stats.totalSeconds, durationLabels),
    },
    {
      label: t('wrapped.streak_active'),
      value: t('wrapped.streak_days', { count: stats.activeDays }),
    },
    {
      label: t('wrapped.streak_longest'),
      value: t('wrapped.streak_days', { count: stats.longestStreak }),
    },
  ];
  if (stats.busiestHour !== null) {
    habitLines.push({
      label: t('wrapped.time_busiest_hour'),
      value: t('wrapped.time_hour_format', { hour: stats.busiestHour }),
    });
  }
  habitLines.push({
    label: t('wrapped.streak_discovery'),
    value: String(stats.onePlayArtists),
  });

  const renderCardShell = (cardId: ShareCardId, children: React.ReactNode) => {
    const palette = SHARE_CARD_PALETTES[cardId];
    return (
      <View
        ref={(node) => {
          cardRefs.current[cardId] = node;
        }}
        collapsable={false}
        style={[styles.shareCard, { borderColor: `${palette.a}66` }]}>
        {/* Kart zemini: palet renginden koyu yüzeye geçen gradient.
            view-shot bu native görünümü de yakalar. */}
        <GradientSurface
          pointerEvents="none"
          colors={[
            withAlpha(palette.a, 0.34),
            withAlpha(palette.b, 0.16),
            '#101013',
          ]}
          locations={[0, 0.5, 1]}
          direction="diagonal"
          borderRadius={22}
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.shareCardGlow, { backgroundColor: palette.a }]} />
        <View style={[styles.shareCardGlowBottom, { backgroundColor: palette.b }]} />
        <Text style={[styles.shareKicker, { color: palette.a }]}>
          {t('wrapped.share_card_kicker')}
        </Text>
        <Text style={styles.sharePeriod}>{periodLabel}</Text>
        {children}
        <Text style={styles.shareBrand}>RunMusic</Text>
      </View>
    );
  };

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

          <Text style={styles.shareCardHint}>{t('wrapped.share_card_hint')}</Text>

          <View style={styles.shareCardNameRow}>
            <Text style={[styles.shareCardName, { color: SHARE_CARD_PALETTES[SHARE_CARD_IDS[cardIndex]].a }]}>
              {t(SHARE_CARD_TITLE_KEYS[SHARE_CARD_IDS[cardIndex]])}
            </Text>
            <Text style={styles.shareCardCounter}>
              {cardIndex + 1}/{SHARE_CARD_IDS.length}
            </Text>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={pageWidth}
            decelerationRate="fast"
            disableIntervalMomentum
            removeClippedSubviews={false}
            contentContainerStyle={styles.shareCardTrack}
            onScroll={(event) => handleCardScroll(event.nativeEvent.contentOffset.x)}
            scrollEventThrottle={32}>
            {renderCardShell(
              'overview',
              <>
                <Text style={styles.sharePlays}>{heroValue}</Text>
                <Text style={styles.sharePlaysLabel}>{heroLabel}</Text>

                {shareLines.length > 0 ? (
                  <>
                    <View style={styles.shareDivider} />
                    {shareLines.map((line) => (
                      <View key={line.label} style={styles.shareLine}>
                        <Text style={styles.shareLineLabel}>{line.label}</Text>
                        <Text style={styles.shareLineValue} numberOfLines={1}>
                          {line.value}
                        </Text>
                      </View>
                    ))}
                  </>
                ) : null}
              </>
            )}

            {renderCardShell(
              'artists',
              <>
                <Text style={styles.shareCardHeading}>{t('wrapped.artists_title')}</Text>
                {stats.topArtists.length > 0 ? (
                  stats.topArtists.slice(0, 5).map((artist, index) => {
                    const image = artistImages[normalizeArtistKey(artist.label)];
                    const initial = (artist.label || '?').trim().charAt(0).toUpperCase();
                    return (
                      <View key={artist.key} style={styles.shareRankRow}>
                        <Text style={styles.shareRankIndex}>{index + 1}</Text>
                        {image ? (
                          <Image
                            source={{ uri: image }}
                            style={[styles.shareRankArtwork, styles.shareRankArtworkRound]}
                            contentFit="cover"
                          />
                        ) : (
                          <View
                            style={[
                              styles.shareRankArtwork,
                              styles.shareRankArtworkRound,
                              styles.shareRankFallback,
                            ]}>
                            <Text style={styles.shareRankFallbackText}>{initial}</Text>
                          </View>
                        )}
                        <View style={styles.shareRankText}>
                          <Text style={styles.shareRankTitle} numberOfLines={1}>
                            {artist.label || '—'}
                          </Text>
                          <Text style={styles.shareRankMeta}>
                            {t('wrapped.plays', { count: artist.plays })}
                          </Text>
                        </View>
                      </View>
                    );
                  })
                ) : (
                  <Text style={styles.shareCardEmpty}>{t('wrapped.empty_hint')}</Text>
                )}
              </>
            )}

            {renderCardShell(
              'tracks',
              <>
                <Text style={styles.shareCardHeading}>{t('wrapped.tracks_title')}</Text>
                {stats.topTracks.length > 0 ? (
                  stats.topTracks.slice(0, 5).map((track, index) => (
                    <View key={track.key} style={styles.shareRankRow}>
                      <Text style={styles.shareRankIndex}>{index + 1}</Text>
                      {track.artwork ? (
                        <Image
                          source={{ uri: track.artwork }}
                          style={styles.shareRankArtwork}
                          contentFit="cover"
                        />
                      ) : (
                        <View style={[styles.shareRankArtwork, styles.shareRankFallback]}>
                          <Ionicons name="musical-note" size={16} color="#d4d4d8" />
                        </View>
                      )}
                      <View style={styles.shareRankText}>
                        <Text style={styles.shareRankTitle} numberOfLines={1}>
                          {track.label || '—'}
                        </Text>
                        <Text style={styles.shareRankMeta} numberOfLines={1}>
                          {track.subtitle
                            ? `${track.subtitle} · ${t('wrapped.plays', { count: track.plays })}`
                            : t('wrapped.plays', { count: track.plays })}
                        </Text>
                      </View>
                    </View>
                  ))
                ) : (
                  <Text style={styles.shareCardEmpty}>{t('wrapped.empty_hint')}</Text>
                )}
              </>
            )}

            {renderCardShell(
              'habits',
              <>
                <Text style={styles.shareCardHeading}>{t(PERSONA_TITLE_KEYS[persona])}</Text>
                <Text style={styles.shareCardSubheading}>
                  {t(PERSONA_DESC_KEYS[persona])}
                </Text>
                <View style={styles.shareDivider} />
                {habitLines.map((line) => (
                  <View key={line.label} style={styles.shareLine}>
                    <Text style={styles.shareLineLabel}>{line.label}</Text>
                    <Text style={styles.shareLineValue} numberOfLines={1}>
                      {line.value}
                    </Text>
                  </View>
                ))}
              </>
            )}
          </ScrollView>

          <View style={styles.shareDots}>
            {SHARE_CARD_IDS.map((cardId, index) => (
              <View
                key={cardId}
                style={[
                  styles.shareDot,
                  index === cardIndex && {
                    backgroundColor: SHARE_CARD_PALETTES[cardId].a,
                    width: 18,
                  },
                ]}
              />
            ))}
          </View>

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
  glowMid: {
    position: 'absolute',
    top: '38%',
    left: '-30%',
    width: 280,
    height: 280,
    borderRadius: 140,
    opacity: 0.18,
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
  rankArtistArtwork: {
    borderRadius: 20,
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
  sheetScroll: {
    maxHeight: 520,
  },
  sheetSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#a1a1aa',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 14,
    marginBottom: 4,
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
  shareCardHint: {
    fontSize: 11,
    color: '#71717a',
    marginTop: 2,
  },
  shareCardNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
  },
  shareCardName: {
    fontSize: 13,
    fontWeight: '700',
  },
  shareCardCounter: {
    fontSize: 11,
    color: '#71717a',
  },
  shareCardTrack: {
    alignItems: 'flex-start',
    paddingVertical: 10,
    paddingRight: SHARE_CARD_GAP,
  },
  shareCard: {
    width: SHARE_CARD_WIDTH,
    minHeight: 420,
    borderRadius: 22,
    borderWidth: 1,
    backgroundColor: '#101013',
    padding: 20,
    gap: 4,
    overflow: 'hidden',
    marginRight: SHARE_CARD_GAP,
  },
  shareCardHeading: {
    fontSize: 20,
    fontWeight: '800',
    color: '#ffffff',
    marginTop: 6,
    marginBottom: 10,
  },
  shareCardSubheading: {
    fontSize: 12,
    color: '#a1a1aa',
    lineHeight: 17,
    marginBottom: 2,
  },
  shareCardEmpty: {
    fontSize: 12,
    color: '#71717a',
    marginTop: 12,
  },
  shareRankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  shareRankIndex: {
    width: 14,
    fontSize: 12,
    fontWeight: '800',
    color: '#71717a',
  },
  shareRankArtwork: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#27272a',
  },
  shareRankArtworkRound: {
    borderRadius: 17,
  },
  shareRankFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareRankFallbackText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#d4d4d8',
  },
  shareRankText: {
    flex: 1,
    gap: 1,
  },
  shareRankTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
  },
  shareRankMeta: {
    fontSize: 10,
    color: '#a1a1aa',
  },
  shareDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 5,
    paddingTop: 4,
  },
  shareDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#3f3f46',
  },
  shareCardGlow: {
    position: 'absolute',
    top: -80,
    right: -60,
    width: 200,
    height: 200,
    borderRadius: 100,
    opacity: 0.4,
  },
  shareCardGlowBottom: {
    position: 'absolute',
    bottom: -90,
    left: -70,
    width: 210,
    height: 210,
    borderRadius: 105,
    opacity: 0.25,
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
