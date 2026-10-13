/**
 * Türkçe ve diyakritik harf duyarsız arama yardımcıları.
 *
 * "gözlerinde" şarkısını "gozlerinde" veya "gözlerinde" ile,
 * "Işık" şarkısını "isik" veya "ışık" ile,
 * "İstanbul" şarkısını "istanbul" veya "ıstanbul" ile arayabilmeyi sağlar.
 */

/**
 * Metni Türkçe ve genel aksan kurallarına göre taban arama biçimine normalize eder.
 */
export function normalizeSearchText(text: string | null | undefined): string {
  if (!text) return '';
  return text
    // 1. Türkçe I / İ / ı varyasyonlarını 'i' harfine dönüştür
    .replace(/İ/g, 'i')
    .replace(/I/g, 'i')
    .replace(/ı/g, 'i')
    .toLowerCase()
    // 2. Diğer Türkçe özel karakterleri taban ASCII haline getir
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    // 3. Genel Unicode diyakritik işaretlerini (şapkalı â, é vb.) temizle
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // 4. Fazla boşlukları toparla
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Arama sorgusunun (query) verilen hedef metin (target) ile eşleşip eşleşmediğini denetler.
 * Birden fazla kelime girilmişse her kelimenin hedef içinde yer almasını doğrular.
 */
export function searchMatches(
  target: string | null | undefined,
  query: string | null | undefined
): boolean {
  if (!query || !query.trim()) return true;
  if (!target) return false;

  const normalizedTarget = normalizeSearchText(target);
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery) return true;

  // Doğrudan tam eşleşme
  if (normalizedTarget.includes(normalizedQuery)) return true;

  // Boşlukla ayrılmış çoklu kelimeler (ör. "baris donence")
  const terms = normalizedQuery.split(' ').filter(Boolean);
  if (terms.length <= 1) return false;

  return terms.every((term) => normalizedTarget.includes(term));
}
