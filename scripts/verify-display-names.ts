/**
 * Görünen isim temizleyicisinin doğrulaması.
 *
 * Tüm uygulama (oyuncu, kütüphane, istatistikler, Wrapped, scrobble) bu
 * fonksiyonların çıktısını gösterir; ham biçim yalnızca parça bilgisi düzenleme
 * ekranında kalır. Bu yüzden temizliğin gerçek sanatçı adlarını bozmadığını
 * (AC-DC, T-Pain) ve bilinen gürültü eklerini kaldırdığını doğruluyoruz.
 *
 * Çalıştırma:
 *   npx tsc scripts/verify-display-names.ts --ignoreConfig --outDir .tmp-verify \
 *     --module commonjs --target es2020 --moduleResolution bundler --skipLibCheck
 *   node .tmp-verify/scripts/verify-display-names.js
 */

import {
  cleanArtistName,
  cleanTrackFields,
  cleanTrackTitle,
  isPlaceholderArtist,
} from '../src/services/displayNames';

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

section('Sanatçı temizliği');
check('" - Topic" kaldırılır', cleanArtistName('Daft Punk - Topic') === 'Daft Punk');
check('VEVO kaldırılır', cleanArtistName('Daft Punk VEVO') === 'Daft Punk');
check('" - Official" kaldırılır', cleanArtistName('Daft Punk - Official') === 'Daft Punk');
check(
  'parantezli gürültü kaldırılır',
  cleanArtistName('Daft Punk (Official Video)') === 'Daft Punk'
);
check('tire korunur (AC-DC)', cleanArtistName('AC-DC') === 'AC-DC');
check('tire korunur (T-Pain)', cleanArtistName('T-Pain') === 'T-Pain');
check('baştaki ayraç kırpılır', cleanArtistName(' - Daft Punk - ') === 'Daft Punk');
check(
  'zincir sonekler kaldırılır',
  cleanArtistName('Daft Punk - Topic - Official') === 'Daft Punk'
);
check('boşluklar sadeleşir', cleanArtistName('  Daft   Punk  ') === 'Daft Punk');
check('dosya uzantısı kaldırılır', cleanArtistName('Daft Punk.mp3') === 'Daft Punk');

section('Yapışık kanal sonekleri');
check('"MODELOfficial" -> "MODEL"', cleanArtistName('MODELOfficial') === 'MODEL');
check('"MODEL Official" -> "MODEL"', cleanArtistName('MODEL Official') === 'MODEL');
check('"MODEL Official Music" -> "MODEL"', cleanArtistName('MODEL Official Music') === 'MODEL');
check('"MODELOfficialMusic" -> "MODEL"', cleanArtistName('MODELOfficialMusic') === 'MODEL');
check('"Official" tek başına korunur', cleanArtistName('Official') === 'Official');
check('"Music Channel" tek başına korunur', cleanArtistName('Music Channel') === 'Music Channel');
check('"Mumford & Sons" korunur', cleanArtistName('Mumford & Sons') === 'Mumford & Sons');

section('HTML &');
check('"&amp;" virgüle döner', cleanArtistName('A &amp; B') === 'A, B');
check('"&#38;" virgüle döner', cleanArtistName('A &#38; B') === 'A, B');
check('"&#x26;" virgüle döner', cleanArtistName('A &#x26; B') === 'A, B');

section('Yer tutucular');
check('Unknown Artist', isPlaceholderArtist('Unknown Artist'));
check('Bilinmeyen Sanatçı', isPlaceholderArtist('Bilinmeyen Sanatçı'));
check('Local Audio', isPlaceholderArtist('Local Audio'));
check('boş', isPlaceholderArtist('   '));
check('gerçek ad yer tutucu değil', !isPlaceholderArtist('Daft Punk'));
check('yer tutucu boş döner', cleanArtistName('Unknown Artist') === '');

section('Başlık temizliği');
check(
  'sanatçı öneki kırpılır',
  cleanTrackTitle('Daft Punk - One More Time', 'Daft Punk') === 'One More Time'
);
check(
  'parantezli etiket kaldırılır',
  cleanTrackTitle('One More Time (Official Video)', 'Daft Punk') === 'One More Time'
);
check('dosya uzantısı kaldırılır', cleanTrackTitle('One More Time.mp3') === 'One More Time');
check('boş başlık boş kalır', cleanTrackTitle('   ') === '');

section('Birlikte temizlik');
const fields = cleanTrackFields('Daft Punk - One More Time (Official Video).mp3', 'Daft Punk - Topic');
check('başlık temiz', fields.title === 'One More Time', fields.title);
check('sanatçı temiz', fields.artist === 'Daft Punk', fields.artist);

section('Sonuç');
if (failures === 0) {
  console.log('  TÜM TESTLER GEÇTİ.');
} else {
  console.log(`  ${failures} TEST BAŞARISIZ.`);
  throw new Error(`${failures} doğrulama başarısız`);
}
