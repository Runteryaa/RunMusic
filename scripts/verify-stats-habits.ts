/**
 * Dinleme alışkanlığı hesapları doğrulaması (seri + atlama oranı).
 *
 * Çalıştırma:
 *   npx tsc scripts/verify-stats-habits.ts --ignoreConfig --outDir .tmp-verify \
 *     --module commonjs --target es2020 --moduleResolution bundler --skipLibCheck
 *   node .tmp-verify/scripts/verify-stats-habits.js
 */

import {
  computeListeningStreak,
  computeSkipRate,
  formatStreakDays,
  localDayKey,
} from '../src/services/statsHabits';
import { shouldCountSkip, skipThresholdSeconds } from '../src/services/skipDetection';

let failures = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

/** Yerel saatle "bugün"ü sabitlemek için öğlen saatini kullan. */
const NOW = new Date(2026, 10, 26, 12, 0, 0).getTime();

function daysAgo(count: number): string {
  return localDayKey(NOW - count * 24 * 60 * 60 * 1000);
}

console.log('1) Güncel ve en uzun seri');
{
  const keys = [daysAgo(4), daysAgo(3), daysAgo(2), daysAgo(1), daysAgo(0), daysAgo(9)];
  const streak = computeListeningStreak(keys, NOW);
  check('bugüne kadar kesintisiz seri 5 gün', streak.current === 5, String(streak.current));
  check('en uzun seri 5 gün', streak.longest === 5, String(streak.longest));
}

console.log('2) Dün dinlenmiş, bugün henüz dinlenmemiş: seri devam eder');
{
  const keys = [daysAgo(3), daysAgo(2), daysAgo(1)];
  const streak = computeListeningStreak(keys, NOW);
  check('seri 3 gün', streak.current === 3, String(streak.current));
}

console.log('3) İki gün ara: seri sıfır, en uzun korunur');
{
  const keys = [daysAgo(6), daysAgo(5), daysAgo(4), daysAgo(2)];
  const streak = computeListeningStreak(keys, NOW);
  check('güncel seri 0', streak.current === 0, String(streak.current));
  check('en uzun 3', streak.longest === 3, String(streak.longest));
}

console.log('4) Veri yok / tekrar eden günler');
{
  check('boş liste', computeListeningStreak([], NOW).current === 0);
  const keys = [daysAgo(0), daysAgo(0), daysAgo(1), daysAgo(1), daysAgo(1)];
  const streak = computeListeningStreak(keys, NOW);
  check('yinelenen günler tek sayılır', streak.current === 2, String(streak.current));
}

console.log('5) Bozuk gün anahtarları yok sayılır');
{
  const keys = ['', 'bozuk', daysAgo(0)];
  const streak = computeListeningStreak(keys, NOW);
  check('geçerli tek gün', streak.current === 1, String(streak.current));
}

console.log('6) Atlama oranı');
{
  check('dinleme 9, atlama 1 → %10', Math.abs((computeSkipRate(9, 1) ?? 0) - 0.1) < 1e-9);
  check('hiç başlatma yok → null', computeSkipRate(0, 0) === null);
  check('yalnızca atlama → %100', computeSkipRate(0, 4) === 1);
  check('negatif değerler sıfıra kırpılır', computeSkipRate(-5, 2) === 1);
}

console.log('7) Seri metni');
{
  check('tek gün', formatStreakDays(1, { day: 'gün', days: 'gün' }) === '1 gün');
  check('çok gün', formatStreakDays(7, { day: 'gün', days: 'gün' }) === '7 gün');
  check('sıfır', formatStreakDays(0, { day: 'gün', days: 'gün' }) === '0 gün');
}

console.log('8) Atlama sayılma kuralları');
{
  check('eşik 200 sn parça → 30 sn', skipThresholdSeconds(200) === 30);
  check('eşik 40 sn parça → 20 sn', skipThresholdSeconds(40) === 20);
  check('süre bilinmiyor → 30 sn', skipThresholdSeconds(0) === 30);

  check('5 sn sonra atlandı → atlama', shouldCountSkip(5, 200, false));
  check('hiç başlamadı (0.2 sn) → atlama değil', !shouldCountSkip(0.2, 200, false));
  check('35 sn dinleyip atladı → atlama değil (eşik geçti)', !shouldCountSkip(35, 200, false));
  check('sona 3 sn kala bitti → atlama değil', !shouldCountSkip(197, 200, false));
  check('geçmişe yazıldı → atlama değil', !shouldCountSkip(5, 200, true));
  check('kısa parçada yarıdan sonra → atlama değil', !shouldCountSkip(25, 40, false));
  check('kısa parçada yarıdan önce → atlama', shouldCountSkip(10, 40, false));
  check('süre bilinmiyor, 10 sn → atlama', shouldCountSkip(10, 0, false));
}

console.log('\nSonuç');
if (failures === 0) {
  console.log('  TÜM TESTLER GEÇTİ ✅');
} else {
  console.log(`  ${failures} TEST BAŞARISIZ ❌`);
  throw new Error(`${failures} doğrulama başarısız`);
}
