/**
 * Ağ durumu çözümlemesi (saf).
 *
 * `networkStatus.ts` içindeki mantık buraya taşındı: `expo-network` native
 * modülünü import etmeden Node üzerinde doğrulanabilsin. Enum değerleri
 * bilinçli olarak dize olarak karşılaştırılır; `NetworkStateType.NONE` ve
 * `UNKNOWN` değerleri expo-network'te aynı dizelerdir.
 */

export interface RawNetworkState {
  type?: string;
  isConnected?: boolean;
  isInternetReachable?: boolean;
}

export interface ResolvedConnectionState {
  isConnected: boolean;
  isInternetReachable: boolean;
  /** İstek atılabilir mi? Yalnızca bağlantı varlığına bakar. */
  isOnline: boolean;
}

const TYPE_NONE = 'NONE';
const TYPE_UNKNOWN = 'UNKNOWN';

/**
 * Ağ durumunu "istek atılabilir mi?" sorusuna indirger.
 *
 * NEDEN `isInternetReachable` KULLANILMIYOR: Android'de bu bayrak yalnızca
 * ağ `NET_CAPABILITY_VALIDATED` taşıyorsa true olur, yani cihaz Google'ın
 * doğrulama sunucusuna ulaşabilmiş olmalıdır. VPN, DNS filtresi, captive
 * portal veya doğrulama sunucusunun engellendiği ağlarda internet sorunsuz
 * çalışırken bayrak false kalıyor. Bunu "çevrimdışı" saymak, ağ varken söz
 * aramasını kilitleyip kullanıcıyı kayıtlı sözlere mahkûm ediyordu.
 *
 * Bu yüzden karar yalnızca bağlantı üzerinden verilir:
 * - `type === NONE` → kesin çevrimdışı,
 * - `isConnected` açıkça false olsa bile bilinen bir ağ tipi varsa (UNKNOWN
 *   dışında) bağlantı var kabul edilir,
 * - tüm alanlar boşsa iyimser davranılır (ilk kare / web).
 */
export function resolveConnectionState(state: RawNetworkState): ResolvedConnectionState {
  const typeNone = state.type === TYPE_NONE;
  const isConnected = typeNone
    ? false
    : state.isConnected === true ||
      state.isInternetReachable === true ||
      (!!state.type && state.type !== TYPE_UNKNOWN) ||
      state.isConnected === undefined;

  const isInternetReachable =
    state.isInternetReachable === undefined ? isConnected : Boolean(state.isInternetReachable);

  return { isConnected, isInternetReachable, isOnline: isConnected };
}
