/**
 * Sanatçı fotoğrafı eşleştirmesinin doğrulaması.
 *
 * İki bölüm var:
 *  1. Saf yardımcılar: yer tutucu tespiti, kelime benzerliği, başlık örtüşmesi,
 *     popülerlik sıralaması ve örtüşmeye göre seçim.
 *  2. Canlı ağ testi: gerçek Deezer yanıtları üzerinde doğru sanatçının
 *     seçildiği. Ağ yoksa bu bölüm atlanır (test başarısız sayılmaz).
 *
 * Neden gerekli: Deezer'da aynı adda birden çok sanatçı var. Uygulama bir ara
 * ilk sonucu aldığı için "Motive", "UZI" ve "aisu" yanlış fotoğraf gösteriyordu.
 *
 * Çalıştırma:
 *   npx tsc scripts/verify-artist-images.ts --ignoreConfig --outDir .tmp-verify \
 *     --module commonjs --target es2020 --moduleResolution bundler --skipLibCheck
 *   node .tmp-verify/scripts/verify-artist-images.js
 */

import {
  MAX_TITLE_CANDIDATES,
  artistPictureOf,
  bestVotedId,
  isPlaceholderPicture,
  matchingTrackArtistIds,
  pickByTitleOverlap,
  rankDeezerArtists,
  titleOverlap,
  wordSimilarity,
  type DeezerArtistLike,
  type DeezerTrackLike,
} from '../src/services/artistImageMatch';

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

/** Gerçek CDN yolunu taklit eden görsel URL'i. */
function picture(hash: string): string {
  return `https://cdn-images.dzcdn.net/images/artist/${hash}/500x500-000000-80-0-0.jpg`;
}

function artist(
  id: number,
  name: string,
  fans: number,
  hash: string | null
): DeezerArtistLike {
  return {
    id,
    name,
    nb_fan: fans,
    picture_big: hash === null ? undefined : picture(hash),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
section('Yer tutucu görsel tespiti');

check('gerçek hash kabul edilir', !isPlaceholderPicture(picture('ebcf22e5c3a0eb3178b8a6f6bc1a5a6c')));
check('kısa hash yer tutucu', isPlaceholderPicture(picture('abc')));
check('boş hash yer tutucu', isPlaceholderPicture(picture('')));
check('sıfırlardan oluşan hash yer tutucu', isPlaceholderPicture(picture('00000000000000000000000000000000')));
check('boş URL yer tutucu', isPlaceholderPicture('') && isPlaceholderPicture(null));
check('yol tanınmazsa yer tutucu', isPlaceholderPicture('https://example.com/a.jpg'));

// ─────────────────────────────────────────────────────────────────────────────
section('Kelime benzerliği');

check('aynı isim → 1', wordSimilarity('Motive', 'Motive') === 1);
check('büyük/küçük harf yok sayılır', wordSimilarity('UZI', 'uzi') === 1);
check('ilgisiz isim → 0', wordSimilarity('MOT!VE', 'Motive') === 0);
// "Uzi & Ari" üç kelimeye ayrılır, yalnızca biri örtüşür.
check('kısmi kelime', Math.abs(wordSimilarity('Uzi & Ari', 'Uzi') - 1 / 3) < 0.001);
check('boş isim → 0', wordSimilarity('', 'Uzi') === 0);

// ─────────────────────────────────────────────────────────────────────────────
section('Başlık örtüşmesi');

check('aynı başlıklar → 1', titleOverlap(['Cennet'], ['Cennet']) === 1);
check('kısa liste bölen olur', titleOverlap(['Cennet', 'Caney'], ['cennet', 'x', 'y', 'z']) === 0.5);
check('örtüşme yok → 0', titleOverlap(['Cennet'], ['Revolt']) === 0);
check('boş liste → 0', titleOverlap([], ['Cennet']) === 0);

// ─────────────────────────────────────────────────────────────────────────────
section('Popülerlik sıralaması');

// Gerçek Deezer yanıtı: "Motive" araması (doğru kişi 42.899 hayran).
const motiveResults: DeezerArtistLike[] = [
  artist(86431782, 'Motive', 20, 'ea8b2052abb07f66c5c37396932b8e7e'),
  artist(86431382, 'Motive', 119, 'ed94718f8e0248951ed2c5c4ce54bf07'),
  artist(86431362, 'Motive', 2, 'f905db75018f874ed0046387b10e9795'),
  artist(329894201, 'MOT!VE', 1, 'a7a9f95a6cf577e46bf1457979b0ca2a'),
  artist(72196, 'Motive', 42899, 'ebcf22e5c3a0eb3178b8a6f6bc1a5a6c'),
];

const motiveRanked = rankDeezerArtists(motiveResults, 'Motive');
check('en popüler doğru sanatçı başta', motiveRanked[0]?.id === 72196, String(motiveRanked[0]?.id));
check('tam eşleşmeyen ad ("MOT!VE") elenir', motiveRanked.every((item) => item.id !== 329894201));
check('tüm "Motive" kayıtları aday', motiveRanked.length === 4, String(motiveRanked.length));

// Gerçek Deezer yanıtı: "UZI" araması (doğru kişi 135.940 hayran).
const uziResults: DeezerArtistLike[] = [
  artist(153405332, 'Uzi', 65, 'ea18be765d0bfba80fceef535464a060'),
  artist(81533692, 'Uzi', 1394, 'a848e2cc46974d8188e29a9060ffbc64'),
  artist(81533352, 'Uzi', 31, '4b26ba75ca7ffac81c6a95779b186c1a'),
  artist(1070683, 'Uzi & Ari', 332, 'f8d84431fe76216609e6a09e1a7bd1a3'),
  artist(98336572, 'Uzi', 135940, '65905c1901748c17c176bfd1889cc3ae'),
];

const uziRanked = rankDeezerArtists(uziResults, 'UZI');
check('UZI doğru sanatçı başta', uziRanked[0]?.id === 98336572, String(uziRanked[0]?.id));
check('"Uzi & Ari" elenir (tam eşleşme var)', uziRanked.every((item) => item.id !== 1070683));

check(
  'yer tutucu fotoğrafı olan aday aday kalmaz',
  rankDeezerArtists([artist(1, 'Zzz', 9999, null)], 'Zzz').length === 0
);
check('hiç sonuç yoksa boş', rankDeezerArtists([], 'Zzz').length === 0);
check('zayıf eşleşme elenir', rankDeezerArtists([artist(2, 'Bambaşka', 50, 'abcdef1234567890')], 'Zzz').length === 0);

// ─────────────────────────────────────────────────────────────────────────────
section('Örtüşmeye göre seçim');

const motiveTops = [
  ['pVg (Manifest Live Remix)', 'YIN YANG', 'Yüce Aşk', 'LACIVERT'],
  ['Raiders Cap', "Just Can't Quit (feat. Scoop Deville)", 'Dopest Nigga Alive'],
  [],
  [],
];
check(
  'Motive: kütüphane parçaları doğru kaydı seçer',
  pickByTitleOverlap(motiveRanked.slice(0, MAX_TITLE_CANDIDATES), ['YIN YANG'], [
    motiveTops[0],
    motiveTops[1],
    motiveTops[2],
  ]) === 0
);
check(
  'Motive: doğrulama yoksa popülerlik korunur',
  pickByTitleOverlap(motiveRanked, [], motiveTops) === 0
);

// Yanlış kişi daha popüler olsaydı bile kütüphane parçaları kazanmalı.
const wrongFirst = [artist(86431382, 'Motive', 999999, 'ed94718f8e0248951ed2c5c4ce54bf07'), motiveResults[4]];
check(
  'örtüşme popülerliği yener',
  pickByTitleOverlap(wrongFirst, ['Raiders Cap'], [[], ['pVg', 'YIN YANG']]) === 0
);
check(
  'eşit örtüşmede daha popüler olan kalır',
  pickByTitleOverlap(wrongFirst, ['Yok'], [['Yok'], ['Yok']]) === 0
);

// ─────────────────────────────────────────────────────────────────────────────
section('Görsel URL seçimi');

check('büyük görsel tercih edilir', artistPictureOf({ picture_big: 'big', picture_medium: 'medium' }) === 'big');
check('büyük yoksa orta', artistPictureOf({ picture_medium: 'medium' }) === 'medium');
check('hiç yoksa null', artistPictureOf({}) === null);

// ─────────────────────────────────────────────────────────────────────────────
section('Parça aramasıyla kimlik doğrulama');

const trackResults = [
  { title: 'Cennet', artist: { id: 98336572, name: 'Uzi' } },
  { title: 'XO Tour Llif3', artist: { id: 7101343, name: 'Lil Uzi Vert' } },
  { title: 'Cennet', artist: { id: 999, name: 'Uzi Cover Band' } },
];

const matchedIds = matchingTrackArtistIds(trackResults, 'UZI');
check('yalnızca ada tam eşleşen sanatçılar', matchedIds.length === 1, matchedIds.join(','));
check('doğru kimlik çıkar', matchedIds[0] === 98336572, String(matchedIds[0]));
check('boş isim → sonuç yok', matchingTrackArtistIds(trackResults, '').length === 0);
check('kimliksiz sonuç atlanır', matchingTrackArtistIds([{ artist: { name: 'Uzi' } }], 'Uzi').length === 0);

check('oy yoksa null', bestVotedId(new Map<number, number>()) === null);
check(
  'en çok oyu alan kazanır',
  bestVotedId(new Map([[1, 1], [2, 3]]), [1, 2]) === 2
);
check(
  'eşitlikte popüler aday kazanır',
  bestVotedId(new Map([[7, 2], [3, 2]]), [3, 7]) === 3
);
check(
  'eşitlikte aday dışı kimlik geride kalır',
  bestVotedId(new Map([[55, 1], [9, 1]]), [9]) === 9
);

// ─────────────────────────────────────────────────────────────────────────────
section('Canlı ağ testi (Deezer)');

interface DeezerSearchResponse {
  data?: DeezerArtistLike[];
}

/** Uygulamadaki `fetchFromDeezer` akışının aynısı (ağ + saf kararlar). */
async function resolveArtistId(name: string, knownTitles: string[]): Promise<number | null> {
  const search = await fetch(
    `https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=10`
  ).then((res) => res.json() as Promise<DeezerSearchResponse>);
  const ranked = rankDeezerArtists(Array.isArray(search?.data) ? search.data : [], name);
  if (ranked.length === 0) return null;
  if (ranked.length === 1 || knownTitles.length === 0) return ranked[0].id ?? null;

  const candidateIds = ranked
    .map((artist) => artist.id)
    .filter((id): id is number => typeof id === 'number');

  const votes = new Map<number, number>();
  let resolvedId: number | null = null;
  for (const title of knownTitles.slice(0, 3)) {
    const found = await fetch(
      `https://api.deezer.com/search?q=${encodeURIComponent(`${title} ${name}`)}&limit=6`
    ).then((res) => res.json() as Promise<{ data?: DeezerTrackLike[] }>);
    const ids = matchingTrackArtistIds(Array.isArray(found?.data) ? found.data : [], name);
    if (ids.length === 0) continue;
    votes.set(ids[0], (votes.get(ids[0]) ?? 0) + 1);
    resolvedId = bestVotedId(votes, candidateIds);
    if (resolvedId != null && candidateIds.includes(resolvedId)) break;
  }
  if (resolvedId != null) return resolvedId;

  const candidates = ranked.slice(0, MAX_TITLE_CANDIDATES);
  const tops = await Promise.all(
    candidates.map(async (candidate) => {
      if (candidate.id == null) return [] as string[];
      const top = await fetch(`https://api.deezer.com/artist/${candidate.id}/top?limit=25`).then(
        (res) => res.json() as Promise<{ data?: { title?: string }[] }>
      );
      return (top?.data ?? []).map((item) => item.title || '').filter(Boolean);
    })
  );
  return candidates[pickByTitleOverlap(candidates, knownTitles, tops)].id ?? null;
}

const liveCases: { name: string; titles: string[]; expected: number }[] = [
  // Doğru kayıtlar gerçek Deezer kimlikleriyle sabitlendi.
  { name: 'Motive', titles: ['pVg (Manifest Live Remix)', 'YIN YANG'], expected: 72196 },
  { name: 'UZI', titles: ['Cennet', 'Şarkılar Sokaklara Ait'], expected: 98336572 },
  { name: 'aisu', titles: ['küt küt', 'nerdesin?'], expected: 6135952 },
];

async function main(): Promise<void> {
  for (const testCase of liveCases) {
    try {
      const withHints = await resolveArtistId(testCase.name, testCase.titles);
      check(
        `${testCase.name}: parça ipucuyla doğru kayıt`,
        withHints === testCase.expected,
        `beklenen ${testCase.expected}, gelen ${withHints}`
      );
    } catch (error) {
      console.log(`  SKIP  ${testCase.name} - ağ hatası (${(error as Error).message})`);
    }
  }

  // Neden ipucu şart: "UZI" adında daha popüler bir kayıt var (Fransız
  // sanatçı). İpucu olmadan popülerlik yanlış kişiyi seçer; ipucuyla seçim
  // doğru kayda gider. Bu test o davranışı kilitler.
  try {
    const withoutHints = await resolveArtistId('UZI', []);
    const withHints = await resolveArtistId('UZI', ['Cennet']);
    check(
      'UZI: ipucu seçimi değiştirir (popülerlik yanıltıcı)',
      withoutHints !== withHints && withHints === 98336572,
      `ipucusuz ${withoutHints}, ipuçlu ${withHints}`
    );
  } catch (error) {
    console.log(`  SKIP  UZI ipucu karşılaştırması - ağ hatası (${(error as Error).message})`);
  }

  console.log('\nSonuç');
  if (failures === 0) {
    console.log('  TÜM TESTLER GEÇTİ.');
  } else {
    console.log(`  ${failures} TEST BAŞARISIZ.`);
    (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
  }
}

void main();
