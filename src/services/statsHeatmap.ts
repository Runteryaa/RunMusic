import { parseSqlTimestamp, toSqlTimestamp } from './wrappedStats';

/**
 * Dinleme ısı haritası yardımcıları (saf fonksiyonlar, native'siz).
 *
 * SQLite `played_at` değerini UTC saklar; gün gruplaması kullanıcının yerel
 * saat dilimine göre yapılır. Bu yüzden gruplama SQL'de değil burada yapılır.
 */

export type HeatmapRange = 'month' | 'half' | 'year';

/** Isı haritası sütun (hafta) sayıları. */
export const HEATMAP_RANGE_WEEKS: Record<HeatmapRange, number> = {
  month: 5,
  half: 26,
  year: 53,
};

export const HEATMAP_RANGES: HeatmapRange[] = ['month', 'half', 'year'];

export interface HeatmapSummary {
  /** YYYY-MM-DD (yerel) → çalma sayısı. */
  counts: Record<string, number>;
  /** YYYY-MM-DD (yerel) → dinlenen saniye. */
  seconds: Record<string, number>;
  totalPlays: number;
  totalSeconds: number;
  /** En yoğun günün çalma sayısı (renk ölçeği için). */
  maxCount: number;
}

export function startOfLocalDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function addLocalDays(ms: number, days: number): number {
  const date = new Date(ms);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

/** Haftanın ilk günü Pazartesi (0 = Pazartesi). */
export function localWeekdayIndex(ms: number): number {
  return (new Date(ms).getDay() + 6) % 7;
}

export function startOfLocalWeek(ms: number): number {
  return addLocalDays(startOfLocalDay(ms), -localWeekdayIndex(ms));
}

/** YYYY-MM-DD (yerel saat). */
export function localDateKey(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** YYYY-MM (yerel saat). */
export function localMonthKey(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export interface HeatmapCell {
  ms: number;
  dateKey: string;
  count: number;
  /** Gelecek günler için `false`: hücre çizilmez. */
  filled: boolean;
}

/** `weeks` sütunluk ızgara: her sütun Pazartesi→Pazar. */
export function buildHeatmapColumns(
  weeks: number,
  counts: Record<string, number>,
  now: number = Date.now()
): HeatmapCell[][] {
  const today = startOfLocalDay(now);
  const gridStart = addLocalDays(startOfLocalWeek(now), -(Math.max(1, weeks) - 1) * 7);
  const columns: HeatmapCell[][] = [];
  for (let column = 0; column < weeks; column++) {
    const cells: HeatmapCell[] = [];
    for (let row = 0; row < 7; row++) {
      const ms = addLocalDays(gridStart, column * 7 + row);
      const dateKey = localDateKey(ms);
      cells.push({
        ms,
        dateKey,
        count: counts[dateKey] ?? 0,
        filled: ms <= today,
      });
    }
    columns.push(cells);
  }
  return columns;
}

/**
 * Bir ızgara için SQL aralığı (UTC). Izgaranın tamamı kapsanır; gelecek günler
 * veri döndürmez.
 */
export function heatmapSqlWindow(
  weeks: number,
  now: number = Date.now()
): { startMs: number; endMs: number; startSql: string; endSql: string } {
  const today = startOfLocalDay(now);
  const gridStart = addLocalDays(startOfLocalWeek(now), -(Math.max(1, weeks) - 1) * 7);
  const gridEnd = addLocalDays(today, 1);
  return {
    startMs: gridStart,
    endMs: gridEnd,
    startSql: toSqlTimestamp(gridStart),
    endSql: toSqlTimestamp(gridEnd),
  };
}

/** Ham günlük satırları yerel gün bazında özetler. */
export function summarizeDailyRows(
  rows: { played_at: string; duration_listened?: number | null }[]
): HeatmapSummary {
  const counts: Record<string, number> = {};
  const seconds: Record<string, number> = {};
  let totalPlays = 0;
  let totalSeconds = 0;
  let maxCount = 0;

  for (const row of rows) {
    const ms = parseSqlTimestamp(row.played_at);
    if (ms == null) continue;
    const key = localDateKey(ms);
    counts[key] = (counts[key] ?? 0) + 1;
    const listened = Math.max(0, Math.round(row.duration_listened ?? 0));
    seconds[key] = (seconds[key] ?? 0) + listened;
    totalPlays += 1;
    totalSeconds += listened;
    if (counts[key] > maxCount) maxCount = counts[key];
  }

  return { counts, seconds, totalPlays, totalSeconds, maxCount };
}

export interface MonthComparison {
  plays: number;
  seconds: number;
  previousPlays: number;
  previousSeconds: number;
  /** Yüzde fark; `null` ise geçen ay veri yok. */
  percentChange: number | null;
}

/** Bu ay ve geçen ayın toplamları (aylık özet kartı). */
export function compareCurrentMonth(
  summary: HeatmapSummary,
  now: number = Date.now()
): MonthComparison {
  const currentKey = localMonthKey(now);
  const previousKey = localMonthKey(
    new Date(new Date(now).getFullYear(), new Date(now).getMonth() - 1, 15).getTime()
  );

  let plays = 0;
  let seconds = 0;
  for (const [dayKey, count] of Object.entries(summary.counts)) {
    if (!dayKey.startsWith(currentKey)) continue;
    plays += count;
    seconds += summary.seconds[dayKey] ?? 0;
  }

  let previousPlays = 0;
  let previousSeconds = 0;
  for (const [dayKey, count] of Object.entries(summary.counts)) {
    if (!dayKey.startsWith(previousKey)) continue;
    previousPlays += count;
    previousSeconds += summary.seconds[dayKey] ?? 0;
  }

  const percentChange =
    previousPlays > 0 ? Math.round(((plays - previousPlays) / previousPlays) * 100) : null;

  return { plays, seconds, previousPlays, previousSeconds, percentChange };
}

/** Renk kademesi: 0 (boş) → 4 (en yoğun). */
export function heatmapLevel(count: number, maxCount: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (maxCount <= 1) return 2;
  const ratio = count / maxCount;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}
