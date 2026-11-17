/**
 * İstatistik önbelleklerinin ortak "dönem" sayacı.
 *
 * NEDEN: İstatistik ekranı ağır sorguların sonucunu 60 sn önbellekte tutuyor.
 * Kullanıcı "İstatistikleri sıfırla" dediğinde bu önbellek boşaltılmazsa
 * sıfırlamadan sonra eski sayılar görünmeye devam ediyordu. Sıfırlama sayacı
 * artırır; önbellek kayıtları sayaç değişince geçersiz sayılır.
 *
 * Modül saf: native/React bağımlılığı yok.
 */

let statsEpoch = 0;

/** İstatistikler değiştiğinde (sıfırlama vb.) önbellekleri geçersiz kılar. */
export function bumpStatsEpoch(): void {
  statsEpoch += 1;
}

/** Önbellek kaydının hâlâ geçerli olup olmadığını anlamak için okunur. */
export function getStatsEpoch(): number {
  return statsEpoch;
}
