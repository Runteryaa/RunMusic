/**
 * Ağ durumu çözümlemesi doğrulaması.
 *
 * Regresyon: Android'in `isInternetReachable` bayrağı doğrulama sunucusuna
 * ulaşılamadığında (VPN, DNS filtresi, captive portal) internet varken bile
 * false dönüyor. Bu bayrak "çevrimdışı" sayıldığı için söz araması ağ varken
 * kayıtlı sözlere kilitleniyordu. Bu betik, kararın yalnızca bağlantıya
 * bakmasını garanti eder.
 *
 * Çalıştırma:
 *   npx tsc scripts/verify-network-state.ts --ignoreConfig --outDir .tmp-verify \
 *     --module commonjs --target es2020 --moduleResolution bundler --skipLibCheck
 *   node .tmp-verify/scripts/verify-network-state.js
 */

import { resolveConnectionState } from '../src/services/networkStateResolve';

let failures = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

console.log('1) Doğrulama bayrağı yanlış negatif olsa bile bağlantı kullanılabilir');

{
  const motion = resolveConnectionState({
    type: 'WIFI',
    isConnected: true,
    isInternetReachable: false,
  });
  check('çevrimiçi sayılır', motion.isOnline === true);
  check('ham erişilebilirlik bilgisi korunur', motion.isInternetReachable === false);
}

{
  const cellular = resolveConnectionState({
    type: 'CELLULAR',
    isConnected: true,
    isInternetReachable: false,
  });
  check('mobil veri çevrimiçi sayılır', cellular.isOnline === true);
}

console.log('2) Gerçek çevrimdışı durumlar kapalı kalır');

{
  const airplane = resolveConnectionState({
    type: 'NONE',
    isConnected: false,
    isInternetReachable: false,
  });
  check('NONE çevrimdışı', airplane.isOnline === false);
}

{
  const notConnected = resolveConnectionState({
    type: 'UNKNOWN',
    isConnected: false,
    isInternetReachable: false,
  });
  check('UNKNOWN + bağlantı yok çevrimdışı', notConnected.isOnline === false);
}

console.log('3) Eksik alanlarda iyimser davranış');

{
  const missingReachable = resolveConnectionState({
    type: 'WIFI',
    isConnected: true,
    isInternetReachable: undefined,
  });
  check('erişilebilirlik alanı yoksa bağlantı esas alınır', missingReachable.isOnline === true);
  check('erişilebilirlik bağlantıya eşitlenir', missingReachable.isInternetReachable === true);
}

{
  const empty = resolveConnectionState({});
  check('boş durumda çevrimiçi varsayılır', empty.isOnline === true);
}

console.log('4) Ağ tipi bilinen ama isConnected alanı yok');

{
  const typed = resolveConnectionState({ type: 'WIFI' });
  check('bilinen ağ tipi çevrimiçi sayılır', typed.isOnline === true);
}

console.log('\nSonuç');
if (failures === 0) {
  console.log('  TÜM TESTLER GEÇTİ ✅');
} else {
  console.log(`  ${failures} TEST BAŞARISIZ ❌`);
  throw new Error(`${failures} doğrulama başarısız`);
}
