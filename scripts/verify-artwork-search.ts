/**
 * Kapak arama servisinin doğrulaması.
 *
 * İki bölüm var:
 *  1. Saf yardımcılar: sorgu üretimi ve sonuç sıralama/filtreleme.
 *  2. Canlı ağ testi: gerçek parçalar için kaç kapak bulunduğu. Ağ yoksa
 *     bu bölüm atlanır (test başarısız sayılmaz).
 *
 * Çalıştırma:
 *   npx tsc scripts/verify-artwork-search.ts --ignoreConfig --outDir .tmp-verify \
 *     --module commonjs --target es2020 --moduleResolution bundler --skipLibCheck
 *   node .tmp-verify/scripts/verify-artwork-search.js
 */

import {
  MAX_ARTWORK_RESULTS,
  MIN_ARTWORK_SCORE,
  buildArtworkQueries,
  rankArtworkResults,
  searchOnlineArtwork,
  type OnlineArtworkResult,
} from '../src/services/artworkSearchService';

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

function makeResult(
  trackName: string,
  artistName: string,
  artworkUrl: string,
  source: OnlineArtworkResult['source'] = 'itunes'
): OnlineArtworkResult {
  return {
    id: artworkUrl,
    trackName,
    artistName,
    artworkUrl,
    thumbnailUrl: artworkUrl,
    source,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
section('Sorgu üretimi');

const queries = buildArtworkQueries('Kırmış Kalbini', 'Duman');
check('ilk sorgu parça + sanatçı', queries[0] === 'Kırmış Kalbini Duman', JSON.stringify(queries));
check('ikinci sorgu yalnızca parça', queries[1] === 'Kırmış Kalbini');
check('üçüncü sorgu yalnızca sanatçı', queries[2] === 'Duman');

const noArtist = buildArtworkQueries('Yalnız Parça', '');
check('sanatçı yoksa tekilleştirilir', noArtist.length === 1 && noArtist[0] === 'Yalnız Parça');

const withExt = buildArtworkQueries('şarkı.mp3', 'UZI, MODD');
check('dosya uzantısı temizlenir', withExt[0] === 'şarkı UZI, MODD', JSON.stringify(withExt));

check('boş istek sorgu üretmez', buildArtworkQueries('', '').length === 0);

// ─────────────────────────────────────────────────────────────────────────────
section('Sıralama ve filtreleme');

const mixed = [
  makeResult('Take Your Time', 'Sam Hunt', 'url-a'),
  makeResult('Kırmış Kalbini', 'Duman', 'url-b', 'deezer'),
  makeResult('Senden Daha Güzel', 'Duman', 'url-c'),
];

const ranked = rankArtworkResults(mixed, 'Duman', 'Kırmış Kalbini');
check('en uygun sonuç başta', ranked[0].artworkUrl === 'url-b', ranked[0]?.trackName);
check(
  'alakasız sonuç elenir',
  !ranked.some((item) => item.artworkUrl === 'url-a'),
  JSON.stringify(ranked.map((item) => item.trackName))
);
check(
  'aynı sanatçının diğer parçası eşiği geçer',
  ranked.some((item) => item.artworkUrl === 'url-c')
);

const duplicates = [
  makeResult('Aynı', 'Sanatçı', 'dup'),
  makeResult('Aynı', 'Sanatçı', 'dup', 'deezer'),
];
check('aynı kapak URL tekrarlanmaz', rankArtworkResults(duplicates, 'Sanatçı', 'Aynı').length === 1);

const irrelevantOnly = [makeResult('Tamamen Farklı', 'Başka Biri', 'only')];
check(
  'hiçbiri eşiği geçmezse en iyi sonuç yine gösterilir',
  rankArtworkResults(irrelevantOnly, 'Duman', 'Kırmış Kalbini').length === 1
);

const many = Array.from({ length: 30 }, (_, i) =>
  makeResult('Kırmış Kalbini', 'Duman', `many-${i}`)
);
check(
  'sonuç sayısı sınırlanır',
  rankArtworkResults(many, 'Duman', 'Kırmış Kalbini').length === MAX_ARTWORK_RESULTS
);
check('eşik pozitif', MIN_ARTWORK_SCORE > 0);

// ─────────────────────────────────────────────────────────────────────────────
section('Canlı ağ testi (iTunes + Deezer)');

async function liveCheck(title: string, artist: string): Promise<void> {
  try {
    const results = await searchOnlineArtwork(title, artist);
    const top = results[0];
    check(
      `"${title} / ${artist}" için kapak bulundu`,
      results.length > 0,
      'sonuç yok'
    );
    if (top) {
      console.log(
        `      bilgi: ${results.length} sonuç, ilk = "${top.trackName} / ${top.artistName}" (${top.source})`
      );
      check(`"${title}" ilk sonuç aranan parça`, top.trackName.toLowerCase().includes(title.toLowerCase().slice(0, 6)));
    }
  } catch (error) {
    console.log(`  SKIP  ağ hatası: ${(error as Error).message}`);
  }
}

async function main(): Promise<void> {
  await liveCheck('Kırmış Kalbini', 'Duman');
  await liveCheck('Senden Daha Güzel', 'Duman');
  await liveCheck('Hadi Bakalım', 'Sezen Aksu');

  console.log('\nSonuç');
  if (failures === 0) {
    console.log('  TÜM TESTLER GEÇTİ.');
  } else {
    console.log(`  ${failures} TEST BAŞARISIZ.`);
    // Node'un tip tanımı bu betikte yok; süreç kodu any üzerinden ayarlanır.
    (globalThis as any).process.exitCode = 1;
  }
}

void main();
