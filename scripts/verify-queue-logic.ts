/**
 * Kuyruk mantığının doğrulaması (Apple Music / Spotify semantiği).
 *
 * Gerçek uygulama mantığı kullanılır (src/services/queueMath.ts), kopyası değil.
 * Script native bağımlılık içermez; bu yüzden Node üzerinde çalışır.
 *
 * Çalıştırma:
 *   npx tsc scripts/verify-queue-logic.ts --ignoreConfig --outDir .tmp-verify \
 *     --module commonjs --target es2020 --moduleResolution bundler --skipLibCheck
 *   node .tmp-verify/scripts/verify-queue-logic.js
 */

import {
  buildPlayOrder,
  buildQueueRows,
  deriveQueueSections,
  shuffleArray,
  trackKey,
  type QueueTrackLike,
} from '../src/services/queueMath';

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

/** Kimliği verilen sahte parça. */
function t(id: string): QueueTrackLike {
  return { id, url: `file:///music/${id}.mp3`, title: `Song ${id}` };
}

/** Bölüm indekslerinin kuyruktaki gerçek konumlara denk geldiğini doğrular. */
function indicesMatch<T extends QueueTrackLike>(
  queue: T[],
  entries: { index: number; track: T }[]
): boolean {
  return entries.every((e) => queue[e.index] === e.track);
}

function ids(entries: { track: QueueTrackLike }[]): string[] {
  return entries.map((e) => trackKey(e.track));
}

// ─────────────────────────────────────────────────────────────────────────────

section('1) trackKey');

check('id varsa id kullanılır', trackKey({ id: 'a', url: 'u' }) === 'a');
check('id yoksa url kullanılır', trackKey({ url: 'u' }) === 'u');
check('boş nesnede boş string', trackKey({}) === '');
check('null/undefined güvenli', trackKey(null) === '' && trackKey(undefined) === '');

section('2) shuffleArray — geçerli permütasyon');

const source = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const shuffled = shuffleArray(source);

check('girdi DEĞİŞTİRİLMEZ', JSON.stringify(source) === JSON.stringify(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']));
check('uzunluk korunur', shuffled.length === source.length);
check(
  'aynı elemanlar (kayıp/tekrar yok)',
  [...shuffled].sort().join(',') === [...source].sort().join(',')
);
check('boş dizi güvenli', shuffleArray([]).length === 0);
check('tek elemanlı dizi güvenli', JSON.stringify(shuffleArray(['x'])) === JSON.stringify(['x']));

// Karıştırmanın gerçekten karıştırdığını olasılıksal olarak doğrula:
// 8 elemanın 20 denemede en az bir kez farklı sıraya gelmesi beklenir.
let sawDifferentOrder = false;
for (let i = 0; i < 20; i++) {
  if (shuffleArray(source).join(',') !== source.join(',')) {
    sawDifferentOrder = true;
    break;
  }
}
check('karıştırma sırayı gerçekten değiştiriyor', sawDifferentOrder);

section('3) buildPlayOrder');

const context = ['c1', 'c2', 'c3', 'c4', 'c5'];

check(
  'shuffle kapalı: bağlam sırası aynen korunur',
  JSON.stringify(buildPlayOrder(context, 'c3', false)) === JSON.stringify(context)
);

const shuffledOrder = buildPlayOrder(context, 'c3', true);
check('shuffle açık: seçilen parça İLK sırada', shuffledOrder[0] === 'c3');
check('shuffle açık: uzunluk korunur', shuffledOrder.length === context.length);
check(
  'shuffle açık: tüm parçalar tam bir kez var',
  [...shuffledOrder].sort().join(',') === [...context].sort().join(',')
);
check('shuffle açık: tekrar yok', new Set(shuffledOrder).size === context.length);

section('4) deriveQueueSections — temel bölümleme');

const q1 = [t('C1'), t('C2'), t('C3'), t('C4')];

{
  const s = deriveQueueSections(q1, 1, []);
  check('current doğru', s.current?.track === q1[1] && s.current?.index === 1);
  check('manuel yoksa upNext boş', s.upNext.length === 0);
  check('context kalan parçalar', JSON.stringify(ids(s.context)) === JSON.stringify(['C3', 'C4']));
  check('context indeksleri mutlak ve doğru', indicesMatch(q1, s.context));
  check('geçmiş context içinde yer almaz', !ids(s.context).includes('C2'));
  check('geçmiş ayrı bölümde döner', JSON.stringify(ids(s.history)) === JSON.stringify(['C1']));
  check('geçmiş indeksleri kuyruğa denk', indicesMatch(q1, s.history));
}

section('4b) Geçmiş (çalınmış parçalar) bölümü');

{
  // 4 parça çalınmış, 5. çalıyor.
  const s = deriveQueueSections(q1, 3, []);
  check('geçmiş eskiden yeniye sıralı', JSON.stringify(ids(s.history)) === JSON.stringify(['C1', 'C2', 'C3']));
  check(
    'geçmiş indeksleri 0..activeIndex-1',
    JSON.stringify(s.history.map((e) => e.index)) === JSON.stringify([0, 1, 2])
  );
  check('geçmiş indeksleri kuyruğa denk', indicesMatch(q1, s.history));
  check('mevcut parça geçmişte YOK', !ids(s.history).includes('C4'));
  check('mevcut parça current', s.current?.track === q1[3]);

  // İlk parça çalınıyorsa geçmiş boş olmalı.
  const first = deriveQueueSections(q1, 0, []);
  check('ilk parçada geçmiş boş', first.history.length === 0);

  // Son parça çalınıyorsa geçmiş tüm önceki parçaları içerir.
  const last = deriveQueueSections(q1, q1.length - 1, []);
  check('son parçada geçmiş tüm öncekiler', last.history.length === q1.length - 1);

  // Geçmiş + current + context = tüm kuyruk (hiçbir parça kaybolmaz/tekrarlanmaz).
  const mid = deriveQueueSections(q1, 2, []);
  const all = [...ids(mid.history), ...ids(mid.current ? [mid.current] : []), ...ids(mid.context)];
  check('bölümler kuyruğu tam böler', JSON.stringify(all) === JSON.stringify(['C1', 'C2', 'C3', 'C4']));
}

section('5) deriveQueueSections — manuel öğeler araya girince');

const q2 = [t('C1'), t('C2'), t('M1'), t('C3'), t('M2'), t('C4')];

{
  const s = deriveQueueSections(q2, 1, ['M1', 'M2']);
  check('upNext doğru sırada', JSON.stringify(ids(s.upNext)) === JSON.stringify(['M1', 'M2']));
  check('upNext indeksleri doğru (2 ve 4)', JSON.stringify(s.upNext.map((e) => e.index)) === JSON.stringify([2, 4]));
  check('upNext indeksleri kuyruğa denk', indicesMatch(q2, s.upNext));
  check('context manuel öğeleri içermez', JSON.stringify(ids(s.context)) === JSON.stringify(['C3', 'C4']));
  check('context indeksleri doğru (3 ve 5)', JSON.stringify(s.context.map((e) => e.index)) === JSON.stringify([3, 5]));
  check('context indeksleri kuyruğa denk', indicesMatch(q2, s.context));
}

section('6) Tüketim ve geri gitme (en kritik davranış)');

{
  // M1 çalınmaya başladı: aktif indeks 2. M1 artık listede OLMAMALI.
  const s = deriveQueueSections(q2, 2, ['M1', 'M2']);
  check('çalınan manuel öğe listeden düşer', JSON.stringify(ids(s.upNext)) === JSON.stringify(['M2']));
  check('kalan manuel öğe doğru indekste', s.upNext[0]?.index === 4);
  check('context hâlâ doğru', JSON.stringify(ids(s.context)) === JSON.stringify(['C3', 'C4']));

  // Kullanıcı geri döndü: M1 yeniden "sırada" görünmeli.
  const back = deriveQueueSections(q2, 1, ['M1', 'M2']);
  check('geri gidince manuel öğeler yeniden görünür', JSON.stringify(ids(back.upNext)) === JSON.stringify(['M1', 'M2']));

  // Son manuel öğe de çalındı.
  const s3 = deriveQueueSections(q2, 4, ['M1', 'M2']);
  check('tüm manuel öğeler tükenince upNext boşalır', s3.upNext.length === 0);
  check('context kalan tek parça', JSON.stringify(ids(s3.context)) === JSON.stringify(['C4']));
}

section('7) Aynı parça hem manuel hem bağlamda (mükerrer kimlik)');

{
  // Kullanıcı, kütüphanede zaten sırada olan X'i "şimdi çal" ile öne aldı.
  const q3 = [t('C1'), t('X'), t('C2'), t('X'), t('C3')];
  const s = deriveQueueSections(q3, 0, ['X']);

  check('en YAKIN kopya manuel sayılır', s.upNext.length === 1 && s.upNext[0].index === 1);
  check('uzaktaki kopya bağlama bırakılır', ids(s.context).includes('X'));
  check('context doğru sırada', JSON.stringify(ids(s.context)) === JSON.stringify(['C2', 'X', 'C3']));
  check('indeksler kuyruğa denk', indicesMatch(q3, s.upNext) && indicesMatch(q3, s.context));
}

section('8) Sıra kaynağı kuyruktur (upNextIds sırası değil)');

{
  // upNextIds ters verilse bile görüntülenen sıra kuyruktaki gerçek sıradır.
  const s = deriveQueueSections(q2, 1, ['M2', 'M1']);
  check('kuyruk sırası kazanır', JSON.stringify(ids(s.upNext)) === JSON.stringify(['M1', 'M2']));
}

section('9) Sınır durumları');

{
  const empty = deriveQueueSections([], 0, ['M1']);
  check('boş kuyruk: current null', empty.current === null);
  check('boş kuyruk: bölümler boş', empty.upNext.length === 0 && empty.context.length === 0);

  const past = deriveQueueSections(q1, 99, []);
  check('indeks aralık dışı: current null', past.current === null);
  check('indeks aralık dışı: context boş', past.context.length === 0);

  const last = deriveQueueSections(q1, q1.length - 1, []);
  check('son parça: current var, context boş', last.current !== null && last.context.length === 0);

  const stale = deriveQueueSections(q1, 0, ['YOK']);
  check('kuyrukta olmayan manuel kimlik yok sayılır', stale.upNext.length === 0);
  check('eşleşmeyen kimlik bağlamı bozmaz', stale.context.length === q1.length - 1);
}

section('10) Sıralama sonrası tutarlılık (move senaryosu)');

{
  // M1 ile M2 yer değiştirdi: [C1, C2, M2, C3, M1, C4]
  const moved = [t('C1'), t('C2'), t('M2'), t('C3'), t('M1'), t('C4')];
  const s = deriveQueueSections(moved, 1, ['M1', 'M2']);
  check('yeni sıra kuyruktan okunur', JSON.stringify(ids(s.upNext)) === JSON.stringify(['M2', 'M1']));
  check('yeni indeksler doğru', JSON.stringify(s.upNext.map((e) => e.index)) === JSON.stringify([2, 4]));
  check('indeksler kuyruğa denk', indicesMatch(moved, s.upNext) && indicesMatch(moved, s.context));
}

section('11) Panel satır sırası (buildQueueRows)');

{
  // q1 = [C1, C2, C3, C4], C3 çalıyor, C4 sırada, manuel yok.
  const s = deriveQueueSections(q1, 2, []);
  const rows = buildQueueRows(s, 0, false);

  check(
    'sıra: geçmiş başlığı → geçmiş → şu an → bağlam başlığı → bağlam',
    rows.map((r) => r.kind).join(',') ===
      'section,history,history,current,section,context'
  );
  check(
    'geçmiş satırları eskiden yeniye',
    JSON.stringify(
      rows.filter((r) => r.kind === 'history').map((r) => trackKey((r as any).entry.track))
    ) === JSON.stringify(['C1', 'C2'])
  );
  check(
    'şu an satırı doğru parça',
    rows.find((r) => r.kind === 'current') !== undefined &&
      trackKey((rows.find((r) => r.kind === 'current') as any).entry.track) === 'C3'
  );
  check(
    'bağlam satırı C4',
    JSON.stringify(
      rows.filter((r) => r.kind === 'context').map((r) => trackKey((r as any).entry.track))
    ) === JSON.stringify(['C4'])
  );
  check('geçmiş başlığı sayı gösterir', (rows[0] as any).title.includes('2'));

  // İlk parça çalınıyorsa geçmiş başlığı hiç olmamalı.
  const firstRows = buildQueueRows(deriveQueueSections(q1, 0, []), 0, false);
  check(
    'geçmiş yoksa başlık da yok',
    firstRows[0].kind === 'current' && !firstRows.some((r) => r.kind === 'history')
  );

  // Manuel öğe varsa "upnext" satırı şu an ile bağlam arasında olmalı.
  const withManual = buildQueueRows(deriveQueueSections(q2, 1, ['M1', 'M2']), 2, false);
  const kinds = withManual.map((r) => r.kind);
  const upnextPos = kinds.indexOf('upnext');
  const currentPos = kinds.indexOf('current');
  const contextPos = kinds.indexOf('context');
  check('upnext satırı var', upnextPos !== -1);
  check('upnext, current ile bağlam arasında', currentPos < upnextPos && upnextPos < contextPos);

  // Boş/kirli girdi güvenli olmalı.
  check('sections null ise boş dizi', buildQueueRows(null, 0, false).length === 0);

  // Tüm satır anahtarları benzersiz olmalı (React key çakışması olmasın).
  const allRows = buildQueueRows(deriveQueueSections(q2, 1, ['M1', 'M2']), 2, true);
  const keys = allRows.map((r) => r.key);
  check('satır anahtarları benzersiz', new Set(keys).size === keys.length);

  // Shuffle başlığı farklı olmalı.
  const shuffledRows = buildQueueRows(deriveQueueSections(q1, 1, []), 0, true);
  const ctxTitle = (shuffledRows.find((r) => r.kind === 'section' && r.key === 'sec-context') as any)?.title ?? '';
  check('shuffle açıkken bağlam başlığı "KARIŞIK" der', ctxTitle.includes('KARIŞIK'));
}

// ─────────────────────────────────────────────────────────────────────────────

section('Sonuç');
if (failures === 0) {
  console.log('  TÜM TESTLER GEÇTİ ✅');
} else {
  console.log(`  ${failures} TEST BAŞARISIZ ❌`);
  throw new Error(`${failures} doğrulama başarısız`);
}
