/**
 * RunMusic Wrapped veri katmanının doğrulaması.
 *
 * AMAÇ: dönem penceresi (bu yıl / son 12 ay / tüm zamanlar / özel aralık),
 * tarih girdisi çözümlemesi, sıralamalar, seri hesabı ve kişiselleştirme
 * normalizasyonu — hepsi saf fonksiyon olduğu için SQLite/React olmadan
 * test edilebiliyor. Slaytlardaki sayılar bu fonksiyonlardan geliyor.
 *
 * Çalıştırma:
 *   npx tsc scripts/verify-wrapped.ts --ignoreConfig --outDir .tmp-verify \
 *     --module commonjs --target es2020 --moduleResolution bundler --skipLibCheck
 *   node .tmp-verify/scripts/verify-wrapped.js
 */

import {
  DEFAULT_WRAPPED_PREFERENCES,
  WRAPPED_SLIDE_IDS,
  buildWrappedStats,
  formatDateInput,
  formatWrappedDuration,
  normalizeWrappedPreferences,
  parseDateInput,
  parseSqlTimestamp,
  resolveWrappedPersona,
  resolveWrappedWindow,
  toSqlTimestamp,
  type WrappedPlayRow,
} from '../src/services/wrappedStats';

let failures = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

/** Bir dinleme satırı üretir (varsayılanlar testlerde okunabilirlik için). */
function row(
  playedAt: string,
  overrides: Partial<WrappedPlayRow> = {}
): WrappedPlayRow {
  return {
    track_id: overrides.track_id ?? 'track-1',
    played_at: playedAt,
    duration_listened: 200,
    title: 'Track',
    artist: 'Artist',
    album: 'Album',
    artwork: null,
    ...overrides,
  };
}

/**
 * Yerel saatle bir dinleme satırı üretir.
 *
 * `played_at` veritabanında UTC tutuluyor; saat/gün histogramı ise kullanıcının
 * yerel saatine göre hesaplanır. Testleri makinenin saat diliminden bağımsız
 * kılmak için satırları yerel saatten UTC'ye çevirerek yazıyoruz.
 */
function localRow(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  overrides: Partial<WrappedPlayRow> = {}
): WrappedPlayRow {
  const ms = new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
  return row(toSqlTimestamp(ms), overrides);
}

// ─────────────────────────────────────────────────────────────────────────────
section('Zaman damgası dönüşümü');

const stampMs = Date.UTC(2025, 11, 31, 23, 59, 58);
check('ms → SQL metni (UTC)', toSqlTimestamp(stampMs) === '2025-12-31 23:59:58');
check('SQL metni → ms (UTC)', parseSqlTimestamp('2025-12-31 23:59:58') === stampMs);
check('gidiş-dönüş kararlı', parseSqlTimestamp(toSqlTimestamp(stampMs)) === stampMs);
check('boş değer null', parseSqlTimestamp(null) === null && parseSqlTimestamp('') === null);
check('T ayırıcısı kabul edilir', parseSqlTimestamp('2025-12-31T23:59:58') === stampMs);
check(
  'geçersiz metin null',
  parseSqlTimestamp('not-a-date') === null
);

// ─────────────────────────────────────────────────────────────────────────────
section('Dönem penceresi');

const now = new Date(2026, 5, 15, 12, 0, 0).getTime();

const yearWindow = resolveWrappedWindow('year', now);
const expectedYearStart = new Date(2026, 0, 1, 0, 0, 0, 0).getTime();
check('bu yıl 1 Ocak 00:00 yerel saatte başlar', yearWindow.startMs === expectedYearStart);
check('bu yıl şimdiye kadar sürer', yearWindow.endMs === now);
check(
  'SQL başlangıcı UTC biçiminde',
  yearWindow.startSql === toSqlTimestamp(expectedYearStart)
);

const last12 = resolveWrappedWindow('last12m', now);
check('son 12 ay tam 365 gün', now - last12.startMs === 365 * 24 * 60 * 60 * 1000);

const all = resolveWrappedWindow('all', now);
check('tüm zamanlar 1970’ten başlar', all.startMs === 0);

const custom = resolveWrappedWindow('custom', now, {
  startMs: Date.UTC(2024, 0, 10),
  endMs: Date.UTC(2024, 2, 5),
});
check('özel aralık verilen sınırları korur', custom.startMs === Date.UTC(2024, 0, 10));

const reversed = resolveWrappedWindow('custom', now, {
  startMs: Date.UTC(2024, 5, 1),
  endMs: Date.UTC(2024, 0, 1),
});
check('ters aralık düzeltilir', reversed.startMs < reversed.endMs);
check(
  'bitiş SQL’i bir saniye pay bırakır',
  reversed.endSql === toSqlTimestamp(reversed.endMs + 1000)
);

// ─────────────────────────────────────────────────────────────────────────────
section('Tarih girdisi');

const parsedDate = parseDateInput('31.12.2025');
check('GG.AA.YYYY çözülür', parsedDate === new Date(2025, 11, 31, 0, 0, 0, 0).getTime());
check('ISO biçimi de çözülür', parseDateInput('2025-12-31') === parsedDate);
check('eğik çizgi kabul edilir', parseDateInput('31/12/2025') === parsedDate);
check('tek haneli gün/ay kabul edilir', parseDateInput('1.2.2025') === new Date(2025, 1, 1).getTime());
check('var olmayan tarih reddedilir (31.02)', parseDateInput('31.02.2025') === null);
check('ay aralığı kontrol edilir', parseDateInput('01.13.2025') === null);
check('serbest metin reddedilir', parseDateInput('dün') === null);
check('boş girdi reddedilir', parseDateInput('   ') === null);

check('formatDateInput sıfır dolgulu yazar', formatDateInput(parsedDate as number) === '31.12.2025');
check(
  'tarih gidiş-dönüşü kararlı',
  parseDateInput(formatDateInput(new Date(2024, 0, 5).getTime())) === new Date(2024, 0, 5).getTime()
);

// ─────────────────────────────────────────────────────────────────────────────
section('İstatistik toplama');

const rows: WrappedPlayRow[] = [
  localRow(2026, 1, 1, 10, 0, { track_id: 'a', title: 'Alpha', artist: 'A1', album: 'Alb1' }),
  localRow(2026, 1, 2, 12, 0, { track_id: 'b', title: 'Beta', artist: 'A2', album: 'Alb1' }),
  localRow(2026, 1, 2, 23, 30, { track_id: 'a', title: 'Alpha', artist: 'A1', album: 'Alb1' }),
  localRow(2026, 1, 2, 23, 45, { track_id: 'c', title: 'Gamma', artist: 'A3', album: 'Alb2' }),
  localRow(2026, 1, 4, 9, 0, { track_id: 'a', title: 'Alpha', artist: 'A1', album: 'Alb1' }),
];

const stats = buildWrappedStats(rows, { limit: 3 });

check('toplam dinleme', stats.totalPlays === 5);
check('toplam süre (5 × 200 sn)', stats.totalSeconds === 1000);
check('farklı parça', stats.uniqueTracks === 3);
check('farklı sanatçı', stats.uniqueArtists === 3);
// Albüm anahtarı ada + sanatçıya göre: aynı ada sahip farklı sanatçı albümleri
// (derleme / aynı isimli albüm) birbirine karışmasın.
check('farklı albüm (ad + sanatçı)', stats.uniqueAlbums === 3);
check('aktif gün', stats.activeDays === 3);
check('en çok dinlenen parça', stats.topTracks[0].label === 'Alpha' && stats.topTracks[0].plays === 3);
check('ikinci parça', stats.topTracks[1].label === 'Beta');
check('limit uygulanır', stats.topTracks.length === 3);
check('en çok dinlenen sanatçı', stats.topArtists[0].label === 'A1');
check('albüm sıralaması', stats.topAlbums[0].label === 'Alb1' && stats.topAlbums[0].plays === 3);
check('tek dinlemelik sanatçı sayısı', stats.onePlayArtists === 2);
check('parça payı 3/5', Math.abs(stats.topTrackShare - 0.6) < 1e-9);
check('ilk ve son dinleme', stats.lastPlayAt! > stats.firstPlayAt!);

section('Saat ve gün dağılımı');
check('gece dinlemesi doğru saatte sayılır', stats.hourHistogram[23] === 2);
check('en yoğun saat 23:00', stats.busiestHour === 23);
check(
  'en yoğun gün 2 Ocak (3 dinleme)',
  stats.busiestDay?.dateKey === '2026-01-02' && stats.busiestDay.plays === 3
);
check('saat histogramı 24 eleman', stats.hourHistogram.length === 24);
check('gün histogramı 7 eleman', stats.weekdayHistogram.length === 7);
// 2 Ocak 2026 Cuma → dizin 4 (Pazartesi = 0).
check('hafta günü doğru kovaya düşer', stats.weekdayHistogram[4] === 3);

section('Seri hesabı');
check('1-2 Ocak ardışık, 4 Ocak kopukluk → seri 2', stats.longestStreak === 2);

const streakRows: WrappedPlayRow[] = [
  localRow(2026, 3, 1, 8, 0),
  localRow(2026, 3, 2, 8, 0),
  localRow(2026, 3, 3, 8, 0),
  localRow(2026, 3, 4, 8, 0),
];
check('dört günlük seri', buildWrappedStats(streakRows).longestStreak === 4);
check('tek gün seri 1', buildWrappedStats([localRow(2026, 3, 1, 8, 0)]).longestStreak === 1);
check(
  'ay geçişinde seri bozulmaz',
  buildWrappedStats([
    localRow(2026, 1, 31, 8, 0),
    localRow(2026, 2, 1, 8, 0),
    localRow(2026, 2, 2, 8, 0),
  ]).longestStreak === 3
);

section('Boş veri');
const emptyStats = buildWrappedStats([]);
check('boşta toplam 0', emptyStats.totalPlays === 0 && emptyStats.totalSeconds === 0);
check('boşta liste boş', emptyStats.topTracks.length === 0 && emptyStats.topAlbums.length === 0);
check('boşta pay 0', emptyStats.topTrackShare === 0);
check('boşta saat yok', emptyStats.busiestHour === null);

section('Eksik meta');
const missingMeta = buildWrappedStats([
  row('2026-01-01 10:00:00', { title: null, artist: '  ', album: null, duration_listened: null }),
]);
check('başlıksız satır sayılır', missingMeta.totalPlays === 1);
check('boş sanatçı tek grupta toplanır', missingMeta.uniqueArtists === 1);
check('boş albüm listeye girmez', missingMeta.uniqueAlbums === 0);
check('eksik süre 0 sayılır', missingMeta.totalSeconds === 0);

// ─────────────────────────────────────────────────────────────────────────────
section('Kişiselleştirme normalizasyonu');

check('varsayılan tüm slaytlar', DEFAULT_WRAPPED_PREFERENCES.slides.length === WRAPPED_SLIDE_IDS.length);
const normalized = normalizeWrappedPreferences({ slides: ['tracks', 'tracks', 'bilinmeyen'], showArtwork: false });
check('bilinmeyen slayt atılır', normalized.slides.length === 1 && normalized.slides[0] === 'tracks');
check('showArtwork korunur', normalized.showArtwork === false);
check(
  'boş seçim varsayılana döner',
  normalizeWrappedPreferences({ slides: [] }).slides.length === WRAPPED_SLIDE_IDS.length
);
check(
  'bozuk değer güvenli varsayılan',
  normalizeWrappedPreferences('nonsense' as unknown).slides.length === WRAPPED_SLIDE_IDS.length
);
check(
  'showArtwork verilmezse açık',
  normalizeWrappedPreferences({ slides: ['intro'] }).showArtwork === true
);

// ─────────────────────────────────────────────────────────────────────────────
section('Süre biçimi');

const labels = { hour: 'sa', minute: 'dk', second: 'sn' };
check('saat + dakika', formatWrappedDuration(3 * 3600 + 24 * 60, labels) === '3 sa 24 dk');
check('tam saat', formatWrappedDuration(2 * 3600, labels) === '2 sa');
check('dakika', formatWrappedDuration(45 * 60, labels) === '45 dk');
check('saniye', formatWrappedDuration(38, labels) === '38 sn');
check('negatif değer 0', formatWrappedDuration(-5, labels) === '0 sn');

// ─────────────────────────────────────────────────────────────────────────────
section('Dinleyici profili');

const nightRows: WrappedPlayRow[] = [];
for (let i = 0; i < 10; i++) {
  nightRows.push(localRow(2026, 2, i + 1, 2, 0, { track_id: `n${i}` }));
}
check('gece dinleyicisi', resolveWrappedPersona(buildWrappedStats(nightRows)) === 'nightowl');
check(
  'gece penceresi 05:59’a kadar sayar',
  resolveWrappedPersona(
    buildWrappedStats([localRow(2026, 2, 1, 5, 30), localRow(2026, 2, 2, 5, 45)])
  ) === 'nightowl'
);

const explorerRows: WrappedPlayRow[] = [];
for (let i = 0; i < 10; i++) {
  explorerRows.push(
    localRow(2026, 2, i + 1, 14, 0, {
      track_id: `t${i}`,
      artist: `Artist ${i}`,
      album: `Album ${i}`,
    })
  );
}
check('kâşif', resolveWrappedPersona(buildWrappedStats(explorerRows)) === 'explorer');

const devotedRows: WrappedPlayRow[] = [];
for (let i = 0; i < 10; i++) {
  devotedRows.push(
    localRow(2026, 2, i + 1, 14, 0, {
      track_id: 'same',
      artist: 'A1',
      album: 'Alb',
    })
  );
}
check('adanmış dinleyici', resolveWrappedPersona(buildWrappedStats(devotedRows)) === 'devoted');

const streakPersonaRows: WrappedPlayRow[] = [];
for (let day = 1; day <= 20; day++) {
  streakPersonaRows.push(
    localRow(2026, 4, day, 14, 0, {
      track_id: `s${day % 6}`,
      artist: `Artist ${day % 4}`,
      album: `Album ${day % 3}`,
    })
  );
}
check(
  'uzun seri → maratoncu',
  resolveWrappedPersona(buildWrappedStats(streakPersonaRows)) === 'marathoner'
);

check('boş veride dengeli', resolveWrappedPersona(emptyStats) === 'balanced');

// ─────────────────────────────────────────────────────────────────────────────
section('Sonuç');
if (failures === 0) {
  console.log('  TÜM TESTLER GEÇTİ.');
} else {
  console.log(`  ${failures} TEST BAŞARISIZ.`);
  throw new Error(`${failures} doğrulama başarısız`);
}
