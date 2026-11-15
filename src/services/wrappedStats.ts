/**
 * RunMusic Wrapped — istatistik toplama mantığı.
 *
 * Bu modül **saf**: SQLite, React veya native modül çağırmaz. Girdi, `play_history`
 * satırları; çıktı, slaytlarda gösterilecek özet. Böylece dönem çözümlemesi ve
 * sıralamalar `scripts/verify-wrapped.ts` ile Node üzerinde doğrulanabiliyor.
 *
 * Veri kaynağı yalnızca uygulamanın kendi istatistikleridir. Bağlantılar
 * (Last.fm / ListenBrainz) burada ne okunur ne yazılır.
 */

export type WrappedPeriod = 'year' | 'last12m' | 'all' | 'custom';

/** Wrapped destesindeki slaytlar (kullanıcı bunları açıp kapatabilir). */
export const WRAPPED_SLIDE_IDS = [
  'intro',
  'totals',
  'tracks',
  'artists',
  'albums',
  'time',
  'streak',
  'persona',
] as const;

export type WrappedSlideId = (typeof WRAPPED_SLIDE_IDS)[number];

export interface WrappedPreferences {
  /** Gösterilecek slaytlar; en az bir tane kalır. */
  slides: WrappedSlideId[];
  /** Slaytlarda albüm kapağı gösterilsin mi (kapak yoksa harf rozeti). */
  showArtwork: boolean;
}

export const DEFAULT_WRAPPED_PREFERENCES: WrappedPreferences = {
  slides: [...WRAPPED_SLIDE_IDS],
  showArtwork: true,
};

/** Persist'ten gelen (bozuk/eksik olabilecek) Wrapped tercihlerini onarır. */
export function normalizeWrappedPreferences(value: unknown): WrappedPreferences {
  const source = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const rawSlides = Array.isArray(source.slides) ? source.slides : [];
  const slides: WrappedSlideId[] = [];
  for (const candidate of rawSlides) {
    if (
      typeof candidate === 'string' &&
      (WRAPPED_SLIDE_IDS as readonly string[]).includes(candidate) &&
      !slides.includes(candidate as WrappedSlideId)
    ) {
      slides.push(candidate as WrappedSlideId);
    }
  }
  return {
    slides: slides.length > 0 ? slides : [...WRAPPED_SLIDE_IDS],
    showArtwork: source.showArtwork === undefined ? true : Boolean(source.showArtwork),
  };
}

/** `play_history` satırının ihtiyaç duyduğumuz alanları. */
export interface WrappedPlayRow {
  track_id: string;
  played_at: string;
  duration_listened?: number | null;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  artwork?: string | null;
}

export interface WrappedWindow {
  period: WrappedPeriod;
  startMs: number;
  endMs: number;
  /** SQLite `played_at` ile aynı biçim (UTC). */
  startSql: string;
  endSql: string;
}

export interface WrappedRankedItem {
  key: string;
  label: string;
  subtitle?: string;
  plays: number;
  seconds: number;
  artwork?: string | null;
}

export interface WrappedStats {
  totalPlays: number;
  totalSeconds: number;
  uniqueTracks: number;
  uniqueArtists: number;
  uniqueAlbums: number;
  activeDays: number;
  topTracks: WrappedRankedItem[];
  topArtists: WrappedRankedItem[];
  topAlbums: WrappedRankedItem[];
  /** 24 eleman: yerel saate göre dinleme sayısı. */
  hourHistogram: number[];
  /** 7 eleman: Pazartesi = 0. */
  weekdayHistogram: number[];
  busiestHour: number | null;
  busiestWeekday: number | null;
  busiestDay: { dateKey: string; plays: number } | null;
  longestStreak: number;
  /** Tek sefer dinlenen sanatçı sayısı ("keşif" hissi). */
  onePlayArtists: number;
  /** En çok dinlenen parçanın toplam dinlemelere oranı (0..1). */
  topTrackShare: number;
  firstPlayAt: number | null;
  lastPlayAt: number | null;
}

const DEFAULT_LIMIT = 5;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Milisaniyeyi `YYYY-MM-DD HH:MM:SS` (UTC) biçimine çevirir. */
export function toSqlTimestamp(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}

/**
 * SQLite'ın `CURRENT_TIMESTAMP` değerini (UTC, saat dilimi eki yok) ms'e çevirir.
 *
 * `new Date('2026-01-02 03:04:05')` bazı motorlarda yerel saat sayılır; bu
 * yüzden bileşenleri açıkça UTC olarak kuruyoruz.
 */
export function parseSqlTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value);
  if (!match) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6])
  );
}

/**
 * Seçilen dönemi somut bir zaman aralığına çevirir.
 *
 * - `year`: içinde bulunulan yılın 1 Ocak 00:00'ı (yerel) → şimdi
 * - `last12m`: son 365 gün
 * - `all`: 1970 → şimdi (gerçek başlangıç veriden okunur)
 * - `custom`: verilen aralık; ters verilirse düzeltilir
 */
export function resolveWrappedWindow(
  period: WrappedPeriod,
  now: number = Date.now(),
  custom?: { startMs?: number; endMs?: number }
): WrappedWindow {
  let startMs: number;
  let endMs: number;

  if (period === 'custom') {
    const rawStart = custom?.startMs ?? now - 30 * ONE_DAY_MS;
    const rawEnd = custom?.endMs ?? now;
    startMs = Math.min(rawStart, rawEnd);
    endMs = Math.max(rawStart, rawEnd);
  } else if (period === 'all') {
    startMs = 0;
    endMs = now;
  } else if (period === 'last12m') {
    startMs = now - 365 * ONE_DAY_MS;
    endMs = now;
  } else {
    const localStart = new Date(now);
    localStart.setHours(0, 0, 0, 0);
    localStart.setMonth(0, 1);
    startMs = localStart.getTime();
    endMs = now;
  }

  return {
    period,
    startMs,
    endMs,
    startSql: toSqlTimestamp(startMs),
    // Aralık dışlamalı: son saniyeyi kaybetmemek için +1 sn.
    endSql: toSqlTimestamp(endMs + 1000),
  };
}

/**
 * Tarih girdisini (yerel gün başlangıcı, ms) çözer.
 *
 * Kabul edilen biçimler: `31.12.2025`, `31/12/2025`, `2025-12-31`.
 * Geçersiz veya var olmayan tarihlerde (ör. 31.02) `null` döner.
 */
export function parseDateInput(text: string): number | null {
  const value = (text ?? '').trim();
  if (!value) return null;

  let day: number;
  let month: number;
  let year: number;

  const dotted = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dotted) {
    day = Number(dotted[1]);
    month = Number(dotted[2]);
    year = Number(dotted[3]);
  } else if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else {
    return null;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  // 31.02 gibi taşan tarihleri yakala (Date otomatik ilerletir).
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date.getTime();
}

/** Yerel tarihi `GG.AA.YYYY` biçiminde metne çevirir (girdi alanları için). */
export function formatDateInput(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

/** Boş/whitespace metni sadeleştirir (gruplama anahtarlarında tekilleştirir). */
function clean(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function topOf(map: Map<string, WrappedRankedItem>, limit: number): WrappedRankedItem[] {
  return [...map.values()]
    .sort((a, b) => b.plays - a.plays || b.seconds - a.seconds || a.label.localeCompare(b.label))
    .slice(0, limit);
}

/**
 * Satırlardan Wrapped özeti üretir.
 *
 * Sıralama deterministik: dinleme sayısı → süre → etiket. Slaytlar bu yüzden
 * her açılışta aynı sırayı gösterir.
 */
export function buildWrappedStats(
  rows: WrappedPlayRow[],
  options?: { limit?: number }
): WrappedStats {
  const limit = options?.limit ?? DEFAULT_LIMIT;

  const tracks = new Map<string, WrappedRankedItem>();
  const artists = new Map<string, WrappedRankedItem>();
  const albums = new Map<string, WrappedRankedItem>();
  const artistPlayCounts = new Map<string, number>();
  const days = new Map<string, number>();
  const hourHistogram = new Array<number>(24).fill(0);
  const weekdayHistogram = new Array<number>(7).fill(0);

  let totalSeconds = 0;
  let firstPlayAt: number | null = null;
  let lastPlayAt: number | null = null;

  for (const row of rows) {
    const playedAt = parseSqlTimestamp(row.played_at);
    const seconds = Math.max(0, Math.floor(row.duration_listened ?? 0));
    totalSeconds += seconds;

    const title = clean(row.title);
    const artist = clean(row.artist);
    const album = clean(row.album);
    const trackKey = clean(row.track_id) || `${artist}|${title}`;

    const track = tracks.get(trackKey);
    if (track) {
      track.plays += 1;
      track.seconds += seconds;
    } else {
      tracks.set(trackKey, {
        key: trackKey,
        label: title,
        subtitle: artist || undefined,
        plays: 1,
        seconds,
        artwork: row.artwork || null,
      });
    }

    const artistKey = artist.toLowerCase();
    const artistItem = artists.get(artistKey);
    if (artistItem) {
      artistItem.plays += 1;
      artistItem.seconds += seconds;
    } else {
      artists.set(artistKey, {
        key: artistKey,
        label: artist,
        plays: 1,
        seconds,
        artwork: row.artwork || null,
      });
    }
    artistPlayCounts.set(artistKey, (artistPlayCounts.get(artistKey) ?? 0) + 1);

    if (album) {
      const albumKey = `${album.toLowerCase()}|${artistKey}`;
      const albumItem = albums.get(albumKey);
      if (albumItem) {
        albumItem.plays += 1;
        albumItem.seconds += seconds;
      } else {
        albums.set(albumKey, {
          key: albumKey,
          label: album,
          subtitle: artist || undefined,
          plays: 1,
          seconds,
          artwork: row.artwork || null,
        });
      }
    }

    if (playedAt !== null) {
      if (firstPlayAt === null || playedAt < firstPlayAt) firstPlayAt = playedAt;
      if (lastPlayAt === null || playedAt > lastPlayAt) lastPlayAt = playedAt;

      const local = new Date(playedAt);
      hourHistogram[local.getHours()] += 1;
      // JS: 0 = Pazar → Pazartesi merkezli dizin.
      weekdayHistogram[(local.getDay() + 6) % 7] += 1;

      const dateKey = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(
        local.getDate()
      ).padStart(2, '0')}`;
      days.set(dateKey, (days.get(dateKey) ?? 0) + 1);
    }
  }

  const topTracks = topOf(tracks, limit);
  const topArtists = topOf(artists, limit);
  const topAlbums = topOf(albums, limit);

  let busiestHour: number | null = null;
  for (let i = 0; i < hourHistogram.length; i++) {
    if (busiestHour === null || hourHistogram[i] > hourHistogram[busiestHour]) busiestHour = i;
  }
  let busiestWeekday: number | null = null;
  for (let i = 0; i < weekdayHistogram.length; i++) {
    if (busiestWeekday === null || weekdayHistogram[i] > weekdayHistogram[busiestWeekday]) {
      busiestWeekday = i;
    }
  }
  if (busiestHour !== null && hourHistogram[busiestHour] === 0) busiestHour = null;
  if (busiestWeekday !== null && weekdayHistogram[busiestWeekday] === 0) busiestWeekday = null;

  let busiestDay: { dateKey: string; plays: number } | null = null;
  for (const [dateKey, plays] of days) {
    if (!busiestDay || plays > busiestDay.plays) busiestDay = { dateKey, plays };
  }

  // Kesintisiz dinleme serisi: yerel gün anahtarlarını sıralayıp ardışıklığı ölç.
  const sortedDays = [...days.keys()].sort();
  let longestStreak = 0;
  let currentStreak = 0;
  let previousMs: number | null = null;
  for (const dateKey of sortedDays) {
    const [year, month, day] = dateKey.split('-').map(Number);
    const dayMs = Date.UTC(year, month - 1, day);
    if (previousMs !== null && Math.abs(dayMs - previousMs - ONE_DAY_MS) < 1) {
      currentStreak += 1;
    } else {
      currentStreak = 1;
    }
    longestStreak = Math.max(longestStreak, currentStreak);
    previousMs = dayMs;
  }

  let onePlayArtists = 0;
  for (const count of artistPlayCounts.values()) {
    if (count === 1) onePlayArtists += 1;
  }

  return {
    totalPlays: rows.length,
    totalSeconds,
    uniqueTracks: tracks.size,
    uniqueArtists: artists.size,
    uniqueAlbums: albums.size,
    activeDays: days.size,
    topTracks,
    topArtists,
    topAlbums,
    hourHistogram,
    weekdayHistogram,
    busiestHour,
    busiestWeekday,
    busiestDay,
    longestStreak,
    onePlayArtists,
    topTrackShare: rows.length > 0 && topTracks.length > 0 ? topTracks[0].plays / rows.length : 0,
    firstPlayAt,
    lastPlayAt,
  };
}

/**
 * Süreyi okunur metne çevirir: "3 sa 24 dk", "45 dk", "38 sn".
 *
 * Saat dilimi bağımsız ve saf; UI ile testler aynı biçimi kullanır.
 */
export function formatWrappedDuration(
  seconds: number,
  labels: { hour: string; minute: string; second: string }
): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) {
    return minutes > 0 ? `${hours} ${labels.hour} ${minutes} ${labels.minute}` : `${hours} ${labels.hour}`;
  }
  if (minutes > 0) return `${minutes} ${labels.minute}`;
  return `${total} ${labels.second}`;
}

/** Verilen dinleme sayısına göre dinleyici "profili" (paylaşım kartı ve kapanış). */
export type WrappedPersona = 'explorer' | 'devoted' | 'nightowl' | 'marathoner' | 'balanced';

/** Gece penceresi: 22:00–05:59 (yerel saat). */
export function isNightHour(hour: number): boolean {
  return hour >= 22 || hour < 6;
}

export function resolveWrappedPersona(stats: WrappedStats): WrappedPersona {
  if (stats.totalPlays === 0) return 'balanced';

  let nightPlays = 0;
  for (let hour = 0; hour < stats.hourHistogram.length; hour++) {
    if (isNightHour(hour)) nightPlays += stats.hourHistogram[hour];
  }
  if (nightPlays / stats.totalPlays >= 0.4) return 'nightowl';

  // Tek parçayı tekrar tekrar dinlemek "adanmışlık"; keşiften önce bakılır
  // çünkü tek parça/tek sanatçı oranı da yüksek çıkar ve yanıltır.
  if (stats.topTrackShare >= 0.3) return 'devoted';

  // Keşif: dinlemelerin yarısından fazlası farklı sanatçılardan geliyorsa.
  const artistVariety = stats.uniqueArtists / stats.totalPlays;
  if (artistVariety >= 0.5) return 'explorer';

  if (stats.longestStreak >= 14) return 'marathoner';
  return 'balanced';
}
