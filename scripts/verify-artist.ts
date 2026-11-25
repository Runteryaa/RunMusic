/**
 * Sanatçı sayfası veri katmanının doğrulaması.
 *
 * Kapsam:
 *  - Sanatçı eşleştirme anahtarı (aksan/büyük-küçük harf/noktalama)
 *  - Kütüphane gruplaması (ortak çalışmalar, "Mumford & Sons" korunumu)
 *  - Geçmiş süzme + istatistik toplama (Wrapped motoruyla tutarlı)
 *  - "En çok dinlenen en üstte" sıralaması
 *
 * Çalıştırma:
 *   npx tsc scripts/verify-artist.ts --ignoreConfig --outDir .tmp-verify \
 *     --module commonjs --target es2020 --moduleResolution bundler --skipLibCheck
 *   node .tmp-verify/scripts/verify-artist.js
 */

import {
  normalizeArtistKey,
  artistNamesFromRow,
  rowMatchesArtist,
} from '../src/services/artistMatch';
import {
  buildArtistIndex,
  buildArtistProfile,
  buildArtistProfileFromRows,
  buildArtistTitleHints,
  buildArtistTrackPlayCounts,
  collectArtistNameVariants,
  filterRowsForArtist,
  getArtistTracks,
  getArtistTotalPlays,
  getUnassignedTracks,
  sortTracksByPlays,
  topArtistTracks,
  type ArtistTrack,
} from '../src/services/artistProfile';
import type { WrappedPlayRow } from '../src/services/wrappedStats';

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

function track(id: string, title: string, artist: string): ArtistTrack {
  return { id, uri: `file:///${id}.mp3`, title, artist, duration: 180 };
}

// ─────────────────────────────────────────────────────────────────────────────
section('Sanatçı anahtarı');

check('büyük/küçük harf aynı anahtar', normalizeArtistKey('Sezen Aksu') === normalizeArtistKey('SEZEN AKSU'));
check('aksan sadeleşir', normalizeArtistKey('Şebnem Ferah') === normalizeArtistKey('Sebnem Ferah'));
check('fazla boşluk temizlenir', normalizeArtistKey('  UZI   MODD ') === 'uzi modd');
check('& korunur', normalizeArtistKey('Mumford & Sons') === 'mumford & sons');
check('boş isim boş anahtar', normalizeArtistKey('') === '');

check('ortak çalışma ayrılır', JSON.stringify(artistNamesFromRow('UZI, MODD')) === '["UZI","MODD"]');
check('feat. ayrılır', JSON.stringify(artistNamesFromRow('UZI feat. MODD')) === '["UZI","MODD"]');
check(
  'grup ismi bölünmez',
  JSON.stringify(artistNamesFromRow('Mumford & Sons')) === '["Mumford & Sons"]',
  JSON.stringify(artistNamesFromRow('Mumford & Sons'))
);
check('boş sanatçı tek boş grup', JSON.stringify(artistNamesFromRow('')) === '[""]');

check('satır eşleşmesi ortak çalışmada doğru', rowMatchesArtist('UZI, MODD', 'modd'));
check(
  'satır eşleşmesi farklı sanatçıda yanlış',
  !rowMatchesArtist('UZI, MODD', 'Duman')
);

// ─────────────────────────────────────────────────────────────────────────────
section('Kütüphane gruplaması');

const library: ArtistTrack[] = [
  track('a1', 'Düet', 'UZI, MODD'),
  track('a2', 'Solo UZI', 'UZI'),
  track('a3', 'Solo MODD', 'MODD'),
  track('a4', 'The Cave', 'Mumford & Sons'),
  track('a5', 'Kırmış Kalbini', 'Duman'),
];

const index = buildArtistIndex(library);
check('ortak çalışma iki sanatçıya da girer', getArtistTracks(index, 'uzi').length === 2);
check('MODD iki parçaya sahip', getArtistTracks(index, 'MODD').length === 2);
check('grup tek sanatçı olarak kalır', getArtistTracks(index, 'Mumford & Sons').length === 1);
check('olmayan sanatçı boş dizi', getArtistTracks(index, 'Yok Böyle').length === 0);
check(
  'görünen isim ilk karşılaşılan yazım',
  index.get('uzi')?.displayName === 'UZI',
  index.get('uzi')?.displayName
);

// ─────────────────────────────────────────────────────────────────────────────
section('Geçmiş süzme');

const rows: WrappedPlayRow[] = [
  { track_id: 'a1', played_at: '2026-01-01 10:00:00', duration_listened: 200, title: 'Düet', artist: 'UZI, MODD' },
  { track_id: 'a1', played_at: '2026-01-02 11:00:00', duration_listened: 200, title: 'Düet', artist: 'UZI, MODD' },
  { track_id: 'a2', played_at: '2026-01-03 12:00:00', duration_listened: 150, title: 'Solo UZI', artist: 'UZI' },
  { track_id: 'a5', played_at: '2026-01-04 13:00:00', duration_listened: 180, title: 'Kırmış Kalbini', artist: 'Duman' },
  { track_id: 'a9', played_at: '2026-01-05 14:00:00', duration_listened: 90, title: 'Bilinmeyen', artist: '' },
];

check('UZI satırları (ortak çalışma dahil)', filterRowsForArtist(rows, 'uzi').length === 3);
check('MODD satırları', filterRowsForArtist(rows, 'modd').length === 2);
check('Duman satırları', filterRowsForArtist(rows, 'Duman').length === 1);
check('boş sanatçı satırı hiçbir sanatçıya yazılmaz', filterRowsForArtist(rows, '').length === 0);

const uziProfile = buildArtistProfile(rows, 'UZI', { limit: 10 });
check('toplam dinleme', uziProfile.stats.totalPlays === 3, String(uziProfile.stats.totalPlays));
check('toplam süre', uziProfile.stats.totalSeconds === 550, String(uziProfile.stats.totalSeconds));
check('farklı parça', uziProfile.stats.uniqueTracks === 2, String(uziProfile.stats.uniqueTracks));
check('en çok dinlenen parça "Düet"', uziProfile.stats.topTracks[0]?.label === 'Düet');
check('en çok dinlenen 2 dinleme', uziProfile.stats.topTracks[0]?.plays === 2);
check('ilk dinleme tarihi', uziProfile.stats.firstPlayAt !== null);
check('son dinleme tarihi ilkinden sonra', (uziProfile.stats.lastPlayAt ?? 0) > (uziProfile.stats.firstPlayAt ?? 0));
check('görünen isim geçmişten', uziProfile.displayName === 'UZI', uziProfile.displayName);
check('getArtistTotalPlays aynı sonucu verir', getArtistTotalPlays(rows, 'uzi') === 3);

const counts = buildArtistTrackPlayCounts(rows, 'uzi');
check('parça dinleme sayısı haritası', counts.get('a1') === 2 && counts.get('a2') === 1);

// ─────────────────────────────────────────────────────────────────────────────
section('Sıralama (en çok dinlenen en üstte)');

const sorted = sortTracksByPlays(getArtistTracks(index, 'uzi'), counts);
check('ilk sırada en çok dinlenen', sorted[0]?.id === 'a1', sorted[0]?.title);
check('dinlenmemiş parça varsa sona düşer', sorted[sorted.length - 1]?.id !== 'a1');

const noPlays = sortTracksByPlays(
  [track('z2', 'Beta', 'X'), track('z1', 'Alfa', 'X'), track('z3', 'Gama', 'X')],
  new Map()
);
check(
  'dinleme yoksa alfabetik',
  noPlays.map((item) => item.title).join(',') === 'Alfa,Beta,Gama',
  noPlays.map((item) => item.title).join(',')
);

const top = topArtistTracks(getArtistTracks(index, 'uzi'), counts, 5);
check('top parçalar yalnızca dinlenenleri içerir', top.length === 2, String(top.length));
check('top parçalar sıralı', top[0].track.id === 'a1');
check('sıfır limiti en az bir sonuç', topArtistTracks(getArtistTracks(index, 'uzi'), counts, 0).length === 1);

// ─────────────────────────────────────────────────────────────────────────────
section('Ad yazımları (SQL ön süzmesi)');

const variants = collectArtistNameVariants(getArtistTracks(index, 'uzi'), 'uzi');
check('farklı yazımlar toplanır, düet adı ayrılır', variants.includes('UZI'), variants.join(' | '));
check('anahtara düşmeyen isim eklenmez', !variants.includes('MODD'), variants.join(' | '));
check('boş anahtar boş liste', collectArtistNameVariants(getArtistTracks(index, 'uzi'), '').length === 0);

// ─────────────────────────────────────────────────────────────────────────────
section('Ön süzülmüş satırlardan profil');

const prefiltered = filterRowsForArtist(rows, 'uzi');
const fromRows = buildArtistProfileFromRows(prefiltered, 'uzi', { limit: 10 });
check('satırlardan profil toplam dinleme', fromRows.stats.totalPlays === 3, String(fromRows.stats.totalPlays));
check('satırlardan profil toplam süre', fromRows.stats.totalSeconds === 550, String(fromRows.stats.totalSeconds));
check('satırlardan görünen isim', fromRows.displayName === 'UZI', fromRows.displayName);
check('satırlardan parça sayıları', fromRows.playCounts.get('a1') === 2 && fromRows.playCounts.get('a2') === 1);
check(
  'tam profil ile aynı sonuç',
  fromRows.stats.totalPlays === uziProfile.stats.totalPlays &&
    fromRows.stats.totalSeconds === uziProfile.stats.totalSeconds &&
    fromRows.stats.uniqueTracks === uziProfile.stats.uniqueTracks
);

// ─────────────────────────────────────────────────────────────────────────────
section('Fotoğraf ipuçları');

const hintRows: WrappedPlayRow[] = [
  ...rows,
  { track_id: 'a2', played_at: '2026-01-06 15:00:00', duration_listened: 150, title: 'Solo UZI', artist: 'UZI' },
  { track_id: 'a1', played_at: '2026-01-07 16:00:00', duration_listened: 200, title: 'Düet', artist: 'uzi, MODD' },
];

const hints = buildArtistTitleHints(hintRows);
check('düet sanatçısı da ipucu alır', hints['modd']?.includes('Düet') ?? false);
check('en çok dinlenen parça başta', hints['uzi']?.[0] === 'Düet', JSON.stringify(hints['uzi']));
check('parça sayısı sınırlanır', buildArtistTitleHints(hintRows, { perArtist: 1 })['uzi']?.length === 1);
check('boş başlık ipucuna girmez', (buildArtistTitleHints([
  { track_id: 'x', played_at: '2026-01-01 00:00:00', duration_listened: 10, title: '  ', artist: 'UZI' },
])['uzi'] ?? []).length === 0);
check('boş sanatçı anahtarı üretilmez', !('' in buildArtistTitleHints(hintRows)));
check('boş geçmiş boş harita', Object.keys(buildArtistTitleHints([])).length === 0);

// ─────────────────────────────────────────────────────────────────────────────
section('Sanatçısı boş parçalar');

const mixedTracks: ArtistTrack[] = [
  track('u1', 'Adsız', ''),
  track('u2', 'Yer Tutucu', 'Unknown Artist'),
  track('u3', 'Gerçek', 'Duman'),
  track('u4', 'Tire', '-'),
  track('u5', 'Yerel', 'Local Audio'),
];
const unassigned = getUnassignedTracks(mixedTracks);
check(
  'boş ve yer tutucu sanatçılar seçilir',
  ['u1', 'u2', 'u4', 'u5'].every((id) => unassigned.some((item) => item.id === id)),
  unassigned.map((item) => item.id).join(',')
);
check(
  'gerçek sanatçı seçilmez',
  !unassigned.some((item) => item.id === 'u3'),
  unassigned.map((item) => item.id).join(',')
);

const unknownProfile = buildArtistProfileFromRows(
  [
    { track_id: 'u1', played_at: '2026-01-01 10:00:00', duration_listened: 100, title: 'Adsız', artist: '' },
    { track_id: 'u1', played_at: '2026-01-02 10:00:00', duration_listened: 100, title: 'Adsız', artist: '' },
  ],
  '',
  { limit: 10 }
);
check('boş sanatçı profilinde dinlemeler sayılır', unknownProfile.stats.totalPlays === 2);
check('boş sanatçı playCounts üretir', unknownProfile.playCounts.get('u1') === 2);
check('boş sanatçı top parçası', unknownProfile.stats.topTracks[0]?.label === 'Adsız');
check('boş sanatçı görünen adı yok', unknownProfile.displayName === '');

// ─────────────────────────────────────────────────────────────────────────────
section('Boş veri');

const emptyProfile = buildArtistProfile([], 'Kimse');
check('boş geçmişte sıfır dinleme', emptyProfile.stats.totalPlays === 0);
check('boş geçmişte boş top parça', emptyProfile.stats.topTracks.length === 0);
check('boş haritada eşleşme yok', buildArtistIndex([]).size === 0);

console.log('\nSonuç');
if (failures === 0) {
  console.log('  TÜM TESTLER GEÇTİ.');
} else {
  console.log(`  ${failures} TEST BAŞARISIZ.`);
  (globalThis as any).process.exitCode = 1;
}
