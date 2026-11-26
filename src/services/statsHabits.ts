/**
 * Dinleme alışkanlığı hesapları (saf).
 *
 * Node doğrulama betiğinden import edilebilsin diye React/SQLite bağımlılığı
 * yoktur; yalnızca tarih anahtarları ve sayılarla çalışır.
 */

/** `YYYY-MM-DD` biçimindeki yerel gün anahtarını epoch ms'ye çevirir (UTC tabanlı). */
function dayKeyToMs(dateKey: string): number | null {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month || !day) return null;
  const ms = Date.UTC(year, month - 1, day);
  return Number.isFinite(ms) ? ms : null;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface ListeningStreak {
  /**
   * Bugün (veya dün) devam eden seri.
   *
   * Dün dinlenmiş, bugün henüz dinlenmemişse seri bozulmuş sayılmaz; gün
   * bitmeden seriyi sürdürme şansı vardır. İki gün veya daha uzun ara verildiyse
   * seri sıfırdır.
   */
  current: number;
  /** Verilen günler içindeki en uzun kesintisiz seri. */
  longest: number;
}

/**
 * Yerel gün anahtarlarından dinleme serilerini çıkarır.
 *
 * @param dayKeys `YYYY-MM-DD` yerel gün anahtarları (yinelenen olabilir).
 * @param nowMs Günü belirlemek için "şimdi" (test edilebilirlik için dışarıdan).
 */
export function computeListeningStreak(dayKeys: string[], nowMs: number): ListeningStreak {
  const uniqueMs = [
    ...new Set(
      dayKeys
        .map(dayKeyToMs)
        .filter((ms): ms is number => ms !== null)
    ),
  ].sort((a, b) => a - b);

  if (uniqueMs.length === 0) return { current: 0, longest: 0 };

  let longest = 0;
  let run = 0;
  let previous: number | null = null;
  for (const ms of uniqueMs) {
    run = previous !== null && Math.abs(ms - previous - ONE_DAY_MS) < 1 ? run + 1 : 1;
    if (run > longest) longest = run;
    previous = ms;
  }

  const todayKey = localDayKey(nowMs);
  const yesterdayKey = localDayKey(nowMs - ONE_DAY_MS);
  const lastMs = uniqueMs[uniqueMs.length - 1];
  const lastKey = msToDayKey(lastMs);

  if (lastKey !== todayKey && lastKey !== yesterdayKey) {
    return { current: 0, longest };
  }

  // Sondan geriye doğru kesintisiz gün sayısını say.
  let current = 1;
  for (let i = uniqueMs.length - 1; i > 0; i--) {
    if (Math.abs(uniqueMs[i] - uniqueMs[i - 1] - ONE_DAY_MS) < 1) current += 1;
    else break;
  }

  return { current, longest: Math.max(longest, current) };
}

/** Epoch ms'yi yerel gün anahtarına çevirir (`YYYY-MM-DD`). */
export function localDayKey(ms: number): string {
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function msToDayKey(ms: number): string {
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Atlama oranı: başlatılan şarkıların yüzde kaçı eşiğe gelmeden atlandı.
 *
 * `plays` eşiği geçen (geçmişe yazılan) dinlemeler, `skips` ise eşiğe gelmeden
 * bırakılan başlatmalardır. Hiç başlatma yoksa `null` döner (bölme yok).
 */
export function computeSkipRate(plays: number, skips: number): number | null {
  const started = Math.max(0, plays) + Math.max(0, skips);
  if (started === 0) return null;
  return Math.max(0, skips) / started;
}

/** Seri gün sayısını okunur metne çevirir. */
export function formatStreakDays(days: number, labels: { day: string; days: string }): string {
  const value = Math.max(0, Math.floor(days));
  return value === 1 ? `1 ${labels.day}` : `${value} ${labels.days}`;
}
