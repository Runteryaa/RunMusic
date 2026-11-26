import * as Network from 'expo-network';

import { setNetworkAvailabilityCheck } from './networkAwareFetch';
import { resolveConnectionState } from './networkStateResolve';

/**
 * Tek merkezden ağ durumu izleme.
 *
 * NEDEN TEK ABONELİK: her ekranın kendi `addNetworkStateListener` çağrısını
 * yapması yerine tek bir dinleyici tutulur ve React tarafı
 * `useSyncExternalStore` ile buna abone olur. Böylece çevrimdışıyken söz,
 * sanatçı fotoğrafı ve kapak aramaları ağ isteği atmaz.
 */

export interface NetworkSnapshot {
  isConnected: boolean;
  isInternetReachable: boolean;
  /**
   * İstek atılabilir mi? Yalnızca **bağlantı** durumuna bakar; Android'in
   * doğrulama bayrağı (`isInternetReachable`) yanlış negatif verebildiği için
   * burada kullanılmaz. Ayrıntı: `applyState`.
   */
  isOnline: boolean;
}

const initialSnapshot: NetworkSnapshot = {
  isConnected: true,
  isInternetReachable: true,
  isOnline: true,
};

let snapshot: NetworkSnapshot = initialSnapshot;
let started = false;
let subscription: { remove: () => void } | null = null;
const listeners = new Set<() => void>();

function publish(next: NetworkSnapshot): void {
  const changed =
    next.isConnected !== snapshot.isConnected ||
    next.isInternetReachable !== snapshot.isInternetReachable ||
    next.isOnline !== snapshot.isOnline;
  snapshot = next;
  if (!changed) return;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Bir abone hata verirse diğerleri etkilenmesin.
    }
  }
}

function applyState(state: Network.NetworkState): void {
  /*
   * BAĞLANTI ÖLÇÜTÜ (önemli):
   *
   * Android'de `isInternetReachable` yalnızca ağ `NET_CAPABILITY_VALIDATED`
   * taşıyorsa true olur — yani cihaz Google'ın doğrulama sunucusuna ulaşabilmiş
   * olmalı. Kurumsal/mobil ağlarda DNS filtresi, VPN, captive portal ya da
   * doğrulama sunucusunun engellenmesi bu bayrağı `false` bırakırken internet
   * sorunsuz çalışabiliyor. Bu bayrağı "çevrimdışı" saymak, ağ varken söz
   * aramasını kilitleyip kullanıcıyı önbelleğe mahkûm ediyordu.
   *
   * Karar mantığı `resolveConnectionState` içinde (saf, doğrulanabilir).
   */
  publish(
    resolveConnectionState({
      type: state.type,
      isConnected: state.isConnected,
      isInternetReachable: state.isInternetReachable,
    })
  );
}

/** Ağ durumunu hemen sorgular ve önbelleğe alınmış anlık görüntüyü döndürür. */
export async function refreshNetworkStatus(): Promise<NetworkSnapshot> {
  try {
    const state = await Network.getNetworkStateAsync();
    applyState(state);
  } catch (error) {
    console.warn('[networkStatus] durum okunamadı:', error);
  }
  return snapshot;
}

/**
 * Ağ izlemeyi başlatır (idempotent). Gerçek kontrolü `isNetworkAvailable`
 * kapısına bağlar; böylece servisler native modüle bağımlı olmadan kontrol
 * yapabilir.
 */
export function startNetworkMonitoring(): void {
  if (started) return;
  started = true;

  setNetworkAvailabilityCheck(() => snapshot.isOnline);
  void refreshNetworkStatus();

  try {
    subscription = Network.addNetworkStateListener((state) => {
      applyState(state);
    });
  } catch (error) {
    // Dinleyici kurulamazsa ilk sorgunun sonucuyla devam edilir.
    console.warn('[networkStatus] dinleyici kurulamadı:', error);
  }
}

export function stopNetworkMonitoring(): void {
  subscription?.remove();
  subscription = null;
  started = false;
}

export function getNetworkSnapshot(): NetworkSnapshot {
  return snapshot;
}

/**
 * Ağ yeniden gelene kadar bekler. İndirme kuyruğu çevrimdışıyken başlamaz;
 * bağlantı geri gelince kaldığı yerden devam eder.
 */
export function waitUntilOnline(): Promise<void> {
  if (snapshot.isOnline) return Promise.resolve();

  return new Promise((resolve) => {
    const unsubscribe = subscribeNetworkStatus(() => {
      if (!snapshot.isOnline) return;
      unsubscribe();
      resolve();
    });
  });
}

export function subscribeNetworkStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
