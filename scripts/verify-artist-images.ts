/**
 * Sanatçı fotoğrafı eşleştirmesinin doğrulaması — Genius kaynağı.
 *
 * Testler gerçek Genius yanıtlarından alınmış küçük sabitler üzerinde çalışır
 * (bu makineden genius.com Cloudflare yüzünden 403 döndüğü için canlı ağ testi
 * yapılmıyor; sabitler doğrudan gerçek yanıtlardan kopyalandı).
 *
 * Neden gerekli: "Motive", "UZI" ve "aisu" gibi isimlerde birden çok kayıt
 * var ("UZI (FRA 77)", "Aisuru", "aisukii"). Doğru kaydı ve gerçek görseli
 * seçmek ağ gerektirmeyen bir sıralama problemi.
 *
 * Çalıştırma:
 *   npx tsc scripts/verify-artist-images.ts --ignoreConfig --outDir .tmp-verify \
 *     --module commonjs --target es2020 --moduleResolution bundler --skipLibCheck
 *   node .tmp-verify/scripts/verify-artist-images.js
 */

import {
  geniusArtistImageOf,
  isPlaceholderArtistImage,
  pickArtistFromSongs,
  rankGeniusArtists,
  wordSimilarity,
  type GeniusArtistLike,
  type GeniusSongLike,
} from '../src/services/artistImageMatch';

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

/** Gerçek Genius görsel yolu. */
function image(hash: string, size = '1000x1000x1'): string {
  return `https://images.genius.com/${hash}.${size}.png`;
}

const DEFAULT_COVER = 'https://assets.genius.com/images/default_cover_image.png';

function artist(
  id: number,
  name: string,
  imageUrl: string | null,
  verified = false
): GeniusArtistLike {
  return { id, name, image_url: imageUrl, is_verified: verified };
}

// ─────────────────────────────────────────────────────────────────────────────
section('Yer tutucu görsel tespiti');

check('gerçek Genius görseli kabul edilir', !isPlaceholderArtistImage(image('1a25130571d2fe35eb502fbc81952087')));
check('varsayılan kapak yer tutucu', isPlaceholderArtistImage(DEFAULT_COVER));
check(
  'varsayılan banner yer tutucu',
  isPlaceholderArtistImage('https://assets.genius.com/images/default_banner.png')
);
check('boş değer yer tutucu', isPlaceholderArtistImage('') && isPlaceholderArtistImage(null));
check('yabancı alan adı reddedilir', isPlaceholderArtistImage('https://example.com/a.jpg'));
check(
  'avatars yolu kabul edilir',
  !isPlaceholderArtistImage('https://images.genius.com/avatars/medium/ef39c675b1b299469c8cec46c2f2b4eb')
);

// ─────────────────────────────────────────────────────────────────────────────
section('Görsel seçimi (profil → banner → yok)');

check(
  'profil görseli tercih edilir',
  geniusArtistImageOf({
    image_url: image('aaa'),
    header_image_url: image('bbb', '1000x248x1'),
  }) === image('aaa')
);
check(
  'profil yoksa banner kullanılır',
  geniusArtistImageOf({
    image_url: DEFAULT_COVER,
    header_image_url: image('26b113b56b3b25b1dc75c1e48b81d458', '1000x248x1'),
  }) === image('26b113b56b3b25b1dc75c1e48b81d458', '1000x248x1')
);
check(
  'ikisi de yoksa null',
  geniusArtistImageOf({ image_url: DEFAULT_COVER, header_image_url: null }) === null
);
check('boş kayıt → null', geniusArtistImageOf(null) === null);

// ─────────────────────────────────────────────────────────────────────────────
section('Kelime benzerliği');

check('aynı isim → 1', wordSimilarity('Motive', 'Motive') === 1);
check('büyük/küçük harf yok sayılır', wordSimilarity('UZI', 'uzi') === 1);
check('ilgisiz isim → 0', wordSimilarity('MOT!VE', 'Motive') === 0);
check('boş isim → 0', wordSimilarity('', 'Uzi') === 0);

// ─────────────────────────────────────────────────────────────────────────────
section('Sanatçı araması sıralaması');

// Gerçek yanıt: genius.com/api/search/artist?q=Motive
const motiveArtists: GeniusArtistLike[] = [
  artist(1213575, 'Motive', image('1a25130571d2fe35eb502fbc81952087'), true),
];

const motiveRanked = rankGeniusArtists(motiveArtists, 'Motive');
check('Motive doğru kayıt', motiveRanked[0]?.id === 1213575, String(motiveRanked[0]?.id));

// Gerçek yanıt: genius.com/api/search/artist?q=aisu
const aisuArtists: GeniusArtistLike[] = [
  artist(2721108, 'aisu', image('5325501551ae80b356d60d71b5b0c5c0', '640x640x1')),
  artist(1736707, 'Aisuru', DEFAULT_COVER),
  artist(4419175, 'AiSuu (あいす) (VoiSona)', image('b9f3ea5e9b1101b5448baa93b082ee63', '504x504x1')),
  artist(3575292, 'aisukii', DEFAULT_COVER),
  artist(4002163, 'AiSuu', DEFAULT_COVER),
];

const aisuRanked = rankGeniusArtists(aisuArtists, 'aisu');
check('aisu doğru kayıt', aisuRanked[0]?.id === 2721108, String(aisuRanked[0]?.id));
check('aisu: yalnızca tam eşleşme kalır', aisuRanked.length === 1, String(aisuRanked.length));
check(
  'aisu: yer tutucu görsel aday olmaz',
  aisuRanked.every((item) => item.id !== 1736707 && item.id !== 4002163)
);

// Gerçek yanıt: genius.com/api/search/artist?q=UZI (benzer isimli kayıtlar)
const uziArtists: GeniusArtistLike[] = [
  artist(1715254, 'UZI', image('afad3a7744635642810285a4c79ce7a7')),
  artist(1623896, 'UZI (FRA 77)', image('0181447f17f8659f89f6892c96f213b1', '722x722x1')),
  artist(233451, 'Uzi (HT)', image('b4e4523462be369d2451532f7656ba2d', '241x241x1')),
];

const uziRanked = rankGeniusArtists(uziArtists, 'UZI');
check('UZI doğru kayıt', uziRanked[0]?.id === 1715254, String(uziRanked[0]?.id));
check('UZI: benzer isimler elenir', uziRanked.length === 1, String(uziRanked.length));

check('hiç sonuç yoksa boş', rankGeniusArtists([], 'Zzz').length === 0);
check(
  'yer tutucu görselli tek aday elenir',
  rankGeniusArtists([artist(1, 'Zzz', DEFAULT_COVER)], 'Zzz').length === 0
);
check(
  'zayıf eşleşme elenir',
  rankGeniusArtists([artist(2, 'Bambaşka', image('abcdef1234567890'))], 'Zzz').length === 0
);

// ─────────────────────────────────────────────────────────────────────────────
section('Şarkı aramasından sanatçı görseli');

// Gerçek yanıt: genius.com/api/search/multi?q=UZI Cennet
const cennetSongs: GeniusSongLike[] = [
  {
    title: 'Cennet',
    artist_names: 'UZI & Motive',
    primary_artist: artist(1715254, 'UZI', image('afad3a7744635642810285a4c79ce7a7')),
    primary_artists: [
      artist(1715254, 'UZI', image('afad3a7744635642810285a4c79ce7a7')),
      artist(1213575, 'Motive', image('1a25130571d2fe35eb502fbc81952087'), true),
    ],
  },
  {
    title: 'Cannot Stand Me*',
    primary_artist: artist(217208, 'Lil Uzi Vert', image('01c44955cc93c776e9a35ab252841cc2')),
  },
];

check(
  'UZI: şarkıdan doğru sanatçı görseli',
  pickArtistFromSongs(cennetSongs, 'UZI') === image('afad3a7744635642810285a4c79ce7a7')
);
check(
  'Motive: ortak çalışmada ikinci sanatçı da çözülür',
  pickArtistFromSongs(cennetSongs, 'Motive') === image('1a25130571d2fe35eb502fbc81952087')
);
check(
  'Lil Uzi Vert, "UZI" için seçilmez',
  pickArtistFromSongs(cennetSongs, 'UZI') !== image('01c44955cc93c776e9a35ab252841cc2')
);
check('ada eşleşme yoksa null', pickArtistFromSongs(cennetSongs, 'Zzz') === null);
check('boş isim → null', pickArtistFromSongs(cennetSongs, '') === null);
check(
  'yer tutucu görselli sanatçı atlanır',
  pickArtistFromSongs([{ primary_artist: artist(9, 'aisu', DEFAULT_COVER) }], 'aisu') === null
);
check(
  'isabet sırası korunur (ilk eşleşme kazanır)',
  pickArtistFromSongs(
    [
      { primary_artist: artist(1, 'aisu', image('aaaa1111')) },
      { primary_artist: artist(2, 'aisu', image('bbbb2222')) },
    ],
    'aisu'
  ) === image('aaaa1111')
);

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nSonuç');
if (failures === 0) {
  console.log('  TÜM TESTLER GEÇTİ.');
} else {
  console.log(`  ${failures} TEST BAŞARISIZ.`);
  (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
}
