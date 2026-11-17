/**
 * Istatistiklerin duzenlenmis metadata kullandigini dogrular.
 *
 * NEDEN: Gecmiste kaydedilmis ham etiketler ("MODELOfficial",
 * "Song (Official Video)") istatistik ve sanatci sayfalarinda hayalet
 * sarkilar/sanatcilar olusturuyordu. `buildWrappedStats` artik satirlari
 * `cleanTrackFields` ile temizliyor; bu betik o davranisi sabitler.
 *
 * Calistirma:
 *   npx tsc scripts/verify-stats-cleaning.ts --ignoreConfig --outDir .tmp-verify \
 *     --module commonjs --target es2020 --moduleResolution bundler --skipLibCheck
 *   node .tmp-verify/scripts/verify-stats-cleaning.js
 */

import { buildWrappedStats, splitArtistNames, type WrappedPlayRow } from '../src/services/wrappedStats';
import { artistNamesFromRow } from '../src/services/artistMatch';

let failures = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

function row(partial: { track_id: string; title: string; artist: string }): WrappedPlayRow {
  return {
    track_id: partial.track_id,
    played_at: '2026-05-01 12:00:00',
    duration_listened: 120,
    title: partial.title,
    artist: partial.artist,
    album: null,
    artwork: null,
  } as WrappedPlayRow;
}

console.log('\nHam etiketler temizlenir');
const ghostRows: WrappedPlayRow[] = [
  row({ track_id: 'a', title: 'Sarki (Official Video)', artist: 'MODELOfficial' }),
  row({ track_id: 'a', title: 'Sarki', artist: 'MODEL' }),
  row({ track_id: 'c', title: 'Baska Sarki', artist: 'MODELOfficial' }),
];
const ghostStats = buildWrappedStats(ghostRows, { limit: 10 });

const sarki = ghostStats.topTracks.find((item) => item.label === 'Sarki');
check(
  'ayni sarki tek kayitta birlesir',
  ghostStats.topTracks.filter((item) => item.label === 'Sarki').length === 1 && sarki?.plays === 2,
  ghostStats.topTracks.map((item) => `${item.label}:${item.plays}`).join(' | ')
);
check(
  'hayalet sanatci yok',
  !ghostStats.topArtists.some((item) => item.label === 'MODELOfficial'),
  ghostStats.topArtists.map((item) => item.label).join(' | ')
);
const model = ghostStats.topArtists.find((item) => item.label === 'MODEL');
check('MODEL tek sanatci olarak 3 dinleme', model?.plays === 3, String(model?.plays));
check(
  'sanatci alt bilgisi temiz',
  ghostStats.topTracks.every((item) => item.subtitle !== 'MODELOfficial'),
  ghostStats.topTracks.map((item) => item.subtitle).join(' | ')
);

console.log('\nHTML & ayraci');
check('splitArtistNames "&amp;" boler', splitArtistNames('A &amp; B').length === 2);
check('splitArtistNames duz "&" bolmez', splitArtistNames('Mumford & Sons').length === 1);
check(
  'artistNamesFromRow temizler',
  artistNamesFromRow('MODELOfficial').join('|') === 'MODEL',
  artistNamesFromRow('MODELOfficial').join('|')
);

console.log('\nSonuc');
if (failures === 0) {
  console.log('  TUM TESTLER GECTI.');
} else {
  console.log(`  ${failures} TEST BASARISIZ.`);
  throw new Error(`${failures} dogrulama basarisiz`);
}
