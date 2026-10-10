/**
 * Kitaplık sıralaması doğrulaması ("Eklenme Tarihi").
 *
 * Gerçek uygulama mantığı kullanılır (src/services/librarySort.ts), kopyası değil.
 * Script native bağımlılık içermez; bu yüzden Node üzerinde çalışır.
 *
 * Çalıştırma:
 *   npx tsc scripts/verify-library-sort.ts --ignoreConfig --outDir .tmp-verify \
 *     --module commonjs --target es2020 --moduleResolution bundler --skipLibCheck
 *   node .tmp-verify/scripts/verify-library-sort.js
 */

import { compareAddedDate, getAddedTime, type SortableAsset } from '../src/services/librarySort';

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

section('1) getAddedTime — alan seçimi');

check(
  'modificationTime tercih edilir',
  getAddedTime({ id: '1', modificationTime: 1700000000000, creationTime: 1600000000000 }) ===
    1700000000000
);
check(
  'modificationTime yoksa creationTime kullanılır',
  getAddedTime({ id: '1', modificationTime: 0, creationTime: 1600000000000 }) === 1600000000000
);
check(
  'modificationTime null ise creationTime kullanılır',
  getAddedTime({ id: '1', modificationTime: null, creationTime: 1600000000000 }) === 1600000000000
);
check(
  'ikisi de yoksa 0 döner',
  getAddedTime({ id: '1' }) === 0 && getAddedTime({ id: '1', modificationTime: 0, creationTime: 0 }) === 0
);
check('negatif değerler yok sayılır', getAddedTime({ id: '1', modificationTime: -5 }) === 0);
check('NaN güvenli', getAddedTime({ id: '1', modificationTime: NaN, creationTime: NaN }) === 0);
check('null/undefined asset güvenli', getAddedTime(null) === 0 && getAddedTime(undefined) === 0);

section('2) ASIL HATA: ses dosyalarında creationTime 0');

// Gerçek dünya durumu: DATE_TAKEN (creationTime) ses dosyalarında 0,
// DATE_MODIFIED (modificationTime) gerçek indirilme zamanı.
const audio: SortableAsset[] = [
  { id: '100', creationTime: 0, modificationTime: 1_700_000_300_000 }, // en yeni
  { id: '101', creationTime: 0, modificationTime: 1_700_000_100_000 }, // en eski
  { id: '102', creationTime: 0, modificationTime: 1_700_000_200_000 }, // ortanca
];

// Eski (hatalı) davranış: creationTime ile karşılaştırma.
const oldFieldOrder = [...audio].sort((a, b) => (b.creationTime || 0) - (a.creationTime || 0));
check(
  'kanıt: creationTime ile sıralama HİÇ değişmiyor (eski hata)',
  JSON.stringify(oldFieldOrder.map((a) => a.id)) === JSON.stringify(['100', '101', '102'])
);

// Yeni davranış: gerçek uygulamanın kullandığı karşılaştırma.
const newestFirst = [...audio].sort((a, b) => compareAddedDate(b, a));
check(
  'modificationTime ile en yeni -> en eski doğru sıralanıyor',
  JSON.stringify(newestFirst.map((a) => a.id)) === JSON.stringify(['100', '102', '101'])
);

const oldestFirst = [...audio].sort((a, b) => compareAddedDate(a, b));
check(
  'artan sıralama en eski -> en yeni',
  JSON.stringify(oldestFirst.map((a) => a.id)) === JSON.stringify(['101', '102', '100'])
);

section('3) Aynı saniyede indirilenler (DATE_MODIFIED eşit)');

// DATE_MODIFIED saniye çözünürlüğünde; aynı saniyede biten indirmeler eşit görünür.
const sameSecond: SortableAsset[] = [
  { id: '500', modificationTime: 1_700_000_000_000 },
  { id: '502', modificationTime: 1_700_000_000_000 },
  { id: '501', modificationTime: 1_700_000_000_000 },
];
const tied = [...sameSecond].sort((a, b) => compareAddedDate(b, a));
check(
  'eşitlikte MediaStore id ile daha yeni önce gelir',
  JSON.stringify(tied.map((a) => a.id)) === JSON.stringify(['502', '501', '500'])
);
const tiedAsc = [...sameSecond].sort((a, b) => compareAddedDate(a, b));
check(
  'eşitlikte artan sırada id küçük olan önce',
  JSON.stringify(tiedAsc.map((a) => a.id)) === JSON.stringify(['500', '501', '502'])
);

section('4) Hiç zaman bilgisi yoksa id sırasına düşer');

const noTimes: SortableAsset[] = [
  { id: '10', modificationTime: 0, creationTime: 0 },
  { id: '30', modificationTime: 0, creationTime: 0 },
  { id: '20', modificationTime: 0, creationTime: 0 },
];
const noTimesSorted = [...noTimes].sort((a, b) => compareAddedDate(b, a));
check(
  'zaman yoksa en son eklenen (büyük id) önce',
  JSON.stringify(noTimesSorted.map((a) => a.id)) === JSON.stringify(['30', '20', '10'])
);

section('5) Bozuk girdiler çökme yaratmıyor');

check(
  'sayısal olmayan id güvenli',
  compareAddedDate({ id: 'abc' }, { id: 'def' }) === 0
);
check(
  'bir id sayısal değilse ayraç kullanılmaz',
  compareAddedDate({ id: 'abc' }, { id: '2' }) === 0
);
check('null girdiler güvenli', compareAddedDate(null, { id: '1' }) === -getAddedTime({ id: '1' }));
check(
  'karışık geçerli/geçersiz zamanlar çökmez',
  (() => {
    const mixed: SortableAsset[] = [
      { id: '1', modificationTime: 1_700_000_000_000 },
      { id: '2' },
      { id: '3', creationTime: 1_600_000_000_000 },
      { id: '4', modificationTime: NaN },
    ];
    try {
      const out = [...mixed].sort((a, b) => compareAddedDate(b, a));
      return out.length === 4;
    } catch {
      return false;
    }
  })()
);

section('6) Uçtan uca: karışık gerçekçi kitaplık');

const mixedLibrary: SortableAsset[] = [
  { id: '900', creationTime: 0, modificationTime: 1_700_000_500_000 }, // yeni indirilen
  { id: '901', creationTime: 0, modificationTime: 1_600_000_000_000 }, // eski indirilen
  { id: '902', creationTime: 0, modificationTime: 1_700_000_900_000 }, // en yeni
  { id: '903', creationTime: 0, modificationTime: 0 }, // zamanı okunamadı
];

const sortedLibrary = [...mixedLibrary].sort((a, b) => compareAddedDate(b, a));
check(
  'en yeni en üstte, zamanı okunamayan en altta',
  JSON.stringify(sortedLibrary.map((a) => a.id)) === JSON.stringify(['902', '900', '901', '903'])
);
check(
  'tüm parçalar korunur (kayıp yok)',
  new Set(sortedLibrary.map((a) => a.id)).size === mixedLibrary.length
);

// ─────────────────────────────────────────────────────────────────────────────

section('Sonuç');
if (failures === 0) {
  console.log('  TÜM TESTLER GEÇTİ ✅');
} else {
  console.log(`  ${failures} TEST BAŞARISIZ ❌`);
  throw new Error(`${failures} doğrulama başarısız`);
}
