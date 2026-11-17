/**
 * Ağ erişilebilirliği için SAF (native bağımlılığı olmayan) kapı.
 *
 * Bu dosya bilinçli olarak expo-network/React Native import ETMEZ. Böylece
 * Node doğrulama betiklerinden import edilen servisler (sanatçı fotoğrafı,
 * kapak arama, söz arama) test ortamında çalışmaya devam eder.
 *
 * Gerçek kontrol uygulama açılışında `networkStatus.ts` tarafından bağlanır.
 * Bağlanmadan önce varsayılan "ağ var" kabul edilir; bu, testlerin ve ilk
 * karede yapılan isteklerin yanlışlıkla engellenmesini önler.
 */

export type NetworkAvailabilityCheck = () => boolean;

let availabilityCheck: NetworkAvailabilityCheck = () => true;

/** Uygulama açılışında gerçek ağ durumunu bağlar. */
export function setNetworkAvailabilityCheck(check: NetworkAvailabilityCheck): void {
  availabilityCheck = check;
}

/** Şu anda ağ isteği atılabilir mi? Hata durumunda güvenli taraf: evet. */
export function isNetworkAvailable(): boolean {
  try {
    return availabilityCheck();
  } catch {
    return true;
  }
}
