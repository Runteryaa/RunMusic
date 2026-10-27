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
  computeUpcomingOrder,
  deriveQueueSections,
  findNextPlayableIndex,
  getPlaybackMode,
  nextPlaybackMode,
  reorderQueueOnTrackSelect,
  shuffleArray,
  smartShuffleArray,
  trackKey,
  type QueueTrackLike,
  type QueueRow,
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

/** Deterministik testler için küçük LCG. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
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

section('4c) Gerçek dinleme geçmişi (playedHistory) — kuyruk sırasından bağımsız');

{
  // Kullanıcı C3 dinledi, sonra C1 dinledi, şu an C4 çalıyor.
  // Kuyruk sırası: [C1, C2, C3, C4] olsa bile, dinleme geçmişi tam olarak [C3, C1] olmalı.
  const played = [t('C3'), t('C1')];
  const s = deriveQueueSections(q1, 3, [], played);
  check('dinleme geçmişi dinlenme sırasını (C3 -> C1) korur', JSON.stringify(ids(s.history)) === JSON.stringify(['C3', 'C1']));
  check('mevcut parça geçmişte gösterilmez', !ids(s.history).includes('C4'));
  check('kuyruk indeksi doğru çözümlenir', s.history[0].index === 2 && s.history[1].index === 0);

  // Kuyruk karıştırılsa bile (ör. [C4, C2, C1, C3]) geçmiş sırası DEĞİŞMEZ
  const shuffledQ = [t('C4'), t('C2'), t('C1'), t('C3')];
  const sShuffled = deriveQueueSections(shuffledQ, 0, [], played);
  check('kuyruk sırası değişse bile geçmiş sırası [C3, C1] olarak kalır', JSON.stringify(ids(sShuffled.history)) === JSON.stringify(['C3', 'C1']));

  // Yeni parça başlatıldığında geçmiş boşsa geçmiş bölümü boştur (0 parça)
  const fresh = deriveQueueSections(q1, 2, [], []);
  check('yeni başlatılan oturumda geçmiş boş başlar (activeIndex 2 olsa bile)', fresh.history.length === 0);
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

section('10b) activeTrackKey ile kanonik parça kurtarma (sahte indeks kayması)');

{
  const moved = [t('C1'), t('C2'), t('M2'), t('C3'), t('M1'), t('C4')];
  // activeIndex sahte olarak 2 (M2) bildirilse bile activeTrackKey C2 ise düzeltilmeli
  const s = deriveQueueSections(moved, 2, ['M1', 'M2'], undefined, 'C2');
  check('sahte indeks yerine C2 doğru çözümlendi', s.current?.track.id === 'C2' && s.current?.index === 1);
  check('upNext C2 ardındaki manuel öğeler', JSON.stringify(ids(s.upNext)) === JSON.stringify(['M2', 'M1']));
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

section('12) Shuffle aç/kapat sıralaması (computeUpcomingOrder)');

{
  const ctx = ['A', 'B', 'C', 'D', 'E', 'F'].map(t);
  const contextIds = ctx.map((x) => trackKey(x));

  // ASIL HATA: contextIds BOŞKEN shuffle açmak sırayı karıştırmıyordu.
  const noBaseline = computeUpcomingOrder({
    enabled: true,
    upNextTracks: [],
    upcomingContext: ctx,
    contextIds: [],
    fullQueue: ctx,
  });
  check(
    'contextIds boşken shuffle yine de karıştırır (asıl hata)',
    noBaseline.upcoming.length === ctx.length &&
      JSON.stringify(noBaseline.upcoming) !== JSON.stringify(ctx)
  );
  check(
    'contextIds boşken taban sıra döner (sonradan kapatabilmek için)',
    JSON.stringify(noBaseline.baselineIds) === JSON.stringify(contextIds)
  );

  const withBaseline = computeUpcomingOrder({
    enabled: true,
    upNextTracks: [],
    upcomingContext: ctx,
    contextIds,
    fullQueue: ctx,
  });
  check('orijinal sıra varsa taban döndürülmez', withBaseline.baselineIds === null);
  check(
    'shuffle bir permütasyondur (kayıp/tekrar yok)',
    [...withBaseline.upcoming].map(trackKey).sort().join(',') === [...contextIds].sort().join(',')
  );

  // Kapatınca orijinal kütüphane sırasına dönülür (karışık sıradan).
  const shuffledMid = shuffleArray(ctx);
  const off = computeUpcomingOrder({
    enabled: false,
    upNextTracks: [],
    upcomingContext: shuffledMid,
    contextIds,
    fullQueue: ctx,
  });
  check(
    'kapatınca orijinal kütüphane sırasına döner',
    JSON.stringify(off.upcoming.map(trackKey)) === JSON.stringify(contextIds)
  );

  // Orijinal sıra yokken kapatmak sırayı BOZMAMALI (çalma bozulmasın).
  const offNoBaseline = computeUpcomingOrder({
    enabled: false,
    upNextTracks: [],
    upcomingContext: shuffledMid,
    contextIds: [],
    fullQueue: shuffledMid,
  });
  check(
    'orijinal sıra yokken kapatmak mevcut sırayı korur',
    JSON.stringify(offNoBaseline.upcoming) === JSON.stringify(shuffledMid)
  );

  // Manuel "Sırada" öğeleri shuffle açık/kapalı her durumda ÖNDE kalmalı.
  const manual = [t('M1'), t('M2')];
  const onWithManual = computeUpcomingOrder({
    enabled: true,
    upNextTracks: manual,
    upcomingContext: ctx,
    contextIds,
    fullQueue: ctx,
  });
  check(
    'shuffle açıkken manuel öğeler bağlamın önünde',
    JSON.stringify(onWithManual.upcoming.slice(0, 2).map(trackKey)) === JSON.stringify(['M1', 'M2'])
  );
  const offWithManual = computeUpcomingOrder({
    enabled: false,
    upNextTracks: manual,
    upcomingContext: shuffleArray(ctx),
    contextIds,
    fullQueue: ctx,
  });
  check(
    'shuffle kapatılırken manuel öğeler önde kalır',
    JSON.stringify(offWithManual.upcoming.slice(0, 2).map(trackKey)) === JSON.stringify(['M1', 'M2'])
  );
  check(
    'manuel + bağlam uzunluğu korunur',
    offWithManual.upcoming.length === manual.length + ctx.length
  );

  // Karıştırmanın gerçekten olduğunu olasılıksal doğrula.
  let shuffledOnce = false;
  for (let i = 0; i < 20; i++) {
    const r = computeUpcomingOrder({
      enabled: true,
      upNextTracks: [],
      upcomingContext: ctx,
      contextIds,
      fullQueue: ctx,
    });
    if (JSON.stringify(r.upcoming) !== JSON.stringify(ctx)) {
      shuffledOnce = true;
      break;
    }
  }
  check('shuffle gerçekten sırayı değiştiriyor', shuffledOnce);

  // Boş bağlam güvenli olmalı.
  const empty = computeUpcomingOrder({
    enabled: true,
    upNextTracks: [],
    upcomingContext: [],
    contextIds: [],
    fullQueue: [],
  });
  check('boş bağlam güvenli', empty.upcoming.length === 0);
}

section('13) "Karışık çal" — rastgele başlangıç her zaman geçerli');

{
  // Kütüphane ekranındaki shuffle butonu rastgele bir parçadan başlar ve
  // `buildPlayOrder(..., shuffle: true)` ile kuyruğu kurar. Hangi parça
  // seçilirse seçilsin: o parça ilk sırada olmalı ve geri kalanı tam bir
  // permütasyon olmalı (kayıp/tekrar yok).
  const lib = ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9'];
  const expected = [...lib].sort().join(',');

  const allStartsValid = lib.every((start) => {
    const order = buildPlayOrder(lib, start, true);
    return order[0] === start && [...order].sort().join(',') === expected;
  });
  check('her olası başlangıç: seçilen ilk sırada + tam permütasyon', allStartsValid);

  // Tek parçalı kütüphane çökme yaratmamalı.
  const single = buildPlayOrder(['only'], 'only', true);
  check('tek parçalı kütüphane güvenli', single.length === 1 && single[0] === 'only');

  // Boş kütüphane güvenli (buton zaten devre dışı ama yine de).
  check('boş kütüphane güvenli', buildPlayOrder([], '', true).length === 0);

  // Başlangıç kimliği listede yoksa hiçbir parça kaybolmamalı.
  const unknownStart = buildPlayOrder(lib, 'yok', true);
  check(
    'listede olmayan başlangıç parça kaybettirmez',
    [...unknownStart].sort().join(',') === expected
  );
}

section('14) smartShuffleArray — sanatçı ayrıştırması ve ağırlıklandırma');

{
  const tracks: QueueTrackLike[] = [
    { id: 't1', artist: 'ArtistA', title: 'Song 1' },
    { id: 't2', artist: 'ArtistA', title: 'Song 2' },
    { id: 't3', artist: 'ArtistA', title: 'Song 3' },
    { id: 't4', artist: 'ArtistB', title: 'Song 4' },
    { id: 't5', artist: 'ArtistB', title: 'Song 5' },
    { id: 't6', artist: 'ArtistC', title: 'Song 6' },
    { id: 't7', artist: 'ArtistC', title: 'Song 7' },
    { id: 't8', artist: 'ArtistD', title: 'Song 8' },
  ];

  const playCounts: Record<string, number> = {
    t1: 50,
    t4: 30,
    t6: 0,
  };

  const result = smartShuffleArray(tracks, {
    playCounts,
    getArtist: (tr) => tr.artist,
  });

  check('uzunluk korunur', result.length === tracks.length);
  check(
    'tüm parçalar mevcut (kayıp/tekrar yok)',
    [...result.map((x) => x.id)].sort().join(',') === [...tracks.map((x) => x.id)].sort().join(',')
  );

  let consecutiveSameArtist = 0;
  for (let i = 0; i < result.length - 1; i++) {
    if (result[i].artist === result[i + 1].artist) {
      consecutiveSameArtist++;
    }
  }
  check('aynı sanatçının peş peşe gelmesi minimize edilir', consecutiveSameArtist <= 1);

  const singleArtistTracks: QueueTrackLike[] = [
    { id: 's1', artist: 'Solo', title: 'Solo 1' },
    { id: 's2', artist: 'Solo', title: 'Solo 2' },
    { id: 's3', artist: 'Solo', title: 'Solo 3' },
  ];
  const singleResult = smartShuffleArray(singleArtistTracks);
  check('tek sanatçılı kütüphanede çökmez', singleResult.length === 3);

  check('boş dizi güvenli', smartShuffleArray([]).length === 0);
  check('tek elemanlı dizi güvenli', smartShuffleArray([{ id: 'x' }]).length === 1);
}

section('14b) Akıllı karıştırma — tohum, sanatçı aralığı ve nadir/sık dengeleme');
{
  const seedTracks: QueueTrackLike[] = [
    { id: 'seed-a', artist: 'SeedArtist', title: 'Seed A' },
    { id: 'seed-b', artist: 'SeedArtist', title: 'Seed B' },
    { id: 'other-1', artist: 'Artist 1', title: 'Other 1' },
    { id: 'other-2', artist: 'Artist 2', title: 'Other 2' },
    { id: 'other-3', artist: 'Artist 3', title: 'Other 3' },
  ];
  const seeded = smartShuffleArray(seedTracks, {
    getArtist: (track) => track.artist,
    seedArtists: ['SeedArtist'],
    random: makeRandom(7),
  });
  check(
    'çalan sanatçının başka bir şarkısı ilk sıraya gelmez',
    seeded[0]?.artist !== 'SeedArtist',
    seeded.map((track) => `${track.id}:${track.artist}`).join(', ')
  );

  const spaced = smartShuffleArray(
    [
      { id: 'a1', artist: 'A' },
      { id: 'a2', artist: 'A' },
      { id: 'b1', artist: 'B' },
      { id: 'c1', artist: 'C' },
      { id: 'd1', artist: 'D' },
    ],
    { getArtist: (track) => track.artist, random: makeRandom(11) }
  );
  let adjacentSameArtist = 0;
  for (let i = 0; i < spaced.length - 1; i++) {
    if (spaced[i].artist === spaced[i + 1].artist) adjacentSameArtist++;
  }
  check('aynı sanatçı arka arkaya gelmez', adjacentSameArtist === 0);

  const rareTracks = Array.from({ length: 4 }, (_, i) => ({
    id: `rare-${i}`,
    artist: `Rare Artist ${i}`,
    title: `Rare ${i}`,
  }));
  const frequentTracks = Array.from({ length: 4 }, (_, i) => ({
    id: `freq-${i}`,
    artist: `Frequent Artist ${i}`,
    title: `Frequent ${i}`,
  }));
  const blendCounts: Record<string, number> = {};
  for (const track of rareTracks) blendCounts[track.id] = 0;
  for (const track of frequentTracks) blendCounts[track.id] = 50;

  const blended = smartShuffleArray([...rareTracks, ...frequentTracks], {
    playCounts: blendCounts,
    getArtist: (track) => track.artist,
    random: makeRandom(23),
  });
  const blendedCounts = blended.map((track) => blendCounts[track.id]);
  check(
    'az ve çok çalınan parçalar dönüşümlü seçilir',
    blendedCounts.every((count, index) => count === (index % 2 === 0 ? 0 : 50)),
    blendedCounts.join(', ')
  );

  const rareSeedFirst = smartShuffleArray([...rareTracks, ...frequentTracks], {
    playCounts: blendCounts,
    getArtist: (track) => track.artist,
    seedPlayCount: 0,
    random: makeRandom(29),
  });
  check(
    'çalan parça nadirse ilk seçim sık havuzdan gelir',
    blendCounts[rareSeedFirst[0]?.id] === 50,
    blendCounts[rareSeedFirst[0]?.id]?.toString()
  );

  const frequentSeedFirst = smartShuffleArray([...rareTracks, ...frequentTracks], {
    playCounts: blendCounts,
    getArtist: (track) => track.artist,
    seedPlayCount: 50,
    random: makeRandom(31),
  });
  check(
    'çalan parça sık dinleniyorsa ilk seçim nadir havuzdan gelir',
    blendCounts[frequentSeedFirst[0]?.id] === 0,
    blendCounts[frequentSeedFirst[0]?.id]?.toString()
  );

  const order = buildPlayOrder(['seed-a', 'seed-b', 'other-1', 'other-2', 'other-3'], 'seed-a', true, {
    smartShuffle: true,
    getArtist: (id) =>
      id === 'seed-a' || id === 'seed-b' ? 'SeedArtist' : `Artist ${id}`,
    seedArtists: ['SeedArtist'],
  });
  check('buildPlayOrder seçilen parçayı ilk sırada tutar', order[0] === 'seed-a');
  check('buildPlayOrder tohum sanatçısını ikinci sırada tekrarlamaz', order[1] !== 'seed-b', order.join(', '));
  check(
    'buildPlayOrder tüm parçaları tam bir kez içerir',
    [...order].sort().join(',') === ['seed-a', 'seed-b', 'other-1', 'other-2', 'other-3'].sort().join(',')
  );
}

section('14c) Dört durumlu oynatma modu');
{
  check(
    'tekrarsız/karışıksız durum Tümünü Tekrarla olarak okunur',
    getPlaybackMode({ isShuffle: false, isSmartShuffle: false, isRepeatOne: false }) ===
      'repeat-all'
  );
  check(
    'klasik karışık doğru okunur',
    getPlaybackMode({ isShuffle: true, isSmartShuffle: false, isRepeatOne: false }) ===
      'shuffle'
  );
  check(
    'akıllı karışık doğru okunur',
    getPlaybackMode({ isShuffle: true, isSmartShuffle: true, isRepeatOne: false }) ===
      'smart'
  );
  check(
    'tek şarkı tekrarı doğru okunur',
    getPlaybackMode({ isShuffle: true, isSmartShuffle: true, isRepeatOne: true }) ===
      'repeat-one'
  );
  check('döngü sırası: repeat-all -> shuffle', nextPlaybackMode('repeat-all') === 'shuffle');
  check('döngü sırası: shuffle -> smart', nextPlaybackMode('shuffle') === 'smart');
  check('döngü sırası: smart -> repeat-one', nextPlaybackMode('smart') === 'repeat-one');
  check('döngü sırası: repeat-one -> repeat-all', nextPlaybackMode('repeat-one') === 'repeat-all');
}

section('15) buildQueueRows — AKILLI KARIŞIK başlığı');
{
  const testSections = {
    history: [],
    current: { index: 0, track: { id: 'c', title: 'Current' } },
    upNext: [],
    context: [{ index: 1, track: { id: 'ctx', title: 'Next' } }],
  };

  const smartRows = buildQueueRows(testSections, 0, true, true);
  const contextSection = smartRows.find(
    (r): r is Extract<QueueRow<any>, { kind: 'section' }> => r.kind === 'section' && r.key === 'sec-context'
  );
  check(
    'akıllı karıştırmada başlık AKILLI KARIŞIK içerir',
    contextSection !== undefined && contextSection.title.includes('AKILLI KARIŞIK')
  );

  const classicRows = buildQueueRows(testSections, 0, true, false);
  const classicSection = classicRows.find(
    (r): r is Extract<QueueRow<any>, { kind: 'section' }> => r.kind === 'section' && r.key === 'sec-context'
  );
  check(
    'klasik karıştırmada başlık KARIŞIK içerir',
    classicSection !== undefined && classicSection.title.includes('KARIŞIK') && !classicSection.title.includes('AKILLI')
  );
}

section('16) findNextPlayableIndex — çalınamayan şarkıları atlama ve döngü koruması');
{
  const queue = [t('1'), t('2'), t('3'), t('4')];

  // 1. Basit atlama: index 0 bozuksa index 1'e geçer
  const next1 = findNextPlayableIndex(queue, 0, (track) => track.id === '1');
  check('bozuk ilk parçadan sonraki ilk çalınabilir parçaya geçer (1)', next1 === 1);

  // 2. Ardışık bozuk parçalar: index 0 ve 1 bozuksa index 2'ye geçer
  const next2 = findNextPlayableIndex(queue, 0, (track) => track.id === '1' || track.id === '2');
  check('peş peşe bozuk parçaları atlayıp çalınabilir olanı bulur (2)', next2 === 2);

  // 3. Kuyruk sonu ve tüm parçalar bozuk: -1 döner (pause güvencesi)
  const nextAllBroken = findNextPlayableIndex(queue, 0, () => true);
  check('tüm parçalar bozuksa -1 döner (sonsuz döngüye girmez)', nextAllBroken === -1);

  // 4. Kuyruk sonundaki parça bozuksa (RepeatMode.Off): -1 döner
  const nextAtEnd = findNextPlayableIndex(queue, 3, () => false, false);
  check('kuyruk sonunda ileride başka parça yoksa -1 döner', nextAtEnd === -1);

  // 5. RepeatMode.Queue açıkken kuyruk sonundaki parça bozuksa: başa sarıp arar
  const nextRepeatQueue = findNextPlayableIndex(queue, 3, (track) => track.id === '1' || track.id === '4', true);
  check('RepeatMode.Queue: kuyruk sonundan başa sararak ilk çalınabilir parçayı bulur (1)', nextRepeatQueue === 1);

  // 6. RepeatMode.Queue açık ama tüm parçalar bozuksa: -1 döner (sonsuz döngü engeli)
  const nextRepeatAllBroken = findNextPlayableIndex(queue, 2, () => true, true);
  check('RepeatMode.Queue: tüm parçalar bozuksa sonsuz modulo döngüsüne girmeden -1 döner', nextRepeatAllBroken === -1);

  // 7. Boş veya geçersiz kuyruk: -1 döner
  check('boş kuyruk -1 döner', findNextPlayableIndex([], 0, () => false) === -1);
}

section('17) reorderQueueOnTrackSelect — önceliksiz sıradan parça seçildiğinde öncelikli sıranın korunması');
{
  const queue = [t('A'), t('U1'), t('U2'), t('C1'), t('C2'), t('C3')];
  const upNextIds = ['U1', 'U2'];

  // 1. Kullanıcı C2'ye (önceliksiz sıra, targetIndex: 4) dokunursa:
  // C2 başa/mevcut konuma gelir, U1 ve U2 C2'nin HEMEN ARDINA taşınır.
  const res1 = reorderQueueOnTrackSelect({
    queue,
    targetIndex: 4,
    upNextIds,
    clearOnSelect: false,
  });

  check(
    'C2 dokunulduğunda yeni aktif indeks C2 olmalı',
    res1.newStartIndex === 2 && trackKey(res1.newQueue[res1.newStartIndex]) === 'C2'
  );
  check(
    'U1 ve U2 C2 ardında korunmalı (yeni sıra: [A, C1, C2, U1, U2, C3])',
    res1.newQueue.map(trackKey).join(',') === 'A,C1,C2,U1,U2,C3'
  );
  check(
    'upNextIds U1 ve U2 olarak korunmalı',
    res1.newUpNextIds.join(',') === 'U1,U2'
  );

  // 2. Bu yeni sırada C2 bittiğinde/skiplendiğinde (indeks ilerlediğinde) ne olur?
  // Native TrackPlayer 2'den 3'e geçer -> U1 çalar!
  const sectionsAfterC2 = deriveQueueSections(
    res1.newQueue,
    res1.newStartIndex,
    res1.newUpNextIds
  );
  check(
    'deriveQueueSections: şu an çalan C2 olmalı',
    sectionsAfterC2.current?.track.id === 'C2'
  );
  check(
    'deriveQueueSections: öncelikli sırada U1 ve U2 görünmeli',
    sectionsAfterC2.upNext.map((e) => e.track.id).join(',') === 'U1,U2'
  );
  check(
    'deriveQueueSections: context bölümünde C3 yer almalı',
    sectionsAfterC2.context.map((e) => e.track.id).join(',') === 'C3'
  );

  // 3. Kullanıcı öncelikli sıradaki U2'ye (targetIndex: 2) doğrudan dokunursa:
  const res2 = reorderQueueOnTrackSelect({
    queue,
    targetIndex: 2,
    upNextIds,
    clearOnSelect: false,
  });
  check(
    'U2 dokunulduğunda hedef indeks 2 kalmalı',
    res2.newStartIndex === 2 && trackKey(res2.newQueue[2]) === 'U2'
  );
  check(
    'U2 çalındığı için upNextIds listesinden düşmeli (kalan: [U1])',
    res2.newUpNextIds.join(',') === 'U1'
  );

  // 4. clearOnSelect true olduğunda öncelikli sıra temizlenmeli
  const res3 = reorderQueueOnTrackSelect({
    queue,
    targetIndex: 4,
    upNextIds,
    clearOnSelect: true,
  });
  check(
    'clearOnSelect true iken upNextIds boşalmalı',
    res3.newUpNextIds.length === 0
  );
  check(
    'clearOnSelect true iken sıra değiştirilmeden hedef indekse atlanmalı',
    res3.newStartIndex === 4 && trackKey(res3.newQueue[4]) === 'C2'
  );

  // 5. Öncelikli sıra boşken doğrudan atlama yapılmalı
  const resEmpty = reorderQueueOnTrackSelect({
    queue,
    targetIndex: 3,
    upNextIds: [],
    clearOnSelect: false,
  });
  check(
    'upNextIds boşken sıra aynen korunmalı',
    resEmpty.newStartIndex === 3 && resEmpty.newQueue.map(trackKey).join(',') === 'A,U1,U2,C1,C2,C3'
  );
}

// ─────────────────────────────────────────────────────────────────────────────

section('Sonuç');
if (failures === 0) {
  console.log('  TÜM TESTLER GEÇTİ ✅');
} else {
  console.log(`  ${failures} TEST BAŞARISIZ ❌`);
  throw new Error(`${failures} doğrulama başarısız`);
}

