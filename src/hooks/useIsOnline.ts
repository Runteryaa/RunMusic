import { useSyncExternalStore } from 'react';

import {
  getNetworkSnapshot,
  subscribeNetworkStatus,
  type NetworkSnapshot,
} from '../services/networkStatus';

/**
 * Ağ durumuna React tarafında abone olur.
 * Tek dinleyici (`networkStatus.ts`) sayesinde ekran başına ayrı native
 * abonelik açılmaz.
 */
export function useNetworkSnapshot(): NetworkSnapshot {
  return useSyncExternalStore(
    subscribeNetworkStatus,
    getNetworkSnapshot,
    getNetworkSnapshot
  );
}

/** Yalnızca "istek atılabilir mi?" sorusu gereken yerler için kısa yol. */
export function useIsOnline(): boolean {
  return useNetworkSnapshot().isOnline;
}
