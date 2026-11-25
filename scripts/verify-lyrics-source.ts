/**
 * Şarkı sözü sağlayıcı sırası + Apple TTML parser doğrulaması.
 *
 * Üç kaynağın (lrc.red → LRCLIB → Genius) gerçekten bu sırayla ve birbirinin
 * yedeği olarak çalıştığını, lrc.red'in doğru kaydı seçtiğini ve TTML
 * parser'ının hece/arka vokal/ara boşluk kurallarını uyguladığını kanıtlar.
 * `fetch` taklit edilir; ağa çıkılmaz.
 *
 * Çalıştırma:
 *   npx tsc scripts/verify-lyrics-source.ts --ignoreConfig --outDir .tmp-verify \
 *     --module commonjs --target es2020 --moduleResolution bundler --skipLibCheck
 *   node .tmp-verify/scripts/verify-lyrics-source.js
 */

import {
  fetchLyricsOnline,
  parseTtml,
  buildLyricRows,
  splitBackgroundVocals,
  isGeniusSectionHeader,
  getGeniusSectionLabel,
} from '../src/services/lyricsService';
import { clearLrcRedCache } from '../src/services/lrcRed';

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

const STUDIO_ISRC = 'USABC1234567';
const LIVE_ISRC = 'USABC7654321';

const TTML_DOC = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:lrc="http://lrc.red/lyric-ttml-internal" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" lrc:timing="Word" xml:lang="en">
  <head>
    <metadata>
      <ttm:agent type="person" xml:id="v1"><ttm:name type="full">Artist</ttm:name></ttm:agent>
      <ttm:agent type="person" xml:id="v2"><ttm:name type="full">Guest</ttm:name></ttm:agent>
    </metadata>
  </head>
  <body dur="3:20.000">
    <div begin="0.000" end="20.000" lrc:songPart="Verse">
      <p begin="1.000" end="3.000" lrc:key="L1" ttm:agent="v1"><span begin="1.000" end="1.500">Hello</span> <span begin="1.500" end="2.000">world</span> <span ttm:role="x-bg"><span begin="2.000" end="2.500">(echo</span> <span begin="2.500" end="3.000">now)</span></span></p>
      <p begin="10.000" end="12.000" lrc:key="L2" ttm:agent="v1"><span begin="10.000" end="11.000">Second</span> <span begin="11.000" end="12.000">line</span></p>
      <p begin="12.000" end="14.000" lrc:key="L3" ttm:agent="v2"><span begin="12.000" end="13.000">Duet</span> <span begin="13.000" end="14.000">answer</span></p>
    </div>
  </body>
</tt>`;

let calls: string[] = [];
let lrcHits: any[] = [];
let lrclibResults: any[] = [];
let ttmlAvailable = true;

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

const lrclibPlainHit = {
  id: 2,
  trackName: 'Song',
  artistName: 'Artist',
  albumName: 'Album',
  duration: 200,
  syncedLyrics: null,
  plainLyrics: 'hello world plain',
  lyricsfile: null,
  hasWordSync: false,
};

const lrcStudioHit = {
  isrc: STUDIO_ISRC,
  title: 'Song',
  artist: 'Artist',
  album: 'Album',
  year: 2020,
  duration: 200,
};

const lrcLiveHit = {
  isrc: LIVE_ISRC,
  title: 'Song (Live)',
  artist: 'Artist',
  album: 'Live Album',
  year: 2021,
  duration: 260,
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

function jsonResponse(data: unknown, status = 200, contentType = 'application/json') {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null),
    },
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

function textResponse(text: string, status = 200, contentType = 'application/ttml+xml; charset=utf-8') {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null),
    },
    json: async () => {
      throw new Error('not json');
    },
    text: async () => text,
  };
}

(globalThis as any).fetch = async (url: unknown) => {
  const u = String(url);
  calls.push(u);

  if (u.includes('lrc.red/search.json')) return jsonResponse({ hits: lrcHits });
  if (u.includes('lrc.red/s/') && u.includes('.ttml')) {
    return ttmlAvailable ? textResponse(TTML_DOC) : jsonResponse({}, 404);
  }
  // Doğrudan /api/get bilerek başarısız: arama stratejilerine düşsün.
  if (u.includes('lrclib.net/api/get')) return jsonResponse({}, 404);
  if (u.includes('lrclib.net/api/search')) return jsonResponse(lrclibResults);
  if (u.includes('genius.com/api/search')) return jsonResponse(geniusSearchBody);
  if (u.includes('genius.com/')) return textResponse(geniusHtml, 200, 'text/html');
  return jsonResponse({}, 404);
};

function touched(host: string): boolean {
  return calls.some((u) => u.includes(host));
}

function ttmlDownloads(): string[] {
  return calls.filter((u) => u.includes('.ttml'));
}

function reset(options: { lrc?: any[]; lrclib?: any[] } = {}) {
  calls = [];
  lrcHits = options.lrc ?? [];
  lrclibResults = options.lrclib ?? [];
  ttmlAvailable = true;
  clearLrcRedCache();
}

// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  section('1) Varsayılan — lrc.red önce, TTML hece senkronu');

  {
    reset({ lrc: [lrcStudioHit], lrclib: [lrclibHit] });
    const res = await fetchLyricsOnline('Song', 'Artist', undefined, 200);
    check('sonuç lrc.red kaynaklı', res?.source === 'lrc.red', String(res?.source));
    check('TTML saklandı', !!res?.ttml && res.ttml.includes('<tt'));
    check('TTML indirildi', ttmlDownloads().length === 1, calls.join(' | '));
    check('hece senkronu işaretli', res?.hasWordSync === true);
    check('satırlar TTML’den üretildi', (res?.parsedLines.length || 0) === 3);
    check('Genius çağrılmadı', !touched('genius.com'), calls.join(' | '));
  }

  section('2) lrc.red yanlış sürümü (live) seçmez');

  {
    reset({ lrc: [lrcLiveHit, lrcStudioHit], lrclib: [lrclibHit] });
    const res = await fetchLyricsOnline('Song', 'Artist', undefined, 200);
    check('süresi yakın kayıt seçildi', res?.id === `lrc-red-${STUDIO_ISRC}`, String(res?.id));
    check('yalnızca doğru ISRC indirildi', ttmlDownloads().length === 1, calls.join(' | '));
    check(
      'live sürümü indirilmedi',
      ttmlDownloads().every((u) => !u.includes(LIVE_ISRC)),
      calls.join(' | ')
    );
  }

  section('3) lrc.red boşsa LRCLIB kullanılır');

  {
    reset({ lrclib: [lrclibHit] });
    const res = await fetchLyricsOnline('Song', 'Artist', undefined, 200);
    check('sonuç LRCLIB kaynaklı', res?.source === 'lrclib', String(res?.source));
    check('lrc.red arandı', touched('lrc.red/search.json'), calls.join(' | '));
    check('TTML indirilmedi', ttmlDownloads().length === 0, calls.join(' | '));
  }

  section('4) Senkron kaynaklar boşsa Genius yedeği');

  {
    reset({});
    const res = await fetchLyricsOnline('Song', 'Artist', undefined, 200);
    check('sonuç Genius kaynaklı', res?.source === 'genius', String(res?.source));
    check('lrc.red önce denendi', touched('lrc.red/search.json'));
    check('LRCLIB de denendi', touched('lrclib.net'));
    check('Genius son çare olarak çağrıldı', touched('genius.com'));
  }

  section('5) lrclib_first — güçlü LRCLIB eşleşmesinde TTML indirilmez');

  {
    reset({ lrc: [lrcStudioHit], lrclib: [lrclibHit] });
    const res = await fetchLyricsOnline('Song', 'Artist', 'lrclib_first', 200);
    check('sonuç LRCLIB kaynaklı', res?.source === 'lrclib', String(res?.source));
    check('TTML indirilmedi', ttmlDownloads().length === 0, calls.join(' | '));
    check('Genius çağrılmadı', !touched('genius.com'), calls.join(' | '));
  }

  section('6) genius_first — güçlü Genius eşleşmesinde diğerleri çağrılmaz');

  {
    reset({ lrc: [lrcStudioHit], lrclib: [lrclibHit] });
    const res = await fetchLyricsOnline('Song', 'Artist', 'genius_first', 200);
    check('sonuç Genius kaynaklı', res?.source === 'genius', String(res?.source));
    check('lrc.red çağrılmadı', !touched('lrc.red'), calls.join(' | '));
    check('LRCLIB çağrılmadı', !touched('lrclib.net'), calls.join(' | '));
  }

  section('7) Sorgu hâlâ tire içermiyor');

  {
    reset({ lrclib: [lrclibHit] });
    await fetchLyricsOnline('Artist - Song', 'Artist', 'lrclib_first', 200);
    const searchUrls = calls.filter((u) => u.includes('lrclib.net/api/search'));
    const anyDash = searchUrls.some((u) => /\bq=[^&]*-/.test(decodeURIComponent(u)));
    check('LRCLIB arama sorgularında tire yok', !anyDash, searchUrls.join(' | '));
  }

  section('8) TTML parser — hece birleştirme, arka vokal, duet');

  {
    const lines = parseTtml(TTML_DOC);
    check('3 satır ayrıştırıldı', lines.length === 3, String(lines.length));

    const first = lines[0];
    check('satır metni arka vokalsiz', first?.text === 'Hello world', String(first?.text));
    check(
      'heceler kelimelere birleşti',
      (first?.words || []).map((w) => w.text).join('|') === 'Hello|world',
      (first?.words || []).map((w) => w.text).join('|')
    );
    check('arka vokal ayrıldı', first?.background?.text === '(echo now)', String(first?.background?.text));
    check('arka vokal kelimeleri var', (first?.background?.words?.length || 0) === 2);
    check('satır bitişi korundu', first?.endTime === 3, String(first?.endTime));
    check('duet: ilk söyleyen solda', first?.alignment === 'start', String(first?.alignment));
    check('duet: ikinci söyleyen sağda', lines[2]?.alignment === 'end', String(lines[2]?.alignment));
  }

  section('9) Ara boşluk kuralları (>= 4 sn, bilinen bitiş şartı)');

  {
    const lines = parseTtml(TTML_DOC);
    const rows = buildLyricRows(lines);
    const gaps = rows.filter((r) => r.kind === 'gap');
    check('tek ara işareti üretildi', gaps.length === 1, String(gaps.length));
    check('ara, önceki satırın bitişinde', gaps[0]?.time === 3, String(gaps[0]?.time));
    check('ara, sonraki satırın başlangıcında biter', gaps[0]?.time === 3 && (gaps[0] as any).endTime === 10);
    check('satır ve ara toplamı', rows.length === 4, String(rows.length));

    const early = buildLyricRows([
      { time: 2, endTime: 4, text: 'a' },
      { time: 4.5, endTime: 6, text: 'b' },
    ]);
    check('kısa boşlukta işaret yok', early.every((r) => r.kind !== 'gap'));
    check('4 sn’den sonra başlayan ilk satır intro sayılır', (() => {
      const introRows = buildLyricRows([{ time: 6, endTime: 8, text: 'late' }]);
      return introRows[0]?.kind === 'gap' && (introRows[0] as any).time === 0;
    })());
  }

  section('10) Parantezli arka vokal (düz senkron kaynaklar)');

  {
    const [line] = splitBackgroundVocals([{ time: 4, endTime: 8, text: 'Main line (echo)' }]);
    check('ana metin parantezsiz', line.text === 'Main line', line.text);
    check('arka vokal parantezli', line.background?.text === '(echo)', String(line.background?.text));

    const [worded] = splitBackgroundVocals([
      {
        time: 1,
        endTime: 3,
        text: 'Main (echo)',
        words: [
          { time: 1, endTime: 2, text: 'Main' },
          { time: 2, endTime: 3, text: '(echo)' },
        ],
      },
    ]);
    check('kelimeli satırda ana kelime korunur', worded.words?.length === 1, String(worded.words?.length));
    check('kelimeli satırda arka vokal zamanı', worded.background?.time === 2, String(worded.background?.time));
  }

  section('11) Genius bölüm başlığı');

  {
    check('başlık tanınır', isGeniusSectionHeader('[Verse 2: Artist]'));
    check('sanatçı notu düşer', getGeniusSectionLabel('[Verse 2: Artist]') === 'Verse 2', getGeniusSectionLabel('[Verse 2: Artist]'));
    check('normal satır başlık sayılmaz', !isGeniusSectionHeader('Hello world'));
  }

  section('12) Düz metin sözlerde varsayılan kaynak Genius');

  {
    /*
     * lrc.red/LRCLIB yalnızca zamanlamasız metin döndürüyorsa "senkron kaynak"
     * sayılmaz; düz metin için Genius tercih edilir (kullanıcı isteği #7).
     */
    reset({ lrclib: [lrclibPlainHit] });
    const res = await fetchLyricsOnline('Song', 'Artist', undefined, 200);
    check('düz sözlerde sonuç Genius kaynaklı', res?.source === 'genius', String(res?.source));
    check('zamanlama yok', !res?.syncedLyrics && (res?.parsedLines.length ?? 0) === 0);
  }

  // ───────────────────────────────────────────────────────────────────────────

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
