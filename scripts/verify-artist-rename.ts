/**
 * Sanatçı adı değiştirme/birleştirme doğrulaması.
 *
 * `renameArtistInField` hem `metadataMap` yazımında hem istatistik geçmişinin
 * SQLite güncellemesinde kullanılıyor. Testler ortak çalışmaların korunmasını,
 * eşleşmeyen satırın dokunulmamasını ve yeni adla birleşmeyi doğrular.
 *
 * Çalıştırma:
 *   npx tsc scripts/verify-artist-rename.ts --ignoreConfig --outDir .tmp-verify \
 *     --module commonjs --target es2020 --moduleResolution bundler --skipLibCheck
 *   node .tmp-verify/scripts/verify-artist-rename.js
 */

import { renameArtistInField } from '../src/services/artistRename';
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

function section(title: string): void {
  console.log(`\n${title}`);
}

section('Tek sanatçı');
check(
  'Mavi Solman -> Mavi',
  renameArtistInField('Mavi Solman', 'Mavi Solman', 'Mavi') === 'Mavi'
);
check(
  'eşleşmeyen satır null döner',
  renameArtistInField('UZI', 'Mavi Solman', 'Mavi') === null
);
check(
  'büyük/küçük harf eşleşir',
  renameArtistInField('MAVI SOLMAN', 'Mavi Solman', 'Mavi') === 'Mavi'
);
check('aynı ada çevirme null döner', renameArtistInField('Mavi', 'Mavi', 'Mavi') === null);

section('Ortak çalışmalar');
check(
  'diğer sanatçı korunur',
  renameArtistInField('Mavi Solman, UZI', 'Mavi Solman', 'Mavi') === 'Mavi, UZI'
);
check(
  'feat. ayracı korunur',
  renameArtistInField('UZI feat. Mavi Solman', 'Mavi Solman', 'Mavi') === 'UZI, Mavi'
);
check(
  'HTML & ayrı sanatçı sayılır',
  renameArtistInField('Mavi Solman &amp; UZI', 'Mavi Solman', 'Mavi') === 'Mavi, UZI'
);
check(
  'düz & grup adı korunur',
  renameArtistInField('Mumford & Sons', 'Mumford & Sons', 'Mumford') === 'Mumford'
);

section('Birleştirme');
check(
  'aynı ada iki kez düşmez',
  renameArtistInField('Mavi Solman, Mavi', 'Mavi Solman', 'Mavi') === 'Mavi'
);
check(
  'birleşme sonrası sıra korunur',
  renameArtistInField('UZI, Mavi Solman', 'Mavi Solman', 'Mavi') === 'UZI, Mavi'
);

section('Sonrası: ayrıştırma');
const merged = renameArtistInField('Mavi Solman, UZI', 'Mavi Solman', 'Mavi') ?? '';
check('iki sanatçı ayrışır', artistNamesFromRow(merged).length === 2, merged);
check(
  'yeni ad ilk sırada',
  artistNamesFromRow(merged)[0] === 'Mavi',
  JSON.stringify(artistNamesFromRow(merged))
);

section('Sonuç');
if (failures === 0) {
  console.log('  TÜM TESTLER GEÇTİ.');
} else {
  console.log(`  ${failures} TEST BAŞARISIZ.`);
  throw new Error(`${failures} doğrulama başarısız`);
}
