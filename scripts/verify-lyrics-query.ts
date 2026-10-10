/**
 * LRCLIB arama sorgusu doğrulaması.
 *
 * Gerçek uygulama mantığı kullanılır (src/services/lyricsService.ts), kopyası
 * değil. `lyricsService` hiç import içermediği için Node üzerinde çalışır.
 *
 * Çalıştırma:
 *   npx tsc scripts/verify-lyrics-query.ts --ignoreConfig --outDir .tmp-verify \
 *     --module commonjs --target es2020 --moduleResolution bundler --skipLibCheck
 *   node .tmp-verify/scripts/verify-lyrics-query.js
 */

import { buildLrclibSearchUrl, sanitizeLrclibQuery } from '../src/services/lyricsService';

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

/** URL'den tek bir parametrenin çözülmüş değerini okur. */
function param(url: string, key: string): string | null {
  const qs = url.split('?')[1] ?? '';
  for (const pair of qs.split('&')) {
    const [k, v = ''] = pair.split('=');
    if (decodeURIComponent(k) === key) return decodeURIComponent(v);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────

section('1) sanitizeLrclibQuery — tire ailesi temizliği');

check('normal tire kaldırılır', sanitizeLrclibQuery('Duman - Kırım') === 'Duman Kırım');
check('tire boşluğa dönüşür (kelimeler birleşmez)', sanitizeLrclibQuery('Love-Hate') === 'Love Hate');
check('en dash (–) kaldırılır', sanitizeLrclibQuery('A – B') === 'A B');
check('em dash (—) kaldırılır', sanitizeLrclibQuery('A — B') === 'A B');
check('hyphen (‐) kaldırılır', sanitizeLrclibQuery('A ‐ B') === 'A B');
check('minus (−) kaldırılır', sanitizeLrclibQuery('A − B') === 'A B');
check(
  'birden fazla ayırıcı temizlenir',
  sanitizeLrclibQuery('A - – — B') === 'A B',
  sanitizeLrclibQuery('A - – — B')
);
check('tire yoksa dokunulmaz', sanitizeLrclibQuery('Duman Kırım') === 'Duman Kırım');

section('2) sanitizeLrclibQuery — boşluk ve karakterler');

check('baş/son boşluk kırpılır', sanitizeLrclibQuery('   A B   ') === 'A B');
check('çoklu boşluk teke iner', sanitizeLrclibQuery('A     B') === 'A B');
check('tire sonrası boşluk teke iner', sanitizeLrclibQuery('A -   B') === 'A B');
check('Türkçe karakterler korunur', sanitizeLrclibQuery('Şımarık - Tarkan') === 'Şımarık Tarkan');
check('yalnızca tire -> boş string', sanitizeLrclibQuery(' - ') === '');
check('boş string güvenli', sanitizeLrclibQuery('') === '');
check('noktalama korunur (yalnızca tire hedeflenir)', sanitizeLrclibQuery('A, B! (C)') === 'A, B! (C)');

section('3) buildLrclibSearchUrl — q temizlenir');

{
  const url = buildLrclibSearchUrl({ q: 'Duman - Kırım' });
  check('URL tirе içermiyor', !decodeURIComponent(url).includes('-'), url);
  check('q temizlenmiş halde', param(url, 'q') === 'Duman Kırım', String(param(url, 'q')));

  const url2 = buildLrclibSearchUrl({ q: 'Tarkan – Şımarık' });
  check('en dash de temizlenir', param(url2, 'q') === 'Tarkan Şımarık', String(param(url2, 'q')));
}

section('4) buildLrclibSearchUrl — q DIŞINDAKİLER korunur');

{
  // Birebir eşleşme parametreleri: gerçek adında tire olan parçalar bozulmasın.
  const url = buildLrclibSearchUrl({ track_name: 'Love-Hate', artist_name: 'A-B' });
  check('track_name tirie dokunulmaz', param(url, 'track_name') === 'Love-Hate');
  check('artist_name tirie dokunulmaz', param(url, 'artist_name') === 'A-B');

  const mixed = buildLrclibSearchUrl({ track_name: 'Love-Hate', q: 'A - B' });
  check('aynı istekte q temizlenir, track_name korunur',
    param(mixed, 'q') === 'A B' && param(mixed, 'track_name') === 'Love-Hate');
}

section('5) buildLrclibSearchUrl — boş/geçersiz girdiler');

{
  check('boş q tamamen düşürülür', !buildLrclibSearchUrl({ q: '   ' }).includes('q='));
  check('yalnızca tireden oluşan q düşürülür', !buildLrclibSearchUrl({ q: ' - ' }).includes('q='));
  check(
    'boş parametreler atlanır',
    buildLrclibSearchUrl({ q: '', track_name: 'X', artist_name: '' }) ===
      'https://lrclib.net/api/search?track_name=X'
  );
  check(
    'hiç parametre yoksa temel URL döner',
    buildLrclibSearchUrl({}) === 'https://lrclib.net/api/search?'
  );
}

section('6) buildLrclibSearchUrl — kodlama');

{
  const url = buildLrclibSearchUrl({ q: 'A & B' });
  check('özel karakterler kodlanır', url.includes('q=A%20%26%20B'), url);
  check('kodlanmış değer doğru çözülür', param(url, 'q') === 'A & B');

  const turkish = buildLrclibSearchUrl({ q: 'Şımarık' });
  check('Türkçe karakter kodlanıp geri çözülür', param(turkish, 'q') === 'Şımarık');
}

// ─────────────────────────────────────────────────────────────────────────────

section('Sonuç');
if (failures === 0) {
  console.log('  TÜM TESTLER GEÇTİ ✅');
} else {
  console.log(`  ${failures} TEST BAŞARISIZ ❌`);
  throw new Error(`${failures} doğrulama başarısız`);
}
