/**
 * Kalıcı depolama (persist) migrasyonunun doğrulaması.
 *
 * AMAÇ: Eski (şema sürümü olmayan, şişmiş) bir AsyncStorage kaydının yeni
 * migrasyondan geçtikten sonra (a) TÜM veriyi koruduğunu, (b) güvenli boyuta
 * indiğini ve (c) her arama anahtarının hâlâ çalıştığını kanıtlamak.
 *
 * Gerçek uygulama mantığı kullanılır (src/services/persistSanitize.ts), kopyası
 * değil. Script native bağımlılık içermez; bu yüzden Node üzerinde çalışır.
 *
 * Çalıştırma:
 *   npx tsc scripts/verify-persist-migration.ts --outDir .tmp-verify \
 *     --module commonjs --target es2020 --moduleResolution node --skipLibCheck
 *   node .tmp-verify/scripts/verify-persist-migration.js
 */

import {
  normalizeLyricsCache,
  findLyricsInCache,
  reducePersistedState,
  byteLength,
  MAX_SAFE_BYTES,
  type LyricsCacheEntry,
} from '../src/services/persistSanitize';
import type { LyricsResult } from '../src/services/lyricsService';

// ─────────────────────────────────────────────────────────────────────────────
// Küçük test altyapısı
// ─────────────────────────────────────────────────────────────────────────────

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
// Eski (v0) verinin benzetimi
// ─────────────────────────────────────────────────────────────────────────────

const TRACK_COUNT = 40;
const CANDIDATES_PER_TRACK = 15;
const ALT_KEYS_PER_TRACK = 8;

/** Deterministik, gerçekçi boyutta bir söz gövdesi üretir. */
function lyricBody(trackNo: number, lines: number, width: number): string {
  const out: string[] = [];
  for (let i = 0; i < lines; i++) {
    const text = `Track ${trackNo} line ${i} `.padEnd(width, 'x');
    out.push(`[00:${String(i % 60).padStart(2, '0')}.00] ${text}`);
  }
  return out.join('\n');
}

/**
 * Eski kodun yazdığı gibi "şişmiş" bir LyricsResult: aday listesi + ayrıştırılmış
 * satırlar dahil (ikisi de kalıcı veriye yazılmamalı).
 */
function makeFatLyrics(trackNo: number): LyricsResult {
  const synced = lyricBody(trackNo, 60, 60);
  const plain = Array.from(
    { length: 60 },
    (_, i) => `Track ${trackNo} plain ${i} `.padEnd(50, 'y')
  ).join('\n');

  const candidates = Array.from({ length: CANDIDATES_PER_TRACK }, (_, c) => ({
    id: `lrclib-${trackNo}-${c}`,
    trackName: `Track ${trackNo} alt ${c}`,
    artistName: `Artist ${trackNo}`,
    albumName: `Album ${c}`,
    duration: 200 + c,
    hasSynced: true,
    hasWordSync: false,
    syncedLyrics: lyricBody(trackNo, 60, 60),
    plainLyrics: plain,
    lyricsfile: null,
    source: 'lrclib' as const,
  }));

  return {
    id: `lrclib-${trackNo}`,
    trackName: `Track ${trackNo}`,
    artistName: `Artist ${trackNo}`,
    syncedLyrics: synced,
    plainLyrics: plain,
    lyricsfile: null,
    hasWordSync: false,
    parsedLines: Array.from({ length: 60 }, (_, i) => ({
      time: i,
      text: `Track ${trackNo} line ${i}`,
    })),
    source: 'lrclib',
    isUserSelected: true,
    selectedCandidateId: `lrclib-${trackNo}-0`,
    candidates,
  };
}

/**
 * Eski `setLyrics` davranışı: AYNI nesne tüm alternatif anahtarlara yazılırdı
 * (id, url, dosya adı ve başlık/sanatçı kombinasyonları).
 */
function buildLegacyCache(): { cache: Record<string, LyricsResult>; expectedByKey: Map<string, string> } {
  const cache: Record<string, LyricsResult> = {};
  const expectedByKey = new Map<string, string>();

  for (let t = 0; t < TRACK_COUNT; t++) {
    const lyrics = makeFatLyrics(t);
    const canonicalId = `asset-${t}`;

    const keys = [
      canonicalId,
      `file:///storage/emulated/0/Music/track-${t}.mp3`,
      `fn_track ${t}`,
      `art_artist ${t}___tit_track ${t}`,
      `tit_track ${t}`,
      `art_Artist ${t}___tit_Track ${t}`,
      `tit_Track ${t}`,
      `tit_track-${t}`,
    ].slice(0, ALT_KEYS_PER_TRACK);

    for (const key of keys) {
      cache[key] = lyrics; // eski kodda: aynı referans
      expectedByKey.set(key, lyrics.id!);
    }
  }

  return { cache, expectedByKey };
}

// ─────────────────────────────────────────────────────────────────────────────
// Testler
// ─────────────────────────────────────────────────────────────────────────────

section('1) Eski verinin sorunlu olduğu kanıtlanıyor');

const { cache: legacyCache, expectedByKey } = buildLegacyCache();
const legacyBytes = byteLength(JSON.stringify(legacyCache));
const legacyKeyCount = Object.keys(legacyCache).length;

console.log(
  `  bilgi: ${TRACK_COUNT} parça, ${legacyKeyCount} anahtar, ` +
    `${Math.round(legacyBytes / 1024)} KB (sınır ${Math.round(MAX_SAFE_BYTES / 1024)} KB)`
);

check(
  'eski kayıt güvenli boyut sınırını AŞIYOR (asıl hata)',
  legacyBytes > MAX_SAFE_BYTES,
  `${Math.round(legacyBytes / 1024)} KB <= ${Math.round(MAX_SAFE_BYTES / 1024)} KB`
);

section('2) Migrasyon: normalizeLyricsCache');

const normalized = normalizeLyricsCache(legacyCache);
const normalizedBytes = byteLength(JSON.stringify(normalized));
const normalizedKeys = Object.keys(normalized);

console.log(
  `  bilgi: ${normalizedKeys.length} anahtar, ${Math.round(normalizedBytes / 1024)} KB ` +
    `(${(100 - (normalizedBytes / legacyBytes) * 100).toFixed(1)}% küçülme)`
);

check(
  'tüm arama anahtarları korundu (kayıp anahtar yok)',
  normalizedKeys.length === legacyKeyCount,
  `${normalizedKeys.length} != ${legacyKeyCount}`
);

check(
  'boyut güvenli sınırın ALTINA indi',
  normalizedBytes <= MAX_SAFE_BYTES,
  `${Math.round(normalizedBytes / 1024)} KB > ${Math.round(MAX_SAFE_BYTES / 1024)} KB`
);

check(
  'boyut en az %80 küçüldü',
  normalizedBytes < legacyBytes * 0.2,
  `sadece %${(100 - (normalizedBytes / legacyBytes) * 100).toFixed(1)} küçülme`
);

const canonicalEntries = normalizedKeys
  .map((k) => normalized[k])
  .filter((e) => !(e && typeof e === 'object' && 'ref' in e)) as LyricsResult[];

const refEntries = normalizedKeys.filter((k) => {
  const e = normalized[k];
  return !!e && typeof e === 'object' && 'ref' in e;
});

check(
  'kanonik kayıt sayısı = gerçek parça sayısı (kopya yok)',
  canonicalEntries.length === TRACK_COUNT,
  `${canonicalEntries.length} != ${TRACK_COUNT}`
);

check(
  'alternatif anahtarlar işaretçiye dönüştü',
  refEntries.length === legacyKeyCount - TRACK_COUNT,
  `${refEntries.length} != ${legacyKeyCount - TRACK_COUNT}`
);

check(
  'hiçbir kalıcı kayıt `candidates` taşımıyor',
  canonicalEntries.every((e) => e.candidates === undefined)
);

check(
  'hiçbir kalıcı kayıt `parsedLines` taşımıyor',
  canonicalEntries.every((e) => e.parsedLines === undefined)
);

check(
  'söz İÇERİĞİ korundu (syncedLyrics/plainLyrics dolu)',
  canonicalEntries.every((e) => !!e.syncedLyrics && !!e.plainLyrics)
);

check(
  'kullanıcı seçimi korundu (isUserSelected/selectedCandidateId)',
  canonicalEntries.every((e) => e.isUserSelected === true && !!e.selectedCandidateId)
);

section('3) Migrasyon sonrası her anahtar hâlâ çözümleniyor');

let resolvedOk = 0;
let resolvedWrong = 0;
let resolvedNull = 0;

for (const [key, expectedId] of expectedByKey.entries()) {
  const found = findLyricsInCache(normalized, [key]);
  if (!found) resolvedNull++;
  else if (found.id === expectedId) resolvedOk++;
  else resolvedWrong++;
}

check(
  'her arama anahtarı DOĞRU parçayı döndürüyor',
  resolvedOk === expectedByKey.size && resolvedWrong === 0 && resolvedNull === 0,
  `ok=${resolvedOk} yanlış=${resolvedWrong} boş=${resolvedNull} / ${expectedByKey.size}`
);

section('4) İdempotans (migrasyon tekrar çalıştırılabilir)');

const twice = normalizeLyricsCache(normalized);
check(
  'ikinci migrasyon çıktıyı değiştirmiyor',
  JSON.stringify(twice) === JSON.stringify(normalized)
);

section('5) Sarkan referans güvenliği');

const withDangling: Record<string, LyricsCacheEntry> = { ...normalized };
// Kanonik kaydı sil, işaretçisi kalsın: çökmemeli, null dönmeli.
const victim = canonicalEntries[0].id!;
let victimKey = '';
for (const k of Object.keys(withDangling)) {
  const e = withDangling[k];
  if (e && typeof e === 'object' && !('ref' in e) && (e as LyricsResult).id === victim) {
    victimKey = k;
    break;
  }
}
delete withDangling[victimKey];

let danglingRefKey = '';
for (const k of Object.keys(withDangling)) {
  const e = withDangling[k];
  if (e && typeof e === 'object' && 'ref' in e && e.ref === victimKey) {
    danglingRefKey = k;
    break;
  }
}

check(
  'sarkan referans null döndürüyor (çökme yok)',
  !!danglingRefKey && findLyricsInCache(withDangling, [danglingRefKey]) === null,
  danglingRefKey ? 'beklenen null' : 'test için referans bulunamadı'
);

section('6) Kimliği olmayan (özel) kayıtlar korunuyor');

const custom: LyricsResult = {
  trackName: 'Custom',
  artistName: 'Custom Artist',
  syncedLyrics: null,
  plainLyrics: 'elle girilmiş sözler',
  parsedLines: [],
  source: 'custom',
};
const withCustom = normalizeLyricsCache({ custom_key: custom });
check(
  'id alanı olmayan kayıt silinmiyor',
  !!withCustom.custom_key && !('ref' in withCustom.custom_key)
);

section('7) Boyut taşmasında kullanıcı tercihleri korunuyor');

const fullPersistedState = {
  settings: { minLengthSec: 30, maxLengthSec: 600, minSizeMB: 1, maxSizeMB: 50 },
  isShuffle: true,
  repeatMode: 2,
  hiddenTrackIds: ['asset-3', 'asset-7'],
  artworkMap: Object.fromEntries(
    Array.from({ length: 200 }, (_, i) => [`asset-${i}`, `file:///art/${i}.jpg`])
  ),
  metadataMap: { 'asset-0': { title: 'T', artist: 'A', album: 'Al', artwork: 'x' } },
  lyricsCache: legacyCache as Record<string, LyricsCacheEntry>,
};

const beforeBytes = byteLength(JSON.stringify(fullPersistedState));
const { state: reduced, trimmed } = reducePersistedState(fullPersistedState);
const afterBytes = byteLength(JSON.stringify(reduced));

console.log(
  `  bilgi: ${Math.round(beforeBytes / 1024)} KB -> ${Math.round(afterBytes / 1024)} KB ` +
    `(trimmed=${trimmed})`
);

check('boyut sınırın altına indi', afterBytes <= MAX_SAFE_BYTES);
check('kırpma bildirildi (trimmed=true)', trimmed === true);
check(
  'ayarlar (settings) bire bir korundu',
  JSON.stringify(reduced.settings) === JSON.stringify(fullPersistedState.settings)
);
check('isShuffle korundu', reduced.isShuffle === true);
check('repeatMode korundu', reduced.repeatMode === 2);
check(
  'gizlenen şarkılar (hiddenTrackIds) korundu',
  JSON.stringify(reduced.hiddenTrackIds) === JSON.stringify(fullPersistedState.hiddenTrackIds)
);
check(
  'meta veriler (metadataMap) korundu',
  JSON.stringify(reduced.metadataMap) === JSON.stringify(fullPersistedState.metadataMap)
);

section('8) Küçük kayıtlar hiç kırpılmıyor');

const smallState = {
  settings: { minLengthSec: null, maxLengthSec: null, minSizeMB: null, maxSizeMB: null },
  isShuffle: false,
  repeatMode: 0,
  hiddenTrackIds: [],
  artworkMap: {},
  metadataMap: {},
  lyricsCache: normalizeLyricsCache({ 'asset-0': makeFatLyrics(0) }),
};
const smallResult = reducePersistedState(smallState);
check('küçük kayıtta trimmed=false', smallResult.trimmed === false);
check(
  'küçük kayıt aynen geri döndü',
  JSON.stringify(smallResult.state) === JSON.stringify(smallState)
);

section('9) Bozuk/eksik migrasyon girdileri çökme yaratmıyor');

const malformedCases: Array<[string, unknown]> = [
  ['lyricsCache yok (undefined)', undefined],
  ['lyricsCache null', null],
  ['lyricsCache boş nesne', {}],
  ['lyricsCache dizi (bozuk)', [{ id: 'x' }]],
  ['lyricsCache string (bozuk)', 'bozuk'],
  ['lyricsCache içinde null değer', { a: null, b: undefined }],
  ['lyricsCache içinde ilkel değer', { a: 5, b: 'metin' }],
];

for (const [label, input] of malformedCases) {
  let ok = true;
  let size = -1;
  try {
    const out = normalizeLyricsCache(input as Record<string, LyricsCacheEntry> | null | undefined);
    size = Object.keys(out).length;
  } catch {
    ok = false;
  }
  check(`çökmüyor: ${label}`, ok, ok ? '' : 'istisna fırlattı');
  check(`nesne döndürüyor: ${label}`, size >= 0, `boyut=${size}`);
}

// Migrasyonun tamamı (reducePersistedState dahil) bozuk store ile denenir.
let reduceOk = true;
try {
  reducePersistedState({ lyricsCache: 'bozuk', artworkMap: 42, settings: undefined } as any);
} catch {
  reduceOk = false;
}
check('reducePersistedState bozuk store ile çökmüyor', reduceOk);

// ─────────────────────────────────────────────────────────────────────────────

section('Sonuç');
if (failures === 0) {
  console.log('  TÜM TESTLER GEÇTİ ✅');
} else {
  console.log(`  ${failures} TEST BAŞARISIZ ❌`);
  throw new Error(`${failures} doğrulama başarısız`);
}
