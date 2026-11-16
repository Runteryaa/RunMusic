/**
 * Sanatçı adı eşleştirme yardımcıları.
 *
 * NEDEN AYRI MODÜL: aynı anahtar üretimi hem görsel önbelleğinde (`artistImages`)
 * hem istatistiklerde hem de sanatçı sayfasında gerekiyor. `artistImages`
 * AsyncStorage import ettiği için Node doğrulama betiklerinde çalışmıyor; bu
 * yüzden saf eşleştirme mantığı burada tutulur ve `artistImages` buradan
 * yeniden dışa aktarır (mevcut importlar bozulmaz).
 */

import { splitArtistNames } from './wrappedStats';

/**
 * Sanatçı isimlerini eşleştirme için sadeleştirir.
 *
 * Küçük harf, aksan sadeleştirme ve noktalama temizliği uygular; böylece
 * "Sezen Aksu", "SEZEN AKSU" ve "Sezen  Aksu" aynı anahtara düşer. `&`
 * korunur çünkü grup isimlerinin parçası olabiliyor ("Mumford & Sons").
 */
export function normalizeArtistKey(name?: string | null): string {
  return (name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Bir satırın sanatçı alanından tek tek sanatçı adlarını çıkarır.
 *
 * Ortak çalışmalar ("UZI, MODD", "UZI feat. MODD") ayrıştırılır; sanatçı alanı
 * boşsa tek boş grup korunur (eski Wrapped davranışıyla aynı).
 */
export function artistNamesFromRow(raw?: string | null): string[] {
  const names = splitArtistNames(raw);
  return names.length > 0 ? names : [''];
}

/** Satırın sanatçı alanı verilen normalize anahtara ait mi? */
export function rowMatchesArtist(raw?: string | null, targetKey?: string | null): boolean {
  const key = normalizeArtistKey(targetKey);
  if (!key) return false;
  return artistNamesFromRow(raw).some((name) => normalizeArtistKey(name) === key);
}

/**
 * Satırların sanatçı alanında geçen isimlerden, normalize anahtar → ilk görülen
 * yazım haritası üretir. Sanatçı sayfası başlığında kullanılır.
 */
export function resolveArtistDisplayName(rows: { artist?: string | null }[], targetKey: string): string {
  const key = normalizeArtistKey(targetKey);
  if (!key) return '';
  for (const row of rows) {
    for (const name of artistNamesFromRow(row.artist)) {
      if (normalizeArtistKey(name) === key && name.trim()) return name.trim();
    }
  }
  return '';
}
