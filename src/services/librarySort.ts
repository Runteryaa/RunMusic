/**
 * Kitaplık sıralaması — SAF yardımcılar (native bağımlılığı yok).
 *
 * NEDEN AYRI DOSYA: "Eklenme Tarihi" sıralaması uzun süre sessizce BOZUKTU.
 * `expo-media-library` Android'de alanları şöyle eşliyor (AssetUtils.kt):
 *
 *   creationTime     <- MediaStore.DATE_TAKEN     (fotoğraf/video ÇEKİM tarihi)
 *   modificationTime <- MediaStore.DATE_MODIFIED  (dosyanın yazıldığı an, *1000)
 *
 * Ses dosyalarında DATE_TAKEN boş/0 kalır; bu yüzden `creationTime` ile
 * karşılaştırmak her zaman 0 dönüyordu ve liste hiç sıralanmıyordu.
 * İndirilme/yazılma zamanı `modificationTime` içindedir.
 *
 * Bu mantık Node üzerinde test edilebilir (bkz. scripts/verify-library-sort.ts).
 */

export type SortOption =
  | 'name_asc'
  | 'name_desc'
  | 'duration_asc'
  | 'duration_desc'
  | 'date_desc'
  | 'date_asc';

export interface SortableAsset {
  id: string;
  duration?: number | null;
  creationTime?: number | null;
  modificationTime?: number | null;
}

/**
 * Sıralama seçeneklerinin kullanıcıya gösterilen adları.
 * (Kitaplık ekranı ve Ayarlar aynı metinleri kullanır.)
 */
export const SORT_OPTION_LABELS: Record<SortOption, string> = {
  name_asc: 'İsim (A→Z)',
  name_desc: 'İsim (Z→A)',
  duration_asc: 'Süre (kısa→uzun)',
  duration_desc: 'Süre (uzun→kısa)',
  date_desc: 'Eklenme (yeni→eski)',
  date_asc: 'Eklenme (eski→yeni)',
};

/**
 * Bir parçanın "eklenme" zamanı (ms).
 *
 * Öncelik `modificationTime` (dosyanın yazıldığı = indirildiği an). Yoksa
 * `creationTime`'a düşülür. Hiçbiri yoksa 0 döner; bu durumda sıralama
 * `compareAddedDate` içindeki MediaStore id ayracına devreder.
 */
export function getAddedTime(asset: SortableAsset | null | undefined): number {
  if (!asset) return 0;

  const modified = Number(asset.modificationTime);
  if (Number.isFinite(modified) && modified > 0) return modified;

  const created = Number(asset.creationTime);
  if (Number.isFinite(created) && created > 0) return created;

  return 0;
}

/**
 * MediaStore `_ID` değeri ekleme sırasına göre artar; bu yüzden büyük id daha
 * sonra eklenmiş demektir. Sayısal değilse NaN döner ve ayraç kullanılmaz.
 */
function numericId(id: string | null | undefined): number {
  const parsed = Number(id);
  return Number.isFinite(parsed) ? parsed : NaN;
}

/**
 * İki parçayı eklenme zamanına göre karşılaştırır (ARTAN: eski -> yeni).
 * Azalan sıralama için argümanları ters çevirin.
 *
 * `DATE_MODIFIED` saniye çözünürlüğünde olduğu için aynı saniyede indirilen
 * dosyalar eşit görünür; bu durumda MediaStore id'si gerçek ekleme sırasını
 * verir. Zamanlar hiç yoksa (hepsi 0) sıralama tamamen id'ye dayanır — yani
 * yine doğru "en son eklenen" sırası elde edilir.
 */
export function compareAddedDate(
  a: SortableAsset | null | undefined,
  b: SortableAsset | null | undefined
): number {
  const diff = getAddedTime(a) - getAddedTime(b);
  if (diff !== 0) return diff;

  const idA = numericId(a?.id);
  const idB = numericId(b?.id);
  if (Number.isFinite(idA) && Number.isFinite(idB) && idA !== idB) {
    return idA - idB;
  }
  return 0;
}
