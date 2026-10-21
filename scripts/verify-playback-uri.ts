/**
 * Yerel oynatma URI normalizasyonunun doğrulaması.
 *
 * Çalıştırma:
 *   npx tsc scripts/verify-playback-uri.ts --outDir .tmp-verify \
 *     --module commonjs --target es2020 --moduleResolution node --skipLibCheck
 *   node .tmp-verify/scripts/verify-playback-uri.js
 */

import { toPlayableTrack, toPlayableTracks, toPlayableUri } from '../src/services/playbackUri';

declare const process: any;

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

section('1) #PLA4 dosya adı');

const raw =
  'file:///storage/emulated/0/Music/Khontkar - 2 BABAS (feat. Corr) [Prod. by Groza Beatz] #PLA4.opus';
const encoded = toPlayableUri(raw);

console.log(`  ham:       ${raw}`);
console.log(`  oynatılan: ${encoded}`);

check('# karakteri yüzde-kodlandı', encoded.includes('%23PLA4.opus'));
check('ham # karakteri kalmadı', !encoded.includes('#'));
check('boşluklar kodlandı', encoded.includes('%20'));
check('dosya adı korundu', decodeURIComponent(encoded).endsWith('#PLA4.opus'));

const parsed = new URL(encoded);
check('URL hash boş', parsed.hash === '');
check(
  'URL yolu dosya adını içeriyor',
  decodeURIComponent(parsed.pathname).endsWith('#PLA4.opus')
);

section('2) İdempotentlik');

const twice = toPlayableUri(encoded);
check('aynı URI ikinci kez değişmiyor', twice === encoded, twice);

section('3) Diğer özel karakterler');

const special = toPlayableUri('file:///music/100% upload? [demo].mp3');
check('? karakteri kodlandı', special.includes('%3F') && !special.includes('?'));
check('kare parantez kodlandı', special.includes('%5B') && special.includes('%5D'));
check('yüzde işareti kodlandı', special.includes('%25'));
check('mevcut %XX korunuyor', toPlayableUri('file:///music/a%20b.mp3') === 'file:///music/a%20b.mp3');
check(
  'Unicode kodlanıyor',
  toPlayableUri('file:///music/Türkçe Şarkı.mp3') ===
    'file:///music/T%C3%BCrk%C3%A7e%20%C5%9Eark%C4%B1.mp3'
);

section('4) Dokunulmaması gereken URI şemaları');

const remote = 'https://example.com/audio?x=1#t=10';
const content = 'content://media/external/audio/media/123';
check('https aynen kalıyor', toPlayableUri(remote) === remote);
check('content:// aynen kalıyor', toPlayableUri(content) === content);

section('5) Track yardımcıları');

const track = { id: '1', url: 'file:///music/#PLA4.opus', title: 'Test' };
const normalizedTrack = toPlayableTrack(track);
check('track URL normalleşti', normalizedTrack.url.includes('%23PLA4.opus'));
check('track alanları korundu', normalizedTrack.id === '1' && normalizedTrack.title === 'Test');
check('zaten güvenli track aynı referans', toPlayableTrack(normalizedTrack) === normalizedTrack);

const tracks = toPlayableTracks([
  { id: '1', url: 'file:///music/a.mp3' },
  { id: '2', url: 'file:///music/#PLA4.opus' },
]);
check('liste normalleşti', tracks[1].url.includes('%23PLA4.opus'));

console.log('');
if (failures > 0) {
  console.error(`${failures} kontrol başarısız.`);
  process.exit(1);
}
console.log('Tüm kontroller başarılı.');
