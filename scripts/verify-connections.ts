/**
 * Bağlantılar (Last.fm / ListenBrainz) katmanının doğrulaması.
 *
 * NEDEN GEREKLİ: `api_sig` yanlışsa Last.fm her isteği reddeder ve bu hata
 * yalnızca gerçek kullanıcı hesabında görünür. MD5'i native modül olmadan
 * kendimiz yazdığımız için RFC 1321 vektörleriyle test ediyoruz. Kuyruk
 * mantığı da saf fonksiyonlara ayrıldığı için burada AsyncStorage olmadan
 * doğrulanabiliyor.
 *
 * Çalıştırma:
 *   npx tsc scripts/verify-connections.ts --ignoreConfig --outDir .tmp-verify \
 *     --module commonjs --target es2020 --moduleResolution bundler --skipLibCheck
 *   node .tmp-verify/scripts/verify-connections.js
 */

import { md5 } from '../src/services/connections/md5';
import { buildApiSignature, resolveLastFmCredentials } from '../src/services/connections/lastfm';
import {
  QUEUE_MAX_ENTRIES,
  QUEUE_TTL_MS,
  dueEntries,
  enqueueEntry,
  pruneQueue,
  retryDelayMs,
} from '../src/services/connections/scrobbleQueueMath';
import { scrobbleThresholdSeconds } from '../src/services/connections/scrobbleThreshold';
import type { ScrobbleEntry } from '../src/services/connections/types';

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

function entry(overrides: Partial<ScrobbleEntry>): ScrobbleEntry {
  const startedAt = overrides.startedAt ?? 1_700_000_000;
  return {
    id: `e-${startedAt}-${overrides.target ?? 'lastfm'}-${overrides.track ?? 'track'}`,
    target: 'lastfm',
    artist: 'Artist',
    track: 'Track',
    startedAt,
    album: undefined,
    duration: 200,
    attempts: 0,
    nextAttemptAt: 0,
    createdAt: startedAt * 1000,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
section('MD5 (RFC 1321 vektörleri)');

const vectors: [string, string][] = [
  ['', 'd41d8cd98f00b204e9800998ecf8427e'],
  ['a', '0cc175b9c0f1b6a831c399e269772661'],
  ['abc', '900150983cd24fb0d6963f7d28e17f72'],
  ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
  ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
  [
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
    'd174ab98d277d9f5a5611c2c9f419d9f',
  ],
  [
    '12345678901234567890123456789012345678901234567890123456789012345678901234567890',
    '57edf4a22be3c955ac49da2e2107b67a',
  ],
  ['The quick brown fox jumps over the lazy dog', '9e107d9d372bb6826bd81d3542a419d6'],
  // 64 bayt sınırını aşan blok (dolgu yolu).
  ['a'.repeat(1000), 'cabe45dcc9ae5b66ba86600cca6b8ba8'],
  // UTF-8: Türkçe karakterler 2 bayt, vekil çifti 4 bayt.
  ['şarkı sözleri ĞÜİŞÖÇ', '445ad43e28366e42f323100c79faa963'],
  ['😀 emoji', '937948e47e1dfa66901634dea84a7092'],
];

for (const [input, expected] of vectors) {
  const actual = md5(input);
  check(`md5(${JSON.stringify(input.slice(0, 24))})`, actual === expected, `beklenen ${expected}, gelen ${actual}`);
}

// ─────────────────────────────────────────────────────────────────────────────
section('Last.fm imzası (api_sig)');

const params = {
  track: 'A',
  artist: 'B',
  timestamp: 1,
  method: 'track.scrobble',
  api_key: 'K',
  format: 'json',
};

// Alfabetik: api_keyK artistB methodtrack.scrobble timestamp1 trackA + secret
check(
  'parametreler sıralanıp birleştirilir, format imzaya girmez',
  buildApiSignature(params, 'S') === '89aaeca0c8206d79141f7a95b519fa6d'
);

const reordered = {
  format: 'json',
  method: 'track.scrobble',
  api_key: 'K',
  timestamp: 1,
  artist: 'B',
  track: 'A',
};
check('anahtar sırası imzayı değiştirmez', buildApiSignature(params, 'S') === buildApiSignature(reordered, 'S'));
check(
  'shared secret imzayı değiştirir',
  buildApiSignature(params, 'S') !== buildApiSignature(params, 'S2')
);
check(
  'undefined parametreler atlanır',
  buildApiSignature({ ...params, album: undefined }, 'S') === buildApiSignature(params, 'S')
);
check(
  'callback de imzaya girmez',
  buildApiSignature({ ...params, callback: 'x' }, 'S') === buildApiSignature(params, 'S')
);

section('Last.fm kimlik çözümleme');
const appCreds = resolveLastFmCredentials(null, null);
check('varsayılan uygulama anahtarı kullanılır', appCreds.apiKey.length === 32 && appCreds.sharedSecret.length === 32);
const customCreds = resolveLastFmCredentials('  key123  ', ' secret123 ');
check(
  'kullanıcı anahtarı varsa o kullanılır',
  customCreds.apiKey === 'key123' && customCreds.sharedSecret === 'secret123'
);
check(
  'eksik özel anahtar uygulama anahtarına döner',
  resolveLastFmCredentials('key123', '').apiKey === appCreds.apiKey
);

// ─────────────────────────────────────────────────────────────────────────────
section('Scrobble eşiği (Last.fm standardı)');

check('180 sn parça → 90 sn', scrobbleThresholdSeconds(180) === 90);
check('600 sn parça → 240 sn (4 dk üst sınır)', scrobbleThresholdSeconds(600) === 240);
check('süre yoksa → 240 sn', scrobbleThresholdSeconds(undefined) === 240);
check('süre 0 ise → 240 sn', scrobbleThresholdSeconds(0) === 240);
check('30 sn parça → 15 sn', scrobbleThresholdSeconds(30) === 15);
check(
  'uygulama içi 30 sn istatistik eşiğinden bağımsız',
  scrobbleThresholdSeconds(180) !== 30
);

// ─────────────────────────────────────────────────────────────────────────────
section('Kuyruk: TTL ve boyut sınırı');

const now = 1_700_000_000_000;
const fresh = entry({ createdAt: now - 1000 });
const stale = entry({ createdAt: now - QUEUE_TTL_MS - 1, track: 'Stale' });
check('bir haftadan eski kayıt atılır', pruneQueue([stale, fresh], now).length === 1);
check('taze kayıt korunur', pruneQueue([stale, fresh], now)[0] === fresh);

const many: ScrobbleEntry[] = [];
for (let i = 0; i < QUEUE_MAX_ENTRIES + 25; i++) {
  many.push(entry({ createdAt: now - 10_000 + i, track: `T${i}`, id: `id-${i}` }));
}
const capped = pruneQueue(many, now);
check('kuyruk üst sınırı aşmaz', capped.length === QUEUE_MAX_ENTRIES);
check('sınır aşılınca en yeniler tutulur', capped[capped.length - 1].track === `T${QUEUE_MAX_ENTRIES + 24}`);

// ─────────────────────────────────────────────────────────────────────────────
section('Kuyruk: ekleme, tekrar ve sıralama');

const base = entry({});
check('aynı kayıt ikinci kez eklenmez', enqueueEntry([base], entry({ id: 'other' }), now).length === 1);
check(
  'farklı hedef ayrı kayıt olur',
  enqueueEntry([base], entry({ id: 'lb', target: 'listenbrainz' }), now).length === 2
);
check(
  'farklı parça ayrı kayıt olur',
  enqueueEntry([base], entry({ id: 'other', track: 'Other' }), now).length === 2
);

const ready = entry({ id: 'a', startedAt: 200, nextAttemptAt: now });
const late = entry({ id: 'b', startedAt: 100, nextAttemptAt: now });
const future = entry({ id: 'c', startedAt: 50, nextAttemptAt: now + 60_000 });
const otherTarget = entry({ id: 'd', target: 'listenbrainz', nextAttemptAt: now });
const due = dueEntries([ready, late, future, otherTarget], 'lastfm', now);
check('süresi gelmeyen kayıt gönderilmez', due.every((e) => e.id !== 'c'));
check('diğer hedefin kayıtları karışmaz', due.every((e) => e.target === 'lastfm'));
check('en eski dinleme önce gönderilir', due[0].id === 'b' && due[1].id === 'a');

// ─────────────────────────────────────────────────────────────────────────────
section('Kuyruk: yeniden deneme gecikmesi');

check('1. deneme → 30 sn', retryDelayMs(1) === 30_000);
check('2. deneme → 2 dk', retryDelayMs(2) === 120_000);
check('3. deneme → 10 dk', retryDelayMs(3) === 600_000);
check('4. deneme → 30 dk', retryDelayMs(4) === 1_800_000);
check('sonrası 30 dk tavanında kalır', retryDelayMs(12) === 1_800_000);
check('0/negatif denemede taşmaz', retryDelayMs(0) === 30_000);

// ─────────────────────────────────────────────────────────────────────────────
section('Sonuç');
if (failures === 0) {
  console.log('  TÜM TESTLER GEÇTİ.');
} else {
  console.log(`  ${failures} TEST BAŞARISIZ.`);
  throw new Error(`${failures} doğrulama başarısız`);
}
