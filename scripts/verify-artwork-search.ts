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
import { clearLrcRedCache } from '../src/services/lrcRed';

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
  makeResult('Kırmış Kalbini', 'Duman', 'url-b', 'genius'),
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
  makeResult('Aynı', 'Sanatçı', 'dup', 'genius'),
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
function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
    },
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

/** Ağ taklidi: lrc.red kapağı, iTunes kapağı, Genius hatası. */
async function mockedChecks(): Promise<void> {
  const originalFetch = (globalThis as any).fetch;

  const lrcHits = [
    {
      isrc: 'TR0310600024',
      title: 'Kırmış Kalbini',
      artist: 'Duman',
      album: 'Söyle Ruhum',
      duration: 260,
      cover: 'https://lrc.red/s/TR0310600024.webp',
    },
    {
      isrc: 'TR0310600025',
      title: 'Kırmış Kalbini (Live)',
      artist: 'Duman',
      album: 'Konser',
      duration: 300,
      cover: 'https://lrc.red/s/TR0310600025.webp',
    },
  ];

  // 1) Yalnızca lrc.red ayakta; iTunes ve Genius hata veriyor.
  (globalThis as any).fetch = async (url: unknown) => {
    const u = String(url);
    if (u.includes('lrc.red/search.json')) return jsonResponse({ hits: lrcHits });
    throw new Error('kaynak kapalı');
  };
  clearLrcRedCache();
  const onlyLrc = await searchOnlineArtwork('Kırmış Kalbini', 'Duman');
  check('lrc.red tek başına sonuç döndürür', onlyLrc.length > 0, String(onlyLrc.length));
  check(
    'lrc.red kaynağı etiketlenir',
    onlyLrc.every((item) => item.source === 'lrc.red'),
    JSON.stringify(onlyLrc.map((item) => item.source))
  );
  check(
    'lrc.red kapak URL’i kullanılır',
    onlyLrc[0]?.artworkUrl === 'https://lrc.red/s/TR0310600024.webp',
    onlyLrc[0]?.artworkUrl
  );
  check(
    'lrc.red albüm adı taşınır',
    onlyLrc[0]?.albumName === 'Söyle Ruhum',
    onlyLrc[0]?.albumName
  );
  check(
    'eşleşen kayıt ilk sırada',
    onlyLrc[0]?.trackName === 'Kırmış Kalbini',
    onlyLrc[0]?.trackName
  );

  // 2) lrc.red boş; iTunes çalışıyor → iTunes sonucu kullanılır.
  (globalThis as any).fetch = async (url: unknown) => {
    const u = String(url);
    if (u.includes('lrc.red/search.json')) return jsonResponse({ hits: [] });
    if (u.includes('itunes.apple.com')) {
      return jsonResponse({
        results: [
          {
            trackId: 42,
            trackName: 'Kırmış Kalbini',
            artistName: 'Duman',
            collectionName: 'Söyle Ruhum',
            artworkUrl100: 'https://is1.mzstatic.com/100x100bb.jpg',
          },
        ],
      });
    }
    return jsonResponse({}, 403);
  };
  clearLrcRedCache();
  const onlyItunes = await searchOnlineArtwork('Kırmış Kalbini', 'Duman');
  check('lrc.red boşsa iTunes kullanılır', onlyItunes.length === 1, String(onlyItunes.length));
  check('iTunes kaynağı etiketlenir', onlyItunes[0]?.source === 'itunes');

  // 3) Aynı parça iki kaynakta: lrc.red kapağı öne geçer.
  (globalThis as any).fetch = async (url: unknown) => {
    const u = String(url);
    if (u.includes('lrc.red/search.json')) return jsonResponse({ hits: [lrcHits[0]] });
    if (u.includes('itunes.apple.com')) {
      return jsonResponse({
        results: [
          {
            trackId: 42,
            trackName: 'Kırmış Kalbini',
            artistName: 'Duman',
            artworkUrl100: 'https://is1.mzstatic.com/100x100bb.jpg',
          },
        ],
      });
    }
    return jsonResponse({}, 403);
  };
  clearLrcRedCache();
  const both = await searchOnlineArtwork('Kırmış Kalbini', 'Duman');
  check(
    'eşit benzerlikte lrc.red kapağı ilk sırada',
    both[0]?.source === 'lrc.red',
    JSON.stringify(both.map((item) => item.source))
  );

  (globalThis as any).fetch = originalFetch;
  clearLrcRedCache();
}

// ─────────────────────────────────────────────────────────────────────────────

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
  section('Kaynak birleştirme (taklit ağ)');
  await mockedChecks();

  section('Canlı ağ testi (lrc.red + iTunes + Genius)');
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
