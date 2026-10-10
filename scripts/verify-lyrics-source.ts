/**
 * Şarkı sözü kaynak tercihi doğrulaması.
 *
 * Yeni "Tercih edilen kaynak" ayarının gerçekten ağ isteklerinin SIRASINI
 * değiştirdiğini kanıtlar. `fetch` taklit edilir ve hangi adreslere gidildiği
 * kaydedilir.
 *
 * Çalıştırma:
 *   npx tsc scripts/verify-lyrics-source.ts --ignoreConfig --outDir .tmp-verify \
 *     --module commonjs --target es2020 --moduleResolution bundler --skipLibCheck
 *   node .tmp-verify/scripts/verify-lyrics-source.js
 */

import { fetchLyricsOnline } from '../src/services/lyricsService';

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

// ─────────────────────────────────────────────────────────────────────────────
// fetch taklidi
// ─────────────────────────────────────────────────────────────────────────────

let calls: string[] = [];
let lrclibResults: any[] = [];

const lrclibHit = {
  id: 1,
  trackName: 'Song',
  artistName: 'Artist',
  albumName: 'Album',
  duration: 200,
  syncedLyrics: '[00:01.00] hello world',
  plainLyrics: 'hello world',
  lyricsfile: null,
  hasWordSync: false,
};

const geniusSearchBody = {
  response: {
    sections: [
      {
        type: 'song',
        hits: [
          {
            result: {
              id: 9,
              title: 'Song',
              primary_artist: { name: 'Artist' },
              url: 'https://genius.com/artist-song-lyrics',
            },
          },
        ],
      },
    ],
  },
};

const geniusHtml = `<div data-lyrics-container="true">${'la la la '.repeat(30)}</div>`;

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

(globalThis as any).fetch = async (url: unknown) => {
  const u = String(url);
  calls.push(u);

  // Doğrudan /api/get bilerek başarısız: arama stratejilerine düşsün.
  if (u.includes('lrclib.net/api/get')) return jsonResponse({}, 404);
  if (u.includes('lrclib.net/api/search')) return jsonResponse(lrclibResults);
  if (u.includes('genius.com/api/search')) return jsonResponse(geniusSearchBody);
  if (u.includes('genius.com/')) return { ...jsonResponse({}), text: async () => geniusHtml };
  return jsonResponse({}, 404);
};

function touched(host: string): boolean {
  return calls.some((u) => u.includes(host));
}

function reset(results: any[]) {
  calls = [];
  lrclibResults = results;
}

// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
section('1) lrclib_first (varsayılan) — LRCLIB bulunca Genius çağrılmaz');

{
  reset([lrclibHit]);
  const res = await fetchLyricsOnline('Song', 'Artist', 'lrclib_first');
  check('sonuç LRCLIB kaynaklı', res?.source === 'lrclib', String(res?.source));
  check('LRCLIB sorgulandı', touched('lrclib.net'));
  check('Genius HİÇ çağrılmadı', !touched('genius.com'), calls.join(' | '));
}

section('2) lrclib_first — LRCLIB boşsa Genius yedeği çalışır');

{
  reset([]);
  const res = await fetchLyricsOnline('Song', 'Artist', 'lrclib_first');
  check('sonuç Genius kaynaklı', res?.source === 'genius', String(res?.source));
  check('LRCLIB önce denendi', touched('lrclib.net'));
  check('Genius yedek olarak çağrıldı', touched('genius.com'));
  check(
    'Genius çağrısı LRCLIB sonrası geldi',
    calls.findIndex((u) => u.includes('lrclib.net')) < calls.findIndex((u) => u.includes('genius.com'))
  );
}

section('3) genius_first — önce Genius, o bulunca LRCLIB çağrılmaz');

{
  reset([lrclibHit]);
  const res = await fetchLyricsOnline('Song', 'Artist', 'genius_first');
  check('sonuç Genius kaynaklı', res?.source === 'genius', String(res?.source));
  check('Genius önce denendi', touched('genius.com'));
  check('LRCLIB hiç çağrılmadı', !touched('lrclib.net'), calls.join(' | '));
}

section('4) lrclib_only — Genius ASLA çağrılmaz');

{
  reset([lrclibHit]);
  const ok = await fetchLyricsOnline('Song', 'Artist', 'lrclib_only');
  check('LRCLIB bulunca sonuç döner', ok?.source === 'lrclib');
  check('Genius çağrılmadı', !touched('genius.com'));

  reset([]);
  const none = await fetchLyricsOnline('Song', 'Artist', 'lrclib_only');
  check('LRCLIB boşsa null döner', none === null, String(none));
  check('yine de Genius çağrılmadı', !touched('genius.com'), calls.join(' | '));
}

section('5) Varsayılan davranış lrclib_first ile aynı');

{
  reset([lrclibHit]);
  const def = await fetchLyricsOnline('Song', 'Artist');
  check('tercih verilmezse LRCLIB birinci', def?.source === 'lrclib');
  check('Genius çağrılmadı', !touched('genius.com'));

  reset([]);
  const fallback = await fetchLyricsOnline('Song', 'Artist');
  check('tercih verilmezse Genius yedeği de çalışır', fallback?.source === 'genius');
}

section('6) Sorgu hâlâ tire içermiyor');

{
  reset([lrclibHit]);
  await fetchLyricsOnline('Artist - Song', 'Artist', 'lrclib_first');
  const searchUrls = calls.filter((u) => u.includes('lrclib.net/api/search'));
  const anyDash = searchUrls.some((u) => /\bq=[^&]*-/.test(decodeURIComponent(u)));
  check('LRCLIB arama sorgularında tire yok', !anyDash, searchUrls.join(' | '));
}

// ─────────────────────────────────────────────────────────────────────────────

section('Sonuç');
if (failures === 0) {
  console.log('  TÜM TESTLER GEÇTİ ✅');
} else {
  console.log(`  ${failures} TEST BAŞARISIZ ❌`);
  throw new Error(`${failures} doğrulama başarısız`);
}
}

main().catch((e) => {
  console.error(e);
  throw e;
});
