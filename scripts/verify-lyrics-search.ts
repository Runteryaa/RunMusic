/**
 * Söz önbelleği arama doğrulaması.
 *
 * Gerçek uygulama mantığı kullanılır (src/services/lyricsSearch.ts), kopyası
 * değil. Dosya yalnızca saf TypeScript import ettiği için Node üzerinde çalışır.
 *
 * Çalıştırma:
 *   npx tsc scripts/verify-lyrics-search.ts --ignoreConfig --outDir .tmp-verify \
 *     --module commonjs --target es2020 --moduleResolution bundler --skipLibCheck
 *   node .tmp-verify/scripts/verify-lyrics-search.js
 */

import { searchLyricsCache, searchCachedLyricsCandidates } from '../src/services/lyricsSearch';
import type { LyricsCacheEntry } from '../src/services/persistSanitize';

let failures = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

const TRACK = { id: 'a1', uri: 'file:///a1.mp3', title: 'Parça', artist: 'Sanatçı' };

const LYRICS = [
  'Birinci satır burada',
  'İkinci satır burada',
  'Aradığım dize burada geçiyor',
  'Dördüncü satır',
  'Beşinci satır',
  'Altıncı satır',
].join('\n');

/** Test için eksiksiz bir söz kaydı üretir (LyricsResult alanları zorunlu). */
function entry(plainLyrics: string): LyricsCacheEntry {
  return {
    id: 'a1',
    trackName: 'Parça',
    artistName: 'Sanatçı',
    syncedLyrics: null,
    plainLyrics,
    parsedLines: [],
    source: 'lrclib',
  };
}

const cache: Record<string, LyricsCacheEntry> = {
  a1: entry(LYRICS),
};

// ─────────────────────────────────────────────────────────────────────────────

section('1) Eşleşme ve önizleme');

const hits = searchLyricsCache(cache, [TRACK], 'aradığım');
check('eşleşen parça bulunur', hits.length === 1, String(hits.length));
check(
  'önizleme eşleşen satırı içerir',
  !!hits[0]?.snippet.includes('Aradığım dize'),
  hits[0]?.snippet
);
check('önizleme tek satırdır', !hits[0]?.snippet.includes('\n'), hits[0]?.snippet);

section('2) Genişletilebilir ayrıntı (bağlam)');

const details = hits[0]?.details ?? '';
check('ayrıntı eşleşen satırı içerir', details.includes('Aradığım dize'));
check('ayrıntı önceki satırı içerir', details.includes('İkinci satır'));
check('ayrıntı sonraki satırı içerir', details.includes('Dördüncü satır'));
check('ayrıntı çok satırlıdır', details.includes('\n'));
check('önizleme ile ayrıntı farklı', hits[0]?.snippet !== details);

section('3) Önizleme uzunluğu sınırlı');

const longLine = `${'kelime '.repeat(60)}hedef`;
const longCache: Record<string, LyricsCacheEntry> = {
  a1: entry(longLine),
};
const longHits = searchLyricsCache(longCache, [TRACK], 'hedef');
check('uzun satır kısaltılır', (longHits[0]?.snippet.length ?? 0) <= 91, String(longHits[0]?.snippet.length));
check('kısaltma üç nokta ile biter', (longHits[0]?.snippet ?? '').endsWith('…'));
check(
  'ayrıntı genişletmede tam satırı taşır',
  (longHits[0]?.details.length ?? 0) > (longHits[0]?.snippet.length ?? 0)
);

section('4) Türkçe diyakritikten bağımsız arama');

const turkishHits = searchLyricsCache(cache, [TRACK], 'aradigim');
check('diakritiksiz sorgu eşleşir', turkishHits.length === 1, String(turkishHits.length));

section('5) Kısa sorgu ve boş sonuç');

check('tek karakterli sorgu aramaz', searchLyricsCache(cache, [TRACK], 'a').length === 0);
check('eşleşmeyen sorgu boş döner', searchLyricsCache(cache, [TRACK], 'zzzz').length === 0);
check('boş kitaplık boş döner', searchLyricsCache(cache, [], 'aradığım').length === 0);

section('6) Ref (kanonik kayıt) çözümleme');

const refCache: Record<string, LyricsCacheEntry> = {
  a1: { ref: 'canonical' },
  canonical: entry(LYRICS),
};
const refHits = searchLyricsCache(refCache, [TRACK], 'aradığım');
check('ref üzerinden eşleşir', refHits.length === 1, String(refHits.length));
check('ref sonucu ayrıntı taşır', !!refHits[0]?.details.includes('Aradığım dize'));

section('7) Ayrıntı her zaman önizlemeden uzundur');

/*
 * "Genişlet" düğmesi yalnızca `details` önizlemeden farklıysa görünür. Tek
 * satırlık sözlerde bağlam penceresi de tek satır kalıyordu ve düğme hiç
 * çıkmıyordu; kutu genişletilemez görünüyordu.
 */
const singleCache: Record<string, LyricsCacheEntry> = {
  a1: entry(`${'kelime '.repeat(40)}hedef ve devamı`),
};
const singleHits = searchLyricsCache(singleCache, [TRACK], 'hedef');
check('tek satırlık sözde sonuç bulunur', singleHits.length === 1, String(singleHits.length));
check(
  'tek satırlık uzun sözde ayrıntı önizlemeden uzundur',
  (singleHits[0]?.details.length ?? 0) > (singleHits[0]?.snippet.length ?? 0),
  `${singleHits[0]?.details.length} / ${singleHits[0]?.snippet.length}`
);

for (const [index, hit] of hits.entries()) {
  check(
    `sonuç ${index + 1}: ayrıntı önizlemeden uzun`,
    hit.details.length > hit.snippet.length,
    `${hit.details.length} / ${hit.snippet.length}`
  );
}

section('8) Genişletilmiş ayrıntı sınırı');

const hugeLine = Array.from({ length: 200 }, (_, i) => `satır ${i} hedef`).join('\n');
const hugeHits = searchLyricsCache({ a1: entry(hugeLine) }, [TRACK], 'hedef');
check(
  'ayrıntı en fazla 600 karakter',
  (hugeHits[0]?.details.length ?? 0) <= 600,
  String(hugeHits[0]?.details.length)
);

// ─────────────────────────────────────────────────────────────────────────────

section('9) Çevrimdışı arama — önbellekteki sözlerden aday üretimi');

const offlineByName = searchCachedLyricsCandidates(cache, 'parça');
check('parça adıyla eşleşir', offlineByName.length === 1, String(offlineByName.length));
check(
  'adayda tam söz sonucu taşınır',
  offlineByName[0]?.result.plainLyrics === LYRICS
);
check(
  'aday kimliği önbellek kaydını işaretler',
  offlineByName[0]?.candidate.id.startsWith('cache:'),
  offlineByName[0]?.candidate.id
);

const offlineByText = searchCachedLyricsCandidates(cache, 'aradığım');
check('söz satırıyla eşleşir', offlineByText.length === 1, String(offlineByText.length));

const offlineRef = searchCachedLyricsCandidates(refCache, 'aradığım');
check('ref kaydı çözülerek eşleşir', offlineRef.length === 1, String(offlineRef.length));

check('eşleşmeyen sorgu boş döner', searchCachedLyricsCandidates(cache, 'zzzz').length === 0);
check('tek karakterli sorgu aramaz', searchCachedLyricsCandidates(cache, 'a').length === 0);

// ─────────────────────────────────────────────────────────────────────────────

section('Sonuç');
if (failures === 0) {
  console.log('  TÜM TESTLER GEÇTİ ✅');
} else {
  console.log(`  ${failures} TEST BAŞARISIZ ❌`);
  throw new Error(`${failures} doğrulama başarısız`);
}
