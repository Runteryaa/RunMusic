/**
 * Kitaplık araçları, ısı haritası ve söz aramasının doğrulaması.
 *
 * Gerçek uygulama mantığı kullanılır (kopyası değil). Script native bağımlılık
 * içermez; Node üzerinde çalışır.
 *
 * Çalıştırma:
 *   npx tsc scripts/verify-library-tools.ts --ignoreConfig --outDir .tmp-verify \
 *     --module commonjs --target es2020 --moduleResolution bundler --skipLibCheck
 *   node .tmp-verify/scripts/verify-library-tools.js
 */

import {
  findDuplicateGroups,
  findMissingMetadata,
  formatToolDuration,
  type LibraryToolTrack,
} from '../src/services/libraryTools';
import {
  buildHeatmapColumns,
  compareCurrentMonth,
  heatmapLevel,
  heatmapSqlWindow,
  localDateKey,
  summarizeDailyRows,
} from '../src/services/statsHeatmap';
import { searchLyricsCache } from '../src/services/lyricsSearch';
import type { LyricsCacheEntry } from '../src/services/persistSanitize';
import type { LyricsResult } from '../src/services/lyricsTypes';

let failures = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function makeTrack(overrides: Partial<LibraryToolTrack> & { id: string }): LibraryToolTrack {
  return {
    uri: `file://${overrides.id}.mp3`,
    filename: `${overrides.id}.mp3`,
    duration: 200,
    title: 'Song',
    artist: 'Artist',
    ...overrides,
  };
}

// ── Kopya gruplama ──────────────────────────────────────────────────────────
console.log('\nKopya gruplama');
{
  const tracks = [
    makeTrack({ id: 'a', title: 'Şarkı', artist: 'Sanatçı', duration: 180 }),
    makeTrack({ id: 'b', title: 'sarki', artist: 'sanatci', duration: 181 }),
    makeTrack({ id: 'c', title: 'Şarkı', artist: 'Sanatçı', duration: 240 }),
    makeTrack({ id: 'd', title: 'Başka', artist: 'Sanatçı', duration: 180 }),
  ];
  const groups = findDuplicateGroups(tracks);
  check('aynı ad + ±2 sn tek grup', groups.length === 1, `gruplar: ${groups.length}`);
  const first = groups.find((group) => group.tracks.some((track) => track.id === 'a'));
  check('normalize edilmiş eşleşme', Boolean(first), 'a gruba girmedi');
  check('süre farkı büyükse ayrılır', !first?.tracks.some((track) => track.id === 'c'));
  check('farklı başlık ayrı kalır', !first?.tracks.some((track) => track.id === 'd'));
  check('grup en az iki parça', groups.every((group) => group.tracks.length >= 2));
}

// ── Eksik meta veri ─────────────────────────────────────────────────────────
console.log('\nEksik meta veri');
{
  const missing = findMissingMetadata([
    makeTrack({ id: 'x', artist: '', album: 'Albüm', artwork: 'file://cover.jpg' }),
    makeTrack({ id: 'y', artist: 'A', album: 'B', artwork: 'file://c.jpg' }),
    makeTrack({ id: 'z', artist: 'A', album: '', artwork: '' }),
  ]);
  check('eksiksiz parça listelenmez', !missing.some((track) => track.id === 'y'));
  check('sanatçı eksiği bulunur', missing.find((track) => track.id === 'x')?.missing.includes('artist') === true);
  const z = missing.find((track) => track.id === 'z');
  check('çoklu eksik sıralanır', z?.missing.length === 2, `z: ${z?.missing.join(',')}`);
}

// ── Isı haritası ────────────────────────────────────────────────────────────
console.log('\nIsı haritası');
{
  const now = new Date(2026, 4, 15, 12, 0, 0).getTime();
  const lines = [
    {
      played_at: '2026-05-15 09:00:00',
      duration_listened: 120,
    },
    {
      played_at: '2026-05-15 10:00:00',
      duration_listened: 60,
    },
  ];
  const summary = summarizeDailyRows(lines);
  check('gün bazında toplanır', summary.counts[localDateKey(now)] === 2);
  check('dinlenen süre toplanır', summary.totalSeconds === 180);
  check('maksimum gün sayısı', summary.maxCount === 2);

  const columns = buildHeatmapColumns(5, summary.counts, now);
  check('5 hafta × 7 gün', columns.length === 5 && columns.every((week) => week.length === 7));
  check('gelecek günler doldurulmaz', columns[columns.length - 1].some((cell) => !cell.filled));

  const window = heatmapSqlWindow(5, now);
  check('SQL penceresi geçerli', window.startSql < window.endSql);

  const month = compareCurrentMonth(summary, now);
  check('aylık çalma toplamı', month.plays === 2, `plays: ${month.plays}`);
  check('geçen ay yoksa yüzde null', month.percentChange === null);

  check('seviye 0 boş', heatmapLevel(0, 4) === 0);
  check('seviye sınırları', heatmapLevel(1, 8) === 1 && heatmapLevel(8, 8) === 4);
}

// ── Söz araması ─────────────────────────────────────────────────────────────
console.log('\nSöz araması');
{
  const lyrics: LyricsResult = {
    trackName: 'Şarkı',
    artistName: 'Sanatçı',
    syncedLyrics: null,
    plainLyrics: 'gözlerinde bir ışık var\ngece boyunca',
    parsedLines: [],
    source: 'lrclib',
  };
  const cache: Record<string, LyricsCacheEntry> = {
    a: lyrics,
    b: { ref: 'a' },
    c: { ...lyrics, plainLyrics: 'başka bir satır' },
  };
  const tracks = [
    { id: 'a', uri: 'file://a.mp3', title: 'Şarkı', artist: 'Sanatçı' },
    { id: 'b', uri: 'file://b.mp3', title: 'Kopya', artist: 'Sanatçı' },
    { id: 'c', uri: 'file://c.mp3', title: 'Diğer', artist: 'X' },
  ];
  const hits = searchLyricsCache(cache, tracks, 'gozlerinde');
  check('diyakritik duyarsız eşleşme', hits.length > 0 && hits[0].track.id === 'a');
  check('ref çözümlenir, tekrar listelenmez', hits.filter((hit) => hit.track.id === 'b').length === 0);
  check('eşleşmeyen parça yok', !hits.some((hit) => hit.track.id === 'c'));
  check('snippet satır içerir', Boolean(hits[0]?.snippet.includes('ışık')));
  check('kısa sorgu boş döner', searchLyricsCache(cache, tracks, 'a').length === 0);
}

// ── Biçimlendirme ───────────────────────────────────────────────────────────
console.log('\nBiçimlendirme');
check('dakika:saniye', formatToolDuration(65) === '1:05');
check('saatli biçim', formatToolDuration(3725) === '1:02:05');

if (failures > 0) {
  throw new Error(`${failures} kontrol başarısız`);
}
console.log('\nTüm kontroller geçti.');
