import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  GestureResponderEvent,
  Modal,
  Pressable,
  FlatList,
  ActivityIndicator,
  TextInput,
  ScrollView,
  Dimensions,
  Animated,
  PanResponder,
  BackHandler,
  Alert,
  Switch,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { TouchableOpacity } from './ui/TouchableOpacity';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as MediaLibrary from 'expo-media-library/legacy';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import TrackPlayer, { RepeatMode, Track } from 'react-native-track-player';
import { useStore } from '../store/useStore';
import { usePlayerUIStore } from '../store/usePlayerUIStore';
import { useThemeStore } from '../store/useThemeStore';
import type { ThemeColors } from '../services/colorThemeService';
import { useSleepTimerStore } from '../store/useSleepTimerStore';
import { useRemoteConnectStore } from '../store/useRemoteConnectStore';
import { useOptimisticPlayerStore } from '../store/useOptimisticPlayerStore';
import { useDownloadStore } from '../store/useDownloadStore';
import { useExtensionStore } from '../store/useExtensionStore';
import { startDownload } from '../services/downloadManager';
import { useActivePlayer, type ActivePlayerState } from '../hooks/useActivePlayer';
import { useActiveProgress } from '../hooks/useActiveProgress';
import { readNativePlaying } from '../hooks/useResilientIsPlaying';
import { remoteSyncManager } from '../services/remote/remoteSyncManager';
import { wsRoomClient } from '../services/remote/wsRoomClient';
import { udpDiscoveryService } from '../services/remote/udpDiscovery';
import { bleCentralService } from '../services/remote/bleCentralService';
import type { DiscoveredPeer } from '../services/remote/IRemoteTransport';
import { RUNMUSIC_TCP_PORT, type DiscoveredHost, type RemoteTrackSummary } from '../services/remote/remoteTypes';
import { TrackArtwork } from './TrackArtwork';
import { EditTrackModal } from './EditTrackModal';
import { MarqueeText } from './ui/MarqueeText';
import { GlassBackdrop, RadialBlurFocus } from './ui/GlassBackdrop';
import { withAlpha } from './ui/GradientSurface';
import { rememberArtistImage } from '../services/artistImages';
import { normalizeArtistKey } from '../services/artistMatch';
import { splitArtistNames } from '../services/wrappedStats';
import { router } from 'expo-router';
import { isNetworkAvailable } from '../services/networkAwareFetch';

import { useTranslation } from '../services/i18n';
import { showRewardedAd } from '../services/adService';
import {
  LyricLine,
  LyricsResult,
  LyricsCandidate,
  fetchLyricsOnline,
  searchAllCandidates,
  resolveCandidateToLyricsResult,
  parseAnySyncedLyrics,
  getLyricsCacheKeys,
  cleanDisplayTitle,
  getSearchKeywords,
  LRCLIB_HEADERS,
  fetchGeniusLyricsByUrl,
  buildLyricRows,
  splitBackgroundVocals,
  isGeniusSectionHeader,
  getGeniusSectionLabel,
  type LyricDisplayRow,
} from '../services/lyricsService';
import { cleanArtistName } from '../services/displayNames';
import { searchCachedLyricsCandidates } from '../services/lyricsSearch';
import { saveLastPlayback, updateQueueSnapshotActiveIndex } from '../services/playbackStorage';
import {
  buildQueueRows,
  clearPlaybackQueue,
  clearUpNextQueue,
  deriveQueueSections,
  getQueueSections,
  markUpNextConsumed,
  moveUpNext,
  playQueueTrack,
  promoteContextTrackToUpNext,
  removeQueueItem,
  playHistoryTrack,
  replenishUpcomingQueueIfNeeded,
  resolveTrackId,
  trackKey,
  type QueueEntry,
  type QueueRow,
  type QueueSections,
  type QueueTrackLike,
} from '../services/queueController';
import { UpNextRow, type UpNextItem } from './QueueUpNextList';
import { Swipeable } from 'react-native-gesture-handler';
import Reanimated, {
  type AnimatedStyle,
  Easing,
  FadeInDown,
  LinearTransition,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useIsAppActive } from '../hooks/useIsAppActive';
import { useIsOnline } from '../hooks/useIsOnline';
import { useResilientActiveTrack } from '../hooks/useResilientActiveTrack';
import { useComponentDiagnostics } from '../hooks/useComponentDiagnostics';
import { LyricSharePreviewModal, MAX_SHARE_LINES, type LyricShareLine } from './LyricShareModal';

/**
 * Şarkı altındaki sanatçı adları.
 *
 * Sanatçı alanı virgülle ayrılmış olabilir ("UZI, MODD"); her ad ayrı ayrı
 * dokunulabilir ve kendi sanatçı sayfasını açar. Uygulamanın genel kuralı
 * gereği ortak çalışmalar tek kişi gibi gösterilmez.
 */
function ArtistLinks({
  artist,
  style,
  onOpenArtist,
}: {
  artist: string;
  style?: StyleProp<TextStyle>;
  onOpenArtist: (name: string) => void;
}) {
  const names = useMemo(() => splitArtistNames(artist), [artist]);

  // Ayrıştırma sonuç vermezse ham metin gösterilir (ör. yalnızca virgül).
  if (names.length === 0) {
    return (
      <Text style={style} numberOfLines={1}>
        {artist}
      </Text>
    );
  }

  return (
    <View style={styles.artistLinksRow}>
      {names.map((name, index) => (
        <React.Fragment key={`${name}-${index}`}>
          {index > 0 ? <Text style={style}>{', '}</Text> : null}
          <Text
            style={style}
            numberOfLines={1}
            onPress={() => onOpenArtist(name)}
            suppressHighlighting
            accessibilityRole="link">
            {name}
          </Text>
        </React.Fragment>
      ))}
    </View>
  );
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const ARTWORK_SIZE = Math.min(SCREEN_WIDTH - 56, 350);
/** Sözler/kuyruk açıkken sağ köşeye yerleşen küçük kapak boyutu. */
const MINI_COVER_SIZE = 52;

/**
 * Queue rows are flattened so the single FlatList can virtualize both the
 * regular queue and the manually queued "up next" items. Rendering the up-next
 * list with .map() creates an Animated tree for every queued track at once,
 * which is a major memory spike for large queues.
 */
type QueueDisplayRow =
  | QueueRow<Track>
  | { kind: 'upnext-item'; key: string; item: UpNextItem; upNextIndex: number };

/** Manuel arama listesi: sağlayıcı başlıkları + aday satırları. */
type CandidateListRow =
  | {
      kind: 'header';
      key: string;
      source: LyricsCandidate['source'];
      label: string;
      count: number;
    }
  | { kind: 'candidate'; key: string; item: LyricsCandidate };

type CandidateFilter = 'all' | LyricsCandidate['source'];

const CANDIDATE_SOURCE_ORDER: LyricsCandidate['source'][] = [
  'lrc.red',
  'lrclib',
  'genius',
];

function getCandidateSourceLabel(source: LyricsCandidate['source']): string {
  if (source === 'lrc.red') return 'lrc.red';
  if (source === 'lrclib') return 'LRCLIB';
  return 'Genius';
}

/** Söz ofsetini işaretli, tek ondalıklı saniye olarak gösterir. */
function formatLyricsOffset(value: number): string {
  const normalized = Math.abs(value) < 0.05 ? 0 : value;
  return `${normalized > 0 ? '+' : ''}${normalized.toFixed(1)}s`;
}

function formatTime(secs: number): string {
  if (isNaN(secs) || secs < 0) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Apple Music tarzı söz paneli yardımcıları
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Satırların yeni aktif satıra geçiş süresi.
 *
 * Yeni satır **hızlı** parlamalı: 560 ms'lik tek süre, satır başladıktan sonra
 * eski satırın bir süre daha parlak kalmasına ve yeni satırın geç geldiği
 * izlenimine yol açıyordu. Aktifleşme kısa, pasifleşme biraz daha uzun.
 */
const LYRIC_SETTLE_ACTIVE_MS = 160;
const LYRIC_SETTLE_INACTIVE_MS = 320;
/**
 * Söz panelinin tek ön alma süresi (saniye).
 *
 * NEDEN TEK SABİT: satır odağı (hangi satır aktif) ve harf süpürmesi (renklenme)
 * iki ayrı sabitle hesaplanıyordu. Satır öne alması 0.3, saat öne alması 0.22
 * olduğu için satır aktifleştiği anda saat henüz satırın başına gelmemişti:
 * odak alt satıra kayıyor, renklenme ~80 ms sonra başlıyordu. Kullanıcı bunu
 * "satır geçiyor ama sonra renkleniyor" olarak görüyordu.
 *
 * Artık ikisi de bu sabiti kullanıyor; satır aktifleştiği **an** ilk harf
 * yanmaya başlıyor. Değer, konumun ses motorundan alınıp JS'e ulaşması ve
 * React'in satırı çizmesi için gereken gecikmeyi telafi eder.
 */
const LYRIC_SYNC_LEAD_SECONDS = 0.3;
/**
 * Otomatik kaydırmanın ön alması. **Satır odağı/renklenme ile aynı** olmalı.
 *
 * NEDEN: kaydırma 0.8 sn önce başlıyordu, oysa satır 0.3 sn önce aktifleşiyor.
 * Aradaki yarım saniye boyunca satır ekranın ortasına gelmiş ama sönük duruyor,
 * renklenme ancak sonradan başlıyordu ("satıra geçiyor ama renklenmiyor").
 * Artık liste yeni satıra, o satır aktifleştiği **an** kaymaya başlar: kaydırma
 * animasyonu sürerken ilk harf çoktan yanıyor olur.
 */
const LYRIC_SCROLL_LEAD_SECONDS = LYRIC_SYNC_LEAD_SECONDS;
/**
 * Satır başlangıcı ile ilk kelimenin zamanı arasında kabul edilen en büyük fark
 * (saniye).
 *
 * TTML'de `<p begin>` bazen ilk heceden bir tık önce olur (satır hazırlığı,
 * nefes). Bu fark renklenmenin satır odağından sonra başlamasına yol açıyordu.
 * Bu sınırın altındaki farklar yok sayılır ve ilk kelime satır başlangıcına
 * çekilir; daha büyük farklar gerçek enstrümantal giriş olabilir, korunur.
 */
const LYRIC_WORD_START_TOLERANCE = 0.35;
/**
 * Süpürme saatinin ön alması. Konum saniyede 5 kez geldiği için saat, örnek
 * anından bir sonraki örneğe kadar ilerletilir; hedef budur (saniye).
 */
const LYRIC_CLOCK_LOOKAHEAD = 0.2;
/**
 * Bölünen satırların hedef doluluğu: her satır ekranın yaklaşık üçte ikisini
 * kullanır. Tam genişliğe sıkıştırmak yerine dengeli/kısa satırlar okunurluğu
 * artırır (Apple Music de satırları sonuna kadar doldurmaz).
 */
const LYRIC_LINE_FILL_TARGET = 2 / 3;
/** Aktif satırın dikey konumu; Apple Music'te satır üstte üçte birlik bölgede durur. */
const LYRIC_ACTIVE_VIEW_POSITION = 0.32;
/**
 * Aktif satırdan uzaklaştıkça sönükleşme. Telefon düzeninde (şarkı söylenen
 * satır üstte, kalanı aşağıda) BitChord'un kullandığı seri.
 */
const LYRIC_FALLOFF_ALPHA = [1, 0.74, 0.6, 0.48, 0.4, 0.34];
const LYRIC_EASING = Easing.bezier(0.41, 0, 0.12, 0.99);
const GAP_DOT_REST_ALPHA = 0.25;
const GAP_ROW_HEIGHT = 48;
/** Aktif satırda henüz söylenmemiş harfin rengi. */
const SWEEP_DIM_COLOR = 'rgba(255, 255, 255, 0.38)';
/** Aktif satırda söylenmiş harfin rengi. */
const SWEEP_LIT_COLOR = '#ffffff';
/** Arka vokal satırı için aynı çiftin daha sönük hali. */
const SWEEP_BG_DIM_COLOR = 'rgba(255, 255, 255, 0.26)';
const SWEEP_BG_LIT_COLOR = 'rgba(255, 255, 255, 0.78)';
/**
 * Senkron sözlerin tipografisi. Düz metin sözlerin (`plainLyricsText`) ölçüleri
 * bilinçli olarak ayrı tutulur; burada yalnızca zaman damgalı satırlar büyür.
 */
const LYRIC_FONT_INACTIVE = 27;
const LYRIC_LINE_HEIGHT_INACTIVE = 36;
/**
 * Aktif satır da aynı ölçüyü kullanır. Önceki sürümde aktif satır büyüyordu;
 * bu, satır yüksekliğini aniden değiştirip kaydırmayı sıçratıyordu. Vurgu artık
 * parlaklık, gölge ve ölçekle yapılıyor — düzen sabit kaldığı için geçişler
 * tamamen yumuşak akıyor.
 */
const LYRIC_FONT_ACTIVE = 27;
const LYRIC_LINE_HEIGHT_ACTIVE = 36;
/** Kelimeler arası boşluk (satır içi düzen kelime kelime kurulduğu için elle). */
const LYRIC_WORD_GAP = 7;
const LYRIC_BG_FONT = 17;
const LYRIC_BG_LINE_HEIGHT = 23;
const LYRIC_BG_WORD_GAP = 5;
/** Söylenen kelimenin yukarı kalkma mesafesi (dp). */
const LYRIC_WORD_LIFT = 4;
/**
 * Söz metninin gölgesi iki farklı iş için kullanılıyor.
 *
 * - **Bulanıklık (pasif satırlar):** dar yarıçap, yüksek opaklık. Harfin
 *   kenarlarını dağıtıp odaktan çıkmış görünüm verir (Apple Music'in odak dışı
 *   satırları). React Native metne gerçek `blur` uygulayamadığı için gölgeyle
 *   taklit ediliyor.
 * - **Hâle (aktif satır):** geniş yarıçap, düşük opaklık. Harfin çevresinde
 *   yumuşak bir ışık bırakır; harfin kendisi net kalır. Bu ikisi karıştırılırsa
 *   aktif satır da bulanık görünüyordu.
 *
 * Kayma her ikisinde de yok (offset 0,0).
 */
const LYRIC_TEXT_SHADOW_OFFSET = { width: 0, height: 0 };
/** Pasif satır: hafif bulanıklık (blur 5, opaklık 0.75). */
const LYRIC_BLUR_SHADOW_COLOR = 'rgba(255, 255, 255, 0.75)';
const LYRIC_BLUR_SHADOW_RADIUS = 5;
/**
 * Aktif satır: hâle. Yarıçap geniş, opaklık düşük — harfin kendisi keskin
 * kalırken çevresinde yumuşak bir parıltı oluşur.
 */
const LYRIC_GLOW_SHADOW_COLOR = 'rgba(255, 255, 255, 0.55)';
const LYRIC_GLOW_SHADOW_RADIUS = 14;
/** Arka vokal daha küçük puntoda: hâlesi de bir tık dar. */
const LYRIC_BG_GLOW_SHADOW_COLOR = 'rgba(255, 255, 255, 0.45)';
const LYRIC_BG_GLOW_SHADOW_RADIUS = 10;
/**
 * 0→1 arası yumuşak geçiş (smoothstep). Lineer rampalar (harf yanması, kelime
 * kalkışı) sert görünüyordu; bu eğri başta ve sonda hızı sıfıra indirir.
 */
function smoothstep(value: number): number {
  'worklet';
  const t = value <= 0 ? 0 : value >= 1 ? 1 : value;
  return t * t * (3 - 2 * t);
}
/**
 * Söz listesinin yatay iç boşluğu (`lyricsListContent.paddingHorizontal`) ve
 * seçim modunda satıra eklenen iç boşluk (`lyricRowSelectable.paddingHorizontal`).
 * Bölme hesabı bu değerleri kullanır; stil değişirse buradan güncellenir.
 */
const LYRIC_LIST_H_PADDING = 6;
const LYRIC_SELECT_H_PADDING = 8;

function getLyricsSourceLabel(
  lyrics: LyricsResult | null,
  hasWordSync: boolean,
  fallback: string
): string {
  if (!lyrics) return fallback;
  const base =
    lyrics.source === 'lrc.red'
      ? 'lrc.red'
      : lyrics.source === 'lrclib'
      ? 'LRCLIB'
      : lyrics.source === 'genius'
      ? 'Genius'
      : fallback;
  if (lyrics.source === 'custom') return base;
  const hasLines = (lyrics.parsedLines?.length ?? 0) > 0;
  const kind = hasWordSync
    ? 'Word Sync'
    : lyrics.syncedLyrics || hasLines
    ? 'Sync'
    : 'Plain Text';
  return `${base} (${kind})`;
}

/**
 * Paylaşım kartı için satır listesi: ara boşluk işaretleri atlanır.
 *
 * `buildLyricRows` deterministik olduğu için üretilen anahtarlar söz panelindeki
 * satır anahtarlarıyla birebir aynıdır; seçim bu anahtarlar üzerinden yapılır.
 */
function buildShareLines(lines: LyricLine[]): LyricShareLine[] {
  const rows = buildLyricRows(splitBackgroundVocals(lines));
  const list: LyricShareLine[] = [];
  for (const row of rows) {
    if (row.kind !== 'line') continue;
    list.push({
      key: row.key,
      text: row.line.text,
      background: row.line.background?.text,
      align: row.line.alignment === 'end' ? 'end' : 'start',
    });
  }
  return list;
}

/**
 * Düz metin (senkronize olmayan) sözler için paylaşım satırları.
 *
 * NEDEN: paylaşım önceden yalnızca `parsedLines` (zaman damgalı sözler) varsa
 * çalışıyordu; düz metin sözlerde kart hiç açılmıyordu. Anahtarlar söz
 * panelindeki düz metin satırlarıyla (`plain-<index>`) birebir aynı üretiliyor,
 * böylece seçim aynı anahtarlar üzerinden yapılır.
 *
 * Genius'un `[Verse 1]` bölüm başlıkları ve boş satırlar karta girmez.
 */
function buildPlainShareLines(source: string | null | undefined): LyricShareLine[] {
  if (!source) return [];
  const list: LyricShareLine[] = [];
  source.split('\n').forEach((raw, index) => {
    const text = raw.trim();
    if (!text || isGeniusSectionHeader(text)) return;
    list.push({ key: `plain-${index}`, text });
  });
  return list;
}

/**
 * Tek harf. Söylendikçe sönük renkten parlak renge geçer.
 *
 * Renk animasyonu bilinçli olarak `color` üzerinden yapılıyor: React Native'de
 * iç içe `<Text>` parçaları Android'de tek bir attributed string'e düzleştiği
 * için bu parçalara ne `opacity` ne de animasyonlu `color` uygulanabiliyordu.
 * Artık her harf ayrı bir `<Text>`; bu yüzden animasyon gerçekten çalışıyor.
 *
 * Harfin kendi `color`'ı animasyonlu; hâle/bulanıklık satırdan gelen ortak
 * `textShadowStyle` ile veriliyor. Bu stil satır düzeyinde **tek kez** üretilip
 * bütün harflere aynı referansla geçirildiği için harf başına ayrı animasyon
 * kaydı oluşmuyor, yalnızca satırın odak değeri değişiyor.
 *
 * `clock` panelin ortak saatidir; 4 Hz'lik oynatma konumu güncellemeleri harf
 * geçişlerini sıçratmaz.
 */
function SweepChar({
  clock,
  start,
  end,
  text,
  dimColor,
  litColor,
  textStyle,
  textShadowStyle,
}: {
  clock: { value: number };
  start: number;
  end: number;
  text: string;
  dimColor: string;
  litColor: string;
  textStyle: StyleProp<TextStyle>;
  /** Satır odağına bağlı animasyonlu gölge (bulanıklık ↔ hâle). */
  textShadowStyle: AnimatedStyle<TextStyle>;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    /*
     * Değeri aralığa kıstırıyoruz; interpolateColor ekstrapolasyonla renk
     * üretmesin (kırmızıya kayan bozuk tonlar). Saat bir an için geçersiz
     * olursa (NaN) harfler sönük kalmak yerine yanmış renkte dursun.
     */
    const now = Number.isFinite(clock.value) ? clock.value : end;
    const clamped = Math.min(Math.max(now, start), end);
    return {
      color:
        end > start
          ? interpolateColor(clamped, [start, end], [dimColor, litColor])
          : litColor,
    };
  });
  return (
    <Reanimated.Text style={[textStyle, animatedStyle, textShadowStyle]}>
      {text}
    </Reanimated.Text>
  );
}

/**
 * Harf düğümleri memoize edilir: panel saniyede birkaç kez yeniden çizilse de
 * animasyonlu stiller yeniden kaydedilmez, yalnızca saat ilerler.
 */
const MemoSweepChar = React.memo(SweepChar);

/** Süpürmeli çizime hazır kelime: boşlukları kırpılmış, zaman aralığı çözülmüş. */
interface SweepWordItem {
  key: string;
  text: string;
  start: number;
  end: number;
}

/**
 * Kelimeleri süpürme için hazırlar. Satır sonundaki boşluklar atılır; kelimeler
 * arası boşluk `gap` ile verildiği için metne gömülü boşluk gerekmiyor.
 */
function prepareSweepWords(list: NonNullable<LyricLine['words']>): SweepWordItem[] {
  const items: SweepWordItem[] = [];
  list.forEach((word, index) => {
    const text = word.text.replace(/\s+$/, '');
    if (!text) return;
    const next = list[index + 1];
    items.push({
      key: `${index}`,
      text,
      start: word.time,
      end: word.endTime ?? next?.time ?? word.time + Math.max(0.35, text.length * 0.06),
    });
  });
  return items;
}

/**
 * Satırları dengeli böler: kelimeler kırılmaz ve satırlar `fillTarget` doluluğa
 * göre dağıtılır.
 *
 * `widths` ölçülen gerçek kelime genişlikleridir; bu yüzden bölme tahmine değil
 * gerçek düzene dayanır. Maliyet, her satırın `fillTarget` doluluğundan sapmasının
 * karesidir; satır sayısı da bu maliyetten doğar. Ana sözlerde hedef 2/3'tür
 * (uzun sözler dengeli bölünür), arka vokalde 1'dir: yalnızca sığmadığında
 * bölünür.
 */
function balancedLineBreaks(
  widths: number[],
  gap: number,
  maxWidth: number,
  fillTarget: number
): number[] {
  const n = widths.length;
  if (n === 0 || maxWidth <= 0) return [];

  const spanWidth = (from: number, to: number) => {
    let total = 0;
    for (let i = from; i < to; i++) total += widths[i];
    return total + gap * Math.max(0, to - from - 1);
  };

  const target = maxWidth * fillTarget;
  const targetGap = 4; // tek kelimelik son satır ("dul") cezası, normalize edilmiş

  const INF = Number.POSITIVE_INFINITY;
  const cost: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(n + 1).fill(INF)
  );
  const prev: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(n + 1).fill(-1)
  );
  cost[0][0] = 0;

  for (let line = 1; line <= n; line++) {
    for (let end = 1; end <= n; end++) {
      for (let start = 0; start < end; start++) {
        if (cost[line - 1][start] === INF) continue;
        const width = spanWidth(start, end);
        // Taşma yasak; ancak tek başına sığmayan bir kelime kendi satırında kalır.
        if (width > maxWidth && end - start > 1) continue;
        const deviation = (width - target) / maxWidth;
        const widow = end === n && end - start === 1 && line > 1;
        const total = cost[line - 1][start] + deviation * deviation + (widow ? targetGap : 0);
        if (total < cost[line][end]) {
          cost[line][end] = total;
          prev[line][end] = start;
        }
      }
    }
  }

  let bestLine = 0;
  for (let line = 1; line <= n; line++) {
    if (cost[line][n] === INF) continue;
    if (bestLine === 0 || cost[line][n] < cost[bestLine][n]) bestLine = line;
  }
  if (bestLine === 0) return [];

  // Geri izleme.
  const breaks: number[] = [];
  let end = n;
  for (let line = bestLine; line >= 1; line--) {
    const start = prev[line][end];
    if (start < 0) break;
    breaks.unshift(start);
    end = start;
  }
  return breaks;
}

/** Söz satırındaki tek kelime: zamanlaması varsa harf harf süpürülür. */
interface LyricWordNode {
  key: string;
  text: string;
  /** Kelimenin kendi zaman damgası var mı? Yoksa yalnızca satır zamanı vardır. */
  timed: boolean;
  start: number;
  end: number;
}

/**
 * Satırı kelimelere ayırır. Kelime zamanlaması varsa onu kullanır; yoksa
 * (yalnızca satır zamanı olan kaynaklar) satır metni boşluklardan bölünür —
 * böylece dengeli bölme her satırda, aktif olsun olmasın çalışır.
 *
 * @param lineTime Satırın kendi başlangıç zamanı. TTML'de `<p begin>` bazen ilk
 *   heceden bir tık önce olabilir; bu durumda renklenme satır odağından sonra
 *   başlıyor gibi görünüyordu. Aradaki fark küçükse ilk kelimenin başlangıcı
 *   satır başlangıcına çekilir: odak kaydığı **an** renklenme de başlar.
 */
function prepareWordNodes(
  text: string,
  words: LyricLine['words'] | undefined,
  lineTime?: number
): LyricWordNode[] {
  if (words && words.length > 0) {
    const items = prepareSweepWords(words);
    if (items.length > 0) {
      const first = items[0];
      if (
        typeof lineTime === 'number' &&
        Number.isFinite(lineTime) &&
        first.start > lineTime &&
        first.start - lineTime <= LYRIC_WORD_START_TOLERANCE
      ) {
        first.start = lineTime;
        first.end = Math.max(first.end, lineTime + 0.05);
      }
      return items.map((item) => ({
        key: item.key,
        text: item.text,
        timed: true,
        start: item.start,
        end: item.end,
      }));
    }
  }
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part, index) => ({
      key: `${index}`,
      text: part,
      timed: false,
      start: 0,
      end: 0,
    }));
}

/**
 * Tek kelime kutusu.
 *
 * Apple Music'te söylenen kelime hafifçe yukarı kalkar, kelime söylenip
 * geçtikten sonra yumuşakça yerine oturur. Burada kalkış `clock` üzerinden
 * hesaplanır: kelime başında hızlı bir yükselme (120 ms), kelime boyunca
 * yukarıda kalma, kelime bitiminden sonra yavaş bir yerleşme (500 ms).
 * Konum `withTiming` ile sürekli ilerlediği için animasyon UI thread'inde akıcı
 * çalışır; geri sarıldığında da konuma göre doğru yere oturur.
 *
 * Transform kullanıldığı için düzen (satır yüksekliği, ölçülen genişlik)
 * değişmez; bu sayede satır geçişlerinde sıçrama olmaz.
 */
const LyricWordBox = React.memo(function LyricWordBox({
  node,
  clock,
  isActive,
  dimColor,
  litColor,
  activeTextStyle,
  idleTextStyle,
  textShadowStyle,
  onMeasure,
}: {
  node: LyricWordNode;
  clock: { value: number };
  isActive: boolean;
  dimColor: string;
  litColor: string;
  activeTextStyle: StyleProp<TextStyle>;
  idleTextStyle: StyleProp<TextStyle>;
  /** Satır odağına bağlı animasyonlu gölge (bulanıklık ↔ hâle). */
  textShadowStyle: AnimatedStyle<TextStyle>;
  onMeasure: (width: number) => void;
}) {
  const animate = isActive && node.timed;
  const liftStyle = useAnimatedStyle(() => {
    if (!animate) return { transform: [{ translateY: 0 }, { scale: 1 }] };
    const now = Number.isFinite(clock.value) ? clock.value : node.end;
    /*
     * Kelime başında yumuşak kalkış, kelime boyunca havada kalma, kelime
     * bittikten sonra uzun bir yerleşme. Süreler önceki sürümden uzun:
     * 120 ms'lik kalkış "sert" görünüyordu.
     */
    const rise = smoothstep((now - node.start) / 0.26);
    const settle = smoothstep((now - node.end) / 0.78);
    const amount = rise * (1 - settle);
    return {
      transform: [{ translateY: -LYRIC_WORD_LIFT * amount }, { scale: 1 + 0.02 * amount }],
    };
  });

  const chars = Array.from(node.text);
  const span = Math.max(0.08, node.end - node.start);

  return (
    <Reanimated.View
      style={[styles.lyricWord, liftStyle]}
      onLayout={(event) => onMeasure(event.nativeEvent.layout.width)}>
      {animate ? (
        chars.map((char, charIndex) => {
          const charStart = node.start + (charIndex / chars.length) * span;
          const charEnd = Math.max(charStart + 0.02, charStart + span / chars.length);
          return (
            <MemoSweepChar
              key={`char-${charIndex}`}
              clock={clock}
              start={charStart}
              end={charEnd}
              text={char}
              dimColor={dimColor}
              litColor={litColor}
              textStyle={activeTextStyle}
              textShadowStyle={textShadowStyle}
            />
          );
        })
      ) : (
        <Reanimated.Text
          style={[isActive ? activeTextStyle : idleTextStyle, textShadowStyle]}>
          {node.text}
        </Reanimated.Text>
      )}
    </Reanimated.View>
  );
});

/**
 * Bir söz satırını kelimelere ve dengeli satırlara böler.
 *
 * Kelimeler kendi ölçülen genişlikleriyle satırlara dengeli dağıtılır: satır tek
 * bir `<Text>` olsaydı tarayıcı açgözlü bölme yapıp son satırda tek kelime
 * bırakırdı. Burada önce kelimeler ölçülür, sonra satırlar eşit doluluğa göre
 * kurulur. Ölçüm tamamlanana kadar doğal (flexWrap) düzen gösterilir.
 *
 * Aktif ve pasif satır AYNI bileşenle, aynı bölünmüş satır yapısıyla çizilir;
 * yalnızca kelimelerin içi değişir. Düzen birebir aynı kaldığı için satır aktif
 * olduğu anda yüksekliği değişmez ve liste sıçramaz. Pasif satırlarda her kelime
 * tek bir `<Text>` (harf düğümü yok), aktif satırda harfler ayrı düğümlerdir.
 */
function LyricWords({
  text,
  words,
  lineTime,
  clock,
  isActive,
  gap,
  alignEnd,
  dimColor,
  litColor,
  activeTextStyle,
  idleTextStyle,
  fillTarget = LYRIC_LINE_FILL_TARGET,
  availableWidth,
  textShadowStyle,
}: {
  text: string;
  words?: LyricLine['words'];
  /** Satırın kendi başlangıç zamanı (ilk kelime hizalaması için). */
  lineTime?: number;
  clock: { value: number };
  isActive: boolean;
  gap: number;
  alignEnd: boolean;
  dimColor: string;
  litColor: string;
  activeTextStyle: StyleProp<TextStyle>;
  idleTextStyle: StyleProp<TextStyle>;
  /** Bölme hedefi: ana söz 2/3, arka vokal 1 (yalnızca sığmazsa bölünür). */
  fillTarget?: number;
  /**
   * Söz satırının kullanabildiği gerçek genişlik. Kendi kabından ölçmek
   * güvenilir değil: `alignSelf: 'flex-start'` olan bir kap içeriğe göre
   * daralıyor ve arka vokal her kelimede alt satıra düşüyordu.
   */
  availableWidth: number;
  /**
   * Satırın odağına bağlı animasyonlu gölge (bulanıklık ↔ hâle). Satır
   * düzeyinde bir kez üretilir ve tüm kelimelere/harflere aynı referansla
   * geçirilir; böylece `React.memo` korunur.
   */
  textShadowStyle: AnimatedStyle<TextStyle>;
}) {
  const nodes = useMemo(
    () => prepareWordNodes(text, words, lineTime),
    [text, words, lineTime]
  );

  const [widths, setWidths] = useState<Record<string, number>>({});
  const [layout, setLayout] = useState<{ key: string; breaks: number[] | null } | null>(
    null
  );

  const layoutKey = `${nodes.map((node) => node.text).join('\u0001')}#${Math.round(
    availableWidth
  )}`;
  const breaks = layout && layout.key === layoutKey ? layout.breaks : null;

  /**
   * Bölünme bir kez hesaplanır ve satır o genişlikte kalana kadar korunur:
   * kelimeler aktif satırda harf düğümlerine ayrıldığı için ölçüleri birkaç
   * ondalık değişebiliyor; yeniden hesaplansaydı satır geçişinde yükseklik
   * oynardı.
   */
  useEffect(() => {
    if (availableWidth <= 0 || nodes.length === 0) return;
    if (layout && layout.key === layoutKey) return;

    const values: number[] = [];
    for (const node of nodes) {
      const value = widths[node.key];
      if (typeof value !== 'number') return;
      values.push(value);
    }

    // 2 px güvenlik payı: harf düğümleri tek kelime düğümüne göre bir tık
    // geniş ölçülebiliyor.
    const result = balancedLineBreaks(
      values,
      gap,
      Math.max(0, availableWidth - 2),
      fillTarget
    );
    setLayout({ key: layoutKey, breaks: result.length > 1 ? result : null });
  }, [layout, layoutKey, availableWidth, widths, nodes, gap, fillTarget]);

  const registerWidth = (key: string, width: number) => {
    const rounded = Math.round(width * 2) / 2;
    setWidths((previous) =>
      previous[key] === rounded ? previous : { ...previous, [key]: rounded }
    );
  };

  const renderWord = (node: LyricWordNode) => (
    <LyricWordBox
      key={`word-${node.key}`}
      node={node}
      clock={clock}
      isActive={isActive}
      dimColor={dimColor}
      litColor={litColor}
      activeTextStyle={activeTextStyle}
      idleTextStyle={idleTextStyle}
      textShadowStyle={textShadowStyle}
      onMeasure={(width) => registerWidth(node.key, width)}
    />
  );

  if (nodes.length === 0) return null;

  // Ölçüm öncesi / tek satır: doğal sarma.
  if (!breaks) {
    return (
      <View
        style={[
          styles.lyricWordRow,
          styles.lyricWordRowWrap,
          { gap },
          alignEnd && styles.lyricWordRowEnd,
        ]}>
        {nodes.map(renderWord)}
      </View>
    );
  }

  // Dengeli satırlar: her satır kendi içinde soldan (veya sağdan) hizalanır.
  const lines: LyricWordNode[][] = [];
  for (let i = 0; i < breaks.length; i++) {
    lines.push(nodes.slice(breaks[i], i + 1 < breaks.length ? breaks[i + 1] : nodes.length));
  }

  return (
    <View style={styles.lyricWordLines}>
      {lines.map((line) => (
        <View
          key={`line-${line[0].key}`}
          style={[styles.lyricWordRow, { gap }, alignEnd && styles.lyricWordRowEnd]}>
          {line.map(renderWord)}
        </View>
      ))}
    </View>
  );
}

/** Bir söz satırı: sola hizalı, mesafeye göre sönükleşen, aktifken hece süpürmeli. */
const LyricLineRowView = React.memo(function LyricLineRowView({
  line,
  lineKey,
  isActive,
  isSelected,
  isSelectionMode,
  distance,
  showBackground,
  availableWidth,
  clock,
  onSeek,
  onToggleSelect,
}: {
  line: LyricLine;
  /** Paylaşım seçiminde bu satırı işaretlemek için kullanılan anahtar. */
  lineKey: string;
  isActive: boolean;
  isSelected: boolean;
  isSelectionMode: boolean;
  distance: number;
  /**
   * Arka vokal, kendi satırına gelinmeden çizilmez. Bir kez açıldıktan sonra
   * (konum o satırın zamanını geçtiği sürece) açık kalır.
   */
  showBackground: boolean;
  /** Satırın metin için kullanabildiği gerçek genişlik (dp). */
  availableWidth: number;
  clock: { value: number };
  /**
   * Geri çağrılar **kararlı** olmalı (kimlikleri değişmemeli): satırlar
   * `React.memo` ile korunuyor. Satır başına ok fonksiyonu üretmek, oynatma
   * konumu her güncellendiğinde tüm görünür satırların yeniden çizilmesine ve
   * renk geçişinin kasmasına yol açıyordu.
   */
  onSeek: (time: number) => void;
  onToggleSelect: (key: string) => void;
}) {
  // Seçim modunda okunabilirlik önemlidir: tüm satırlar tam parlaklıkta kalır.
  const targetAlpha =
    isActive || isSelectionMode
      ? 1
      : LYRIC_FALLOFF_ALPHA[Math.min(distance, LYRIC_FALLOFF_ALPHA.length - 1)];
  const alpha = useSharedValue(targetAlpha);
  const scale = useSharedValue(isActive || isSelectionMode ? 1 : 0.985);
  /**
   * Odak: 0 = pasif (bulanık), 1 = aktif (hâleli).
   *
   * Blur ↔ glow geçişi stil değişimiyle anlık oluyordu; bu değer iki efekt
   * arasında yumuşak bir geçiş sağlar. Satır aktifleştiğinde hâle belirirken
   * bulanıklık dağılır, satır geride kaldığında tersi olur.
   */
  const focus = useSharedValue(isActive || isSelectionMode ? 1 : 0);

  useEffect(() => {
    // Aktifleşme hızlı, pasifleşme biraz daha yumuşak: yeni satır söylenmeye
    // başladığı anda parlak olmalı.
    const duration =
      isActive || isSelectionMode ? LYRIC_SETTLE_ACTIVE_MS : LYRIC_SETTLE_INACTIVE_MS;
    alpha.value = withTiming(targetAlpha, {
      duration,
      easing: LYRIC_EASING,
    });
    scale.value = withTiming(isActive || isSelectionMode ? 1 : 0.985, {
      duration,
      easing: LYRIC_EASING,
    });
    focus.value = withTiming(isActive || isSelectionMode ? 1 : 0, {
      duration,
      easing: LYRIC_EASING,
    });
  }, [alpha, scale, focus, targetAlpha, isActive, isSelectionMode]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: alpha.value,
    transform: [{ scale: scale.value }],
  }));

  /*
   * Ana söz gölgesi: bulanıklık (dar yarıçap, yüksek opaklık) → hâle (geniş
   * yarıçap, düşük opaklık). Yarıçap ve renk birlikte animasyonlandığı için
   * geçiş iki ayrı efekt arasında kayıyormuş gibi görünüyor, sıçramıyor.
   */
  const textShadowStyle = useAnimatedStyle(() => ({
    textShadowColor: interpolateColor(
      focus.value,
      [0, 1],
      [LYRIC_BLUR_SHADOW_COLOR, LYRIC_GLOW_SHADOW_COLOR]
    ),
    textShadowRadius: interpolate(
      focus.value,
      [0, 1],
      [LYRIC_BLUR_SHADOW_RADIUS, LYRIC_GLOW_SHADOW_RADIUS]
    ),
  }));

  /** Arka vokal: aynı geçiş, daha küçük puntoya göre daha dar yarıçapla. */
  const backgroundTextShadowStyle = useAnimatedStyle(() => ({
    textShadowColor: interpolateColor(
      focus.value,
      [0, 1],
      [LYRIC_BLUR_SHADOW_COLOR, LYRIC_BG_GLOW_SHADOW_COLOR]
    ),
    textShadowRadius: interpolate(
      focus.value,
      [0, 1],
      [LYRIC_BLUR_SHADOW_RADIUS, LYRIC_BG_GLOW_SHADOW_RADIUS]
    ),
  }));

  const alignEnd = line.alignment === 'end';

  // Harf düğümleri memoize olduğu için stil referansı sabit kalmalı.
  const activeTextStyle = styles.lyricTextActive;
  const backgroundActiveTextStyle = useMemo(
    () => [styles.lyricBackgroundText, styles.lyricBackgroundTextActive],
    []
  );

  return (
    <Reanimated.View style={animatedStyle} layout={LinearTransition.duration(320)}>
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => (isSelectionMode ? onToggleSelect(lineKey) : onSeek(line.time))}
        accessibilityRole={isSelectionMode ? 'checkbox' : 'button'}
        accessibilityState={isSelectionMode ? { checked: isSelected } : undefined}
        style={[
          styles.lyricRow,
          isSelectionMode && styles.lyricRowSelectable,
          isSelected && styles.lyricRowSelected,
          alignEnd && styles.lyricRowEnd,
        ]}>
        <LyricWords
          text={line.text}
          words={line.words}
          lineTime={line.time}
          clock={clock}
          isActive={isActive}
          dimColor={SWEEP_DIM_COLOR}
          litColor={SWEEP_LIT_COLOR}
          activeTextStyle={activeTextStyle}
          idleTextStyle={styles.lyricText}
          gap={LYRIC_WORD_GAP}
          alignEnd={alignEnd}
          availableWidth={availableWidth}
          textShadowStyle={textShadowStyle}
        />

        {/*
          Arka vokal, kendi satırına gelinince açılır ve açık kalır. Daha önce
          çizilseydi satır, söylenmeden önce iki satırlık yer kaplıyordu.
        */}
        {line.background && showBackground ? (
          <Reanimated.View
            entering={FadeInDown.duration(420)}
            style={styles.lyricBackgroundWrap}>
            <LyricWords
              text={line.background.text}
              words={line.background.words}
              lineTime={line.time}
              clock={clock}
              isActive={isActive}
              dimColor={SWEEP_BG_DIM_COLOR}
              litColor={SWEEP_BG_LIT_COLOR}
              activeTextStyle={backgroundActiveTextStyle}
              idleTextStyle={styles.lyricBackgroundText}
              gap={LYRIC_BG_WORD_GAP}
              alignEnd={alignEnd}
              // Arka vokal sığdığı sürece tek satır kalır; ancak taşarsa bölünür.
              fillTarget={1}
              availableWidth={availableWidth}
              textShadowStyle={backgroundTextShadowStyle}
            />
          </Reanimated.View>
        ) : null}
      </TouchableOpacity>
    </Reanimated.View>
  );
});

/**
 * Boşluktaki üç noktadan biri.
 *
 * İlerleme, panelin ortak saatinden (`clock`) UI thread'inde hesaplanır: böylece
 * noktalar, oynatma konumu güncellendikçe listeyi yeniden çizdirmek zorunda
 * kalmaz. Renk geçişindeki sertlik `smoothstep` ile yumuşatıldı.
 */
function GapDot({
  index,
  clock,
  time,
  endTime,
}: {
  index: number;
  clock: { value: number };
  time: number;
  endTime: number;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    const now = Number.isFinite(clock.value) ? clock.value : time;
    const span = Math.max(0.001, endTime - time);
    const progress = Math.max(0, Math.min(1, (now - time) / span));
    const lit = smoothstep(Math.max(0, Math.min(1, progress * 3 - index)));
    return {
      opacity: GAP_DOT_REST_ALPHA + (1 - GAP_DOT_REST_ALPHA) * lit,
      transform: [{ scale: 0.7 + 0.3 * lit }],
    };
  });
  return <Reanimated.View style={[styles.lyricGapDot, animatedStyle]} />;
}

/** Enstrümantal aranın üç noktası; yalnızca ara sürerken açılır. */
const LyricGapRowView = React.memo(function LyricGapRowView({
  active,
  clock,
  time,
  endTime,
}: {
  active: boolean;
  clock: { value: number };
  time: number;
  endTime: number;
}) {
  const height = useSharedValue(active ? GAP_ROW_HEIGHT : 0);
  useEffect(() => {
    height.value = withTiming(active ? GAP_ROW_HEIGHT : 0, {
      duration: 420,
      easing: LYRIC_EASING,
    });
  }, [active, height]);
  const animatedStyle = useAnimatedStyle(() => ({ height: height.value }));

  return (
    <Reanimated.View style={[styles.lyricGapRow, animatedStyle]}>
      {active ? (
        <View style={styles.lyricGapDots}>
          {[0, 1, 2].map((index) => (
            <GapDot key={index} index={index} clock={clock} time={time} endTime={endTime} />
          ))}
        </View>
      ) : null}
    </Reanimated.View>
  );
});


/**
 * Isolated 4 Hz scrubber. The old fullscreen component polled progress at the
 * root and re-rendered its entire (very large) tree four times per second.
 */
function PlayerScrubber({
  active,
  player,
  theme,
}: {
  active: boolean;
  player: ActivePlayerState;
  theme: ThemeColors;
}) {
  const progress = useActiveProgress(active);
  const [barWidth, setBarWidth] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragTime, setDragTime] = useState(0);

  const duration =
    progress.duration > 0 ? progress.duration : player.activeTrack?.duration || 0;
  const currentPosition = isDragging ? dragTime : progress.position;
  const progressPercent =
    duration > 0 ? Math.min(1, Math.max(0, currentPosition / duration)) : 0;

  const handleTouchCalc = (e: GestureResponderEvent) => {
    if (barWidth <= 0 || duration <= 0) return 0;
    const x = Math.max(0, Math.min(barWidth, e.nativeEvent.pageX - 24));
    return (x / barWidth) * duration;
  };

  const handleSeekGrant = (e: GestureResponderEvent) => {
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
    await player.seekTo(target);
  };

  return (
    <View style={styles.scrubberBox}>
      <View
        style={styles.progressTouchContainer}
        onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={handleSeekGrant}
        onResponderMove={handleSeekMove}
        onResponderRelease={handleSeekRelease}>
        <View
          pointerEvents="none"
          style={[
            styles.progressBarBackground,
            {
              height: isDragging ? 10 : 7,
            },
          ]}>
          <View
            style={[
              styles.progressBarFill,
              { backgroundColor: theme.primary, width: `${progressPercent * 100}%` },
            ]}
          />
        </View>
      </View>
      <View style={styles.timeRow}>
        <Text style={styles.timeText}>{formatTime(currentPosition)}</Text>
        <Text style={styles.timeText}>
          {duration > 0 ? formatTime(duration) : '0:00'}
        </Text>
      </View>
    </View>
  );
}

/**
 * Progress-sensitive lyrics surface. It subscribes to `useActiveProgress`
 * itself so the fullscreen player shell stays idle during playback. While the
 * offset modal is open progress polling is suspended; only the offset update
 * runs, which keeps repeated +/- taps responsive.
 */
function LyricsPanel({
  isFullscreenPlayerOpen,
  isLyricsMode,
  isRemote,
  localActiveTrack,
  allAssets,
  currentLyrics,
  parsedLines,
  isLoadingLyrics,
  activeTrackKey,
  player,
  theme,
  t,
  onManualSearch,
  isShareSelecting,
  selectedShareKeys,
  onStartShareSelect,
  onToggleShareLine,
}: {
  isFullscreenPlayerOpen: boolean;
  isLyricsMode: boolean;
  isRemote: boolean;
  localActiveTrack: Track | null;
  allAssets: MediaLibrary.Asset[];
  currentLyrics: LyricsResult | null;
  parsedLines: LyricLine[];
  isLoadingLyrics: boolean;
  activeTrackKey: string | null;
  player: ActivePlayerState;
  theme: ThemeColors;
  t: (key: string, params?: Record<string, string | number>) => string;
  onManualSearch: () => void;
  /** Söz paylaşımı için satır seçme modu (kontrol çubuğu üst bileşende). */
  isShareSelecting: boolean;
  selectedShareKeys: string[];
  onStartShareSelect: (initialKeys: string[]) => void;
  onToggleShareLine: (key: string) => void;
}) {
  const isAppActive = useIsAppActive();
  const isOnline = useIsOnline();
  const [isAutoScrollPaused, setIsAutoScrollPaused] = useState(false);
  const [isOffsetOpen, setIsOffsetOpen] = useState(false);
  /**
   * Söz listesinin ölçülen genişliği.
   *
   * Dengeli satır bölme buradan gelen gerçek genişlikle yapılır: satırın kendi
   * kabından ölçmek güvenilir değildi; içeriğe göre daralan bir kap yüzünden
   * arka vokal her kelimede alt satıra düşüyordu.
   */
  const [lyricsListWidth, setLyricsListWidth] = useState(0);

  /**
   * Söz metninin kullanabildiği genişlik: liste genişliğinden listenin yatay iç
   * boşluğu (6+6) ve seçim modunda satıra eklenen iç boşluk (8+8) düşülür.
   */
  const lyricsAvailableWidth = useMemo(() => {
    if (lyricsListWidth <= 0) return 0;
    const sidePadding = LYRIC_LIST_H_PADDING + (isShareSelecting ? LYRIC_SELECT_H_PADDING : 0);
    return Math.max(0, lyricsListWidth - sidePadding * 2);
  }, [lyricsListWidth, isShareSelecting]);

  const selectedShareSet = useMemo(
    () => new Set(selectedShareKeys),
    [selectedShareKeys]
  );

  const progress = useActiveProgress(
    isFullscreenPlayerOpen && isLyricsMode && !isOffsetOpen,
    // Söz senkronu için 200 ms: satır/kelime geçişi örnekleme yüzünden geç
    // kalmasın. Yalnızca söz paneli görünürken abone olunur.
    200
  );

  const lyricsFlatListRef = useRef<FlatList<LyricDisplayRow>>(null);
  const isUserScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<any>(null);
  const scrollToIndexFallbackRef = useRef<any>(null);

  const plainLyricsScrollRef = useRef<ScrollView>(null);
  const plainContentHeightRef = useRef(0);
  const plainScrollViewHeightRef = useRef(0);
  const isPlainUserScrollingRef = useRef(false);
  const plainScrollTimeoutRef = useRef<any>(null);
  const plainProgressRef = useRef({ position: 0, at: 0, playing: false });

  const lyricsOffsetKeys = useMemo(() => {
    if (!localActiveTrack) return [] as string[];
    const keys = [
      resolveTrackId(localActiveTrack, allAssets),
      String(localActiveTrack.id || ''),
      String(localActiveTrack.url || ''),
    ]
      .map((key) => key.trim())
      .filter(Boolean);
    return Array.from(new Set(keys));
  }, [localActiveTrack, allAssets]);
  const lyricsOffsetKey = lyricsOffsetKeys[0] || '';

  const lyricsOffsets = useStore((s) => s.lyricsOffsets);
  const setLyricsOffsets = useStore((s) => s.setLyricsOffsets);

  const lyricsOffset = useMemo(() => {
    if (!localActiveTrack || isRemote) return 0;
    for (const key of lyricsOffsetKeys) {
      const value = lyricsOffsets[key];
      if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
    return 0;
  }, [localActiveTrack, lyricsOffsetKeys, lyricsOffsets, isRemote]);
  const appliedLyricsOffset = isRemote ? 0 : lyricsOffset;

  const hasWordSync = useMemo(() => {
    if (!currentLyrics) return false;
    if (currentLyrics.hasWordSync) return true;
    return parsedLines.some((l) => !!l.words && l.words.length > 0);
  }, [currentLyrics, parsedLines]);
  const hasLyricsContent = parsedLines.length > 0 || !!currentLyrics?.plainLyrics;

  // Ofset, söz zaman çizelgesini kaydırır. Pozitif değer sözleri geciktirir,
  // bu yüzden karşılaştırmada ses konumundan ofset çıkarılır.
  const lyricPosition = progress.position - appliedLyricsOffset;

  /**
   * Hece süpürmesinin saati.
   *
   * `useActiveProgress` konumu saniyede 4 kez (200 ms'de bir) verir; doğrudan
   * kullansaydık harf aydınlanması çeyrek saniyelik adımlarla sıçrardı. Bunun
   * yerine saat, `konum + ön alma` hedefine doğrusal ilerletilir (UI thread'inde
   * 60 fps).
   *
   * Satır odağı ile **aynı** ön alma (`LYRIC_SYNC_LEAD_SECONDS`) kullanılır:
   * satır aktifleştiği anda saat, satırın başlangıç zamanına ulaşmış olur ve ilk
   * harf beklemeden yanmaya başlar. İki farklı ön alma kullanmak, odağın alt
   * satıra kayıp renklenmenin gecikmeli başlamasına yol açıyordu.
   *
   * En kritik kural: saat **asla gerçek konumdan kopuk kalmamalı**. Panel
   * açılışı, seek veya şarkı değişimi gibi büyük sıçramalarda saat eski yerde
   * kalırsa satır aktif görünürken harfler sönük kalır. Bu yüzden fark eşiği
   * aşarsa (ya da saat hedefin gerisine düşerse) saat anında hedefe oturtulur,
   * sonra normal ilerlemesine bırakılır.
   */
  const lyricClock = useSharedValue(lyricPosition + LYRIC_SYNC_LEAD_SECONDS);

  useEffect(() => {
    if (!Number.isFinite(lyricPosition)) return;

    const desired = lyricPosition + LYRIC_SYNC_LEAD_SECONDS;

    // Duraklatıldı: saati olduğu yere sabitle.
    if (!player.isPlaying) {
      lyricClock.value = desired;
      return;
    }

    const from = lyricClock.value;
    /*
     * `0.35` çok gevşekti: JS birkaç tur geciktiğinde saat sessizce geride
     * kalıyor, kelime senkronu saniyenin bir kısmı boyunca geç yanıyordu.
     * Artık 0.18 saniyeden fazla sapma anında düzeltilir; hedefin gerisinde
     * kalınca da bekletmeden ileri sarılır.
     */
    const drifted = !Number.isFinite(from) || Math.abs(from - desired) > 0.18;
    if (drifted || from < desired - 0.01) lyricClock.value = desired;

    lyricClock.value = withTiming(desired + LYRIC_CLOCK_LOOKAHEAD, {
      duration: LYRIC_CLOCK_LOOKAHEAD * 1000,
      easing: Easing.linear,
    });
  }, [lyricPosition, player.isPlaying, lyricClock]);

  // Görüntülenecek satırlar: enstrümantal aralar + parantezden ayrılan arka
  // vokaller. `parsedLines` saf kalır (önbellek ve uzaktan senkron bozulmasın).
  const displayRows = useMemo<LyricDisplayRow[]>(
    () => buildLyricRows(splitBackgroundVocals(parsedLines)),
    [parsedLines]
  );

  const { activeRowIndex, activeLineRowIndex } = useMemo(() => {
    const position = lyricPosition + LYRIC_SYNC_LEAD_SECONDS;
    let row = -1;
    let lineRow = -1;
    for (let i = 0; i < displayRows.length; i++) {
      if (position >= displayRows[i].time) {
        row = i;
        if (displayRows[i].kind === 'line') lineRow = i;
      }
    }
    return { activeRowIndex: row, activeLineRowIndex: lineRow };
  }, [displayRows, lyricPosition]);

  /**
   * Paylaşım kartı için satır listesi (boşluk işaretleri hariç).
   *
   * Zaman damgalı sözler varsa onlar kullanılır; yoksa düz metin sözlerden
   * üretilir. Böylece paylaşım her söz tipinde çalışır.
   */
  const shareLines = useMemo(
    () =>
      parsedLines.length > 0
        ? buildShareLines(parsedLines)
        : buildPlainShareLines(currentLyrics?.plainLyrics),
    [parsedLines, currentLyrics?.plainLyrics]
  );

  /**
   * Arka vokali açılmış **son satırın** indeksi.
   *
   * Satırlar oynatma konumu her güncellendiğinde yeniden çizilmesin diye
   * görünürlük bilgisi tek bir sayıya indiriliyor ve `extraData`'ya ekleniyor:
   * liste yalnızca gerçekten bir arka vokal açıldığında tazelenir. Bu, renk
   * geçişinin kasmasına yol açan gereksiz çizimleri önler.
   */
  const backgroundRevealedRow = useMemo(() => {
    const position = lyricPosition + LYRIC_SYNC_LEAD_SECONDS;
    let revealed = -1;
    for (let i = 0; i < displayRows.length; i++) {
      const row = displayRows[i];
      if (row.kind !== 'line' || !row.line.background) continue;
      if (position >= row.line.background.time) revealed = i;
    }
    return revealed;
  }, [displayRows, lyricPosition]);

  /**
   * Seçim moduna girerken çalan satır ve ardından gelen üç satır seçili gelir.
   * Düz metin sözlerde "çalan satır" olmadığı için ilk dört satır seçilir.
   */
  const shareInitialKeys = useMemo(() => {
    if (activeLineRowIndex < 0) {
      return shareLines.slice(0, 4).map((line) => line.key);
    }
    const keys: string[] = [];
    for (let i = activeLineRowIndex; i < displayRows.length && keys.length < 4; i++) {
      if (displayRows[i].kind === 'line') keys.push(displayRows[i].key);
    }
    return keys;
  }, [activeLineRowIndex, displayRows, shareLines]);

  // Kaydırma hedefi: ara sürerken noktalara, satır gelmeden hemen önce ise bir
  // sonraki satıra. Böylece panel satırı söylenirken yerine oturur.
  const scrollTargetIndex = useMemo(() => {
    if (activeRowIndex < 0) return -1;
    const next = displayRows[activeRowIndex + 1];
    if (
      next &&
      next.kind === 'line' &&
      next.time - lyricPosition <= LYRIC_SCROLL_LEAD_SECONDS
    ) {
      return activeRowIndex + 1;
    }
    return activeRowIndex;
  }, [activeRowIndex, displayRows, lyricPosition]);

  const plainLyricsSource = currentLyrics?.plainLyrics ?? '';

  /**
   * Düz metin sözleri Apple Music'teki gibi satır satır işler: Genius'un
   * `[Verse 2: Artist]` başlıkları ham köşeli parantez yerine küçük bir bölüm
   * etiketi olarak çizilir.
   */
  const plainLyricRows = useMemo(() => {
    if (!plainLyricsSource) return [];
    return plainLyricsSource.split('\n').map((raw, index) => {
      const text = raw.trim();
      if (!text) return { kind: 'blank' as const, key: `plain-${index}`, text: '' };
      if (isGeniusSectionHeader(text)) {
        return {
          kind: 'section' as const,
          key: `plain-${index}`,
          text: getGeniusSectionLabel(text),
        };
      }
      return { kind: 'text' as const, key: `plain-${index}`, text: raw };
    });
  }, [plainLyricsSource]);

  /**
   * Satıra dokununca o ana atla. Tüm satırlar AYNI fonksiyonu paylaşır; her
   * render'da yeni bir ok fonksiyonu üretmek `React.memo`'yu boşa çıkarıp
   * yüzlerce satırı gereksiz yeniden çizdirirdi.
   *
   * Kimliği **tamamen sabit** tutmak için güncel hedef ref'te tutuluyor:
   * `player` nesnesi oynatma konumuyla birlikte saniyede birkaç kez değişiyor,
   * doğrudan bağımlılık verilseydi bu geri çağrı da (ve dolayısıyla tüm söz
   * satırları) 4 Hz'de yeniden çizilirdi.
   */
  const seekTargetRef = useRef({ seek: player.seekTo, offset: appliedLyricsOffset });
  useEffect(() => {
    seekTargetRef.current = { seek: player.seekTo, offset: appliedLyricsOffset };
  }, [player.seekTo, appliedLyricsOffset]);

  const seekToLyricTime = useCallback((time: number) => {
    const { seek, offset } = seekTargetRef.current;
    seek(Math.max(0, time + offset));
  }, []);

  /**
   * Satır çizici.
   *
   * `useCallback` ile sabitleniyor: aksi hâlde oynatma konumu her güncellendiğinde
   * kimliği değişip listenin tüm hücrelerini yeniden çizdiriyordu. Buradaki
   * bağımlılıklar yalnızca satır geçişlerinde/seçimde değişir; renk süpürmesi
   * `clock` shared value'undan UI thread'inde okunur.
   */
  const renderLyricRow = useCallback(
    ({ item, index }: { item: LyricDisplayRow; index: number }) => {
      if (item.kind === 'gap') {
        // Noktaların ilerlemesi saatten hesaplandığı için `progress` prop'una
        // gerek yok; satır yalnızca aktiflik değişiminde çizilir.
        return (
          <LyricGapRowView
            active={index === activeRowIndex}
            clock={lyricClock}
            time={item.time}
            endTime={item.endTime}
          />
        );
      }

      return (
        <LyricLineRowView
          line={item.line}
          lineKey={item.key}
          isActive={index === activeLineRowIndex}
          isSelected={isShareSelecting && selectedShareSet.has(item.key)}
          isSelectionMode={isShareSelecting}
          distance={Math.abs(index - activeLineRowIndex)}
          // Arka vokal, kendi zamanı gelince açılır ve açık kalır.
          showBackground={index <= backgroundRevealedRow}
          availableWidth={lyricsAvailableWidth}
          // Saat paylaşılan bir shared value'dur: satırlar yeniden
          // çizilmeden harf renkleri UI thread'inde güncellenir.
          clock={lyricClock}
          onSeek={seekToLyricTime}
          onToggleSelect={onToggleShareLine}
        />
      );
    },
    [
      activeRowIndex,
      activeLineRowIndex,
      backgroundRevealedRow,
      isShareSelecting,
      selectedShareSet,
      lyricsAvailableWidth,
      lyricClock,
      seekToLyricTime,
      onToggleShareLine,
    ]
  );

  const toggleAutoScroll = useCallback(() => {
    setIsAutoScrollPaused((prev) => {
      const next = !prev;
      if (!next && scrollTargetIndex >= 0 && displayRows.length > 0) {
        try {
          lyricsFlatListRef.current?.scrollToIndex({
            index: scrollTargetIndex,
            animated: true,
            viewPosition: LYRIC_ACTIVE_VIEW_POSITION,
          });
        } catch {
          // Fallback
        }
      }
      return next;
    });
  }, [displayRows.length, scrollTargetIndex]);

  useEffect(() => {
    if (
      isAppActive &&
      isFullscreenPlayerOpen &&
      isLyricsMode &&
      !isOffsetOpen &&
      !isShareSelecting &&
      !isAutoScrollPaused &&
      scrollTargetIndex >= 0 &&
      displayRows.length > 0 &&
      !isUserScrollingRef.current
    ) {
      try {
        lyricsFlatListRef.current?.scrollToIndex({
          index: scrollTargetIndex,
          animated: true,
          viewPosition: LYRIC_ACTIVE_VIEW_POSITION,
        });
      } catch {
        // Fallback
      }
    }
  }, [
    scrollTargetIndex,
    isAppActive,
    isFullscreenPlayerOpen,
    isLyricsMode,
    isOffsetOpen,
    isShareSelecting,
    isAutoScrollPaused,
    displayRows.length,
  ]);

  useEffect(() => {
    plainProgressRef.current = {
      position: progress.position,
      at: Date.now(),
      playing: player.isPlaying,
    };
  }, [progress.position, player.isPlaying]);

  useEffect(() => {
    if (
      !isAppActive ||
      !isFullscreenPlayerOpen ||
      !isLyricsMode ||
      isOffsetOpen ||
      isShareSelecting ||
      isAutoScrollPaused ||
      currentLyrics?.syncedLyrics ||
      !currentLyrics?.plainLyrics ||
      progress.duration <= 0
    ) {
      return;
    }

    let frameId = 0;
    let lastY = -1;
    const duration = progress.duration;

    const tick = () => {
      if (!isPlainUserScrollingRef.current) {
        const maxScroll = Math.max(
          0,
          plainContentHeightRef.current - plainScrollViewHeightRef.current
        );

        if (maxScroll > 0) {
          const snapshot = plainProgressRef.current;
          const elapsed = snapshot.playing
            ? Math.min(0.5, Math.max(0, (Date.now() - snapshot.at) / 1000))
            : 0;
          const estimatedPosition = Math.min(
            duration,
            Math.max(0, snapshot.position + elapsed)
          );
          const adjustedPosition = Math.min(
            duration,
            Math.max(0, estimatedPosition - appliedLyricsOffset)
          );
          const targetY = (adjustedPosition / duration) * maxScroll;

          if (lastY < 0 || Math.abs(targetY - lastY) >= 0.5) {
            lastY = targetY;
            plainLyricsScrollRef.current?.scrollTo({
              y: targetY,
              animated: false,
            });
          }
        }
      }

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [
    progress.duration,
    isAppActive,
    isFullscreenPlayerOpen,
    isLyricsMode,
    isOffsetOpen,
    isShareSelecting,
    isAutoScrollPaused,
    currentLyrics?.syncedLyrics,
    currentLyrics?.plainLyrics,
    appliedLyricsOffset,
  ]);

  useEffect(() => {
    if (activeTrackKey) {
      isPlainUserScrollingRef.current = false;
      if (plainScrollTimeoutRef.current) clearTimeout(plainScrollTimeoutRef.current);
      plainLyricsScrollRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [activeTrackKey]);

  useEffect(() => {
    setIsAutoScrollPaused(false);
    setIsOffsetOpen(false);
  }, [activeTrackKey, isRemote]);

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      if (scrollToIndexFallbackRef.current) clearTimeout(scrollToIndexFallbackRef.current);
    };
  }, []);

  const adjustLyricsOffset = useCallback(
    (delta: number) => {
      if (lyricsOffsetKeys.length === 0 || isRemote) return;
      // Read the latest value from the store instead of the render closure so
      // two quick taps cannot both start from the same stale offset.
      const currentOffsets = useStore.getState().lyricsOffsets;
      let current = 0;
      for (const key of lyricsOffsetKeys) {
        const value = currentOffsets[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
          current = value;
          break;
        }
      }
      setLyricsOffsets(lyricsOffsetKeys, current + delta);
      if (localActiveTrack) remoteSyncManager.broadcastLyricsUpdate(localActiveTrack.id);
    },
    [lyricsOffsetKeys, isRemote, localActiveTrack, setLyricsOffsets]
  );

  const resetLyricsOffset = useCallback(() => {
    if (isRemote || lyricsOffsetKeys.length === 0) return;
    setLyricsOffsets(lyricsOffsetKeys, 0);
    if (localActiveTrack) remoteSyncManager.broadcastLyricsUpdate(localActiveTrack.id);
  }, [isRemote, localActiveTrack, lyricsOffsetKeys, setLyricsOffsets]);

  return (
    <>
      <View style={styles.lyricsCardHeader}>
        <View style={[styles.lyricsSourceBadge, { backgroundColor: theme.surface }]}>
          <Ionicons
            name={
              hasWordSync
                ? 'sparkles'
                : currentLyrics?.syncedLyrics || parsedLines.length > 0
                ? 'musical-notes'
                : 'document-text-outline'
            }
            size={12}
            color={hasWordSync ? '#10b981' : theme.primary}
            style={{ marginRight: 4 }}
          />
          <Text
            numberOfLines={1}
            style={[styles.lyricsSourceText, { color: hasWordSync ? '#10b981' : theme.textAccent }]}>
            {getLyricsSourceLabel(currentLyrics, hasWordSync, t('player.lyrics'))}
          </Text>
        </View>
        <View
          style={[
            { flexDirection: 'row', alignItems: 'center', gap: 6 },
            isShareSelecting && { opacity: 0.22 },
          ]}
          pointerEvents={isShareSelecting ? 'none' : 'auto'}>
          {hasLyricsContent && !isRemote && lyricsOffsetKey ? (
            <TouchableOpacity
              style={[styles.lyricsActionBtn, { backgroundColor: theme.surface }]}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`${t('player.lyrics_offset')} ${formatLyricsOffset(appliedLyricsOffset)}`}
              onPress={() => setIsOffsetOpen(true)}
              hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
              {appliedLyricsOffset !== 0 ? (
                <Text
                  style={[
                    styles.lyricsActionBtnText,
                    { color: theme.primary, marginLeft: 0, fontVariant: ['tabular-nums'] },
                  ]}>
                  {formatLyricsOffset(appliedLyricsOffset)}
                </Text>
              ) : (
                <Ionicons name="time-outline" size={12} color="rgba(255, 255, 255, 0.65)" />
              )}
            </TouchableOpacity>
          ) : null}

          {hasLyricsContent ? (
            <TouchableOpacity
              style={[
                styles.lyricsActionBtn,
                { backgroundColor: theme.surface },
                isAutoScrollPaused && { backgroundColor: 'rgba(239, 68, 68, 0.18)' },
              ]}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={
                isAutoScrollPaused ? t('player.auto_scroll') : t('player.pause_scroll')
              }
              onPress={toggleAutoScroll}
              hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
              <Ionicons
                name={isAutoScrollPaused ? 'play' : 'pause'}
                size={12}
                color={isAutoScrollPaused ? '#ef4444' : theme.primary}
              />
            </TouchableOpacity>
          ) : null}

          {hasLyricsContent && shareLines.length > 0 ? (
            <TouchableOpacity
              style={[styles.lyricsActionBtn, { backgroundColor: theme.surface }]}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={t('player.share_lyrics')}
              onPress={() => onStartShareSelect(shareInitialKeys)}
              hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
              <Ionicons name="share-outline" size={12} color={theme.primary} />
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={[styles.lyricsSearchBtn, { backgroundColor: theme.surface }]}
            activeOpacity={0.7}
            onPress={onManualSearch}>
            <Ionicons name="search" size={12} color={theme.primary} />
            <Text style={[styles.lyricsSearchBtnText, { color: theme.primary }]}>
              {t('player.manual_search')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {isLoadingLyrics ? (
        <View style={styles.lyricsLoadingCenter}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={styles.lyricsLoadingText}>{t('player.searching_lyrics')}</Text>
        </View>
      ) : parsedLines.length > 0 ? (
        <FlatList
          ref={lyricsFlatListRef}
          data={displayRows}
          keyExtractor={(row) => row.key}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.lyricsListContent}
          /*
           * Dengeli bölme için gerçek satır genişliği gerekli. FlatList'in kendi
           * genişliği ölçülür; iç boşluk ve seçim modu payı yukarıda düşülür.
           */
          onLayout={(event) => {
            const width = event.nativeEvent.layout.width;
            setLyricsListWidth((previous) =>
              Math.abs(previous - width) < 0.5 ? previous : width
            );
          }}
          /*
           * Kaydırma hedefi `scrollToIndex` ile veriliyor; hedef satır henüz
           * ölçülmemişse bu çağrı başarısız olup görünür bir sıçrama yaratıyordu.
           * Pencereyi geniş tutmak, sıradaki satırların (ve dengeli bölünmüş
           * yüksekliklerinin) önceden ölçülmesini sağlar.
           */
          initialNumToRender={14}
          maxToRenderPerBatch={14}
          windowSize={9}
          removeClippedSubviews={false}
          /*
           * Hücreler yalnızca gerçekten değişen şeylerle tazelenir: aktif satır,
           * açılmış arka vokaller, seçim ve ölçülen genişlik. Oynatma konumu
           * burada YOK — renk süpürmesi UI thread'inde saatten okunuyor. Konum
           * her güncellendiğinde listeyi yeniden çizdirmek, animasyonu
           * kastıran asıl sebepti.
           */
          extraData={`${activeRowIndex}-${activeLineRowIndex}-${backgroundRevealedRow}-${selectedShareKeys.join(',')}-${lyricsAvailableWidth}-${isShareSelecting}`}
          onScrollToIndexFailed={(info) => {
            // Satırlar farklı yükseklikte; hedef henüz ölçülmediyse yaklaşık
            // konuma git, bir sonraki karede gerçek satıra hizala.
            lyricsFlatListRef.current?.scrollToOffset({
              offset: info.averageItemLength * info.index,
              animated: true,
            });
            scrollToIndexFallbackRef.current = setTimeout(() => {
              try {
                lyricsFlatListRef.current?.scrollToIndex({
                  index: info.index,
                  animated: true,
                  viewPosition: LYRIC_ACTIVE_VIEW_POSITION,
                });
              } catch {
                // Görünür alana gelene kadar bekle; sonraki güncelleme dener.
              }
            }, 120);
          }}
          onScrollBeginDrag={() => {
            isUserScrollingRef.current = true;
            if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
          }}
          onScrollEndDrag={() => {
            if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
            scrollTimeoutRef.current = setTimeout(() => {
              isUserScrollingRef.current = false;
            }, 4000);
          }}
          renderItem={renderLyricRow}
        />
      ) : currentLyrics?.plainLyrics ? (
        <ScrollView
          ref={plainLyricsScrollRef}
          style={styles.plainLyricsScroll}
          contentContainerStyle={styles.plainLyricsContent}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={(_, h) => {
            plainContentHeightRef.current = h;
          }}
          onLayout={(e) => {
            plainScrollViewHeightRef.current = e.nativeEvent.layout.height;
          }}
          onScrollBeginDrag={() => {
            isPlainUserScrollingRef.current = true;
            if (plainScrollTimeoutRef.current) clearTimeout(plainScrollTimeoutRef.current);
          }}
          onScrollEndDrag={() => {
            if (plainScrollTimeoutRef.current) clearTimeout(plainScrollTimeoutRef.current);
            plainScrollTimeoutRef.current = setTimeout(() => {
              isPlainUserScrollingRef.current = false;
            }, 4000);
          }}
          onMomentumScrollBegin={() => {
            isPlainUserScrollingRef.current = true;
            if (plainScrollTimeoutRef.current) clearTimeout(plainScrollTimeoutRef.current);
          }}
          onMomentumScrollEnd={() => {
            if (plainScrollTimeoutRef.current) clearTimeout(plainScrollTimeoutRef.current);
            plainScrollTimeoutRef.current = setTimeout(() => {
              isPlainUserScrollingRef.current = false;
            }, 4000);
          }}>
          {plainLyricRows.map((row) =>
            row.kind === 'section' ? (
              <View key={row.key} style={styles.plainLyricsSectionPill}>
                <Text style={styles.plainLyricsSectionText}>{row.text}</Text>
              </View>
            ) : row.kind === 'blank' ? (
              <View key={row.key} style={styles.plainLyricsBlankLine} />
            ) : isShareSelecting ? (
              /*
               * Düz metin sözlerde de satır seçilebilir: paylaşım her söz tipinde
               * çalışsın diye dokunuş satırı seçime ekler/çıkarır.
               */
              <TouchableOpacity
                key={row.key}
                activeOpacity={0.7}
                onPress={() => onToggleShareLine(row.key)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selectedShareSet.has(row.key) }}
                style={[
                  styles.lyricRowSelectable,
                  selectedShareSet.has(row.key) && styles.lyricRowSelected,
                ]}>
                <Text style={styles.plainLyricsText}>{row.text}</Text>
              </TouchableOpacity>
            ) : (
              <Text key={row.key} style={styles.plainLyricsText}>
                {row.text}
              </Text>
            )
          )}
          {plainLyricRows.length > 0 ? <View style={styles.plainLyricsTailSpacer} /> : null}
        </ScrollView>
      ) : (
        <View style={styles.lyricsEmptyState}>
          <Ionicons name="mic-off-outline" size={38} color="#52525b" />
          <Text style={styles.lyricsEmptyTitle}>{t('player.no_lyrics_found')}</Text>
          <Text style={styles.lyricsEmptySubtitle}>
            {isOnline ? t('player.no_lyrics_subtitle') : t('player.offline_lyrics')}
          </Text>
          <TouchableOpacity
            style={[styles.lyricsEmptySearchBtn, { backgroundColor: theme.primary }]}
            activeOpacity={0.8}
            onPress={onManualSearch}>
            <Ionicons name="search" size={16} color="#ffffff" style={{ marginRight: 6 }} />
            <Text style={styles.lyricsEmptySearchBtnText}>{t('player.search_lyrics_btn')}</Text>
          </TouchableOpacity>
        </View>
      )}

      <Modal
        visible={isOffsetOpen && !isRemote}
        animationType="fade"
        transparent
        onRequestClose={() => setIsOffsetOpen(false)}>
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setIsOffsetOpen(false)}>
          <Pressable
            style={[styles.lyricsOffsetModalBox, { borderColor: theme.border }]}
            onPress={(e) => e.stopPropagation()}>
            <View style={styles.lyricsOffsetHeader}>
              <View style={styles.lyricsOffsetTitleRow}>
                <Ionicons name="time-outline" size={20} color={theme.primary} />
                <Text style={styles.lyricsOffsetTitle}>{t('player.lyrics_offset')}</Text>
              </View>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={t('player.lyrics_offset_close')}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                onPress={() => setIsOffsetOpen(false)}>
                <Ionicons name="close" size={22} color="#a1a1aa" />
              </TouchableOpacity>
            </View>

            <Text style={[styles.lyricsOffsetValue, { color: theme.primary }]}>
              {formatLyricsOffset(lyricsOffset)}
            </Text>
            <Text style={styles.lyricsOffsetHint}>{t('player.lyrics_offset_hint')}</Text>
            <Text style={styles.lyricsOffsetSignHint}>{t('player.lyrics_offset_sign_hint')}</Text>

            <View style={styles.lyricsOffsetGrid}>
              {[-1, -0.5, -0.1, 0.1, 0.5, 1].map((delta) => (
                <TouchableOpacity
                  key={`offset-${delta}`}
                  activeOpacity={0.7}
                  onPress={() => adjustLyricsOffset(delta)}
                  style={[
                    styles.lyricsOffsetAdjustBtn,
                    { backgroundColor: theme.surface, borderColor: theme.border },
                  ]}>
                  <Text style={[styles.lyricsOffsetAdjustText, { color: theme.textAccent }]}>
                    {formatLyricsOffset(delta)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              activeOpacity={0.7}
              disabled={lyricsOffset === 0}
              onPress={resetLyricsOffset}
              style={[
                styles.lyricsOffsetResetBtn,
                { backgroundColor: theme.surface, borderColor: theme.border },
                lyricsOffset === 0 && styles.lyricsOffsetResetBtnDisabled,
              ]}>
              <Ionicons
                name="refresh"
                size={15}
                color={lyricsOffset === 0 ? 'rgba(255, 255, 255, 0.35)' : theme.primary}
              />
              <Text
                style={[
                  styles.lyricsOffsetResetText,
                  { color: lyricsOffset === 0 ? 'rgba(255, 255, 255, 0.35)' : theme.primary },
                ]}>
                {t('player.lyrics_offset_reset')}
              </Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function FullscreenPlayerModalImpl({ expandAnim }: { expandAnim?: Animated.Value } = {}) {
  useComponentDiagnostics('FullscreenPlayer');
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const isAppActive = useIsAppActive();
  const isOnline = useIsOnline();
  const {
    isFullscreenPlayerOpen,
    closeFullscreenPlayer,
    isLyricsMode,
    toggleLyricsMode,
    isQueueMode,
    toggleQueueMode,
    isSleepTimerMode,
    toggleSleepTimerMode,
    isConnectMode,
    toggleConnectMode,
  } = usePlayerUIStore();

  const theme = useThemeStore((s) => s.theme);
  const player = useActivePlayer();
  const localActiveTrack = useResilientActiveTrack();
  const activeTrack = player.activeTrack;
  const playing = player.isPlaying;

  const remoteState = useRemoteConnectStore((s) => s.remoteState);
  const discoveredHosts = useRemoteConnectStore((s) => s.discoveredHosts);
  const setDiscoveredHosts = useRemoteConnectStore((s) => s.setDiscoveredHosts);
  const discoveredBlePeers = useRemoteConnectStore((s) => s.discoveredBlePeers);
  const setDiscoveredBlePeers = useRemoteConnectStore((s) => s.setDiscoveredBlePeers);
  const activeTransportTab = useRemoteConnectStore((s) => s.activeTransportTab);
  const setActiveTransportTab = useRemoteConnectStore((s) => s.setActiveTransportTab);
  const isRemoteServiceEnabled = useRemoteConnectStore((s) => s.isServiceEnabled);
  const setRemoteServiceEnabled = useRemoteConnectStore((s) => s.setServiceEnabled);
  const remoteMode = useRemoteConnectStore((s) => s.mode);
  const remoteConnectionStatus = useRemoteConnectStore((s) => s.connectionStatus);
  const errorMessage = useRemoteConnectStore((s) => s.errorMessage);
  const connectedDeviceName = useRemoteConnectStore((s) => s.connectedDeviceName);
  const connectedClients = useRemoteConnectStore((s) => s.connectedClients);

  const internetRoomCode = useRemoteConnectStore((s) => s.internetRoomCode);
  const internetHostStatus = useRemoteConnectStore((s) => s.internetHostStatus);

  const [inputRoomCode, setInputRoomCode] = useState('');
  const [showManualIp, setShowManualIp] = useState(false);
  const [manualIp, setManualIp] = useState('');
  const [manualPort, setManualPort] = useState(RUNMUSIC_TCP_PORT.toString());

  // Connecto ekranı açıldığı anda servisi otomatik olarak aktif hale getir
  const prevIsConnectModeRef = useRef(false);
  useEffect(() => {
    if (isConnectMode && !prevIsConnectModeRef.current) {
      if (!isRemoteServiceEnabled) {
        setRemoteServiceEnabled(true);
      }
    }
    prevIsConnectModeRef.current = isConnectMode;
  }, [isConnectMode, isRemoteServiceEnabled, setRemoteServiceEnabled]);

  useEffect(() => {
    if (!isConnectMode || remoteMode === 'client') {
      if (remoteMode !== 'client') {
        setDiscoveredHosts([]);
        setDiscoveredBlePeers([]);
      }
      return;
    }

    if (activeTransportTab === 'ble') {
      const unsubscribe = bleCentralService.startDiscovery((peers) => {
        setDiscoveredBlePeers(peers);
      });
      return () => {
        unsubscribe();
      };
    } else if (activeTransportTab === 'wifi') {
      const unsubscribe = udpDiscoveryService.startClientListener((hosts) => {
        setDiscoveredHosts(hosts);
      });
      return () => {
        unsubscribe();
      };
    } else if (activeTransportTab === 'internet') {
      if (isRemoteServiceEnabled && remoteMode === 'host' && !wsRoomClient.isConnected()) {
        remoteSyncManager.startInternetHostRoom().catch(() => {});
      }
    }
  }, [
    isConnectMode,
    remoteMode,
    activeTransportTab,
    isRemoteServiceEnabled,
    setDiscoveredHosts,
    setDiscoveredBlePeers,
  ]);

  const handleSelectLocalDevice = useCallback(() => {
    if (remoteMode === 'client') {
      remoteSyncManager.disconnectClient();
    }
    toggleConnectMode();
  }, [remoteMode, toggleConnectMode]);

  const handleSelectRemoteHost = useCallback(async (host: DiscoveredHost | DiscoveredPeer) => {
    try {
      await remoteSyncManager.connectToHost(host);
    } catch (err: any) {
      Alert.alert(t('remote.connection_error'), err?.message || t('remote.device_unreachable'));
    }
  }, [t]);

  const handleManualConnect = useCallback(async () => {
    const ip = manualIp.trim();
    if (!ip) return;
    const port = parseInt(manualPort.trim(), 10) || RUNMUSIC_TCP_PORT;
    const manualHost: DiscoveredHost = {
      deviceId: `manual_${ip}`,
      deviceName: `Cihaz (${ip})`,
      hostIp: ip,
      port,
      lastSeen: Date.now(),
    };
    setShowManualIp(false);
    await remoteSyncManager.connectToHost(manualHost);
  }, [manualIp, manualPort]);

  /**
   * Geri tuşu dinleyicisi erken kurulur; paylaşım seçimi durumu ise daha sonra
   * tanımlanır. Bu ref, dinleyicinin güncel iptal eylemine erişmesini sağlar.
   */
  const shareSelectCancelRef = useRef<(() => void) | null>(null);

  // Android hardware back button listener
  useEffect(() => {
    if (!isFullscreenPlayerOpen) return;
    const backSub = BackHandler.addEventListener('hardwareBackPress', () => {
      // Paylaşım seçimi sürüyorsa geri tuşu yalnızca seçimi iptal eder.
      if (shareSelectCancelRef.current) {
        shareSelectCancelRef.current();
        return true;
      }
      if (isConnectMode) {
        toggleConnectMode();
        return true;
      }
      if (isSleepTimerMode) {
        toggleSleepTimerMode();
        return true;
      }
      if (isQueueMode) {
        toggleQueueMode();
        return true;
      }
      if (isLyricsMode) {
        toggleLyricsMode();
        return true;
      }
      closeFullscreenPlayer();
      return true;
    });
    return () => backSub.remove();
  }, [
    isFullscreenPlayerOpen,
    isConnectMode,
    isSleepTimerMode,
    isQueueMode,
    isLyricsMode,
    toggleConnectMode,
    toggleSleepTimerMode,
    toggleQueueMode,
    toggleLyricsMode,
    closeFullscreenPlayer,
  ]);

  // Morph transforms synchronized with expanding card (zarif, akıcı ve GPU dostu)
  const headerMorphY = useMemo(() => {
    if (!expandAnim) return 0;
    return expandAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [-24, 0],
      extrapolate: 'clamp',
    });
  }, [expandAnim]);

  const middleMorphScale = useMemo(() => {
    if (!expandAnim) return 1;
    return expandAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0.94, 1],
      extrapolate: 'clamp',
    });
  }, [expandAnim]);

  const middleMorphX = useMemo(() => {
    return 0;
  }, []);

  const middleMorphY = useMemo(() => {
    if (!expandAnim) return 0;
    return expandAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [18, 0],
      extrapolate: 'clamp',
    });
  }, [expandAnim]);

  const bottomMorphY = useMemo(() => {
    if (!expandAnim) return 0;
    return expandAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [24, 0],
      extrapolate: 'clamp',
    });
  }, [expandAnim]);

  const textMorphX = useMemo(() => {
    return 0;
  }, []);

  const textMorphY = useMemo(() => {
    if (!expandAnim) return 0;
    return expandAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [14, 0],
      extrapolate: 'clamp',
    });
  }, [expandAnim]);

  const storeIsShuffle = useStore((s) => s.isShuffle);
  const storeIsSmartShuffle = useStore((s) => s.isSmartShuffle);
  const storeRepeatMode = useStore((s) => s.repeatMode);
  const repeatMode = player.isRemote ? player.repeatMode : storeRepeatMode;
  const isShuffle = player.isRemote ? player.isShuffle : storeIsShuffle;
  const isSmartShuffle = player.isRemote ? player.isSmartShuffle : storeIsSmartShuffle;
  const playbackMode = player.playbackMode;
  /**
   * Vurgu (cam/glaş arka plan) yalnızca mod **varsayılandan farklıyken** görünür.
   *
   * Ayarlar'daki "Varsayılan oynatma modu" kullanıcının normal durumudur; o
   * moddayken düğme sade (arka plansız) durur. Kullanıcı başka bir moda
   * geçtiğinde düğme vurgulanır — böylece "şu an varsayılandan farklı bir şey
   * açık" bilgisi tek bakışta okunur. Varsayılan `repeat-all` iken davranış
   * öncekiyle aynıdır: yalnızca loop queue arka plansız görünür.
   */
  const defaultPlaybackMode = useStore((s) => s.preferences.defaultPlaybackMode);
  const isPlaybackModeActive = playbackMode !== defaultPlaybackMode;
  const playbackModeLabel =
    playbackMode === 'smart'
      ? t('player.playback_mode_smart')
      : playbackMode === 'shuffle'
        ? t('player.playback_mode_shuffle')
        : playbackMode === 'repeat-one'
          ? t('player.playback_mode_repeat_one')
          : t('player.playback_mode_repeat_all');
  const library = useStore((s) => s.library);
  const allAssets = useStore((s) => s.allAssets);
  const upNextIds = useStore((s) => s.upNextIds);
  const contextIds = useStore((s) => s.contextIds);
  const playedHistory = useStore((s) => s.playedHistory);
  const queueRevision = useStore((s) => s.queueRevision);
  const artworkMap = useStore((s) => s.artworkMap);
  const metadataMap = useStore((s) => s.metadataMap);
  const lyricsCache = useStore((s) => s.lyricsCache);
  const setLyrics = useStore((s) => s.setLyrics);
  const getLyricsFromCache = useStore((s) => s.getLyricsFromCache);
  const hideTrack = useStore((s) => s.hideTrack);
  const isHydrated = useStore((s) => s.isHydrated);
  const autoFetchLyrics = useStore((s) => s.preferences.autoFetchLyrics);
  const reduceMotion = useStore((s) => s.preferences.reduceMotion);
  const isDynamicColorUnlocked = useStore((s) => s.preferences.isDynamicColorUnlocked);
  const isDevModeActive = useStore((s) => s.preferences.isDevModeActive);
  const hasDismissedDynamicColorBanner = useStore((s) => s.preferences.hasDismissedDynamicColorBanner);
  const autoAddToQueue = useStore((s) => s.preferences.autoAddToQueue !== false);
  const unlockDynamicColor = useStore((s) => s.unlockDynamicColor);
  const dismissDynamicColorBanner = useStore((s) => s.dismissDynamicColorBanner);

  const [isLoadingDynamicAd, setIsLoadingDynamicAd] = useState(false);

  const [isOptionsModalOpen, setIsOptionsModalOpen] = useState(false);
  const [isEditTrackModalOpen, setIsEditTrackModalOpen] = useState(false);
  const [customTimerMinutes, setCustomTimerMinutes] = useState('');
  const [sleepTimerRemaining, setSleepTimerRemaining] = useState<string>('');

  // Sleep Timer store
  const isSleepTimerActive = useSleepTimerStore((s) => s.isActive);
  const sleepTimerEndTime = useSleepTimerStore((s) => s.endTime);
  const sleepTimerDurationOption = useSleepTimerStore((s) => s.durationOption);
  const startTimer = useSleepTimerStore((s) => s.startTimer);
  const startTrackTimer = useSleepTimerStore((s) => s.startTrackTimer);
  const stopTimer = useSleepTimerStore((s) => s.stopTimer);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (isSleepTimerActive && isFullscreenPlayerOpen && isAppActive) {
      const updateRemaining = () => {
        if (sleepTimerDurationOption === 'track') {
          setSleepTimerRemaining(t('player.after_track'));
        } else if (sleepTimerEndTime) {
          const diff = Math.max(0, sleepTimerEndTime - Date.now());
          const mins = Math.ceil(diff / 60000);
          setSleepTimerRemaining(`${mins} ${t('player.minutes_left')}`);
        }
      };
      updateRemaining();
      interval = setInterval(updateRemaining, 2000);
    } else {
      setSleepTimerRemaining('');
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [
    isSleepTimerActive,
    isFullscreenPlayerOpen,
    isAppActive,
    sleepTimerEndTime,
    sleepTimerDurationOption,
    t,
  ]);

  const [queue, setQueue] = useState<Track[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(0);
  /** Kuyruk bölümleri (şu an / sırada / kütüphaneden) — modal açıkken hesaplanır. */
  const [queueSections, setQueueSections] = useState<QueueSections<Track> | null>(null);

  const handleUnlockDynamicColorFromBanner = async () => {
    setIsLoadingDynamicAd(true);
    try {
      const shown = await showRewardedAd({
        onRewarded: () => {
          unlockDynamicColor();
          if (currentArtworkUri) {
            useThemeStore.getState().updateThemeFromArtwork(currentArtworkUri);
          }
          setTimeout(() => {
            Alert.alert(
              '🎉 ' + t('settings.unlock_dynamic_theme_title'),
              t('settings.dynamic_theme_unlocked_success')
            );
          }, 400);
        },
        onError: () => {
          setIsLoadingDynamicAd(false);
          Alert.alert(
            t('settings.unlock_dynamic_theme_title'),
            t('settings.theme_ad_failed')
          );
        },
        onClosed: () => {
          setIsLoadingDynamicAd(false);
        },
      });
      if (!shown) {
        setIsLoadingDynamicAd(false);
      }
    } catch {
      setIsLoadingDynamicAd(false);
    }
  };

  const createModalPanResponder = useCallback((closeFn: () => void) => {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, gesture) => {
        return gesture.dy > 20 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.5;
      },
      onMoveShouldSetPanResponderCapture: () => false,
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > 40) {
          closeFn();
        }
      },
    });
  }, []);

  const searchModalPanResponder = createModalPanResponder(() => setIsManualSearchOpen(false));
  const optionsModalPanResponder = createModalPanResponder(() => setIsOptionsModalOpen(false));

  // Manual Lyrics Search state
  const [isLoadingLyrics, setIsLoadingLyrics] = useState(false);
  const [isManualSearchOpen, setIsManualSearchOpen] = useState(false);
  const [manualQuery, setManualQuery] = useState('');
  const [candidatesList, setCandidatesList] = useState<LyricsCandidate[]>([]);
  /**
   * Çevrimdışı aramada önbellekten çözülen tam söz sonuçları.
   *
   * Aday listesi yalnızca kimlik/başlık taşıdığı için seçim anında ağa
   * çıkılmaması adına gerçek `LyricsResult` burada eşlenir. Kalıcı store'a
   * yazılmaz; modal kapandığında bellekten düşer.
   */
  const [offlineCandidates, setOfflineCandidates] = useState<Record<string, LyricsResult>>({});
  /** Son arama kayıtlı sözlerden mi geldi? (Bilgi çubuğu bunu kullanır.) */
  const [isCachedSearch, setIsCachedSearch] = useState(false);
  const [isSearchingCandidates, setIsSearchingCandidates] = useState(false);
  const [resolvingCandidateId, setResolvingCandidateId] = useState<string | null>(null);
  const [candidateFilter, setCandidateFilter] = useState<CandidateFilter>('all');
  const [syncedOnly, setSyncedOnly] = useState(false);

  /**
   * Söz kartı paylaşımı.
   *
   * Seçim ayrı bir ekran yerine söz panelinin kendisinde yapılır: paylaş
   * butonuna basınca panel satır seçme moduna geçer, alttaki oynatma kontrolleri
   * yerini Vazgeç/Tamam çubuğuna bırakır. "Tamam" seçilen satırların kart
   * önizlemesini açar.
   */
  const [isShareSelecting, setIsShareSelecting] = useState(false);
  const [selectedShareKeys, setSelectedShareKeys] = useState<string[]>([]);
  const [isSharePreviewOpen, setIsSharePreviewOpen] = useState(false);
  const [shareLimitHit, setShareLimitHit] = useState(false);

  /**
   * Sağlayıcı sayısı arttıkça düz liste okunamıyor: sonuçlar sağlayıcıya göre
   * gruplanır (lrc.red → LRCLIB → Genius) ve sayaçlı filtre çipleri listeyi
   * daraltır. Filtreleme istemci tarafındadır; arama tek seferde tüm
   * sağlayıcılara gider, filtre değiştirmek ağ isteği üretmez.
   */
  const candidateCounts = useMemo(() => {
    const counts: Record<CandidateFilter, number> = {
      all: 0,
      'lrc.red': 0,
      lrclib: 0,
      genius: 0,
    };
    for (const candidate of candidatesList) {
      if (syncedOnly && !candidate.hasSynced && !candidate.hasWordSync) continue;
      counts.all += 1;
      counts[candidate.source] += 1;
    }
    return counts;
  }, [candidatesList, syncedOnly]);

  const candidateRows = useMemo<CandidateListRow[]>(() => {
    const rows: CandidateListRow[] = [];
    for (const source of CANDIDATE_SOURCE_ORDER) {
      if (candidateFilter !== 'all' && candidateFilter !== source) continue;
      const items = candidatesList.filter(
        (candidate) =>
          candidate.source === source && (!syncedOnly || candidate.hasSynced || candidate.hasWordSync)
      );
      if (items.length === 0) continue;
      rows.push({
        kind: 'header',
        key: `header-${source}`,
        source,
        label: getCandidateSourceLabel(source),
        count: items.length,
      });
      for (const item of items) {
        rows.push({ kind: 'candidate', key: item.id, item });
      }
    }
    return rows;
  }, [candidatesList, candidateFilter, syncedOnly]);

  const refreshQueue = useCallback(async () => {
    if (player.isRemote) return;
    try {
      const q = await TrackPlayer.getQueue();
      const idx = await TrackPlayer.getActiveTrackIndex();
      setQueue(q);
      setActiveIndex(idx ?? 0);
    } catch (e) {
      console.warn('Failed to load queue', e);
    }
  }, [player.isRemote]);

  /** Kuyruk bölümlerini native kuyruktan yeniden türetir. */
  const refreshQueueSections = useCallback(async () => {
    if (player.isRemote) return;
    try {
      setQueueSections(await getQueueSections());
    } catch (e) {
      console.warn('Failed to derive queue sections', e);
    }
  }, [player.isRemote]);

  // Oynatıcı açıkken veya aktif parça değiştiğinde kuyruğu ve bölümleri önceden hazırla (pre-warm)
  useEffect(() => {
    if (!isFullscreenPlayerOpen || !isAppActive) return;
    refreshQueue();
    refreshQueueSections();
    // `activeTrack` is a summary object rebuilt by useActivePlayer on every
    // render. Depending on that object re-ran this effect after each async
    // setQueue/setQueueSections, creating an ~8 renders/sec feedback loop.
  }, [activeTrack?.id, isFullscreenPlayerOpen, isAppActive, refreshQueue, refreshQueueSections]);

  // Kuyruk modu açıkken veya aktif parça / kuyruk / modlar değiştiğinde bölümleri tazele.
  useEffect(() => {
    if (isFullscreenPlayerOpen && isQueueMode && isAppActive) {
      refreshQueueSections();
      refreshQueue();
    }
  }, [
    isFullscreenPlayerOpen,
    isQueueMode,
    isAppActive,
    activeTrack?.id,
    isShuffle,
    isSmartShuffle,
    repeatMode,
    upNextIds,
    contextIds,
    playedHistory,
    queueRevision,
    refreshQueueSections,
    refreshQueue,
  ]);

  // Çalınan parça manuel kuyruktan geldiyse listeden düşür.
  useEffect(() => {
    if (!player.isRemote && localActiveTrack) {
      markUpNextConsumed(localActiveTrack);
    }
  }, [player.isRemote, localActiveTrack]);

  const derivedRemoteQueueSections = useMemo((): QueueSections<Track> | null => {
    if (!player.isRemote) return null;
    const currentTrackSummary = player.activeTrack;
    const queueList: Track[] = (Array.isArray(remoteState.queue) ? remoteState.queue : [])
      .filter(Boolean)
      .map((t) => ({
        id: t.id,
        url: t.id,
        title: t.title,
        artist: t.artist,
        duration: t.duration,
      } as Track));

    let currentIndex = queueList.findIndex((t) => t && t.id === currentTrackSummary?.id);
    if (currentIndex === -1 && currentTrackSummary) {
      const normTitle = (currentTrackSummary.title || '').trim().toLowerCase();
      const normArtist = (currentTrackSummary.artist || '').trim().toLowerCase();
      currentIndex = queueList.findIndex((t) => {
        if (!t) return false;
        const tTitle = (t.title || '').trim().toLowerCase();
        const tArtist = (t.artist || '').trim().toLowerCase();
        return tTitle === normTitle && (!normArtist || tArtist === normArtist);
      });
    }

    const upNextIds = (Array.isArray(remoteState.upNext) ? remoteState.upNext : [])
      .filter(Boolean)
      .map((t) => t.id);

    const sections = deriveQueueSections(
      queueList,
      currentIndex >= 0 ? currentIndex : 0,
      upNextIds
    );

    if (currentTrackSummary && sections.current) {
      sections.current.track.artwork = player.artworkUri || undefined;
    }

    return sections;
  }, [player.isRemote, player.activeTrack, player.artworkUri, remoteState.queue, remoteState.upNext]);

  const effectiveQueueSections = useMemo(() => {
    if (player.isRemote) return derivedRemoteQueueSections;
    if (!queueSections) return null;
    const realKey = trackKey(activeTrack || localActiveTrack);
    if (!realKey || (queueSections.current && trackKey(queueSections.current.track) === realKey)) {
      return queueSections;
    }
    // Eğer native activeIndex kaymış ve queueSections.current sahte bir parçayı gösteriyorsa doğrula
    const foundIdx = queue.findIndex((t) => trackKey(t) === realKey);
    if (foundIdx >= 0) {
      return deriveQueueSections(
        queue,
        foundIdx,
        useStore.getState().upNextIds,
        useStore.getState().playedHistory as any,
        realKey
      );
    }
    return queueSections;
  }, [player.isRemote, derivedRemoteQueueSections, queueSections, activeTrack, localActiveTrack, queue]);

  const resolveTrackDisplay = useCallback(
    (track: Track | QueueTrackLike) => {
      const rawId = String(track.id ?? track.url ?? '').trim();
      const rawUrl = String(track.url ?? '').trim();

      const baseAssets = allAssets.length > 0 ? allAssets : library;
      const asset = baseAssets.find(
        (a) => a.id === rawId || a.uri === rawId || (rawUrl && (a.uri === rawUrl || a.id === rawUrl))
      );
      const canonicalId = asset ? asset.id : rawId;

      const meta =
        (canonicalId && metadataMap[canonicalId]) ||
        (track.id && metadataMap[track.id]) ||
        (rawUrl && metadataMap[rawUrl]) ||
        undefined;

      const artwork =
        meta?.artwork ||
        (canonicalId ? artworkMap[canonicalId] : undefined) ||
        (track.id ? artworkMap[track.id] : undefined) ||
        (rawUrl ? artworkMap[rawUrl] : undefined) ||
        (typeof track.artwork === 'string' ? track.artwork : undefined);

      const rawArtist = meta?.artist || track.artist || '';
      const displayArtist =
        rawArtist && rawArtist !== 'Local Audio' && rawArtist !== 'Bilinmeyen Sanatçı'
          ? cleanArtistName(rawArtist)
          : (rawArtist || t('common.unknown_artist'));

      const rawTitle = meta?.title || track.title || '';
      const displayTitle =
        cleanDisplayTitle(rawTitle, displayArtist !== t('common.unknown_artist') ? displayArtist : undefined) ||
        rawTitle ||
        t('common.unknown_track');

      return {
        canonicalId,
        title: displayTitle,
        artist: displayArtist,
        artwork,
        trackId: canonicalId || track.id || null,
        trackUri: track.url || null,
      };
    },
    [allAssets, library, metadataMap, artworkMap, t]
  );

  /** Manuel "Sırada" listesi (anında 0ms optimistik görsel model). */
  const upNextItems: UpNextItem[] = useMemo(() => {
    const targetIds = player.isRemote
      ? (Array.isArray(remoteState.upNext) ? remoteState.upNext : []).map(String)
      : upNextIds;

    if (!targetIds || targetIds.length === 0) return [];

    // Mevcut kuyruktaki ve bölümlerdeki parçaları hızlı erişim için haritala
    const trackMap = new Map<string, Track>();
    if (queue && queue.length > 0) {
      for (const t of queue) {
        const k = trackKey(t);
        if (k && !trackMap.has(k)) trackMap.set(k, t);
        if (t.id && !trackMap.has(t.id)) trackMap.set(t.id, t);
        if (t.url && !trackMap.has(t.url)) trackMap.set(t.url, t);
      }
    }
    if (effectiveQueueSections?.upNext) {
      for (const entry of effectiveQueueSections.upNext) {
        if (entry.track) {
          const k = trackKey(entry.track);
          if (k && !trackMap.has(k)) trackMap.set(k, entry.track);
          if (entry.track.id && !trackMap.has(entry.track.id)) trackMap.set(entry.track.id, entry.track);
          if (entry.track.url && !trackMap.has(entry.track.url)) trackMap.set(entry.track.url, entry.track);
        }
      }
    }

    const baseAssets = allAssets.length > 0 ? allAssets : library;

    return targetIds.map((id, i) => {
      let t = trackMap.get(id);
      if (!t) {
        const asset = baseAssets.find((a) => a.id === id || a.uri === id);
        if (asset) {
          const meta = metadataMap[asset.id];
          t = {
            id: asset.id,
            url: asset.uri,
            title: meta?.title || asset.filename,
            artist: meta?.artist || 'Unknown Artist',
            artwork: meta?.artwork || artworkMap[asset.id] || undefined,
            duration: asset.duration,
          } as Track;
        } else {
          t = {
            id,
            url: id,
            title: 'Track',
            artist: 'Unknown Artist',
          } as Track;
        }
      }

      const info = resolveTrackDisplay(t);
      return {
        key: `${info.canonicalId || id}-${i}`,
        title: info.title,
        artist: info.artist,
        artwork: info.artwork,
        trackId: info.trackId || id,
        trackUri: info.trackUri,
      };
    });
  }, [
    player.isRemote,
    remoteState.upNext,
    upNextIds,
    queue,
    effectiveQueueSections,
    allAssets,
    library,
    metadataMap,
    artworkMap,
    resolveTrackDisplay,
  ]);

  const handleMoveUpNext = useCallback(
    (from: number, to: number) => {
      if (player.isRemote) {
        remoteSyncManager.sendClientCommand({ type: 'COMMAND_QUEUE_MOVE', fromIndex: from, toIndex: to });
        return;
      }
      moveUpNext(from, to);
    },
    [player.isRemote]
  );

  const handleRemoveUpNext = useCallback(
    (sectionIndex: number) => {
      if (player.isRemote) {
        const target = effectiveQueueSections?.upNext[sectionIndex];
        const trackId = target?.track?.id;
        remoteSyncManager.sendClientCommand({
          type: 'COMMAND_QUEUE_REMOVE',
          trackId: trackId || undefined,
          trackIndex: target && target.index >= 0 ? target.index : undefined,
        });
        return;
      }
      const targetId = upNextIds[sectionIndex];
      const target = queueSections?.upNext?.find(
        (e) => (targetId && (trackKey(e.track) === targetId || e.track.id === targetId))
      );
      const trackId = targetId || target?.track?.id;
      const index = target ? target.index : -1;
      removeQueueItem(index, trackId);
    },
    [player.isRemote, effectiveQueueSections, upNextIds, queueSections]
  );

  const handleRemoveFromContext = useCallback(
    (queueIndex: number, trackId?: string) => {
      if (player.isRemote) {
        const target = effectiveQueueSections?.context.find((e) => e.index === queueIndex);
        const tId = trackId || target?.track?.id;
        remoteSyncManager.sendClientCommand({
          type: 'COMMAND_QUEUE_REMOVE',
          trackIndex: queueIndex,
          trackId: tId || undefined,
        });
        return;
      }
      removeQueueItem(queueIndex, trackId);
    },
    [player.isRemote, effectiveQueueSections]
  );

  const handlePromoteToUpNext = useCallback(
    (queueIndex: number, trackId?: string) => {
      if (player.isRemote) {
        return;
      }
      promoteContextTrackToUpNext(queueIndex, trackId);
    },
    [player.isRemote]
  );

  const handleClearUpNext = useCallback(() => {
    if (player.isRemote) {
      return;
    }
    clearUpNextQueue();
  }, [player.isRemote]);

  const handleToggleAutoAdd = useCallback((value: boolean) => {
    useStore.getState().updatePreferences({ autoAddToQueue: value });
    if (value) {
      // Açılır açılmaz kuyruğu hedefe tamamla; sonraki parça değişimini bekleme.
      replenishUpcomingQueueIfNeeded().catch(() => {});
    }
  }, []);

  const handleClearQueue = useCallback(() => {
    if (player.isRemote) {
      return;
    }
    Alert.alert(
      t('player.clear_queue_title'),
      t('player.clear_queue_msg'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('player.clear_queue'),
          style: 'destructive',
          onPress: () => {
            clearPlaybackQueue().catch(() => {});
          },
        },
      ]
    );
  }, [player.isRemote, t]);

  const handleQueueItemPress = useCallback(
    async (queueIndex: number, trackId?: string, title?: string, artist?: string) => {
      if (trackId || title) {
        const canonicalId = trackId ? resolveTrackId({ id: trackId }, allAssets) : '';
        const meta =
          (canonicalId && metadataMap[canonicalId]) ||
          (trackId && metadataMap[trackId]) ||
          undefined;
        const art =
          meta?.artwork ||
          (canonicalId && artworkMap[canonicalId]) ||
          (trackId && artworkMap[trackId]) ||
          null;

        const cleanArt =
          artist && artist !== 'Local Audio' && artist !== 'Bilinmeyen Sanatçı'
            ? cleanArtistName(artist)
            : (artist || 'Unknown Artist');
        const cleanTit =
          cleanDisplayTitle(title, cleanArt !== 'Unknown Artist' ? cleanArt : undefined) ||
          title ||
          'Unknown Title';

        const summary: RemoteTrackSummary = {
          id: canonicalId || trackId || `queue_${queueIndex}`,
          title: cleanTit,
          artist: cleanArt,
          duration: 0,
          hasArtwork: !!art,
        };
        useOptimisticPlayerStore.getState().setOptimisticTrack(summary, art);
        if (art && useStore.getState().preferences.dynamicColorFromArtwork) {
          useThemeStore.getState().updateThemeFromArtwork(art);
        }
      }
      if (player.isRemote) {
        remoteSyncManager.sendClientCommand({
          type: 'COMMAND_PLAY_TRACK',
          trackIndex: queueIndex >= 0 ? queueIndex : undefined,
          trackId,
          title,
          artist,
        });
        return;
      }
      try {
        await playQueueTrack(queueIndex, trackId);
        await refreshQueue();
        await refreshQueueSections();
      } catch (e) {
        console.warn('Queue skip failed', e);
      }
    },
    [player.isRemote, metadataMap, artworkMap, allAssets, refreshQueue, refreshQueueSections]
  );

  const handleUpNextItemPress = useCallback(
    (item: UpNextItem, idx: number) => {
      const target =
        effectiveQueueSections?.upNext?.find(
          (e) =>
            item.trackId &&
            (e.track.id === item.trackId || trackKey(e.track) === item.trackId)
        ) || effectiveQueueSections?.upNext[idx];
      const trackId = item.trackId || target?.track?.id || undefined;
      const queueIndex = target ? target.index : -1;
      handleQueueItemPress(queueIndex, trackId, item.title, item.artist);
    },
    [effectiveQueueSections, handleQueueItemPress]
  );

  const queueSectionLabels = useMemo(
    () => ({
      history: t('queue.history_section'),
      smartShuffle: t('queue.smart_shuffle_section'),
      shuffle: t('queue.library_shuffle_section'),
      upcoming: t('queue.library_upcoming_section'),
    }),
    [t]
  );

  // Saf fonksiyonla üretilir; React Compiler kendi memoizasyonunu uygular.
  // Up-next satırları ayrıca aynı FlatList'e serpiştirilir; böylece yüzlerce
  // Animated satır aynı anda mount edilmez.
  const queueRows: QueueDisplayRow[] = useMemo(() => {
    const baseRows = buildQueueRows(
      effectiveQueueSections,
      upNextItems.length,
      isShuffle,
      isSmartShuffle,
      queueSectionLabels
    );
    if (upNextItems.length === 0) return baseRows;

    const rows: QueueDisplayRow[] = [];
    for (const row of baseRows) {
      rows.push(row);
      if (row.kind === 'upnext') {
        upNextItems.forEach((item, upNextIndex) => {
          rows.push({
            kind: 'upnext-item',
            key: `upnext-${item.key}`,
            item,
            upNextIndex,
          });
        });
      }
    }
    return rows;
  }, [effectiveQueueSections, upNextItems, isShuffle, isSmartShuffle, queueSectionLabels]);

  const currentRowIndex = useMemo(
    () => queueRows.findIndex((row) => row.kind === 'current'),
    [queueRows]
  );

  const queueListRef = useRef<FlatList<QueueDisplayRow>>(null);

  // Kuyruk açılınca mevcut parçaya zıplamasız ve kaymasız doğrudan konumlan
  useEffect(() => {
    if (!isFullscreenPlayerOpen || !isQueueMode || !isAppActive || currentRowIndex < 0) return;
    const timer = setTimeout(() => {
      try {
        if (currentRowIndex >= 0 && currentRowIndex < queueRows.length) {
          queueListRef.current?.scrollToIndex({
            index: currentRowIndex,
            animated: false,
            viewPosition: 0.15,
          });
        }
      } catch {
        // ignore
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [isFullscreenPlayerOpen, isQueueMode, isAppActive, currentRowIndex, queueRows.length]);

  const handleScrollToIndexFailed = useCallback(
    (info: { index: number; averageItemLength: number }) => {
      // Satır yükseklikleri değişken olduğu için (bölüm başlığı / parça / kapaklı
      // satır) ilk deneme başarısız olabilir: ortalamayla hemen konumlan, sonra tekrar dene.
      try {
        queueListRef.current?.scrollToOffset({
          offset: info.averageItemLength * info.index,
          animated: false,
        });
      } catch {
        // ignore
      }
      setTimeout(() => {
        try {
          if (info.index >= 0 && info.index < queueRows.length) {
            queueListRef.current?.scrollToIndex({
              index: info.index,
              animated: false,
              viewPosition: 0.15,
            });
          }
        } catch {
          // ignore
        }
      }, 50);
    },
    [queueRows.length]
  );

  /** Sıradaki/geçmiş bir parça satırı (dokununca o parçaya atlar). */
  const renderQueueTrackRow = (
    entry: QueueEntry<Track>,
    isCurrent = false,
    isHistory = false,
    historyIndex?: number,
    isContext = false
  ) => {
    const isExtensionTrack =
      entry.track.id?.startsWith('ext_') ||
      (typeof entry.track.url === 'string' && entry.track.url.startsWith('http'));

    const info = resolveTrackDisplay(entry.track);

    return (
      <TouchableOpacity
        style={[styles.queueItem, isCurrent && { backgroundColor: theme.surface }]}
        activeOpacity={0.7}
        onPress={() => {
          if (isHistory && typeof historyIndex === 'number') {
            if (player.isRemote) {
              handleQueueItemPress(
                entry.index,
                info.trackId || entry.track.id,
                info.title,
                info.artist
              );
            } else {
              playHistoryTrack(historyIndex, entry.track);
            }
          } else {
            handleQueueItemPress(
              entry.index,
              info.trackId || entry.track.id,
              info.title,
              info.artist
            );
          }
        }}>
        <Text style={[styles.queueIndex, isCurrent && { color: theme.primary }]}>
          {isHistory && typeof historyIndex === 'number' ? historyIndex + 1 : entry.index + 1}
        </Text>
        <View style={{ flex: 1 }}>
          <Text
            style={[styles.queueTrackTitle, isCurrent && { color: theme.primary }]}
            numberOfLines={1}>
            {info.title}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
            {isExtensionTrack && (
              <View style={styles.queueExtBadge}>
                <Ionicons name="globe-outline" size={10} color="rgba(255,255,255,0.7)" style={{ marginRight: 3 }} />
                <Text style={styles.queueExtBadgeText}>Eklenti</Text>
              </View>
            )}
            <Text style={styles.queueTrackArtist} numberOfLines={1}>
              {info.artist}
            </Text>
          </View>
        </View>
        {isCurrent ? (
          <Ionicons name="volume-high" size={20} color={theme.primary} />
        ) : isContext ? (
          <TouchableOpacity
            style={styles.queueQuickPromoteBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.7}
            onPress={(e) => {
              e.stopPropagation();
              handlePromoteToUpNext(entry.index, info.trackId || entry.track.id);
            }}>
            <Ionicons name="arrow-up-circle-outline" size={22} color="rgba(255,255,255,0.45)" />
          </TouchableOpacity>
        ) : null}
      </TouchableOpacity>
    );
  };

  const renderQueueRow = ({ item }: { item: QueueDisplayRow }) => {
    switch (item.kind) {
      case 'section':
        return <Text style={styles.queueSectionTitle}>{item.title}</Text>;

      case 'history':
        // Geçmiş salt görüntülenir; dokununca o parçaya geri döner.
        return renderQueueTrackRow(item.entry, false, true, item.historyIndex);

      case 'current': {
        const info = resolveTrackDisplay(item.entry.track);
        return (
          <>
            <Text style={styles.queueSectionTitle}>{t('queue.now_playing_section')}</Text>
            <View style={[styles.queueItem, { backgroundColor: theme.surface }]}>
              <TrackArtwork
                uri={info.artwork}
                trackId={info.trackId}
                trackUri={info.trackUri}
                size={40}
                borderRadius={6}
                iconSize={18}
              />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.queueTrackTitle, { color: theme.primary }]} numberOfLines={1}>
                  {info.title}
                </Text>
                <Text style={styles.queueTrackArtist} numberOfLines={1}>
                  {info.artist}
                </Text>
              </View>
              <Ionicons name="volume-high" size={20} color={theme.primary} />
            </View>
          </>
        );
      }

      case 'upnext':
        return (
          <View style={styles.upNextSectionWrapper}>
            <View style={styles.upNextSectionHeader}>
              <Text style={styles.queueSectionTitle}>
                {`${t('queue.up_next_header') || 'SIRADA (SENİN EKLEDİKLERİN)'} · ${upNextItems.length}`}
              </Text>
              <TouchableOpacity
                onPress={handleClearUpNext}
                style={styles.clearUpNextButton}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="trash-outline" size={12} color="#ef4444" style={{ marginRight: 4 }} />
                <Text style={styles.clearUpNextText}>{t('queue.clear_up_next') || 'Temizle'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        );

      case 'upnext-item': {
        return (
          <UpNextRow
            item={item.item}
            index={item.upNextIndex}
            count={upNextItems.length}
            accentColor={theme.primary}
            onCommit={handleMoveUpNext}
            onRemove={handleRemoveUpNext}
            onPress={handleUpNextItemPress}
          />
        );
      }

      case 'context': {
        const info = resolveTrackDisplay(item.entry.track);
        return (
          <Swipeable
            friction={1}
            leftThreshold={130}
            rightThreshold={130}
            overshootLeft={false}
            overshootRight={false}
            activeOffsetX={[-20, 20]}
            failOffsetY={[-15, 15]}
            onSwipeableOpen={(direction, swipeable) => {
              swipeable?.close?.();
              if (direction === 'left') {
                handlePromoteToUpNext(item.entry.index, info.trackId || item.entry.track.id);
              } else if (direction === 'right') {
                handleRemoveFromContext(item.entry.index, info.trackId || item.entry.track.id);
              }
            }}
            renderLeftActions={() => (
              <TouchableOpacity
                style={[styles.queuePromoteAction, { backgroundColor: theme.primary }]}
                activeOpacity={0.8}
                onPress={() => handlePromoteToUpNext(item.entry.index, info.trackId || item.entry.track.id)}>
                <Ionicons name="arrow-up-circle-outline" size={22} color="#ffffff" />
                <Text style={styles.queuePromoteText}>{t('queue.promote_to_up_next') || 'Öne Al'}</Text>
              </TouchableOpacity>
            )}
            renderRightActions={() => (
              <TouchableOpacity
                style={[styles.queueRemoveAction, { backgroundColor: '#ef4444' }]}
                activeOpacity={0.8}
                onPress={() => handleRemoveFromContext(item.entry.index, info.trackId || item.entry.track.id)}>
                <Ionicons name="trash-outline" size={20} color="#ffffff" />
              </TouchableOpacity>
            )}>
            {renderQueueTrackRow(item.entry, false, false, undefined, true)}
          </Swipeable>
        );
      }

      default:
        return null;
    }
  };

  const currentAsset = useMemo(() => {
    if (player.isRemote || !localActiveTrack) return null;
    return (
      library.find(
        (a) =>
          (localActiveTrack.id && a.id === localActiveTrack.id) ||
          (localActiveTrack.url && (a.uri === localActiveTrack.url || a.id === localActiveTrack.url))
      ) || null
    );
  }, [player.isRemote, library, localActiveTrack]);

  const resolvedTrackId =
    player.activeTrack?.id || currentAsset?.id || localActiveTrack?.id || localActiveTrack?.url || '';

  const activeMeta = player.isRemote
    ? undefined
    : (resolvedTrackId ? metadataMap[resolvedTrackId] : undefined) ||
      (player.activeTrack?.id ? metadataMap[player.activeTrack.id] : undefined) ||
      (localActiveTrack?.id ? metadataMap[localActiveTrack.id] : undefined) ||
      (localActiveTrack?.url ? metadataMap[localActiveTrack.url] : undefined);

  const unknownArtist = t('common.unknown_artist');
  const unknownTrack = t('common.unknown_track');

  const sourceTitle = player.activeTrack?.title || localActiveTrack?.title || '';
  const sourceArtist = player.activeTrack?.artist || localActiveTrack?.artist || '';

  const activeKeywords = player.isRemote
    ? { expectedArtist: undefined, expectedTrack: undefined }
    : getSearchKeywords(sourceTitle, sourceArtist);

  const rawArtist = player.isRemote
    ? player.activeTrack?.artist || (player.remoteDeviceName ? `${t('remote.status_connected')} • ${player.remoteDeviceName}` : unknownArtist)
    : (activeMeta?.artist?.trim() && activeMeta.artist !== 'Local Audio' && activeMeta.artist !== 'Bilinmeyen Sanatçı'
        ? activeMeta.artist.trim()
        : '') ||
      (player.activeTrack?.artist && player.activeTrack.artist !== 'Local Audio' && player.activeTrack.artist !== 'Bilinmeyen Sanatçı' && player.activeTrack.artist !== 'Unknown Artist'
        ? cleanArtistName(player.activeTrack.artist)
        : '') ||
      (activeKeywords.expectedArtist && activeKeywords.expectedArtist !== 'Local Audio' && activeKeywords.expectedArtist !== 'Bilinmeyen Sanatçı'
        ? activeKeywords.expectedArtist
        : (sourceArtist && sourceArtist !== 'Local Audio' && sourceArtist !== 'Bilinmeyen Sanatçı'
            ? cleanArtistName(sourceArtist)
            : unknownArtist));

  const rawTitle = player.isRemote
    ? player.activeTrack?.title || t('remote.waiting_for_music')
    : (activeMeta?.title?.trim() ? activeMeta.title.trim() : '') ||
      (player.activeTrack?.title && player.activeTrack.title !== 'Unknown Title' ? player.activeTrack.title : '') ||
      activeKeywords.expectedTrack ||
      sourceTitle ||
      '';

  const displayArtist = rawArtist;
  const displayTitle = player.isRemote
    ? rawTitle
    : cleanDisplayTitle(rawTitle, displayArtist !== unknownArtist && displayArtist !== 'Bilinmeyen Sanatçı' ? displayArtist : undefined) ||
      unknownTrack;

  const currentArtworkUri =
    player.artworkUri ||
    activeMeta?.artwork ||
    (resolvedTrackId ? artworkMap[resolvedTrackId] : undefined) ||
    (player.activeTrack?.id ? artworkMap[player.activeTrack.id] : undefined) ||
    (localActiveTrack?.id ? artworkMap[localActiveTrack.id] : undefined) ||
    (typeof localActiveTrack?.artwork === 'string' ? localActiveTrack.artwork : undefined);

  // Önceki ve sonraki şarkıyı belirleme (Kapak geçiş önizlemesi için)
  const prevTrack = useMemo(() => {
    if (player.isRemote) {
      const q = Array.isArray(remoteState.queue) ? remoteState.queue : [];
      if (q.length <= 1) return null;
      const idx = q.findIndex((t) => t && t.id === player.activeTrack?.id);
      if (idx > 0 && q[idx - 1]) return q[idx - 1] as any;
      if (player.repeatMode === RepeatMode.Queue && q[q.length - 1]) return q[q.length - 1] as any;
      return null;
    }
    if (playedHistory.length > 0) {
      return playedHistory[playedHistory.length - 1];
    }
    if (queue.length <= 1) return null;
    if (activeIndex > 0) return queue[activeIndex - 1];
    if (repeatMode === RepeatMode.Queue) return queue[queue.length - 1];
    return null;
  }, [player.isRemote, player.activeTrack, player.repeatMode, remoteState.queue, playedHistory, queue, activeIndex, repeatMode]);

  const nextTrack = useMemo(() => {
    if (player.isRemote) {
      const q = Array.isArray(remoteState.queue) ? remoteState.queue : [];
      if (q.length <= 1) return null;
      const idx = q.findIndex((t) => t && t.id === player.activeTrack?.id);
      if (idx >= 0 && idx < q.length - 1 && q[idx + 1]) return q[idx + 1] as any;
      if (player.repeatMode === RepeatMode.Queue && q[0]) return q[0] as any;
      return null;
    }
    if (queue.length <= 1) return null;
    if (activeIndex < queue.length - 1) return queue[activeIndex + 1];
    if (repeatMode === RepeatMode.Queue) return queue[0];
    return null;
  }, [player.isRemote, player.activeTrack, player.repeatMode, remoteState.queue, queue, activeIndex, repeatMode]);

  const prevArtworkUri = useMemo(() => {
    if (!prevTrack) return undefined;
    const meta = prevTrack.id ? metadataMap[prevTrack.id] : undefined;
    return (
      meta?.artwork ||
      (prevTrack.id && artworkMap[prevTrack.id]) ||
      (typeof prevTrack.artwork === 'string' ? prevTrack.artwork : undefined)
    );
  }, [prevTrack, metadataMap, artworkMap]);

  const nextArtworkUri = useMemo(() => {
    if (!nextTrack) return undefined;
    const meta = nextTrack.id ? metadataMap[nextTrack.id] : undefined;
    return (
      meta?.artwork ||
      (nextTrack.id && artworkMap[nextTrack.id]) ||
      (typeof nextTrack.artwork === 'string' ? nextTrack.artwork : undefined)
    );
  }, [nextTrack, metadataMap, artworkMap]);

  // Şu an oynatılan parçayı hafızadan/akıştan indirme mantığı
  const targetDownloadUrl = useMemo(() => {
    return (
      (localActiveTrack as any)?.downloadUrl ||
      (localActiveTrack as any)?.url ||
      (activeTrack as any)?.downloadUrl ||
      (activeTrack as any)?.url ||
      ''
    );
  }, [localActiveTrack, activeTrack]);

  const isRemoteStream = useMemo(() => {
    return (
      typeof targetDownloadUrl === 'string' &&
      (targetDownloadUrl.startsWith('http://') || targetDownloadUrl.startsWith('https://'))
    );
  }, [targetDownloadUrl]);

  const downloadTasks = useDownloadStore((s) => s.tasks);
  const currentDownloadTask = useMemo(() => {
    if (!targetDownloadUrl) return undefined;
    return downloadTasks.find(
      (t) =>
        t.downloadUrl === targetDownloadUrl ||
        (localActiveTrack?.url && t.downloadUrl === localActiveTrack.url) ||
        (localActiveTrack?.id && t.id.includes(localActiveTrack.id)) ||
        (t.title === displayTitle && t.artist === displayArtist)
    );
  }, [downloadTasks, targetDownloadUrl, localActiveTrack, displayTitle, displayArtist]);

  const isCurrentTrackDownloading = currentDownloadTask?.status === 'downloading';
  const isCurrentTrackDownloaded = currentDownloadTask?.status === 'completed';

  const handleDownloadCurrentTrack = useCallback(async () => {
    if (!targetDownloadUrl || !isRemoteStream) {
      Alert.alert(t('common.info'), t('player.already_local'));
      return;
    }

    if (isCurrentTrackDownloaded) {
      Alert.alert(
        t('player.already_downloaded_title'),
        t('player.already_downloaded_msg', { title: displayTitle }),
        [
          { text: t('common.ok') },
          {
            text: t('downloads.title'),
            onPress: () => useExtensionStore.getState().openDownloadsModal(),
          },
        ]
      );
      return;
    }

    if (isCurrentTrackDownloading) {
      Alert.alert(t('player.downloading_title'), t('player.downloading_msg', { title: displayTitle }));
      return;
    }

    try {
      const finalTitle = displayTitle || localActiveTrack?.title || 'Unknown Title';
      const finalArtist = displayArtist || localActiveTrack?.artist || 'Unknown Artist';
      const artwork =
        currentArtworkUri ||
        (typeof localActiveTrack?.artwork === 'string' ? localActiveTrack.artwork : undefined);

      await startDownload({
        title: finalTitle,
        artist: finalArtist,
        artwork: artwork,
        downloadUrl: targetDownloadUrl,
        suggestedFileName: `${finalArtist} - ${finalTitle}.mp3`,
        storageTarget: 'private',
      });

      Alert.alert(
        t('player.download_started_title'),
        t('player.download_started_msg', { title: finalTitle })
      );
    } catch (err: any) {
      console.warn('[FullscreenPlayerModal] İndirme hatası:', err);
      Alert.alert(t('player.download_error_title'), err?.message || t('player.download_error_msg'));
    }
  }, [targetDownloadUrl, isRemoteStream, isCurrentTrackDownloaded, isCurrentTrackDownloading, displayTitle, displayArtist, localActiveTrack, currentArtworkUri, t]);

  // Metadata senkronizasyonu.
  //
  // ÖNEMLİ: native `TrackMetadata.setMetadata` (TrackMetadata.kt) TÜM alanları
  // koşulsuz atar — `artwork = BundleUtils.getUri(...)`, `title = getString(...)`.
  // Yani `updateMetadataForTrack`'e gönderilmeyen her alan NULL'lanır. Yalnızca
  // `{ title }` göndermek bildirim kapağını siliyordu (kullanıcının gördüğü
  // "coverlar görünmüyor" hatası). Bu yüzden bilinen TÜM alanlar birlikte
  // gönderilir.
  //
  // Kuyruktaki mevcut değerler yedek olarak kullanılır ki store'da karşılığı
  // olmayan bir alan null'lanmasın.
  const activeStoreMeta = activeMeta;
  const activeStoreArtwork = currentArtworkUri;

  const lastWrittenMetadataRef = useRef<{
    trackId: string;
    title?: string;
    artist?: string;
    artwork?: string;
  } | null>(null);

  useEffect(() => {
    if (player.isRemote || !localActiveTrack) return;

    const trackId = resolvedTrackId || localActiveTrack.id || localActiveTrack.url;
    const queueTitle = typeof localActiveTrack.title === 'string' ? localActiveTrack.title : undefined;
    const queueArtist = typeof localActiveTrack.artist === 'string' ? localActiveTrack.artist : undefined;
    const queueArtwork = typeof localActiveTrack.artwork === 'string' ? localActiveTrack.artwork : undefined;

    const resolvedTitle = activeStoreMeta?.title?.trim() || queueTitle;
    const resolvedArtist =
      activeStoreMeta?.artist &&
      activeStoreMeta.artist !== 'Local Audio' &&
      activeStoreMeta.artist !== 'Bilinmeyen Sanatçı'
        ? activeStoreMeta.artist
        : queueArtist;
    const resolvedArtwork = activeStoreArtwork || activeStoreMeta?.artwork || queueArtwork;

    const needsTitle = !!resolvedTitle && resolvedTitle !== queueTitle;
    const needsArtist = !!resolvedArtist && resolvedArtist !== queueArtist;
    const needsArtwork = !!resolvedArtwork && resolvedArtwork !== queueArtwork;
    if (!needsTitle && !needsArtist && !needsArtwork) return;

    // Aynı track için aynı değerler zaten yazıldıysa tekrar yazma. (Kapak sonradan
    // geldiğinde değerler değişir, dolayısıyla yeniden yazılır ve bildirim
    // kapağı güncellenir — eski "tek seferlik" koruma bunu engelliyordu.)
    const previous = lastWrittenMetadataRef.current;
    if (
      previous &&
      previous.trackId === trackId &&
      previous.title === resolvedTitle &&
      previous.artist === resolvedArtist &&
      previous.artwork === resolvedArtwork
    ) {
      return;
    }
    lastWrittenMetadataRef.current = {
      trackId,
      title: resolvedTitle,
      artist: resolvedArtist,
      artwork: resolvedArtwork,
    };

    // İndeks `refreshQueue`'dan ASENKRON geldiği için şarkı değişimi sırasında
    // bir an önceki parçayı gösterebilir. Doğrudan `activeIndex`'e yazmak, yeni
    // parçanın adını/kapağını ÖNCEKİ parçanın kuyruk girdisine (ya da tersi)
    // yazıp ekranda yanlış şarkı gösterebiliyordu. Bunun yerine parçayı
    // kimliğinden bulup yalnızca doğru girdiye yazıyoruz.
    void (async () => {
      try {
        const currentQueue = await TrackPlayer.getQueue();
        const targetIndex = currentQueue.findIndex((t) => (t.id || t.url) === trackId);
        if (targetIndex < 0) return;

        await TrackPlayer.updateMetadataForTrack(targetIndex, {
          ...(resolvedTitle ? { title: resolvedTitle } : {}),
          ...(resolvedArtist ? { artist: resolvedArtist } : {}),
          ...(resolvedArtwork ? { artwork: resolvedArtwork } : {}),
        });
      } catch {
        // Sessizce yoksay: metadata zaten store'dan okunuyor.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.isRemote, localActiveTrack?.id, localActiveTrack?.url, activeIndex, activeStoreArtwork, activeStoreMeta]);

  const currentLyrics: LyricsResult | null = useMemo(() => {
    if (player.isRemote) {
      if (!player.lyrics) return null;
      return {
        id: player.lyrics.lrclibId
          ? `lrclib-${player.lyrics.lrclibId}`
          : player.lyrics.geniusId
          ? `genius-${player.lyrics.geniusId}`
          : undefined,
        syncedLyrics: player.lyrics.syncedLyrics || (player.lyrics.isSynced ? 'synced' : null),
        plainLyrics: player.lyrics.plainLyrics || null,
        lyricsfile: player.lyrics.lyricsfile || null,
        parsedLines: player.lyrics.lines || [],
        source: (player.lyrics.source as any) || 'lrclib',
        trackName: player.activeTrack?.title || '',
        artistName: player.activeTrack?.artist || '',
        hasWordSync:
          !!player.lyrics.lyricsfile ||
          player.lyrics.lines?.some((l) => !!l.words && l.words.length > 0),
      } as LyricsResult;
    }

    if (!localActiveTrack || !lyricsCache) return null;
    const item = getLyricsFromCache({
      id: localActiveTrack.id,
      url: localActiveTrack.url,
      title: displayTitle,
      artist: displayArtist !== 'Bilinmeyen Sanatçı' ? displayArtist : '',
      rawTitle: localActiveTrack.title,
    });
    if (!item) return null;
    // `parsedLines` kalıcı kayda yazılmıyor (slimLyrics); burada her zaman bir
    // dizi olduğundan emin oluyoruz. Aksi halde düz metin sözlerde `undefined`
    // kalıp arayüzde `.length` okumasında çöküyordu.
    if (!item.parsedLines || item.parsedLines.length === 0) {
      const rebuilt = parseAnySyncedLyrics(item.lyricsfile, item.syncedLyrics, item.ttml);
      return { ...item, parsedLines: rebuilt };
    }
    return item;
  }, [player.isRemote, player.lyrics, player.activeTrack, localActiveTrack, lyricsCache, getLyricsFromCache, displayTitle, displayArtist]);

  const parsedLines = useMemo(() => {
    if (!currentLyrics) return [];
    if (currentLyrics.parsedLines && currentLyrics.parsedLines.length > 0) {
      return currentLyrics.parsedLines;
    }
    return parseAnySyncedLyrics(
      currentLyrics.lyricsfile,
      currentLyrics.syncedLyrics,
      currentLyrics.ttml
    );
  }, [currentLyrics]);

  /**
   * Paylaşım kartına girebilecek satırlar (paneldeki sırayla).
   *
   * Zaman damgalı sözler yoksa düz metin sözlerden üretilir; paylaşım her söz
   * tipinde çalışır.
   */
  const shareLines = useMemo(
    () =>
      parsedLines.length > 0
        ? buildShareLines(parsedLines)
        : buildPlainShareLines(currentLyrics?.plainLyrics),
    [parsedLines, currentLyrics?.plainLyrics]
  );

  /** Seçilen anahtarlar kart sırasına göre çözülür. */
  const selectedShareLines = useMemo(() => {
    if (selectedShareKeys.length === 0) return [];
    const set = new Set(selectedShareKeys);
    return shareLines.filter((line) => set.has(line.key));
  }, [shareLines, selectedShareKeys]);

  const startShareSelect = (initialKeys: string[]) => {
    setShareLimitHit(false);
    // Kart boş açılmasın: paneldeki sıraya göre ilk `MAX_SHARE_LINES` anahtar.
    const ordered = new Set(initialKeys);
    const keys = shareLines
      .filter((line) => ordered.has(line.key))
      .slice(0, MAX_SHARE_LINES)
      .map((line) => line.key);
    setSelectedShareKeys(keys.length > 0 ? keys : shareLines.slice(0, 1).map((l) => l.key));
    setIsShareSelecting(true);
  };

  /**
   * Satır seçimi geri çağrısı.
   *
   * `useCallback` + fonksiyonel güncelleme: kimliği sabit kalıyor. Sabit
   * olmasaydı söz panelindeki satır çizicisi her ebeveyn render'ında değişir ve
   * `React.memo` koruması olan tüm satırlar yeniden çizilirdi.
   */
  const toggleShareLine = useCallback(
    (key: string) => {
      setSelectedShareKeys((previous) => {
        if (previous.includes(key)) {
          setShareLimitHit(false);
          return previous.filter((item) => item !== key);
        }
        if (previous.length >= MAX_SHARE_LINES) {
          setShareLimitHit(true);
          return previous;
        }
        setShareLimitHit(false);
        return [...previous, key];
      });
    },
    [setSelectedShareKeys, setShareLimitHit]
  );

  const cancelShareSelect = () => {
    setIsShareSelecting(false);
    setSelectedShareKeys([]);
    setShareLimitHit(false);
  };

  // Geri tuşu dinleyicisi için güncel iptal eylemi (yalnızca seçim modunda).
  useEffect(() => {
    shareSelectCancelRef.current = isShareSelecting
      ? () => {
          setIsShareSelecting(false);
          setSelectedShareKeys([]);
          setShareLimitHit(false);
        }
      : null;
  }, [isShareSelecting]);

  const openSharePreview = () => {
    if (selectedShareKeys.length === 0) return;
    setIsSharePreviewOpen(true);
  };

  // Şarkı değişirse yarım kalan seçim paylaşım kartına taşınmasın.
  useEffect(() => {
    setIsShareSelecting(false);
    setIsSharePreviewOpen(false);
    setSelectedShareKeys([]);
    setShareLimitHit(false);
  }, [activeTrack?.id]);

  const remoteLyrics = player.lyrics;
  const remoteLrclibId = remoteLyrics?.lrclibId;
  const remoteGeniusId = remoteLyrics?.geniusId;
  const remoteGeniusUrl = remoteLyrics?.geniusUrl;
  const remoteHasContent = !!(
    (remoteLyrics?.lines && remoteLyrics.lines.length > 0) ||
    remoteLyrics?.plainLyrics
  );
  const lastFetchedRemoteLyricsKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isFullscreenPlayerOpen || !player.isRemote || !remoteLyrics || remoteHasContent) {
      return;
    }

    const currentKey = `${player.activeTrack?.id || ''}_${remoteLrclibId || remoteGeniusUrl || ''}`;
    if (lastFetchedRemoteLyricsKeyRef.current === currentKey) {
      return;
    }
    lastFetchedRemoteLyricsKeyRef.current = currentKey;

    if (remoteLrclibId) {
      const rawId = String(remoteLrclibId).replace('lrclib-', '');
      fetch(`https://lrclib.net/api/get/${rawId}`, { headers: LRCLIB_HEADERS })
        .then((res) => res.json())
        .then((d) => {
          if (d) {
            const lines = parseAnySyncedLyrics(d.lyricsfile, d.syncedLyrics);
            const current = useRemoteConnectStore.getState().remoteState.lyrics;
            if (current) {
              useRemoteConnectStore.getState().setRemoteLyrics({
                ...current,
                lines,
                syncedLyrics: d.syncedLyrics,
                plainLyrics: d.plainLyrics,
                lyricsfile: d.lyricsfile,
                isSynced: !!d.syncedLyrics && lines.length > 0,
              });
            }
          }
        })
        .catch(() => {});
    } else if (remoteGeniusUrl) {
      fetchGeniusLyricsByUrl(remoteGeniusUrl).then((plain) => {
        if (plain) {
          const current = useRemoteConnectStore.getState().remoteState.lyrics;
          if (current) {
            useRemoteConnectStore.getState().setRemoteLyrics({
              ...current,
              lines: [],
              plainLyrics: plain,
              isSynced: false,
            });
          }
        }
      });
    }
  }, [
    isFullscreenPlayerOpen,
    player.isRemote,
    remoteLyrics,
    remoteHasContent,
    remoteLrclibId,
    remoteGeniusId,
    remoteGeniusUrl,
    player.activeTrack?.id,
  ]);

  /**
   * Player'daki sanatçı adına dokunulduğunda sanatçı sayfasını açar.
   *
   * Önce player kapatılır: sanatçı sayfası tam ekran bir sekme olarak açılır,
   * arkada açık bir player modal'ı kalırsa geri dönüşte iki katman üst üste
   * binmiş görünür.
   */
  const openArtistProfile = useCallback(
    (name: string) => {
      const target = name.trim();
      if (!target) return;
      closeFullscreenPlayer();
      router.push({ pathname: '/artist', params: { name: target } });
    },
    [closeFullscreenPlayer]
  );

  const loadLyricsForTrack = async (title: string, artist?: string, force = false) => {
    if (player.isRemote || !localActiveTrack) return;
    const cleanArtist = artist && artist !== 'Local Audio' && artist !== 'Bilinmeyen Sanatçı' ? artist : '';
    // lrc.red doğru kaydı süreyle eşler: aynı başlığın canlı/remix sürümleri
    // arasında stüdyo kaydı ancak süre yakınlığıyla ayırt edilebiliyor.
    const durationForLyrics =
      (typeof activeMeta?.duration === 'number' && activeMeta.duration > 0
        ? activeMeta.duration
        : undefined) ||
      (typeof localActiveTrack.duration === 'number' && localActiveTrack.duration > 0
        ? localActiveTrack.duration
        : undefined) ||
      (typeof player.activeTrack?.duration === 'number' && player.activeTrack.duration > 0
        ? player.activeTrack.duration
        : undefined);

    if (!force) {
      const cached = getLyricsFromCache({
        id: localActiveTrack.id,
        url: localActiveTrack.url,
        title,
        artist: cleanArtist,
        rawTitle: localActiveTrack.title,
      });

      // Kaydedilmiş/seçilmiş herhangi bir lyric varsa (senkronize, word sync veya düz metin),
      // varsayılan olarak kesinlikle o kullanılır. Arka planda asla ezilmez.
      if (cached) {
        if (cached.candidates && cached.candidates.length > 0) {
          setCandidatesList(cached.candidates);
        }
        return;
      }
    }

    // Çevrimdışıyken ağ isteği atılmaz. Otomatik denemede **sessiz** kalınır:
    // her oynatıcı açılışında uyarı göstermek rahatsız ediciydi. Yalnızca
    // kullanıcı söz aramayı elle başlattığında bilgi verilir.
    if (!isNetworkAvailable()) {
      if (force) alert(t('player.offline_lyrics'));
      return;
    }

    setIsLoadingLyrics(true);
    try {
      const result = await fetchLyricsOnline(
        title,
        cleanArtist,
        useStore.getState().preferences.lyricsSourcePreference,
        durationForLyrics
      );
      if (result) {
        // Asenkron istek dönerken kullanıcı manuel bir seçim yaptıysa veya cache'e lyric kaydedildiyse ezme!
        const existing = getLyricsFromCache({
          id: localActiveTrack.id,
          url: localActiveTrack.url,
          title,
          artist: cleanArtist,
          rawTitle: localActiveTrack.title,
        });
        if (existing && !force) {
          return;
        }

        // Genius sözü çekerken o şarkının sanatçı görselini de verir: Deezer'da
        // bulunamayan/karışan sanatçılar için doğrudan kaynak. Yerel sanatçı
        // adıyla eşleşiyorsa onun adına yazılır (uygulama bu anahtarla arıyor).
        if (result.artistImageUrl && result.artistImageName) {
          const geniusKey = normalizeArtistKey(result.artistImageName);
          const localName = splitArtistNames(cleanArtist).find(
            (name) => normalizeArtistKey(name) === geniusKey
          );
          void rememberArtistImage(
            localName || result.artistImageName,
            result.artistImageUrl,
            'genius'
          );
        }

        if (result.candidates && result.candidates.length > 0) {
          setCandidatesList(result.candidates);
        }
        const altKeys = getLyricsCacheKeys({
          id: localActiveTrack.id,
          url: localActiveTrack.url,
          title,
          artist: cleanArtist,
          rawTitle: localActiveTrack.title,
        });
        const saveId = localActiveTrack.id || localActiveTrack.url || title;
        const initialSaved: LyricsResult = {
          ...result,
          selectedCandidateId: result.id,
        };
        setLyrics(saveId, initialSaved, altKeys);
        if (localActiveTrack?.id) {
          remoteSyncManager.broadcastLyricsUpdate(localActiveTrack.id);
        }
      }
    } catch (e) {
      console.warn('Failed to load lyrics', e);
    } finally {
      setIsLoadingLyrics(false);
    }
  };

  useEffect(() => {
    if (!isFullscreenPlayerOpen) return;
    if (!player.isRemote && localActiveTrack && isHydrated) {
      const searchArtist = displayArtist !== 'Bilinmeyen Sanatçı' ? displayArtist : '';
      const titleLower = displayTitle.toLowerCase();
      const artistLower = searchArtist.toLowerCase();
      let initialQuery = displayTitle;
      if (searchArtist && !titleLower.includes(artistLower)) {
        initialQuery = `${searchArtist} ${displayTitle}`;
      }
      setManualQuery(initialQuery);

      const cached = getLyricsFromCache({
        id: localActiveTrack.id,
        url: localActiveTrack.url,
        title: displayTitle,
        artist: searchArtist,
        rawTitle: localActiveTrack.title,
      });

      if (!cached && autoFetchLyrics) {
        // Bu parça için henüz kaydedilmiş bir söz yoksa ilk kez internetten ara ve kaydet
        loadLyricsForTrack(displayTitle, searchArtist, false);
      } else if (cached?.candidates && cached.candidates.length > 0) {
        setCandidatesList(cached.candidates);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isFullscreenPlayerOpen,
    player.isRemote,
    localActiveTrack?.id,
    localActiveTrack?.url,
    displayTitle,
    displayArtist,
    isHydrated,
    autoFetchLyrics,
  ]);

  /**
   * Çevrimdışı arama: ağa çıkmadan yalnızca indirilmiş sözlerde arar.
   * Sonuçlar seçim anında yeniden ağ isteği üretmesin diye tam söz kayıtları
   * `offlineCandidates` eşlemesinde tutulur.
   *
   * @returns Bulunan kayıt sayısı (0 ise çağıran bilgilendirme gösterir).
   */
  const applyOfflineCandidates = (query: string): number => {
    const matches = searchCachedLyricsCandidates(lyricsCache, query);
    const byId: Record<string, LyricsResult> = {};
    for (const match of matches) {
      byId[match.candidate.id] = match.result;
    }
    setOfflineCandidates(byId);
    setCandidatesList(matches.map((match) => match.candidate));
    setIsCachedSearch(matches.length > 0);
    return matches.length;
  };

  /**
   * Söz aramalarında ağ durumuna **güvenilmez**.
   *
   * Android'in `isInternetReachable` bayrağı doğrulama sunucusuna ulaşamayınca
   * internet varken bile `false` kalıyor; bu yüzden arama her zaman ağda
   * denenir. Ağ gerçekten yoksa `searchAllCandidates` boş döner ve kayıtlı
   * sözler gösterilir. Böylece "internet varken çevrimdışı" durumu oluşmaz.
   */
  const handleManualSearch = async () => {
    if (!manualQuery.trim() || !activeTrack) return;
    const query = manualQuery.trim();
    const searchArtist = displayArtist !== 'Bilinmeyen Sanatçı' ? displayArtist : '';

    const searchCache = (): void => {
      const count = applyOfflineCandidates(query);
      if (count === 0) alert(t('player.offline_no_cached_results'));
    };

    if (!isNetworkAvailable()) {
      searchCache();
      return;
    }

    setIsSearchingCandidates(true);
    try {
      const results = await searchAllCandidates(query, searchArtist);
      if (results.length === 0) {
        // Ağ hatası da buraya düşer (her sağlayıcı hatayı yutuyor).
        searchCache();
        return;
      }
      setOfflineCandidates({});
      setIsCachedSearch(false);
      setCandidatesList(results);
    } catch (e) {
      console.warn('Manual lyrics search failed', e);
      searchCache();
    } finally {
      setIsSearchingCandidates(false);
    }
  };

  const handleSelectCandidate = async (candidate: LyricsCandidate) => {
    if (player.isRemote) {
      if (player.activeTrack) {
        setResolvingCandidateId(candidate.id);
        remoteSyncManager.sendSelectLyrics(player.activeTrack.id, candidate);
        setIsManualSearchOpen(false);
        setResolvingCandidateId(null);
      }
      return;
    }
    if (!localActiveTrack) return;
    const offlineResult = offlineCandidates[candidate.id];
    if (!offlineResult && !isNetworkAvailable()) {
      alert(t('player.offline_lyrics'));
      return;
    }
    setResolvingCandidateId(candidate.id);
    try {
      const resolved =
        offlineResult ?? (await resolveCandidateToLyricsResult(candidate, candidatesList));
      if (!resolved) {
        // Kaynak erişilemezse eskiden hiçbir şey olmuyordu; kullanıcı
        // "yükleniyor" görüp sonuçsuz kalıyordu.
        alert(t('player.candidate_load_failed'));
        return;
      }
      const searchArtist = displayArtist !== 'Bilinmeyen Sanatçı' ? displayArtist : '';
      const altKeys = getLyricsCacheKeys({
        id: localActiveTrack.id,
        url: localActiveTrack.url,
        title: displayTitle,
        artist: searchArtist,
        rawTitle: localActiveTrack.title,
      });
      const saveId = localActiveTrack.id || localActiveTrack.url || displayTitle;
      const selectedResult: LyricsResult = {
        ...resolved,
        isUserSelected: true,
        selectedCandidateId: candidate.id,
        candidates: candidatesList.length > 0 ? candidatesList : resolved.candidates,
      };
      setLyrics(saveId, selectedResult, altKeys);
      if (localActiveTrack?.id) {
        remoteSyncManager.broadcastLyricsUpdate(localActiveTrack.id);
      }
      setIsManualSearchOpen(false);
    } catch (e) {
      console.warn('Failed to resolve candidate', e);
      alert(t('player.candidate_load_failed'));
    } finally {
      setResolvingCandidateId(null);
    }
  };

  const toggleManualSearch = () => {
    const nextState = !isManualSearchOpen;
    setIsManualSearchOpen(nextState);
    if (nextState) {
      const searchArtist = displayArtist !== 'Bilinmeyen Sanatçı' ? displayArtist : '';
      const queryToSearch = manualQuery.trim() || displayTitle;
      if (!isNetworkAvailable()) {
        applyOfflineCandidates(queryToSearch);
        return;
      }
      setOfflineCandidates({});
      setIsCachedSearch(false);
      if (currentLyrics?.candidates && currentLyrics.candidates.length > 0) {
        setCandidatesList(currentLyrics.candidates);
      } else if (!player.isRemote && localActiveTrack) {
        setIsSearchingCandidates(true);
        searchAllCandidates(queryToSearch, searchArtist)
          .then((results) => {
            // Ağ yoksa/başarısızsa sağlayıcılar boş döner: kayıtlı sözlere düş.
            if (results.length === 0) {
              applyOfflineCandidates(queryToSearch);
              return;
            }
            setCandidatesList(results);
            if (currentLyrics) {
              const altKeys = getLyricsCacheKeys({
                id: localActiveTrack.id,
                url: localActiveTrack.url,
                title: displayTitle,
                artist: searchArtist,
                rawTitle: localActiveTrack.title,
              });
              const saveId = localActiveTrack.id || localActiveTrack.url || displayTitle;
              setLyrics(saveId, { ...currentLyrics, candidates: results }, altKeys);
            }
          })
          .catch(() => applyOfflineCandidates(queryToSearch))
          .finally(() => setIsSearchingCandidates(false));
      }
    }
  };

  const togglePlayback = async () => {
    /*
     * Duraklatma kararı native duruma göre verilir: kanca değeri bayatladığında
     * (olay kaçtığında) düğme hiçbir şey yapmıyormuş gibi görünüyordu. Kanca
     * yalnızca "duraklatınca konumu kaydet" adımı için kullanılır.
     */
    const nativePlaying = player.isRemote ? null : await readNativePlaying();
    const wasPlaying = nativePlaying ?? player.isPlaying;
    await player.togglePlayPause();
    if (wasPlaying && !player.isRemote && localActiveTrack) {
      try {
        const { position } = await TrackPlayer.getProgress();
        if (position > 0) {
          saveLastPlayback(
            {
              trackId: localActiveTrack.id || localActiveTrack.url,
              trackIndex: activeIndex,
              position,
              track: {
                id: localActiveTrack.id || localActiveTrack.url,
                url: localActiveTrack.url,
                title: localActiveTrack.title,
                artist: localActiveTrack.artist,
                artwork: typeof localActiveTrack.artwork === 'string' ? localActiveTrack.artwork : undefined,
              },
            },
            true
          );
          updateQueueSnapshotActiveIndex(activeIndex, position);
        }
      } catch {
        // Player may already be torn down; pausing is still successful.
      }
    }
  };

  const artworkScale = useMemo(() => new Animated.Value(1), []);
  const panX = useMemo(() => new Animated.Value(0), []);
  const lyricsTransition = useMemo(() => new Animated.Value(0), []);
  const queueTransition = useMemo(() => new Animated.Value(0), []);
  const sleepTimerTransition = useMemo(() => new Animated.Value(0), []);
  const connectTransition = useMemo(() => new Animated.Value(0), []);
  const coverTransition = useMemo(() => new Animated.Value(1), []);
  const playBtnScale = useMemo(() => new Animated.Value(1), []);
  const [isSkipping, setIsSkipping] = useState(false);

  /*
   * Emniyet supabı: `isSkipping` yalnızca yatay kaydırma animasyonunun bitiş
   * geri çağrısında temizleniyor. Animasyon iptal edilip geri çağrı hiç
   * çalışmazsa bayrak `true` kalır; o zaman kapak jestleri (kaydırma, aşağı
   * çekip kapatma) sürekli reddedilir ve oynatıcı "donmuş" gibi davranır. Bu
   * yüzden bayrak en geç animasyon süresinden sonra kendiliğinden sıfırlanır.
   */
  useEffect(() => {
    if (!isSkipping) return;
    const timer = setTimeout(() => setIsSkipping(false), 1200);
    return () => clearTimeout(timer);
  }, [isSkipping]);

  // Kapak → sağ köşe geçişi için ölçüm.
  //
  // Büyük kapak kaybolurken küçük kapağın "ortadan sağ köşeye süzülüyor"
  // görünmesi için iki kapağın ekran üzerindeki merkezleri arasındaki fark
  // ölçülür. Merkezler yalnızca ötelemeden etkilenir; ölçekleme merkezi
  // değiştirmediği için kapak ölçeklenmiş/dönmüş olsa da değer doğru kalır.
  const bigCoverRef = useRef<View>(null);
  const miniCoverRef = useRef<View>(null);
  const [coverAnchor, setCoverAnchor] = useState<{ dx: number; dy: number } | null>(null);

  const measureCoverAnchor = useCallback(() => {
    const big = bigCoverRef.current;
    const mini = miniCoverRef.current;
    if (!big || !mini) return;
    big.measureInWindow((bx, by, bw, bh) => {
      mini.measureInWindow((mx, my, mw, mh) => {
        if (!bw || !bh || !mw || !mh) return;
        const dx = bx + bw / 2 - (mx + mw / 2);
        const dy = by + bh / 2 - (my + mh / 2);
        setCoverAnchor((prev) =>
          prev && Math.abs(prev.dx - dx) < 0.5 && Math.abs(prev.dy - dy) < 0.5
            ? prev
            : { dx, dy }
        );
      });
    });
  }, []);

  // Yerleşim değiştiğinde ölçümü tazele. Panel modları açıkken büyük kapak
  // kaydırılmış olduğu için ölçüm yanıltıcı olur; o durumda atlanır.
  const handleCoverLayout = useCallback(() => {
    if (isLyricsMode || isQueueMode || isSleepTimerMode || isConnectMode) return;
    requestAnimationFrame(measureCoverAnchor);
  }, [isLyricsMode, isQueueMode, isSleepTimerMode, isConnectMode, measureCoverAnchor]);

  const CARD_OFFSET = ARTWORK_SIZE + 24;

  // IMPORTANT: Interpolations must be memoized.
  //
  // This shell still re-renders for player/theme/UI state changes. Creating
  // `Animated.Value.interpolate(...)` inline on each render creates a new
  // native Animated node graph every time. On long background playback this
  // churns/leaks native nodes until Android aborts with OutOfMemoryError in
  // NativeAnimatedNodesManager.createAnimatedNode.
  const headerMorphStyle = useMemo(
    () => ({ transform: [{ translateY: headerMorphY }] }),
    [headerMorphY]
  );

  const middleMorphStyle = useMemo(
    () => ({
      transform: [
        { scale: middleMorphScale },
        { translateX: middleMorphX },
        { translateY: middleMorphY },
      ],
    }),
    [middleMorphScale, middleMorphX, middleMorphY]
  );

  const bottomMorphStyle = useMemo(
    () => ({ transform: [{ translateY: bottomMorphY }] }),
    [bottomMorphY]
  );

  const metaMorphStyle = useMemo(
    () => ({
      transform: [{ translateX: textMorphX }, { translateY: textMorphY }],
    }),
    [textMorphX, textMorphY]
  );

  const coverTransitionStyle = useMemo(
    () => ({
      opacity: coverTransition.interpolate({
        inputRange: [0, 0.45, 1],
        outputRange: [0, 0.2, 1],
      }),
      transform: [
        {
          scale: coverTransition.interpolate({
            inputRange: [0, 1],
            // Büyük kapak neredeyse yerinde söner; küçülme işini sağ köşeye
            // süzülen küçük kapak üstlenir.
            outputRange: [0.78, 1],
          }),
        },
        {
          translateY: coverTransition.interpolate({
            inputRange: [0, 1],
            // Küçük kapak büyük kapağın merkezinden süzülmeye başladığı için
            // büyük kapağın aşağı kayması küçük tutulur; aksi halde iki görüntü
            // birbirinden kopuk görünür.
            outputRange: [24, 0],
          }),
        },
      ],
    }),
    [coverTransition]
  );

  const prevArtworkTransitionStyle = useMemo(
    () => ({
      transform: [
        {
          translateX: panX.interpolate({
            inputRange: [-CARD_OFFSET, 0, CARD_OFFSET],
            outputRange: [-CARD_OFFSET * 2, -CARD_OFFSET, 0],
            extrapolate: 'clamp',
          }),
        },
        {
          scale: panX.interpolate({
            inputRange: [0, CARD_OFFSET],
            outputRange: [0.82, 1],
            extrapolate: 'clamp',
          }),
        },
      ],
      opacity: panX.interpolate({
        inputRange: [0, CARD_OFFSET * 0.75],
        outputRange: [0.25, 1],
        extrapolate: 'clamp',
      }),
    }),
    [panX, CARD_OFFSET]
  );

  const artworkTransitionStyle = useMemo(
    () => ({
      transform: [
        { translateX: panX },
        { scale: artworkScale },
        {
          scale: panX.interpolate({
            inputRange: [-CARD_OFFSET, 0, CARD_OFFSET],
            outputRange: [0.85, 1, 0.85],
            extrapolate: 'clamp',
          }),
        },
        {
          rotate: panX.interpolate({
            inputRange: [-CARD_OFFSET, 0, CARD_OFFSET],
            outputRange: ['-5deg', '0deg', '5deg'],
            extrapolate: 'clamp',
          }),
        },
      ],
      opacity: panX.interpolate({
        inputRange: [-CARD_OFFSET, 0, CARD_OFFSET],
        outputRange: [0.45, 1, 0.45],
        extrapolate: 'clamp',
      }),
    }),
    [panX, artworkScale, CARD_OFFSET]
  );

  const nextArtworkTransitionStyle = useMemo(
    () => ({
      transform: [
        {
          translateX: panX.interpolate({
            inputRange: [-CARD_OFFSET, 0, CARD_OFFSET],
            outputRange: [0, CARD_OFFSET, CARD_OFFSET * 2],
            extrapolate: 'clamp',
          }),
        },
        {
          scale: panX.interpolate({
            inputRange: [-CARD_OFFSET, 0],
            outputRange: [1, 0.82],
            extrapolate: 'clamp',
          }),
        },
      ],
      opacity: panX.interpolate({
        inputRange: [-CARD_OFFSET * 0.75, 0],
        outputRange: [1, 0.25],
        extrapolate: 'clamp',
      }),
    }),
    [panX, CARD_OFFSET]
  );

  const lyricsCardTransitionStyle = useMemo(
    () => ({
      opacity: lyricsTransition,
      transform: [
        {
          scale: lyricsTransition.interpolate({
            inputRange: [0, 1],
            outputRange: [0.92, 1],
          }),
        },
        { scale: artworkScale },
      ],
    }),
    [lyricsTransition, artworkScale]
  );

  const queueCardTransitionStyle = useMemo(
    () => ({
      opacity: queueTransition,
      transform: [
        {
          scale: queueTransition.interpolate({
            inputRange: [0, 1],
            outputRange: [0.92, 1],
          }),
        },
        { scale: artworkScale },
      ],
    }),
    [queueTransition, artworkScale]
  );

  const sleepTimerCardTransitionStyle = useMemo(
    () => ({
      opacity: sleepTimerTransition,
      transform: [
        {
          scale: sleepTimerTransition.interpolate({
            inputRange: [0, 1],
            outputRange: [0.92, 1],
          }),
        },
        { scale: artworkScale },
      ],
    }),
    [sleepTimerTransition, artworkScale]
  );

  const connectCardTransitionStyle = useMemo(
    () => ({
      opacity: connectTransition,
      transform: [
        {
          scale: connectTransition.interpolate({
            inputRange: [0, 1],
            outputRange: [0.92, 1],
          }),
        },
        { scale: artworkScale },
      ],
    }),
    [connectTransition, artworkScale]
  );

  const miniCoverTransitionStyle = useMemo(() => {
    // Ölçüm henüz yoksa (çok erken açılış) eski davranışa düş: yerinde belirir.
    const { dx, dy } = coverAnchor ?? { dx: 0, dy: 0 };
    // Küçük kapak, panel KAPALIYKEN (coverTransition = 1) büyük kapağın
    // merkezinde ve büyük boyutta durur; panel AÇILIRKEN (0) kendi köşesine
    // süzülüp küçülür. Böylece büyük kapak sönerken görüntü ortadan sağ
    // köşeye kayıyormuş gibi okunur.
    const scaleRatio = ARTWORK_SIZE / MINI_COVER_SIZE;
    return {
      opacity: coverTransition.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 0],
      }),
      transform: [
        {
          translateX: coverTransition.interpolate({
            inputRange: [0, 1],
            outputRange: [0, dx],
          }),
        },
        {
          translateY: coverTransition.interpolate({
            inputRange: [0, 1],
            outputRange: [0, dy],
          }),
        },
        {
          scale: coverTransition.interpolate({
            inputRange: [0, 1],
            outputRange: [1, scaleRatio],
          }),
        },
      ],
    };
  }, [coverTransition, coverAnchor]);

  useEffect(() => {
    if (!isFullscreenPlayerOpen) return;
    // "Hareketleri azalt" açıkken duraklatma ölçek animasyonu uygulanmaz.
    Animated.spring(artworkScale, {
      toValue: reduceMotion || playing ? 1 : 0.88,
      damping: 18,
      mass: 0.9,
      stiffness: 140,
      useNativeDriver: true,
    }).start();
  }, [isFullscreenPlayerOpen, playing, artworkScale, reduceMotion]);

  useEffect(() => {
    const isCover = !isLyricsMode && !isQueueMode && !isSleepTimerMode && !isConnectMode;
    if (reduceMotion) {
      lyricsTransition.setValue(isLyricsMode ? 1 : 0);
      queueTransition.setValue(isQueueMode ? 1 : 0);
      sleepTimerTransition.setValue(isSleepTimerMode ? 1 : 0);
      connectTransition.setValue(isConnectMode ? 1 : 0);
      coverTransition.setValue(isCover ? 1 : 0);
      return;
    }
    Animated.parallel([
      Animated.spring(lyricsTransition, {
        toValue: isLyricsMode ? 1 : 0,
        damping: 20,
        mass: 0.9,
        stiffness: 150,
        useNativeDriver: true,
      }),
      Animated.spring(queueTransition, {
        toValue: isQueueMode ? 1 : 0,
        damping: 20,
        mass: 0.9,
        stiffness: 150,
        useNativeDriver: true,
      }),
      Animated.spring(sleepTimerTransition, {
        toValue: isSleepTimerMode ? 1 : 0,
        damping: 20,
        mass: 0.9,
        stiffness: 150,
        useNativeDriver: true,
      }),
      Animated.spring(connectTransition, {
        toValue: isConnectMode ? 1 : 0,
        damping: 20,
        mass: 0.9,
        stiffness: 150,
        useNativeDriver: true,
      }),
      Animated.spring(coverTransition, {
        toValue: isCover ? 1 : 0,
        damping: 20,
        mass: 0.9,
        stiffness: 150,
        useNativeDriver: true,
      }),
    ]).start();
  }, [
    isLyricsMode,
    isQueueMode,
    isSleepTimerMode,
    isConnectMode,
    lyricsTransition,
    queueTransition,
    sleepTimerTransition,
    connectTransition,
    coverTransition,
    reduceMotion,
  ]);

  // Kapak konumlarını ölç. Yalnızca kapak modunda ölçülür: sözler/kuyruk
  // açıkken büyük kapak aşağı kaydırılıp ölçeklendiği için merkezi kayar.
  // Yerleşim animasyonu otursun diye kısa bir gecikme bırakılır.
  useEffect(() => {
    if (!isFullscreenPlayerOpen) return;
    if (isLyricsMode || isQueueMode || isSleepTimerMode || isConnectMode) return;
    const timer = setTimeout(measureCoverAnchor, 300);
    return () => clearTimeout(timer);
  }, [
    isFullscreenPlayerOpen,
    isLyricsMode,
    isQueueMode,
    isSleepTimerMode,
    isConnectMode,
    measureCoverAnchor,
  ]);

  // Döndürme / ekran boyutu değişiminde ölçümü tazele.
  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', measureCoverAnchor);
    return () => subscription.remove();
  }, [measureCoverAnchor]);

  const handlePlayPressIn = useCallback(() => {
    Animated.spring(playBtnScale, {
      toValue: 0.88,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  }, [playBtnScale]);

  const handlePlayPressOut = useCallback(() => {
    Animated.spring(playBtnScale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 30,
      bounciness: 12,
    }).start();
  }, [playBtnScale]);

  // Sıra (shuffle/repeat dahil) doğrudan kuyruğa gömülü olduğu için native
  // next/prev her zaman doğru parçayı çalar; ekstra indeks hesabı gerekmez.
  const skipNext = useCallback(async () => {
    try {
      await player.skipToNext();
    } catch (e) {
      console.warn('Skip next failed', e);
    }
  }, [player]);

  const skipPrev = useCallback(async () => {
    try {
      await player.skipToPrevious();
    } catch (e) {
      console.warn('Skip prev failed', e);
    }
  }, [player]);

  const handleHideTrack = useCallback(() => {
    if (!player.isRemote && localActiveTrack?.id) {
      hideTrack(localActiveTrack.id);
      setIsOptionsModalOpen(false);
      skipNext();
    }
  }, [player.isRemote, localActiveTrack, hideTrack, skipNext]);

  const handleDeleteTrack = useCallback(async () => {
    if (!player.isRemote && localActiveTrack?.id) {
      try {
        await MediaLibrary.deleteAssetsAsync([localActiveTrack.id]);
        setIsOptionsModalOpen(false);
        skipNext();
      } catch (e) {
        console.warn('Could not delete track', e);
      }
    }
  }, [player.isRemote, localActiveTrack, skipNext]);

  const gestureSkipPrev = useCallback(async () => {
    try {
      await player.skipToPrevious();
    } catch (e) {
      console.warn('Gesture skip prev failed', e);
    }
  }, [player]);

  const handleSeekBackward = useCallback(async () => {
    try {
      const position = player.isRemote
        ? useRemoteConnectStore.getState().interpolatedPosition
        : (await TrackPlayer.getProgress()).position;
      await player.seekTo(Math.max(0, position - 5));
    } catch (e) {
      console.warn('Seek backward failed', e);
    }
  }, [player]);

  const handleSeekForward = useCallback(async () => {
    try {
      if (player.isRemote) {
        const remoteState = useRemoteConnectStore.getState();
        const duration = remoteState.remoteState.activeTrack?.duration ?? 0;
        const target = remoteState.interpolatedPosition + 5;
        await player.seekTo(duration > 0 ? Math.min(duration, target) : target);
        return;
      }
      const { position, duration } = await TrackPlayer.getProgress();
      const target = position + 5;
      await player.seekTo(duration > 0 ? Math.min(duration, target) : target);
    } catch (e) {
      console.warn('Seek forward failed', e);
    }
  }, [player]);

  const togglePlaybackMode = useCallback(async () => {
    await player.cyclePlaybackMode();
    if (!player.isRemote && isQueueMode) {
      await refreshQueueSections();
      await refreshQueue();
    }
  }, [player, isQueueMode, refreshQueueSections, refreshQueue]);

  // Gestures: Middle container (Interactive Carousel Artwork / Lyrics)
  const artworkPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_, gesture) => {
          if (isLyricsMode || isQueueMode || isSleepTimerMode || isConnectMode || isSkipping) return false;
          return Math.abs(gesture.dx) > 12 || gesture.dy > 15;
        },
        onMoveShouldSetPanResponderCapture: (_, gesture) => {
          if (isLyricsMode || isQueueMode || isSleepTimerMode || isConnectMode || isSkipping) return false;
          return Math.abs(gesture.dx) > 12 || gesture.dy > 15;
        },
        onPanResponderMove: (_, gesture) => {
          if (isSkipping || isConnectMode) return;
          // Belirgin dikey kaydırma varsa (aşağı çekip kapatma) yatay hareketi engelle
          if (gesture.dy > 18 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.4) {
            return;
          }
          let targetDx = gesture.dx;
          // Eğer sonraki veya önceki şarkı yoksa lastik direnci uygula
          if (targetDx < 0 && !nextTrack) {
            targetDx = targetDx * 0.28;
          } else if (targetDx > 0 && !prevTrack) {
            targetDx = targetDx * 0.28;
          }
          panX.setValue(targetDx);
        },
        onPanResponderRelease: (_, gesture) => {
          if (isSkipping || isConnectMode) return;

          // 1. Dokunma (Tap): Sözler moduna geç
          if (Math.abs(gesture.dx) < 10 && Math.abs(gesture.dy) < 10) {
            toggleLyricsMode();
            return;
          }

          // 2. Aşağı kaydırma: Tam ekran çaları kapat
          if (gesture.dy > 50 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.1) {
            Animated.spring(panX, { toValue: 0, useNativeDriver: true }).start();
            closeFullscreenPlayer();
            return;
          }

          // 3. Yatay kaydırma: Şarkı değiştirme eşiği
          const threshold = ARTWORK_SIZE * 0.25;
          const isQuickFlingLeft = gesture.dx < -30 && gesture.vx < -0.4;
          const isQuickFlingRight = gesture.dx > 30 && gesture.vx > 0.4;

          if ((gesture.dx < -threshold || isQuickFlingLeft) && nextTrack) {
            // Sola kaydırıldı -> Sonraki şarkıya yumuşak animasyonla geç
            setIsSkipping(true);
            Animated.spring(panX, {
              toValue: -CARD_OFFSET,
              velocity: gesture.vx,
              tension: 65,
              friction: 9,
              useNativeDriver: true,
            }).start(() => {
              skipNext();
              panX.setValue(0);
              setIsSkipping(false);
            });
          } else if ((gesture.dx > threshold || isQuickFlingRight) && prevTrack) {
            // Sağa kaydırıldı -> Önceki şarkıya yumuşak animasyonla geç
            setIsSkipping(true);
            Animated.spring(panX, {
              toValue: CARD_OFFSET,
              velocity: gesture.vx,
              tension: 65,
              friction: 9,
              useNativeDriver: true,
            }).start(() => {
              gestureSkipPrev();
              panX.setValue(0);
              setIsSkipping(false);
            });
          } else {
            // Eşik geçilmedi -> Merkeze tatlı bir yay efektiyle geri dön
            Animated.spring(panX, {
              toValue: 0,
              velocity: gesture.vx,
              tension: 70,
              friction: 8,
              useNativeDriver: true,
            }).start();
          }
        },
      }),
    [
      isLyricsMode,
      isQueueMode,
      isSleepTimerMode,
      isConnectMode,
      isSkipping,
      nextTrack,
      prevTrack,
      panX,
      CARD_OFFSET,
      toggleLyricsMode,
      closeFullscreenPlayer,
      skipNext,
      gestureSkipPrev,
    ]
  );

  // Gestures: Top grabber handle - Pull down closes modal
  const headerPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 12,
        onMoveShouldSetPanResponderCapture: (_, gesture) => gesture.dy > 12,
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy > 25) {
            closeFullscreenPlayer();
          }
        },
      }),
    [closeFullscreenPlayer]
  );

  const isLyricsModeRef = useRef(isLyricsMode);
  useEffect(() => {
    isLyricsModeRef.current = isLyricsMode;
  }, [isLyricsMode]);

  const globalPanResponder = useMemo(
    () => {
      return PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_, gesture) => {
          if (isLyricsMode || isQueueMode || isSleepTimerMode || isConnectMode) return false;
          // Sadece net aşağı kaydırmalarda aktif ol (diğer gesture'larla çakışmamak için)
          return gesture.dy > 20 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.5;
        },
        onMoveShouldSetPanResponderCapture: (_, gesture) => {
          if (isLyricsMode || isQueueMode || isSleepTimerMode || isConnectMode) return false;
          return gesture.dy > 20 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.5;
        },
        onPanResponderRelease: (_, gesture) => {
          if (isLyricsMode || isQueueMode || isSleepTimerMode || isConnectMode) return;
          if (gesture.dy > 40) {
            closeFullscreenPlayer();
          }
        },
      });
    },
    [closeFullscreenPlayer, isLyricsMode, isQueueMode, isSleepTimerMode, isConnectMode]
  );

  if (!activeTrack) {
    return null;
  }

  return (
    <View
      {...globalPanResponder.panHandlers}
      style={[
        styles.fullscreenContainer,
        {
          paddingTop: Math.max(insets.top, 16),
          paddingBottom: Math.max(insets.bottom, 16),
        },
      ]}>
      {/* Kapak görseli: asıl bulanıklık aşağıdaki GlassBackdrop tarafından
          donanım hızlandırmalı olarak uygulanır (Image blurRadius pahalıydı). */}
      {currentArtworkUri ? (
        <Image
          source={{ uri: currentArtworkUri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={500}
        />
      ) : null}
      {/* Cam katman: kapağı bulanıklaştırıp koyu perdeyle okunabilirlik verir.
          Perde saydam tutulur: oynatıcı "camın arkasındaki kapak" gibi
          görünür, düz siyah bir zemin gibi değil. */}
      <GlassBackdrop intensity={45} overlayColor="rgba(10, 10, 14, 0.58)" />
      {/*
        Kapağın arkasından başlayıp kenarlara doğru azalan bulanıklık: odak
        bölgesinde (kapak/parça bilgisi) en güçlü, dışa doğru yumuşakça söner.
      */}
      <RadialBlurFocus intensity={55} />
      {/* Subtle Ambient Color Glow from Cover Art */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.glowColor, opacity: 0.14 }]} />
      {/*
        Ana oynatıcı alanından dışa yayılan odak: merkezde renk ve ışık
        yoğun, köşelere gidildikçe azalır. Kenarlardaki karartma bilinçli
        olarak düşük tutuldu — önceki hâli ekranın çevresini fazla kapatıyor,
        bulanıklık ekran dışına taşıyormuş gibi görünüyordu.
      */}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            experimental_backgroundImage: `radial-gradient(circle at 50% 42%, ${withAlpha(
              theme.primary,
              0.32
            )} 0%, ${withAlpha(theme.glowColor, 0.16)} 32%, rgba(10, 10, 14, 0.18) 68%, rgba(4, 4, 6, 0.38) 100%)`,
          },
        ]}
      />

      {/* TOP HEADER & GRABBER (Morph animasyonu ile yukarıdan süzülür) */}
      <Animated.View style={headerMorphStyle}>
        {/* Apple Music Style Top Grabber Bar */}
        <View style={styles.topGrabberContainer} {...headerPanResponder.panHandlers}>
          <View style={styles.topGrabberBar} />
        </View>

        {/* Top Header */}
        <View style={styles.topHeader}>
          <TouchableOpacity
            style={styles.headerIconBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            onPress={closeFullscreenPlayer}>
            <Ionicons name="chevron-down" size={26} color="rgba(255, 255, 255, 0.75)" />
          </TouchableOpacity>
          <View style={styles.headerTitleBox}>
            {player.isRemote ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                <View style={styles.remoteHeaderDot} />
                <Text style={styles.headerSmallLabelRemote} numberOfLines={1}>
                  {player.remoteDeviceName || 'Remote Device'}
                </Text>
              </View>
            ) : (
              <Text style={styles.headerSmallLabel}>{t('player.now_playing')}</Text>
            )}
            <Text style={styles.headerAlbumName} numberOfLines={1}>
              {displayArtist}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {/* Hafızadaki Oynatılan Parçayı İndirme Butonu */}
            {isRemoteStream && (
              <TouchableOpacity
                style={styles.headerIconBtn}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                onPress={handleDownloadCurrentTrack}>
                <Ionicons
                  name={
                    isCurrentTrackDownloaded
                      ? 'checkmark-circle'
                      : isCurrentTrackDownloading
                      ? 'cloud-download'
                      : 'arrow-down-circle-outline'
                  }
                  size={24}
                  color={
                    isCurrentTrackDownloaded
                      ? '#10b981'
                      : isCurrentTrackDownloading
                      ? theme.primary
                      : 'rgba(255, 255, 255, 0.85)'
                  }
                />
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.headerIconBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              onPress={() => setIsOptionsModalOpen(true)}>
              <Ionicons name="ellipsis-horizontal-circle" size={24} color="rgba(255, 255, 255, 0.75)" />
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>

      {/* ORTA BÖLÜM: Kapak Fotoğrafı Carousel <---> Senkronize Şarkı Sözleri Değişimi */}
      <Animated.View
        style={[styles.middleContainer, middleMorphStyle]}
        {...artworkPanResponder.panHandlers}>
          {/* 1. Kapak Carousel Görünümü (Apple Music etkileşimli kenar önizlemeli geçiş) */}
          <Animated.View
            style={[styles.coverCenterBox, coverTransitionStyle]}
            pointerEvents={(!isLyricsMode && !isQueueMode && !isSleepTimerMode && !isConnectMode) ? 'auto' : 'none'}>
            {/* Önceki Şarkı Kapağı (Soldan süzülen önizleme) */}
            {prevTrack ? (
              <Animated.View
                style={[styles.neighborArtworkWrapper, prevArtworkTransitionStyle]}
                pointerEvents="none">
                <TrackArtwork
                  uri={prevArtworkUri}
                  trackId={prevTrack.id}
                  trackUri={prevTrack.url}
                  size={ARTWORK_SIZE}
                  borderRadius={18}
                  iconSize={84}
                />
              </Animated.View>
            ) : null}

            {/* Mevcut Şarkı Kapağı (Merkezde, kaydırılan ana kart) */}
            <Animated.View
              style={[styles.artworkWrapper, artworkTransitionStyle]}>
              <View ref={bigCoverRef} collapsable={false}>
                <TouchableOpacity
                  activeOpacity={0.92}
                  onPress={toggleLyricsMode}>
                  <TrackArtwork
                    uri={currentArtworkUri}
                    trackId={activeTrack?.id}
                    trackUri={(activeTrack as any)?.url}
                    size={ARTWORK_SIZE}
                    borderRadius={18}
                    iconSize={84}
                  />
                </TouchableOpacity>
              </View>
            </Animated.View>

            {/* Sonraki Şarkı Kapağı (Sağdan süzülen önizleme) */}
            {nextTrack ? (
              <Animated.View
                style={[styles.neighborArtworkWrapper, nextArtworkTransitionStyle]}
                pointerEvents="none">
                <TrackArtwork
                  uri={nextArtworkUri}
                  trackId={nextTrack.id}
                  trackUri={nextTrack.url}
                  size={ARTWORK_SIZE}
                  borderRadius={18}
                  iconSize={84}
                />
              </Animated.View>
            ) : null}
          </Animated.View>

          {/* 2. Senkronize Şarkı Sözleri Görünümü (Yumuşak solma ve büyüme geçişi) */}
          <Animated.View
            style={[styles.lyricsCardContainer, lyricsCardTransitionStyle]}
            pointerEvents={isLyricsMode ? 'auto' : 'none'}>
            <LyricsPanel
              isFullscreenPlayerOpen={isFullscreenPlayerOpen}
              isLyricsMode={isLyricsMode}
              isRemote={player.isRemote}
              localActiveTrack={localActiveTrack ?? null}
              allAssets={allAssets}
              currentLyrics={currentLyrics}
              parsedLines={parsedLines}
              isLoadingLyrics={isLoadingLyrics}
              activeTrackKey={activeTrack?.id || (activeTrack as any)?.url || null}
              player={player}
              theme={theme}
              t={t}
              onManualSearch={toggleManualSearch}
              isShareSelecting={isShareSelecting}
              selectedShareKeys={selectedShareKeys}
              onStartShareSelect={startShareSelect}
              onToggleShareLine={toggleShareLine}
            />
          </Animated.View>

          {/* 3. Çalma Sırası (Queue) Görünümü (Kapak yerine aynı boyutta yumuşak geçiş) */}
          <Animated.View
            style={[styles.queueCardContainer, queueCardTransitionStyle]}
            pointerEvents={isQueueMode ? 'auto' : 'none'}>
            <View style={styles.queueCardHeader}>
              <View style={[styles.queueSourceBadge, { backgroundColor: theme.surface }]}>
                <Ionicons name="list" size={13} color={theme.primary} style={{ marginRight: 6 }} />
                <Text style={[styles.queueSourceText, { color: theme.textAccent }]}>
                  {t('player.queue_title')}{' '}
                  {(player.isRemote ? (remoteState.queue?.length || 0) : queue.length) > 0
                    ? `(${player.isRemote ? (remoteState.queue?.length || 0) : queue.length})`
                    : ''}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {currentRowIndex >= 0 ? (
                  <TouchableOpacity
                    style={styles.queueLocateBtn}
                    activeOpacity={0.7}
                    onPress={() => {
                      if (currentRowIndex >= 0) {
                        queueListRef.current?.scrollToIndex({
                          index: currentRowIndex,
                          animated: true,
                          viewPosition: 0.15,
                        });
                      }
                    }}>
                    <Ionicons name="locate-outline" size={13} color={theme.primary} style={{ marginRight: 4 }} />
                    <Text style={[styles.queueLocateBtnText, { color: theme.primary }]}>{t('player.go_to_current')}</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  style={styles.queueCardCloseBtn}
                  activeOpacity={0.7}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  onPress={toggleQueueMode}>
                  <Ionicons name="close" size={18} color="rgba(255, 255, 255, 0.7)" />
                </TouchableOpacity>
              </View>
            </View>

            {!player.isRemote ? (
              <View style={styles.queueToolbar}>
                <View style={styles.queueToolbarToggle}>
                  <Ionicons
                    name={autoAddToQueue ? 'sync-outline' : 'pause-circle-outline'}
                    size={14}
                    color={autoAddToQueue ? theme.primary : '#71717a'}
                    style={{ marginRight: 6 }}
                  />
                  <Text style={styles.queueToolbarLabel}>{t('player.auto_add_queue')}</Text>
                  <Switch
                    value={autoAddToQueue}
                    onValueChange={handleToggleAutoAdd}
                    trackColor={{ false: 'rgba(255, 255, 255, 0.16)', true: 'rgba(255, 255, 255, 0.3)' }}
                    thumbColor={autoAddToQueue ? theme.primary : '#9ca3af'}
                    ios_backgroundColor="rgba(255, 255, 255, 0.16)"
                    style={styles.queueToolbarSwitch}
                  />
                </View>
                <TouchableOpacity
                  style={styles.queueClearButton}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={handleClearQueue}>
                  <Ionicons name="trash-outline" size={13} color="#ef4444" style={{ marginRight: 4 }} />
                  <Text style={styles.queueClearButtonText}>{t('player.clear_queue')}</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <FlatList
              ref={queueListRef}
              data={queueRows}
              initialScrollIndex={currentRowIndex >= 0 ? currentRowIndex : undefined}
              extraData={`${isShuffle}-${isSmartShuffle}-${repeatMode}-${queueRevision}-${remoteState.queue?.length}-${player.activeTrack?.id}-${activeTrack?.id ?? localActiveTrack?.id ?? ''}-${Object.keys(metadataMap).length}-${Object.keys(artworkMap).length}`}
              keyExtractor={(row) => row.key}
              renderItem={renderQueueRow}
              contentContainerStyle={styles.queueScrollContent}
              showsVerticalScrollIndicator={false}
              initialNumToRender={16}
              maxToRenderPerBatch={16}
              updateCellsBatchingPeriod={50}
              windowSize={7}
              onScrollToIndexFailed={handleScrollToIndexFailed}
              ListEmptyComponent={
                effectiveQueueSections ? (
                  <View style={{ paddingVertical: 32, alignItems: 'center' }}>
                    <Text style={{ color: '#71717a', fontSize: 14 }}>{t('player.queue_empty')}</Text>
                  </View>
                ) : (
                  <ActivityIndicator size="small" color={theme.primary} style={{ marginTop: 24 }} />
                )
              }
            />
          </Animated.View>

          {/* 4. Uyku Zamanlayıcısı Görünümü (Kapak yerine aynı boyutta yumuşak geçiş) */}
          <Animated.View
            style={[styles.sleepTimerCardContainer, sleepTimerCardTransitionStyle]}
            pointerEvents={isSleepTimerMode ? 'auto' : 'none'}>
            <View style={styles.queueCardHeader}>
              <View style={[styles.queueSourceBadge, { backgroundColor: theme.surface }]}>
                <Ionicons name="moon" size={13} color={theme.primary} style={{ marginRight: 6 }} />
                <Text style={[styles.queueSourceText, { color: theme.textAccent }]}>
                  {t('player.sleep_timer')}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.queueCardCloseBtn}
                activeOpacity={0.7}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                onPress={toggleSleepTimerMode}>
                <Ionicons name="close" size={18} color="rgba(255, 255, 255, 0.7)" />
              </TouchableOpacity>
            </View>

            <View style={styles.sleepTimerBody}>
              {/* Aktif Zamanlayıcı Kompakt Bilgi Çubuğu */}
              {isSleepTimerActive ? (
                <View
                  style={[
                    styles.sleepTimerActiveBar,
                    { backgroundColor: theme.surface, borderColor: `${theme.primary}40` },
                  ]}>
                  <View style={styles.sleepTimerActiveBarLeft}>
                    <View
                      style={[
                        styles.sleepTimerIconBubble,
                        { backgroundColor: `${theme.primary}25` },
                      ]}>
                      <Ionicons name="moon" size={17} color={theme.primary} />
                    </View>
                    <View style={{ marginLeft: 10 }}>
                      <Text style={[styles.sleepTimerActiveBarTitle, { color: theme.textAccent }]}>
                        {t('player.remaining_time')}
                      </Text>
                      <Text style={[styles.sleepTimerActiveBarRemaining, { color: theme.primary }]}>
                        {sleepTimerRemaining || t('player.calculating')}
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={styles.stopTimerPillBtn}
                    activeOpacity={0.75}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    onPress={stopTimer}>
                    <Ionicons name="close-circle" size={16} color="#ef4444" style={{ marginRight: 5 }} />
                    <Text style={styles.stopTimerPillBtnText}>{t('player.cancel_timer')}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              <Text style={[styles.sleepTimerSectionLabel, { color: theme.textAccent }]}>
                {isSleepTimerActive ? t('player.change_duration') : t('player.select_sleep_duration')}
              </Text>

              {/* Hızlı Seçenekler Grid (15, 30, 45, 60 dk) */}
              <View style={styles.timerOptionsGrid}>
                {([15, 30, 45, 60] as const).map((min) => {
                  const isSelected = isSleepTimerActive && sleepTimerDurationOption === min;
                  return (
                    <TouchableOpacity
                      key={min}
                      style={[
                        styles.timerOptionBtn,
                        { backgroundColor: theme.surface },
                        isSelected && {
                          borderColor: theme.primary,
                          borderWidth: 1.5,
                          backgroundColor: `${theme.primary}20`,
                        },
                      ]}
                      activeOpacity={0.75}
                      onPress={() => startTimer(min, min)}>
                      <Text
                        style={[
                          styles.timerOptionText,
                          isSelected && { color: theme.primary, fontWeight: '700' },
                        ]}>
                        {min} {t('player.minutes')}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Şarkı Bitince Durdur */}
              <TouchableOpacity
                style={[
                  styles.timerFullWidthBtn,
                  { backgroundColor: theme.surface },
                  isSleepTimerActive && sleepTimerDurationOption === 'track' && {
                    borderColor: theme.primary,
                    borderWidth: 1.5,
                    backgroundColor: `${theme.primary}20`,
                  },
                ]}
                activeOpacity={0.75}
                onPress={startTrackTimer}>
                <Ionicons
                  name="musical-note"
                  size={18}
                  color={
                    isSleepTimerActive && sleepTimerDurationOption === 'track'
                      ? theme.primary
                      : '#ffffff'
                  }
                  style={{ marginRight: 8 }}
                />
                <Text
                  style={[
                    styles.timerOptionText,
                    isSleepTimerActive && sleepTimerDurationOption === 'track' && {
                      color: theme.primary,
                      fontWeight: '700',
                    },
                  ]}>
                  {t('player.stop_after_track')}
                </Text>
              </TouchableOpacity>

              <View style={styles.customTimerRow}>
                <TextInput
                  style={[styles.customTimerInput, { backgroundColor: theme.surface }]}
                  placeholder={t('player.custom_minutes_placeholder')}
                  placeholderTextColor="#71717a"
                  keyboardType="numeric"
                  value={customTimerMinutes}
                  onChangeText={setCustomTimerMinutes}
                />
                <TouchableOpacity
                  style={[
                    styles.customTimerBtn,
                    { backgroundColor: customTimerMinutes.trim() ? theme.primary : '#27272a' },
                  ]}
                  activeOpacity={0.8}
                  disabled={!customTimerMinutes.trim()}
                  onPress={() => {
                    const mins = parseInt(customTimerMinutes, 10);
                    if (!isNaN(mins) && mins > 0) {
                      startTimer(mins, 'custom');
                      setCustomTimerMinutes('');
                    }
                  }}>
                  <Text
                    style={[
                      styles.customTimerBtnText,
                      { color: customTimerMinutes.trim() ? '#ffffff' : '#71717a' },
                    ]}>
                    {t('player.start')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </Animated.View>

          {/* 5. RunMusic Connect Görünümü (Kapak yerine aynı boyutta yumuşak geçiş) */}
          <Animated.View
            style={[styles.connectCardContainer, connectCardTransitionStyle]}
            pointerEvents={isConnectMode ? 'auto' : 'none'}>
            <View style={styles.queueCardHeader}>
              <View style={[styles.queueSourceBadge, { backgroundColor: theme.surface }]}>
                <Ionicons name="radio" size={13} color={theme.primary} style={{ marginRight: 6 }} />
                <Text style={[styles.queueSourceText, { color: theme.textAccent }]}>
                  RunMusic Connecto
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <TouchableOpacity
                  style={[
                    styles.lyricsActionBtn,
                    { backgroundColor: theme.surface },
                    !isRemoteServiceEnabled && { backgroundColor: 'rgba(239, 68, 68, 0.18)' },
                  ]}
                  activeOpacity={0.7}
                  onPress={() => setRemoteServiceEnabled(!isRemoteServiceEnabled)}
                  hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
                  <Ionicons
                    name={isRemoteServiceEnabled ? 'power' : 'power-outline'}
                    size={12}
                    color={isRemoteServiceEnabled ? theme.primary : '#ef4444'}
                  />
                  <Text
                    style={[
                      styles.lyricsActionBtnText,
                      { color: isRemoteServiceEnabled ? theme.primary : '#ef4444' },
                    ]}>
                    {isRemoteServiceEnabled ? t('common.enabled') : t('common.disabled')}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.queueCardCloseBtn}
                  activeOpacity={0.7}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  onPress={toggleConnectMode}>
                  <Ionicons name="close" size={18} color="rgba(255, 255, 255, 0.7)" />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.connectBody}>
              {/* Segment Kontrolü: Wi-Fi | Bluetooth | İnternet */}
              <View style={[styles.connectSegmentContainer, { backgroundColor: theme.surface }]}>
                <TouchableOpacity
                  style={[
                    styles.connectSegmentTab,
                    activeTransportTab === 'wifi' && {
                      backgroundColor: theme.primary,
                    },
                  ]}
                  activeOpacity={0.8}
                  onPress={() => setActiveTransportTab('wifi')}>
                  <Ionicons
                    name="wifi-outline"
                    size={14}
                    color={activeTransportTab === 'wifi' ? '#ffffff' : 'rgba(255, 255, 255, 0.6)'}
                    style={{ marginRight: 6 }}
                  />
                  <Text
                    style={[
                      styles.connectSegmentText,
                      activeTransportTab === 'wifi' && { color: '#ffffff', fontWeight: '700' },
                    ]}>
                    Wi-Fi
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.connectSegmentTab,
                    activeTransportTab === 'ble' && {
                      backgroundColor: theme.primary,
                    },
                  ]}
                  activeOpacity={0.8}
                  onPress={() => setActiveTransportTab('ble')}>
                  <Ionicons
                    name="bluetooth-outline"
                    size={14}
                    color={activeTransportTab === 'ble' ? '#ffffff' : 'rgba(255, 255, 255, 0.6)'}
                    style={{ marginRight: 6 }}
                  />
                  <Text
                    style={[
                      styles.connectSegmentText,
                      activeTransportTab === 'ble' && { color: '#ffffff', fontWeight: '700' },
                    ]}>
                    Bluetooth
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.connectSegmentTab,
                    activeTransportTab === 'internet' && {
                      backgroundColor: theme.primary,
                    },
                  ]}
                  activeOpacity={0.8}
                  onPress={() => setActiveTransportTab('internet')}>
                  <Ionicons
                    name="globe-outline"
                    size={14}
                    color={activeTransportTab === 'internet' ? '#ffffff' : 'rgba(255, 255, 255, 0.6)'}
                    style={{ marginRight: 6 }}
                  />
                  <Text
                    style={[
                      styles.connectSegmentText,
                      activeTransportTab === 'internet' && { color: '#ffffff', fontWeight: '700' },
                    ]}>
                    {t('remote.internet')}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Bu Telefon (Yerel Cihaz) */}
              <TouchableOpacity
                style={[
                  styles.connectDeviceItem,
                  { backgroundColor: theme.surface },
                  !player.isRemote && {
                    borderColor: theme.primary,
                    borderWidth: 1.5,
                  },
                ]}
                activeOpacity={0.75}
                onPress={handleSelectLocalDevice}>
                <View
                  style={[
                    styles.connectDeviceIcon,
                    {
                      backgroundColor: !player.isRemote ? `${theme.primary}25` : 'rgba(255, 255, 255, 0.06)',
                    },
                  ]}>
                  <Ionicons
                    name="phone-portrait-outline"
                    size={20}
                    color={!player.isRemote ? theme.primary : 'rgba(255, 255, 255, 0.7)'}
                  />
                </View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={[styles.connectDeviceName, !player.isRemote && { color: theme.primary, fontWeight: '700' }]}>
                    {t('remote.this_device')}
                  </Text>
                  <Text style={styles.connectDeviceSubtext}>
                    {!player.isRemote ? t('remote.currently_playing') : t('remote.switch_to_local')}
                  </Text>
                </View>
                {!player.isRemote ? (
                  <Ionicons name="checkmark-circle" size={20} color={theme.primary} />
                ) : null}
              </TouchableOpacity>

              {/* Bağlı İstemci Cihazlar (Host Modunda) */}
              {connectedClients.length > 0 && (
                <View style={{ marginBottom: 10 }}>
                  <View style={styles.connectSectionHeader}>
                    <Text style={[styles.connectSectionLabel, { color: theme.primary, fontWeight: '700' }]}>
                      {`${t('remote.connected_devices_title')} (${connectedClients.length})`}
                    </Text>
                  </View>
                  {connectedClients.map((client) => (
                    <View
                      key={client.id}
                      style={[
                        styles.connectDeviceItem,
                        { backgroundColor: theme.surface, borderColor: `${theme.primary}55`, borderWidth: 1 },
                      ]}>
                      <View
                        style={[
                          styles.connectDeviceIcon,
                          { backgroundColor: `${theme.primary}25` },
                        ]}>
                        <Ionicons
                          name={client.transport === 'ble' ? 'bluetooth' : client.transport === 'internet' ? 'globe' : 'phone-portrait'}
                          size={18}
                          color={theme.primary}
                        />
                      </View>
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={[styles.connectDeviceName, { color: '#ffffff', fontWeight: '700' }]} numberOfLines={1}>
                          {client.deviceName}
                        </Text>
                        <Text style={[styles.connectDeviceSubtext, { color: theme.primary }]}>
                          {`${client.transport === 'ble' ? t('remote.ble_remote') : client.transport === 'internet' ? t('remote.internet_remote') : t('remote.wifi_remote')} • ${t('remote.status_connected')}`}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={styles.connectKickBtn}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        onPress={() => remoteSyncManager.disconnectConnectedClient(client.id)}>
                        <Ionicons name="close-circle-outline" size={22} color="#ef4444" />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}

              {/* İNTERNET MODU UI */}
              {activeTransportTab === 'internet' ? (
                <ScrollView
                  style={{ flex: 1 }}
                  contentContainerStyle={{ paddingBottom: 24 }}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled">
                  {/* Client Mode: Bağlı Kumanda Durum Kartı */}
                  {remoteMode === 'client' ? (
                    <View style={[styles.connectRoomCard, { backgroundColor: theme.surface }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={[styles.connectSectionLabel, { color: theme.textAccent, marginBottom: 0 }]}>
                          {t('remote.connected_remote')}
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                          <View
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: 4,
                              backgroundColor:
                                remoteConnectionStatus === 'connected'
                                  ? '#22c55e'
                                  : remoteConnectionStatus === 'connecting'
                                  ? '#f59e0b'
                                  : '#ef4444',
                            }}
                          />
                          <Text
                            style={{
                              fontSize: 11,
                              color:
                                remoteConnectionStatus === 'connected'
                                  ? '#22c55e'
                                  : remoteConnectionStatus === 'connecting'
                                  ? '#f59e0b'
                                  : '#ef4444',
                              fontWeight: '600',
                            }}>
                            {remoteConnectionStatus === 'connected'
                              ? t('remote.status_connected')
                              : remoteConnectionStatus === 'connecting'
                              ? t('remote.status_connecting')
                              : t('remote.status_error')}
                          </Text>
                        </View>
                      </View>

                      <Text style={[styles.connectRoomCodeBadge, { color: theme.primary, fontSize: 24, marginVertical: 8 }]}>
                        {connectedDeviceName || t('remote.remote_device')}
                      </Text>

                      {remoteConnectionStatus === 'error' && (
                        <Text style={{ color: '#ef4444', fontSize: 13, marginBottom: 12, textAlign: 'center', fontWeight: '500' }}>
                          {errorMessage || t('remote.room_not_found')}
                        </Text>
                      )}

                      <View style={styles.connectRoomActionsRow}>
                        {remoteConnectionStatus === 'error' && (
                          <TouchableOpacity
                            style={[styles.connectRoomBtn, { backgroundColor: `${theme.primary}35` }]}
                            activeOpacity={0.75}
                            onPress={() => {
                              const codeToRetry = inputRoomCode.trim().replace(/^RUN-/, '') || (connectedDeviceName?.replace('Oda: ', '').replace(/^RUN-/, '') || '');
                              if (codeToRetry) {
                                remoteSyncManager.connectToInternetRoom(codeToRetry).catch(() => {});
                              }
                            }}>
                            <Ionicons name="refresh-outline" size={16} color={theme.primary} />
                            <Text style={{ color: theme.primary, fontWeight: '700', fontSize: 12 }}>{t('common.retry')}</Text>
                          </TouchableOpacity>
                        )}

                        <TouchableOpacity
                          style={[styles.connectRoomBtn, { backgroundColor: 'rgba(239, 68, 68, 0.2)' }]}
                          activeOpacity={0.75}
                          onPress={() => {
                            remoteSyncManager.disconnectClient();
                          }}>
                          <Ionicons name="close-circle-outline" size={16} color="#ef4444" />
                          <Text style={{ color: '#ef4444', fontWeight: '700', fontSize: 12 }}>{t('remote.disconnect')}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    /* Host Section: Oda Kodu Kartı (Servis Açıksa) */
                    isRemoteServiceEnabled && (
                      <View style={[styles.connectRoomCard, { backgroundColor: theme.surface }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Text style={[styles.connectSectionLabel, { color: theme.textAccent, marginBottom: 0 }]}>
                            {t('remote.my_room_code')}
                          </Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                            <View
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: 4,
                                backgroundColor:
                                  internetHostStatus === 'connected'
                                    ? '#22c55e'
                                    : internetHostStatus === 'connecting'
                                    ? '#f59e0b'
                                    : '#ef4444',
                              }}
                            />
                            <Text
                              style={{
                                fontSize: 11,
                                color:
                                  internetHostStatus === 'connected'
                                    ? '#22c55e'
                                    : internetHostStatus === 'connecting'
                                    ? '#f59e0b'
                                    : '#ef4444',
                                fontWeight: '600',
                              }}>
                              {internetHostStatus === 'connected'
                                ? t('remote.status_live')
                                : internetHostStatus === 'connecting'
                                ? t('remote.status_connecting')
                                : t('remote.status_offline')}
                            </Text>
                          </View>
                        </View>

                        <Text style={[styles.connectRoomCodeBadge, { color: theme.primary }]}>
                          {internetRoomCode ? internetRoomCode.replace(/^RUN-/, '') : t('remote.starting_room')}
                        </Text>

                        {internetHostStatus !== 'connected' && (
                          <View style={styles.connectRoomActionsRow}>
                            <TouchableOpacity
                              style={[styles.connectRoomBtn, { backgroundColor: `${theme.primary}35` }]}
                              activeOpacity={0.75}
                              onPress={() => {
                                remoteSyncManager.startInternetHostRoom().catch(() => {});
                              }}>
                              <Ionicons name="link-outline" size={16} color={theme.primary} />
                              <Text style={{ color: theme.primary, fontWeight: '700', fontSize: 12 }}>{t('remote.reconnect')}</Text>
                            </TouchableOpacity>
                          </View>
                        )}

                        <Text style={[styles.connectEmptySubtext, { marginTop: 8, textAlign: 'center' }]}>
                          {t('remote.room_hint')}
                        </Text>
                      </View>
                    )
                  )}

                  {/* Client Section: Bir Odaya Bağlan */}
                  <View style={[styles.connectRoomCard, { backgroundColor: theme.surface }]}>
                    <Text style={[styles.connectSectionLabel, { color: theme.textAccent, marginBottom: 6 }]}>
                      {t('remote.join_room_title')}
                    </Text>

                    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                      <TextInput
                        style={[
                          styles.connectInput,
                          {
                            flex: 1,
                            textTransform: 'uppercase',
                            letterSpacing: 2,
                            fontWeight: '700',
                          },
                        ]}
                        placeholder="8284"
                        placeholderTextColor="#71717a"
                        keyboardType="number-pad"
                        maxLength={8}
                        value={inputRoomCode}
                        onChangeText={(t) => setInputRoomCode(t.toUpperCase().replace(/^RUN-/, ''))}
                      />
                      <TouchableOpacity
                        style={[
                          styles.connectRoomBtn,
                          {
                            backgroundColor: inputRoomCode.trim().length > 0 ? theme.primary : '#3f3f46',
                            paddingHorizontal: 16,
                            flex: 0,
                          },
                        ]}
                        activeOpacity={0.8}
                        disabled={
                          inputRoomCode.trim().length === 0 ||
                          (remoteMode === 'client' && remoteConnectionStatus === 'connecting')
                        }
                        onPress={() => {
                          const cleanCode = inputRoomCode.trim().replace(/^RUN-/, '');
                          if (cleanCode) {
                            remoteSyncManager.connectToInternetRoom(cleanCode).catch(() => {});
                          }
                        }}>
                        <Ionicons name="arrow-forward" size={16} color="#ffffff" />
                        <Text style={{ color: '#ffffff', fontWeight: '700', fontSize: 13 }}>
                          {remoteMode === 'client' && remoteConnectionStatus === 'connecting'
                            ? t('remote.status_connecting')
                            : t('remote.connect')}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </ScrollView>
              ) : (
                <>
                  {/* Bölüm Başlığı (Wi-Fi & Bluetooth) */}
                  <View style={styles.connectSectionHeader}>
                    <Text style={[styles.connectSectionLabel, { color: theme.textAccent }]}>
                      {activeTransportTab === 'ble'
                        ? t('remote.nearby_ble_devices')
                        : t('remote.same_wifi_devices')}
                    </Text>
                  </View>

                  {/* Cihazlar Listesi */}
                  <FlatList
                    data={
                      activeTransportTab === 'ble'
                        ? (discoveredBlePeers as any)
                        : (discoveredHosts as any)
                    }
                    keyExtractor={(item) => item.id || item.deviceId}
                    style={styles.connectList}
                    showsVerticalScrollIndicator={false}
                    ListEmptyComponent={
                      <View style={styles.connectEmptyContainer}>
                        <ActivityIndicator size="small" color={theme.primary} style={{ marginBottom: 6 }} />
                        <Text style={styles.connectEmptyTitle}>
                          {activeTransportTab === 'ble'
                            ? t('remote.searching_ble')
                            : t('remote.searching_devices')}
                        </Text>
                        <Text style={styles.connectEmptySubtext}>
                          {activeTransportTab === 'ble'
                            ? t('remote.ble_hint')
                            : t('remote.wifi_hint')}
                        </Text>
                      </View>
                    }
                    renderItem={({ item }) => {
                      const isThisConnected =
                        player.isRemote && connectedDeviceName === item.deviceName;
                      const isConnecting =
                        remoteMode === 'client' &&
                        (remoteConnectionStatus === 'connecting' || remoteConnectionStatus === 'pairing') &&
                        connectedDeviceName === item.deviceName;

                      return (
                        <TouchableOpacity
                          style={[
                            styles.connectDeviceItem,
                            { backgroundColor: theme.surface },
                            isThisConnected && {
                              borderColor: theme.primary,
                              borderWidth: 1.5,
                            },
                          ]}
                          activeOpacity={0.75}
                          onPress={() => handleSelectRemoteHost(item)}>
                          <View
                            style={[
                              styles.connectDeviceIcon,
                              {
                                backgroundColor: isThisConnected
                                  ? `${theme.primary}25`
                                  : 'rgba(255, 255, 255, 0.06)',
                              },
                            ]}>
                            <Ionicons
                              name={
                                item.transport === 'ble' || activeTransportTab === 'ble'
                                  ? 'bluetooth-outline'
                                  : 'laptop-outline'
                              }
                              size={20}
                              color={isThisConnected ? theme.primary : 'rgba(255, 255, 255, 0.7)'}
                            />
                          </View>
                          <View style={{ flex: 1, marginLeft: 10 }}>
                            <Text
                              style={[
                                styles.connectDeviceName,
                                isThisConnected && { color: theme.primary, fontWeight: '700' },
                              ]}
                              numberOfLines={1}>
                              {item.deviceName}
                            </Text>
                            <Text style={styles.connectDeviceSubtext}>
                              {isThisConnected
                                ? t('remote.status_connected')
                                : isConnecting
                                  ? t('remote.status_connecting')
                                  : item.transport === 'ble' || activeTransportTab === 'ble'
                                    ? t('remote.ble_subtext')
                                    : `${item.hostIp}:${item.port}`}
                            </Text>
                          </View>
                          {isConnecting ? (
                            <ActivityIndicator size="small" color={theme.primary} />
                          ) : isThisConnected ? (
                            <Ionicons name="checkmark-circle" size={20} color={theme.primary} />
                          ) : (
                            <Ionicons name="chevron-forward" size={18} color="rgba(255, 255, 255, 0.4)" />
                          )}
                        </TouchableOpacity>
                      );
                    }}
                  />

                  {/* Manuel IP Toggle / Giriş (Sadece Wi-Fi modunda gösterilir) */}
                  {isRemoteServiceEnabled && activeTransportTab === 'wifi' && (
                    showManualIp ? (
                      <View style={[styles.connectManualBox, { backgroundColor: theme.surface }]}>
                        <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
                          <TextInput
                            style={[styles.connectInput, { flex: 2 }]}
                            placeholder={t('remote.ip_placeholder')}
                            placeholderTextColor="#71717a"
                            keyboardType="numbers-and-punctuation"
                            value={manualIp}
                            onChangeText={setManualIp}
                            autoCapitalize="none"
                          />
                          <TextInput
                            style={[styles.connectInput, { flex: 1 }]}
                            placeholder={t('remote.port_placeholder')}
                            placeholderTextColor="#71717a"
                            keyboardType="numeric"
                            value={manualPort}
                            onChangeText={setManualPort}
                          />
                        </View>
                        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
                          <TouchableOpacity
                            style={styles.connectCancelBtn}
                            onPress={() => setShowManualIp(false)}>
                            <Text style={styles.connectCancelText}>{t('common.cancel')}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.connectSubmitBtn, { backgroundColor: theme.primary }]}
                            onPress={handleManualConnect}
                            disabled={!manualIp.trim()}>
                            <Text style={styles.connectSubmitText}>{t('remote.connect')}</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={styles.connectManualToggle}
                        onPress={() => setShowManualIp(true)}>
                        <Ionicons name="add-circle-outline" size={16} color={theme.primary} style={{ marginRight: 6 }} />
                        <Text style={[styles.connectManualToggleText, { color: theme.primary }]}>
                          {t('remote.manual_ip')}
                        </Text>
                      </TouchableOpacity>
                    )
                  )}
                </>
              )}
            </View>
          </Animated.View>
        </Animated.View>

        {/* ALT BÖLÜM: Apple Music Şarkı Bilgileri, Scrubber ve Kontroller */}
        <Animated.View style={[styles.bottomSection, bottomMorphStyle]}>
          {/* Şarkı Başlığı & Sanatçı */}
          <Animated.View style={[styles.metaRow, metaMorphStyle]}>
            <View style={{ flex: 1, marginRight: 14 }}>
              <MarqueeText text={displayTitle || ''} style={styles.trackTitle} />
              <ArtistLinks
                artist={displayArtist || ''}
                style={styles.trackArtist}
                onOpenArtist={openArtistProfile}
              />
            </View>

            {/* Sözler, Çalma Sırası veya Uyku Zamanlayıcısı Modundayken Sağ Tarafa Animasyonla Yerleşen Küçük Kapak */}
            <View
              ref={miniCoverRef}
              collapsable={false}
              onLayout={handleCoverLayout}>
              <Animated.View
                style={miniCoverTransitionStyle}
                pointerEvents={(!isLyricsMode && !isQueueMode && !isSleepTimerMode && !isConnectMode) ? 'none' : 'auto'}>
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => {
                    if (isConnectMode) toggleConnectMode();
                    if (isSleepTimerMode) toggleSleepTimerMode();
                    if (isQueueMode) toggleQueueMode();
                    if (isLyricsMode) toggleLyricsMode();
                  }}
                  style={styles.lyricsMiniCoverBtn}>
                  <TrackArtwork
                    uri={currentArtworkUri}
                    trackId={activeTrack?.id}
                    trackUri={(activeTrack as any)?.url}
                    size={MINI_COVER_SIZE}
                    borderRadius={10}
                    iconSize={26}
                  />
                </TouchableOpacity>
              </Animated.View>
            </View>
          </Animated.View>

          {isShareSelecting ? (
            <View style={styles.shareSelectBar}>
              <View style={styles.shareSelectInfo}>
                <Text numberOfLines={2} style={styles.shareSelectTitle}>
                  {t('player.share_lyrics_hint')}
                </Text>
                <Text style={[styles.shareSelectCount, { color: theme.primary }]}>
                  {selectedShareKeys.length}/{MAX_SHARE_LINES}
                </Text>
              </View>
              {shareLimitHit ? (
                <Text style={styles.shareSelectLimit}>
                  {t('player.share_lyrics_limit', { count: MAX_SHARE_LINES })}
                </Text>
              ) : null}
              <View style={styles.shareSelectActions}>
                <TouchableOpacity
                  activeOpacity={0.75}
                  onPress={cancelShareSelect}
                  style={styles.shareSelectCancel}>
                  <Text style={styles.shareSelectCancelText}>
                    {t('player.share_select_cancel')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.85}
                  disabled={selectedShareKeys.length === 0}
                  onPress={openSharePreview}
                  style={[
                    styles.shareSelectDone,
                    { backgroundColor: theme.primary },
                    selectedShareKeys.length === 0 && styles.shareSelectDoneDisabled,
                  ]}>
                  <Text style={styles.shareSelectDoneText}>
                    {t('player.share_select_done')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <>
              {/* İlerleme Çubuğu (Apple Music Scrubber) */}
              <PlayerScrubber
                active={isFullscreenPlayerOpen}
                player={player}
                theme={theme}
              />

          {/* Oynatma Kontrolleri (Apple Music Minimalist Glyphs) */}
          <View style={styles.controlsRow}>
            <TouchableOpacity
              style={styles.appleNavBtn}
              onPress={skipPrev}
              onLongPress={handleSeekBackward}
              hitSlop={{ top: 18, bottom: 18, left: 16, right: 16 }}
              activeOpacity={0.65}>
              <Ionicons name="play-skip-back" size={38} color="#ffffff" />
            </TouchableOpacity>

            <Animated.View style={{ transform: [{ scale: playBtnScale }] }}>
              <TouchableOpacity
                style={styles.applePlayBtn}
                activeOpacity={0.85}
                onPressIn={handlePlayPressIn}
                onPressOut={handlePlayPressOut}
                hitSlop={{ top: 18, bottom: 18, left: 18, right: 18 }}
                onPress={togglePlayback}>
                <Ionicons
                  name={playing ? 'pause' : 'play'}
                  size={52}
                  color="#ffffff"
                  style={!playing ? { marginLeft: 4 } : undefined}
                />
              </TouchableOpacity>
            </Animated.View>

            <TouchableOpacity
              style={styles.appleNavBtn}
              onPress={skipNext}
              onLongPress={handleSeekForward}
              hitSlop={{ top: 18, bottom: 18, left: 16, right: 16 }}
              activeOpacity={0.65}>
              <Ionicons name="play-skip-forward" size={38} color="#ffffff" />
            </TouchableOpacity>
          </View>

          {/* Apple Music Alt Araç Çubuğu (Lyrics | Shuffle/Repeat | Queue) */}
          <View style={styles.appleBottomRow}>
            {/* Şarkı Sözleri Butonu */}
            <TouchableOpacity
              style={[
                styles.appleUtilBtn,
                isLyricsMode && styles.appleUtilBtnActive,
              ]}
              activeOpacity={0.7}
              hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
              onPress={toggleLyricsMode}>
              <Ionicons
                name="chatbubble-ellipses"
                size={22}
                color={isLyricsMode ? theme.primary : 'rgba(255, 255, 255, 0.55)'}
              />
            </TouchableOpacity>

            {/* Orta: Karışık ve Tekrar Kontrolleri (Tek Buton) + Uyku Zamanlayıcısı */}
            <View style={styles.appleCenterUtilRow}>
              <TouchableOpacity
                style={[
                  styles.appleSubUtilBtn,
                  isPlaybackModeActive && styles.appleSubUtilBtnActive,
                ]}
                onPress={togglePlaybackMode}
                accessibilityRole="button"
                accessibilityLabel={playbackModeLabel}
                accessibilityHint={t('player.playback_mode_hint')}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                {playbackMode === 'repeat-one' ? (
                  <MaterialCommunityIcons
                    name="repeat-once"
                    size={20}
                    color={isPlaybackModeActive ? theme.primary : 'rgba(255, 255, 255, 0.55)'}
                  />
                ) : (
                  <Ionicons
                    name={
                      playbackMode === 'smart'
                        ? 'sparkles'
                        : playbackMode === 'shuffle'
                          ? 'shuffle'
                          : 'repeat'
                    }
                    size={20}
                    color={isPlaybackModeActive ? theme.primary : 'rgba(255, 255, 255, 0.55)'}
                  />
                )}
              </TouchableOpacity>

              {/* RunMusic Connecto Butonu (Shuffle ile Sleep Timer arasında) */}
              <TouchableOpacity
                style={[
                  styles.appleSubUtilBtn,
                  (isConnectMode || isRemoteServiceEnabled || player.isRemote) &&
                    styles.appleSubUtilBtnActive,
                ]}
                onPress={toggleConnectMode}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                {remoteMode !== 'client' && connectedClients.length > 0 && (
                  <View style={styles.connectClientsBadgeWrapper} pointerEvents="none">
                    <View style={[styles.connectClientsBadge, { backgroundColor: theme.primary }]}>
                      <Text style={styles.connectClientsBadgeText}>
                        {connectedClients.length}
                      </Text>
                    </View>
                  </View>
                )}
                <Ionicons
                  name={isRemoteServiceEnabled || player.isRemote ? 'radio' : 'radio-outline'}
                  size={20}
                  color={
                    isRemoteServiceEnabled || player.isRemote
                      ? theme.primary
                      : isConnectMode
                        ? '#ffffff'
                        : 'rgba(255, 255, 255, 0.45)'
                  }
                />
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.appleSubUtilBtn,
                  (isSleepTimerMode || isSleepTimerActive) && styles.appleSubUtilBtnActive,
                ]}
                onPress={toggleSleepTimerMode}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons
                  name={isSleepTimerActive ? 'moon' : 'moon-outline'}
                  size={20}
                  color={
                    isSleepTimerActive
                      ? theme.primary
                      : isSleepTimerMode
                        ? '#ffffff'
                        : 'rgba(255, 255, 255, 0.5)'
                  }
                />
              </TouchableOpacity>
            </View>

            {/* Çalma Sırası Butonu */}
            <TouchableOpacity
              style={[
                styles.appleUtilBtn,
                isQueueMode && styles.appleUtilBtnActive,
              ]}
              activeOpacity={0.7}
              hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
              onPress={toggleQueueMode}>
              <Ionicons
                name="list"
                size={22}
                color={isQueueMode ? theme.primary : 'rgba(255, 255, 255, 0.55)'}
              />
            </TouchableOpacity>
          </View>
            </>
          )}
        </Animated.View>

        {/* Manuel Söz Arama Modalı */}
        <Modal
          visible={isManualSearchOpen}
          animationType="fade"
          transparent
          onRequestClose={() => setIsManualSearchOpen(false)}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setIsManualSearchOpen(false)}
            {...searchModalPanResponder.panHandlers}>
            <Pressable style={styles.searchModalBox} onPress={(e) => e.stopPropagation()}>
              <View style={styles.searchModalHeader}>
                <Text style={styles.searchModalTitle}>{t('player.search_lyrics_modal_title')}</Text>
                <TouchableOpacity onPress={() => setIsManualSearchOpen(false)}>
                  <Ionicons name="close" size={22} color="#a1a1aa" />
                </TouchableOpacity>
              </View>

              {!isOnline || isCachedSearch ? (
                <View
                  style={[
                    styles.offlineSearchBanner,
                    { borderColor: '#f59e0b55', backgroundColor: '#f59e0b1a' },
                  ]}>
                  <Ionicons name="cloud-offline-outline" size={15} color="#f59e0b" />
                  <Text style={styles.offlineSearchBannerText}>
                    {isOnline
                      ? t('player.cached_search_banner')
                      : t('player.offline_search_banner')}
                  </Text>
                </View>
              ) : null}

              <View style={styles.searchModalInputRow}>
                <TextInput
                  style={styles.searchModalInput}
                  placeholder={t('player.search_lyrics_placeholder')}
                  placeholderTextColor="#71717a"
                  value={manualQuery}
                  onChangeText={setManualQuery}
                  onSubmitEditing={handleManualSearch}
                  returnKeyType="search"
                  autoFocus
                />
                <TouchableOpacity
                  style={[styles.searchModalSubmitBtn, { backgroundColor: theme.primary }]}
                  onPress={handleManualSearch}
                  disabled={isSearchingCandidates}>
                  {isSearchingCandidates ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Ionicons name="search" size={18} color="#ffffff" />
                  )}
                </TouchableOpacity>
              </View>

              <View style={styles.candidateFilterRow}>
                {(
                  [
                    { key: 'all' as const, label: t('player.filter_all') },
                    { key: 'lrc.red' as const, label: 'lrc.red' },
                    { key: 'lrclib' as const, label: 'LRCLIB' },
                    { key: 'genius' as const, label: 'Genius' },
                  ] as { key: CandidateFilter; label: string }[]
                ).map((chip) => {
                  const active = candidateFilter === chip.key;
                  const empty = chip.key !== 'all' && candidateCounts[chip.key] === 0;
                  return (
                    <TouchableOpacity
                      key={chip.key}
                      activeOpacity={0.7}
                      disabled={empty && !active}
                      onPress={() => setCandidateFilter(chip.key)}
                      style={[
                        styles.candidateFilterChip,
                        active && { backgroundColor: theme.primary, borderColor: theme.primary },
                        empty && !active && styles.candidateFilterChipEmpty,
                      ]}>
                      <Text
                        style={[
                          styles.candidateFilterChipText,
                          active && styles.candidateFilterChipTextActive,
                        ]}>
                        {chip.label}
                        {candidateCounts[chip.key] > 0 ? ` ${candidateCounts[chip.key]}` : ''}
                      </Text>
                    </TouchableOpacity>
                  );
                })}

                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => setSyncedOnly((prev) => !prev)}
                  style={[
                    styles.candidateFilterChip,
                    syncedOnly && { backgroundColor: '#10b981', borderColor: '#10b981' },
                  ]}>
                  <Ionicons
                    name={syncedOnly ? 'checkmark-circle' : 'ellipse-outline'}
                    size={11}
                    color={syncedOnly ? '#ffffff' : '#a1a1aa'}
                    style={{ marginRight: 4 }}
                  />
                  <Text
                    style={[
                      styles.candidateFilterChipText,
                      syncedOnly && styles.candidateFilterChipTextActive,
                    ]}>
                    {t('player.filter_synced_only')}
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.candidatesSectionTitle}>{t('player.search_results_title')}</Text>

              {candidatesList.length > 0 ? (
                candidateRows.length > 0 ? (
                  <FlatList
                    data={candidateRows}
                    keyExtractor={(row) => row.key}
                    style={{ maxHeight: 280 }}
                    keyboardShouldPersistTaps="handled"
                    renderItem={({ item: row }) => {
                      if (row.kind === 'header') {
                        return (
                          <View style={styles.candidateGroupHeader}>
                            <Text style={styles.candidateGroupHeaderText}>{row.label}</Text>
                            <View style={styles.candidateGroupHeaderLine} />
                            <Text style={styles.candidateGroupHeaderCount}>{row.count}</Text>
                          </View>
                        );
                      }

                      const item = row.item;
                      const isSelected =
                        (currentLyrics?.selectedCandidateId && currentLyrics.selectedCandidateId === item.id) ||
                        (currentLyrics?.id && currentLyrics.id === item.id) ||
                        (currentLyrics?.source === item.source &&
                          currentLyrics?.trackName?.trim().toLowerCase() === item.trackName?.trim().toLowerCase() &&
                          currentLyrics?.artistName?.trim().toLowerCase() === item.artistName?.trim().toLowerCase() &&
                          Boolean(currentLyrics?.syncedLyrics || currentLyrics?.lyricsfile) === Boolean(item.syncedLyrics || item.lyricsfile));

                      return (
                        <TouchableOpacity
                          style={[
                            styles.candidateRow,
                            isSelected && [
                              styles.candidateRowSelected,
                              { borderColor: theme.primary, backgroundColor: `${theme.primary}20` },
                            ],
                          ]}
                          activeOpacity={0.7}
                          onPress={() => handleSelectCandidate(item)}>
                          <View style={{ flex: 1, marginRight: 8 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
                              <Text
                                style={[
                                  styles.candidateTrack,
                                  isSelected && { color: theme.primary, fontWeight: '700' },
                                ]}
                                numberOfLines={1}>
                                {item.trackName}
                              </Text>
                              {isSelected ? (
                                <View style={[styles.candidateSelectedBadge, { backgroundColor: theme.primary }]}>
                                  <Ionicons name="checkmark-sharp" size={10} color="#ffffff" style={{ marginRight: 2 }} />
                                  <Text style={styles.candidateSelectedBadgeText}>{t('player.candidate_selected')}</Text>
                                </View>
                              ) : null}
                            </View>
                            <Text style={styles.candidateArtist} numberOfLines={1}>
                              {item.artistName}
                            </Text>
                          </View>
                          <View style={styles.candidateBadgeBox}>
                            {item.hasWordSync ? (
                              <View style={[styles.candidateSyncedBadge, { backgroundColor: '#10b981' }]}>
                                <Text style={styles.candidateSyncedBadgeText}>WORD SYNC ✨</Text>
                              </View>
                            ) : item.hasSynced ? (
                              <View style={[styles.candidateSyncedBadge, { backgroundColor: theme.primary }]}>
                                <Text style={styles.candidateSyncedBadgeText}>SYNC</Text>
                              </View>
                            ) : (
                              <View style={[styles.candidateSyncedBadge, { backgroundColor: 'rgba(255, 255, 255, 0.12)' }]}>
                                <Text style={[styles.candidateSyncedBadgeText, { color: '#a1a1aa' }]}>{t('player.plain_lyrics_badge')}</Text>
                              </View>
                            )}
                            <Text style={styles.candidateSourceText}>
                              {getCandidateSourceLabel(item.source)}
                            </Text>
                          </View>
                          {resolvingCandidateId === item.id ? (
                            <ActivityIndicator
                              size="small"
                              color={theme.primary}
                              style={{ marginLeft: 8 }}
                            />
                          ) : null}
                        </TouchableOpacity>
                      );
                    }}
                  />
                ) : (
                  <View style={styles.candidateFilterEmpty}>
                    <Text style={styles.candidateFilterEmptyText}>
                      {t('player.filter_empty')}
                    </Text>
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => {
                        setCandidateFilter('all');
                        setSyncedOnly(false);
                      }}>
                      <Text style={[styles.candidateFilterClearText, { color: theme.primary }]}>
                        {t('player.filter_clear')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )
              ) : (
                <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                  <Text style={{ color: '#71717a', fontSize: 14 }}>
                    {isSearchingCandidates ? t('player.searching_candidates') : t('player.search_candidates_hint')}
                  </Text>
                </View>
              )}
            </Pressable>
          </Pressable>
        </Modal>

        {/* Seçenekler Modalı */}
        <Modal
          visible={isOptionsModalOpen}
          animationType="fade"
          transparent
          onRequestClose={() => setIsOptionsModalOpen(false)}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setIsOptionsModalOpen(false)}
            {...optionsModalPanResponder.panHandlers}>
            <Pressable style={styles.optionsModalBox} onPress={(e) => e.stopPropagation()}>
              {player.isRemote ? (
                <>
                  <TouchableOpacity
                    style={styles.optionsModalRow}
                    onPress={() => {
                      setIsOptionsModalOpen(false);
                      toggleConnectMode();
                    }}>
                    <Ionicons name="swap-horizontal-outline" size={24} color="#ffffff" style={{ marginRight: 16 }} />
                    <Text style={styles.optionsModalText}>{t('player.options_change_device')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.optionsModalRow}
                    onPress={() => {
                      setIsOptionsModalOpen(false);
                      player.disconnect();
                    }}>
                    <Ionicons name="close-circle-outline" size={24} color="#ef4444" style={{ marginRight: 16 }} />
                    <Text style={[styles.optionsModalText, { color: '#ef4444' }]}>{t('remote.disconnect')}</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  {isRemoteStream && (
                    <TouchableOpacity
                      style={styles.optionsModalRow}
                      onPress={() => {
                        setIsOptionsModalOpen(false);
                        handleDownloadCurrentTrack();
                      }}>
                      <Ionicons
                        name={isCurrentTrackDownloaded ? 'checkmark-circle-outline' : 'download-outline'}
                        size={24}
                        color={isCurrentTrackDownloaded ? '#10b981' : theme.primary}
                        style={{ marginRight: 16 }}
                      />
                      <Text style={[styles.optionsModalText, { color: isCurrentTrackDownloaded ? '#10b981' : theme.primary }]}>
                        {isCurrentTrackDownloaded
                          ? t('player.track_downloaded_custom')
                          : isCurrentTrackDownloading
                          ? t('player.track_downloading')
                          : t('player.download_current_track')}
                      </Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={styles.optionsModalRow}
                    onPress={() => {
                      setIsOptionsModalOpen(false);
                      toggleConnectMode();
                    }}>
                    <Ionicons name="radio-outline" size={24} color="#ffffff" style={{ marginRight: 16 }} />
                    <Text style={styles.optionsModalText}>RunMusic Connecto</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.optionsModalRow}
                    onPress={() => {
                      setIsOptionsModalOpen(false);
                      loadLyricsForTrack(displayTitle, displayArtist !== unknownArtist && displayArtist !== 'Bilinmeyen Sanatçı' ? displayArtist : '', true);
                    }}>
                    <Ionicons name="refresh-outline" size={24} color="#ffffff" style={{ marginRight: 16 }} />
                    <Text style={styles.optionsModalText}>{t('player.options_refetch_lyrics')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.optionsModalRow}
                    onPress={() => {
                      setIsOptionsModalOpen(false);
                      setIsEditTrackModalOpen(true);
                    }}>
                    <Ionicons name="pencil-outline" size={24} color="#ffffff" style={{ marginRight: 16 }} />
                    <Text style={styles.optionsModalText}>{t('player.options_edit_info')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.optionsModalRow}
                    onPress={handleHideTrack}>
                    <Ionicons name="eye-off-outline" size={24} color="#ffffff" style={{ marginRight: 16 }} />
                    <Text style={styles.optionsModalText}>{t('player.options_hide_track')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.optionsModalRow}
                    onPress={handleDeleteTrack}>
                    <Ionicons name="trash-outline" size={24} color="#ef4444" style={{ marginRight: 16 }} />
                    <Text style={[styles.optionsModalText, { color: '#ef4444' }]}>{t('player.options_delete_track')}</Text>
                  </TouchableOpacity>
                </>
              )}
            </Pressable>
          </Pressable>
        </Modal>

        {/* Şarkı Bilgilerini Düzenleme Modalı */}
        <EditTrackModal
          visible={isEditTrackModalOpen && !player.isRemote && localActiveTrack != null}
          track={
            localActiveTrack
              ? {
                  id: resolvedTrackId || localActiveTrack.id || localActiveTrack.url,
                  uri: currentAsset?.uri || localActiveTrack.url,
                  title: activeMeta?.title || displayTitle,
                  artist: activeMeta?.artist || (displayArtist !== unknownArtist && displayArtist !== 'Bilinmeyen Sanatçı' ? displayArtist : ''),
                  album: activeMeta?.album,
                  artwork: currentArtworkUri,
                  originalArtwork: currentAsset?.id ? artworkMap[currentAsset.id] : null,
                }
              : null
          }
          onClose={() => setIsEditTrackModalOpen(false)}
        />

        {/* Seçilen sözlerin paylaşım kartı önizlemesi */}
        <LyricSharePreviewModal
          visible={isSharePreviewOpen}
          onClose={() => setIsSharePreviewOpen(false)}
          title={displayTitle || ''}
          artist={displayArtist || ''}
          artworkUri={player.artworkUri ?? currentArtworkUri ?? null}
          lines={selectedShareLines}
          theme={theme}
          t={t}
        />

        {/* Dinamik Renk Keşif Kartı (Snackbar) */}
        {!isDynamicColorUnlocked && !isDevModeActive && !hasDismissedDynamicColorBanner && !isLyricsMode && !isQueueMode && !isSleepTimerMode && !isConnectMode && (
          <View
            style={[
              styles.dynamicThemeBanner,
              { bottom: Math.max(insets.bottom, 16) + 4 },
            ]}>
            <View style={styles.dynamicThemeBannerIconBox}>
              <Ionicons name="sparkles" size={16} color="#f59e0b" />
            </View>
            <View style={styles.dynamicThemeBannerTextBox}>
              <Text style={styles.dynamicThemeBannerTitle}>
                {t('settings.dynamic_theme_banner_title')}
              </Text>
              <Text style={styles.dynamicThemeBannerDesc} numberOfLines={1}>
                {t('settings.dynamic_theme_banner_desc')}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.dynamicThemeBannerUnlockBtn}
              activeOpacity={0.8}
              onPress={handleUnlockDynamicColorFromBanner}>
              {isLoadingDynamicAd ? (
                <ActivityIndicator size="small" color="#000000" />
              ) : (
                <>
                  <Ionicons name="play" size={10} color="#000000" />
                  <Text style={styles.dynamicThemeBannerUnlockText}>
                    {t('settings.dynamic_theme_banner_unlock')}
                  </Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.dynamicThemeBannerCloseBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              onPress={dismissDynamicColorBanner}>
              <Ionicons name="close" size={18} color="rgba(255, 255, 255, 0.6)" />
            </TouchableOpacity>
          </View>
        )}

      </View>
  );
}

const styles = StyleSheet.create({
  fullscreenContainer: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'space-between',
  },
  backdropOverlay: {
    backgroundColor: 'rgba(10, 10, 14, 0.88)',
  },
  topGrabberContainer: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 6,
  },
  topGrabberBar: {
    width: 38,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 6,
  },
  headerIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  headerTitleBox: {
    alignItems: 'center',
    maxWidth: '70%',
  },
  headerSmallLabel: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 2,
  },
  remoteHeaderDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10b981',
  },
  headerSmallLabelRemote: {
    color: '#10b981',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  headerAlbumName: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  middleContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    overflow: 'hidden',
    position: 'relative',
  },
  coverCenterBox: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  artworkWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.55,
    shadowRadius: 24,
    elevation: 20,
  },
  neighborArtworkWrapper: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.45,
    shadowRadius: 20,
    elevation: 16,
  },
  swipeHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 18,
    marginTop: 18,
  },
  swipeHintText: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 12,
    fontWeight: '500',
  },
  lyricsCardContainer: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 8,
    right: 8,
    alignSelf: 'stretch',
    borderRadius: 24,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
  },
  lyricsCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  lyricsSourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    flexShrink: 1,
    minWidth: 0,
  },
  lyricsSourceText: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 11,
    fontWeight: '600',
    flexShrink: 1,
  },
  lyricsActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 12,
  },
  lyricsActionBtnText: {
    fontSize: 11,
    fontWeight: '600',
    marginLeft: 3,
  },
  lyricsSearchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 12,
  },
  lyricsSearchBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
    marginLeft: 3,
  },
  lyricsOffsetModalBox: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#18181b',
    borderRadius: 22,
    borderWidth: 1,
    padding: 20,
  },
  lyricsOffsetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  lyricsOffsetTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  lyricsOffsetTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    marginLeft: 8,
  },
  lyricsOffsetValue: {
    fontSize: 42,
    fontWeight: '800',
    letterSpacing: -1,
    textAlign: 'center',
    marginTop: 14,
    fontVariant: ['tabular-nums'],
  },
  lyricsOffsetHint: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 6,
  },
  lyricsOffsetSignHint: {
    color: '#a1a1aa',
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: 3,
  },
  lyricsOffsetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 18,
  },
  lyricsOffsetAdjustBtn: {
    width: '31%',
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lyricsOffsetAdjustText: {
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  lyricsOffsetResetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 12,
  },
  lyricsOffsetResetBtnDisabled: {
    opacity: 0.6,
  },
  lyricsOffsetResetText: {
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 6,
  },
  lyricsListContent: {
    paddingTop: 18,
    paddingBottom: 96,
    paddingHorizontal: 6,
    alignItems: 'stretch',
  },
  lyricRow: {
    paddingVertical: 9,
    alignItems: 'flex-start',
    justifyContent: 'center',
    width: '100%',
  },
  /**
   * Seçim modunda satırlar hafifçe içeri alınır; seçili satırın arkasına
   * yarı saydam gri bir zemin konur (tamamen opak değil, sözler hâlâ görünür).
   */
  lyricRowSelectable: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 12,
    marginVertical: 1,
  },
  lyricRowSelected: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  lyricRowEnd: {
    alignItems: 'flex-end',
  },
  /**
   * Kelime kelime kurulan aktif satır. Kelimeler `flexWrap` ile sarar; her
   * kelime kendi sarmalayıcısında olduğu için satır asla kelime ortasından
   * bölünmez.
   */
  lyricWordRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    width: '100%',
  },
  /** Ölçüm tamamlanana kadar kullanılan doğal sarma. */
  lyricWordRowWrap: {
    flexWrap: 'wrap',
  },
  lyricWordRowEnd: {
    justifyContent: 'flex-end',
  },
  /** Dengeli bölünmüş satırların dikey yığını. */
  lyricWordLines: {
    width: '100%',
  },
  lyricWord: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  shareSelectBar: {
    paddingTop: 14,
    paddingBottom: 4,
  },
  shareSelectInfo: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  shareSelectTitle: {
    flex: 1,
    color: 'rgba(255, 255, 255, 0.66)',
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '600',
  },
  shareSelectCount: {
    fontSize: 13,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  shareSelectLimit: {
    color: '#fca5a5',
    fontSize: 11.5,
    fontWeight: '600',
    marginTop: 4,
  },
  shareSelectActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  shareSelectCancel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    paddingVertical: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  shareSelectCancelText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  shareSelectDone: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    paddingVertical: 14,
  },
  shareSelectDoneDisabled: {
    opacity: 0.4,
  },
  shareSelectDoneText: {
    color: '#0b0b0e',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  lyricText: {
    color: 'rgba(255, 255, 255, 0.52)',
    fontSize: LYRIC_FONT_INACTIVE,
    // Apple Music'in söz tipografisi kalın; ağırlık iki satırda da aynı olmalı.
    fontWeight: '800',
    lineHeight: LYRIC_LINE_HEIGHT_INACTIVE,
    letterSpacing: -0.2,
    textAlign: 'left',
    /*
     * Pasif satır: hafif bulanıklık. Dar yarıçap + yüksek opaklık, harfin
     * kenarlarını dağıtıp odağın dışındaymış hissi veriyor.
     */
    textShadowColor: LYRIC_BLUR_SHADOW_COLOR,
    textShadowOffset: LYRIC_TEXT_SHADOW_OFFSET,
    textShadowRadius: LYRIC_BLUR_SHADOW_RADIUS,
  },
  lyricTextActive: {
    color: '#ffffff',
    fontSize: LYRIC_FONT_ACTIVE,
    /*
     * Ölçüler pasif satırla birebir aynı olmalı: aktif satırın düzeni değişirse
     * liste satır geçişinde sıçrar. Vurgu rengi, gölgesi ve ölçeğiyle veriliyor.
     */
    fontWeight: '800',
    lineHeight: LYRIC_LINE_HEIGHT_ACTIVE,
    letterSpacing: -0.2,
    textAlign: 'left',
    /*
     * Aktif satır bulanıklaştırılmıyor: geniş yarıçaplı, düşük opaklıklı gölge
     * harfin çevresinde hâle bırakır, harfin kendisi keskin kalır.
     */
    textShadowColor: LYRIC_GLOW_SHADOW_COLOR,
    textShadowOffset: LYRIC_TEXT_SHADOW_OFFSET,
    textShadowRadius: LYRIC_GLOW_SHADOW_RADIUS,
  },
  lyricTextEnd: {
    textAlign: 'right',
  },
  lyricBackgroundWrap: {
    marginTop: 4,
    paddingLeft: 2,
    /*
     * Tam genişlik: sağ/sol hizalamayı `LyricWords` kendi içinde yapıyor.
     * `alignSelf: 'flex-start'` ile kap içeriğe göre daralıyordu ve arka vokal
     * her kelimede alt satıra düşüyordu.
     */
    width: '100%',
  },
  lyricBackgroundText: {
    color: 'rgba(255, 255, 255, 0.62)',
    fontSize: LYRIC_BG_FONT,
    fontWeight: '700',
    lineHeight: LYRIC_BG_LINE_HEIGHT,
    letterSpacing: -0.1,
    textAlign: 'left',
    // Pasif satırla aynı mantık: hafif bulanıklık.
    textShadowColor: LYRIC_BLUR_SHADOW_COLOR,
    textShadowOffset: LYRIC_TEXT_SHADOW_OFFSET,
    textShadowRadius: LYRIC_BLUR_SHADOW_RADIUS,
  },
  /** Arka vokalin aktif hâli: ölçüler aynı, renk ve hâle farkı. */
  lyricBackgroundTextActive: {
    color: 'rgba(255, 255, 255, 0.92)',
    // Aktifken bulanıklık yerine hâle (punto küçük olduğu için daha dar).
    textShadowColor: LYRIC_BG_GLOW_SHADOW_COLOR,
    textShadowOffset: LYRIC_TEXT_SHADOW_OFFSET,
    textShadowRadius: LYRIC_BG_GLOW_SHADOW_RADIUS,
  },
  lyricGapRow: {
    width: '100%',
    alignItems: 'flex-start',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  lyricGapDots: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 4,
  },
  lyricGapDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
    backgroundColor: '#ffffff',
  },
  plainLyricsScroll: {
    flex: 1,
    width: '100%',
  },
  plainLyricsContent: {
    paddingTop: 20,
    paddingBottom: 96,
    paddingHorizontal: 6,
  },
  plainLyricsText: {
    color: '#e4e4e7',
    fontSize: 19,
    fontWeight: '600',
    lineHeight: 28,
    letterSpacing: -0.2,
    textAlign: 'left',
  },
  plainLyricsSectionPill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginTop: 24,
    marginBottom: 10,
  },
  plainLyricsSectionText: {
    color: 'rgba(255, 255, 255, 0.82)',
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },
  plainLyricsBlankLine: {
    height: 12,
  },
  plainLyricsTailSpacer: {
    height: 24,
  },
  lyricsLoadingCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lyricsLoadingText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 14,
    marginTop: 12,
  },
  lyricsEmptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  lyricsEmptyTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 12,
  },
  lyricsEmptySubtitle: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 16,
  },
  lyricsEmptySearchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#27272a',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  lyricsEmptySearchBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  bottomSection: {
    paddingHorizontal: 24,
    paddingTop: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  trackTitle: {
    color: '#ffffff',
    fontSize: 23,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  trackArtist: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 17,
    fontWeight: '500',
    marginTop: 2,
  },
  /** Player'da sanatçı adları satırı (her ad ayrı dokunulabilir). */
  artistLinksRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    marginTop: 2,
  },
  metaActionBtn: {
    padding: 6,
  },
  lyricsMiniCoverBtn: {
    borderRadius: 10,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 8,
    elevation: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  scrubberBox: {
    marginBottom: 6,
  },
  progressTouchContainer: {
    height: 40,
    justifyContent: 'center',
  },
  progressBarBackground: {
    height: 7,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  // progressKnob removed
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 3,
  },
  timeText: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 12,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    marginVertical: 12,
  },
  appleNavBtn: {
    width: 56,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
  },
  applePlayBtn: {
    width: 72,
    height: 72,
    justifyContent: 'center',
    alignItems: 'center',
  },
  appleBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    marginTop: 4,
  },
  appleUtilBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    // Cam buton: saydam dolgu + ince saydam kenarlık (RunMusic cam dili).
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  appleUtilBtnActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    borderColor: 'rgba(255, 255, 255, 0.32)',
  },
  appleCenterUtilRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  appleSubUtilBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    // Nötr durumda tamamen saydam: arkasında hiçbir yüzey yok, yalnızca
    // simge görünür. Yüzey yalnızca seçiliyken devreye girer. Kenarlık her
    // durumda ayrılmış (renksiz) ki seçimde buton boyutu kaymasın.
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  appleSubUtilBtnActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.32)',
  },
  connectClientsBadgeWrapper: {
    position: 'absolute',
    top: 1,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  connectClientsBadge: {
    minWidth: 15,
    height: 15,
    borderRadius: 7.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  connectClientsBadgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '800',
    textAlign: 'center',
    includeFontPadding: false,
    lineHeight: 11,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  searchModalBox: {
    width: '100%',
    backgroundColor: '#18181b',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  sleepTimerCardContainer: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 8,
    right: 8,
    alignSelf: 'stretch',
    borderRadius: 24,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 4,
  },
  sleepTimerBody: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  sleepTimerActiveBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 8,
  },
  sleepTimerActiveBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  sleepTimerIconBubble: {
    width: 36,
    height: 36,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sleepTimerActiveBarTitle: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  sleepTimerActiveBarRemaining: {
    fontSize: 15.5,
    fontWeight: '700',
  },
  stopTimerPillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.16)',
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 10,
  },
  stopTimerPillBtnText: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '700',
  },
  sleepTimerSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 6,
    marginTop: 2,
    paddingHorizontal: 2,
  },
  timerOptionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  timerOptionBtn: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#27272a',
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  timerOptionText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  timerFullWidthBtn: {
    flexDirection: 'row',
    backgroundColor: '#27272a',
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  customTimerRow: {
    flexDirection: 'row',
    gap: 8,
  },
  customTimerInput: {
    flex: 1,
    backgroundColor: '#27272a',
    borderRadius: 12,
    color: '#ffffff',
    paddingHorizontal: 14,
    fontSize: 14,
    height: 48,
  },
  customTimerBtn: {
    paddingHorizontal: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    height: 48,
  },
  customTimerBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  optionsModalBox: {
    width: '80%',
    backgroundColor: '#18181b',
    borderRadius: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  optionsModalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  optionsModalText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '500',
  },
  searchModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  searchModalTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  searchModalInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  offlineSearchBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 12,
  },
  offlineSearchBannerText: {
    flex: 1,
    color: '#fbbf24',
    fontSize: 12,
    lineHeight: 16,
  },
  searchModalInput: {
    flex: 1,
    height: 44,
    backgroundColor: '#27272a',
    borderRadius: 12,
    paddingHorizontal: 14,
    color: '#ffffff',
    fontSize: 14,
    marginRight: 10,
  },
  searchModalSubmitBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#27272a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  candidatesSectionTitle: {
    color: '#a1a1aa',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 10,
  },
  candidateFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    marginBottom: 12,
  },
  candidateFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#3f3f46',
    backgroundColor: '#18181b',
  },
  candidateFilterChipEmpty: {
    opacity: 0.45,
  },
  candidateFilterChipText: {
    color: '#d4d4d8',
    fontSize: 11,
    fontWeight: '600',
  },
  candidateFilterChipTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  candidateGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 4,
    paddingHorizontal: 2,
  },
  candidateGroupHeaderText: {
    color: '#a1a1aa',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  candidateGroupHeaderLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginHorizontal: 8,
  },
  candidateGroupHeaderCount: {
    color: '#71717a',
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  candidateFilterEmpty: {
    paddingVertical: 24,
    alignItems: 'center',
    gap: 8,
  },
  candidateFilterEmptyText: {
    color: '#71717a',
    fontSize: 13,
    textAlign: 'center',
  },
  candidateFilterClearText: {
    fontSize: 13,
    fontWeight: '700',
  },
  candidateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginVertical: 3,
    borderWidth: 1,
    borderColor: '#27272a',
    backgroundColor: '#18181b',
  },
  candidateRowSelected: {
    borderWidth: 1.5,
  },
  candidateSelectedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 6,
  },
  candidateSelectedBadgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  candidateTrack: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  candidateArtist: {
    color: '#a1a1aa',
    fontSize: 12,
    marginTop: 2,
  },
  candidateBadgeBox: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  candidateSyncedBadge: {
    backgroundColor: '#10b981',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginRight: 6,
  },
  candidateSyncedBadgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '800',
  },
  candidateSourceText: {
    color: '#71717a',
    fontSize: 11,
    fontWeight: '600',
  },
  queueCardContainer: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 8,
    right: 8,
    alignSelf: 'stretch',
    borderRadius: 24,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 4,
  },
  queueCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 4,
  },
  queueSourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  queueSourceText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  queueLocateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 12,
  },
  queueLocateBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  queueCardCloseBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingBottom: 6,
  },
  queueToolbarToggle: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  queueToolbarLabel: {
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 12,
    fontWeight: '600',
  },
  queueToolbarSwitch: {
    marginLeft: 4,
    transform: [{ scaleX: 0.78 }, { scaleY: 0.78 }],
  },
  queueClearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  queueClearButtonText: {
    color: '#ef4444',
    fontSize: 11,
    fontWeight: '700',
  },
  queueScrollContent: {
    paddingBottom: 24,
  },
  queueSectionTitle: {
    color: '#71717a',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    paddingHorizontal: 8,
    paddingTop: 14,
    paddingBottom: 6,
  },
  upNextSectionWrapper: {
    marginVertical: 4,
  },
  upNextSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingRight: 8,
  },
  clearUpNextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  clearUpNextText: {
    color: '#ef4444',
    fontSize: 11,
    fontWeight: '700',
  },
  queueExtBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    marginRight: 6,
  },
  queueExtBadgeText: {
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 9,
    fontWeight: '600',
  },
  queueRemoveAction: {
    width: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    marginVertical: 2,
  },
  queuePromoteAction: {
    width: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    marginVertical: 2,
  },
  queuePromoteText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  queueQuickPromoteBtn: {
    padding: 6,
  },
  queueItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 12,
    marginVertical: 2,
  },
  queueItemActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  queueIndex: {
    color: '#71717a',
    width: 26,
    fontSize: 13,
    fontWeight: '600',
  },
  queueIndexActive: {
    color: '#ffffff',
  },
  queueTrackInfo: {
    flex: 1,
    marginHorizontal: 10,
  },
  queueTrackTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  queueTrackTitleActive: {
    color: '#ffffff',
  },
  queueTrackArtist: {
    color: '#71717a',
    fontSize: 12,
    marginTop: 2,
  },
  dynamicThemeBanner: {
    position: 'absolute',
    left: 14,
    right: 14,
    backgroundColor: '#18181b',
    borderWidth: 1.2,
    borderColor: 'rgba(245, 158, 11, 0.45)',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 999,
  },
  dynamicThemeBannerIconBox: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dynamicThemeBannerTextBox: {
    flex: 1,
  },
  dynamicThemeBannerTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  dynamicThemeBannerDesc: {
    color: '#a1a1aa',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 1,
  },
  dynamicThemeBannerUnlockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f59e0b',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
  },
  dynamicThemeBannerUnlockText: {
    color: '#000000',
    fontSize: 11,
    fontWeight: '800',
  },
  dynamicThemeBannerCloseBtn: {
    padding: 4,
    marginLeft: 2,
  },
  connectCardContainer: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 8,
    right: 8,
    alignSelf: 'stretch',
    borderRadius: 24,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 4,
  },
  connectBody: {
    flex: 1,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  connectSegmentContainer: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 3,
    marginBottom: 8,
  },
  connectSegmentTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    borderRadius: 10,
  },
  connectSegmentText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    fontWeight: '600',
  },
  connectDeviceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 14,
    marginBottom: 6,
  },
  connectDeviceIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectDeviceName: {
    fontSize: 13.5,
    fontWeight: '600',
    color: '#ffffff',
  },
  connectDeviceSubtext: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: 1,
  },
  connectSectionHeader: {
    marginTop: 6,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  connectSectionLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  connectList: {
    flex: 1,
  },
  connectEmptyContainer: {
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  connectEmptyTitle: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 4,
  },
  connectEmptySubtext: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.5)',
    textAlign: 'center',
    lineHeight: 15,
  },
  connectManualToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  connectManualToggleText: {
    fontSize: 12,
    fontWeight: '600',
  },
  connectManualBox: {
    padding: 10,
    borderRadius: 14,
    marginTop: 4,
  },
  connectInput: {
    height: 38,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 10,
    color: '#ffffff',
    fontSize: 12,
  },
  connectCancelBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  connectCancelText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  connectSubmitBtn: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  connectSubmitText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ffffff',
  },
  connectKickBtn: {
    padding: 6,
    marginLeft: 8,
  },
  connectRoomCard: {
    padding: 12,
    borderRadius: 14,
    marginBottom: 8,
  },
  connectRoomCodeBadge: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 2,
    textAlign: 'center',
    marginVertical: 6,
  },
  connectRoomActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  connectRoomBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: 10,
    gap: 6,
  },
  connectRecentPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginRight: 8,
  },
});

// Parent re-renders must not re-render the entire fullscreen player tree.
// Internal store subscriptions and the isolated progress leaves still update
// the parts that actually need to change.
export const FullscreenPlayerModal = React.memo(FullscreenPlayerModalImpl);
