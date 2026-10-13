import { cleanDisplayTitle, stripArtistFromTitle, cleanYouTubeTitle } from '../src/services/lyricsService';

declare const process: any;

let failures = 0;

function check(name: string, actual: string, expected: string): void {
  if (actual === expected) {
    console.log(`  PASS  ${name} -> "${actual}"`);
  } else {
    failures++;
    console.log(`  FAIL  ${name} -> "${actual}" (EXPECTED: "${expected}")`);
  }
}

console.log('Testing Title Cleaner...\n');

// 1. Parentheses and Brackets
check('Parantez içi temizliği', cleanDisplayTitle('Gözlerinde (Official Audio)'), 'Gözlerinde');
check('Köşeli parantez içi temizliği', cleanDisplayTitle('Gözlerinde [4K 60FPS]'), 'Gözlerinde');
check('Karma parantezler', cleanDisplayTitle('Şarkı (feat. Sanatçı) [Remix]'), 'Şarkı');
check('İç içe parantezler', cleanDisplayTitle('Şarkı ((Canlı Performans))'), 'Şarkı');
check('Kapanmamış parantez', cleanDisplayTitle('Şarkı (Official Video'), 'Şarkı');

// 2. Dash (-) removal
check('Tire kaldırma', cleanDisplayTitle('Aşk - Meşk'), 'Aşk Meşk');
check('En dash (–) kaldırma', cleanDisplayTitle('Aşk – Meşk'), 'Aşk Meşk');
check('Em dash (—) kaldırma', cleanDisplayTitle('Aşk — Meşk'), 'Aşk Meşk');
check('Alt çizgi (_) kaldırma', cleanDisplayTitle('Ask_Mesk_Sarki'), 'Ask Mesk Sarki');
check('Birden fazla tire', cleanDisplayTitle('A - B - C'), 'A B C');

// 3. Artist removal from title
check('Başta Artist - Title', cleanDisplayTitle('Duman - Kırmış Kalbini', 'Duman'), 'Kırmış Kalbini');
check('Başta Artist Title (tiresiz)', cleanDisplayTitle('Duman Kırmış Kalbini', 'Duman'), 'Kırmış Kalbini');
check('Sonda Title - Artist', cleanDisplayTitle('Kırmış Kalbini - Duman', 'Duman'), 'Kırmış Kalbini');
check('Sonda Title Artist (tiresiz)', cleanDisplayTitle('Kırmış Kalbini Duman', 'Duman'), 'Kırmış Kalbini');
check('Title by Artist', cleanDisplayTitle('Kırmış Kalbini by Duman', 'Duman'), 'Kırmış Kalbini');
check('Başta Artist (Türkçe karakter eşleşmesi: Sebnem Ferah / Şebnem Ferah)', 
  cleanDisplayTitle('Sebnem Ferah - Sil Baştan', 'Şebnem Ferah'), 'Sil Baştan');
check('Başta Artist (Büyük İ / I / i eşleşmesi)', 
  cleanDisplayTitle('İrem Derici - Kalbimin Tek Sahibine', 'irem derici'), 'Kalbimin Tek Sahibine');
check('Çoklu sanatçı (Keskin & KÖKSVL)', 
  cleanDisplayTitle('Keskin & KÖKSVL - Yapma Gadaşım', 'Keskin & KÖKSVL'), 'Yapma Gadaşım');
check('Çoklu sanatçıdan sadece biri artist alanında', 
  cleanDisplayTitle('Keskin & KÖKSVL - Yapma Gadaşım', 'Keskin'), 'Yapma Gadaşım');
check('Sanatçı varken Artist - Title tespiti', 
  cleanDisplayTitle('Tarkan - Kuzu Kuzu', 'Tarkan'), 'Kuzu Kuzu');

// 4. Word boundary protection (kelime içi sanatçı adı bozulmamalı)
check('Kelime içinde sanatçı (Can vs Heyecan)', cleanDisplayTitle('Heyecan', 'Can'), 'Heyecan');
check('Kelime içinde sanatçı (Er vs Ercan)', cleanDisplayTitle('Ercan', 'Er'), 'Ercan');

// 5. Self-titled track fallback (başlık asla boş kalmamalı)
check('Self-titled parça (Duman by Duman)', cleanDisplayTitle('Duman', 'Duman'), 'Duman');
check('Self-titled parça parantezli', cleanDisplayTitle('Duman (Official Video)', 'Duman'), 'Duman');

// 6. Audio extensions
check('Ses uzantısı silinmeli', cleanDisplayTitle('Duman - Kırmış Kalbini.mp3', 'Duman'), 'Kırmış Kalbini');

// 7. Track numbering
check('Şarkı numarası silinmeli', cleanDisplayTitle('01 - Kırmış Kalbini', 'Duman'), 'Kırmış Kalbini');

if (failures > 0) {
  console.error(`\n${failures} TEST BAŞARISIZ OLDU!`);
  process.exit(1);
} else {
  console.log('\nTÜM TEMİZLEME TESTLERİ GEÇTİ ✅');
}
