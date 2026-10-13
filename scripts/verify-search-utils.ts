import { normalizeSearchText, searchMatches } from '../src/services/searchUtils';

declare const process: any;

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('PASS:', msg);
}

// 1. "ö" -> "o" ve "Ö" -> "o"
assert(normalizeSearchText('gözlerinde') === 'gozlerinde', 'gözlerinde -> gozlerinde');
assert(normalizeSearchText('GÖZLERİNDE') === 'gozlerinde', 'GÖZLERİNDE -> gozlerinde');
assert(searchMatches('Gözlerinde', 'gozlerinde'), 'searchMatches: Gözlerinde with gozlerinde');
assert(searchMatches('Gozlerinde', 'gözlerinde'), 'searchMatches: Gozlerinde with gözlerinde');

// 2. "ı", "i", "I", "İ"
assert(normalizeSearchText('ışık') === 'isik', 'ışık -> isik');
assert(normalizeSearchText('IŞIK') === 'isik', 'IŞIK -> isik');
assert(normalizeSearchText('isik') === 'isik', 'isik -> isik');
assert(normalizeSearchText('İSİK') === 'isik', 'İSİK -> isik');
assert(searchMatches('Işık', 'isik'), 'searchMatches: Işık with isik');
assert(searchMatches('isik', 'ışık'), 'searchMatches: isik with ışık');
assert(searchMatches('İstanbul', 'istanbul'), 'searchMatches: İstanbul with istanbul');
assert(searchMatches('İstanbul', 'ıstanbul'), 'searchMatches: İstanbul with ıstanbul');
assert(searchMatches('istanbul', 'İSTANBUL'), 'searchMatches: istanbul with İSTANBUL');

// 3. "ü", "ç", "ğ", "ş"
assert(searchMatches('Gülümse', 'gulumse'), 'searchMatches: Gülümse with gulumse');
assert(searchMatches('Çiçek', 'cicek'), 'searchMatches: Çiçek with cicek');
assert(searchMatches('Ağaç', 'agac'), 'searchMatches: Ağaç with agac');
assert(searchMatches('Şarkıcı', 'sarkici'), 'searchMatches: Şarkıcı with sarkici');

// 4. Çoklu kelime sırasız arama
assert(searchMatches('Dönence - Barış Manço', 'baris donence'), 'searchMatches: multiword baris donence');
assert(searchMatches('Dönence - Barış Manço', 'manco baris'), 'searchMatches: multiword manco baris');
assert(searchMatches('Dönence - Barış Manço', 'barış'), 'searchMatches: barış with baris');

console.log('\nTÜM ARAMA TESTLERİ GEÇTİ ✅');
