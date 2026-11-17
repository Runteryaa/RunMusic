import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

/**
 * Eşleştirme (pairing) için kriptografik rastgelelik yardımcıları.
 *
 * NEDEN: PIN, cihaz kimliği ve oturum token'ı daha önce `Math.random()` ile
 * üretiliyordu. `Math.random()` kriptografik değildir; gözlemci çıktı dizisinden
 * sonraki değerleri tahmin edebilir ve PIN/token üretimini öngörebilir. Bu modül
 * Android Keystore destekli `expo-crypto` CSPRNG'sini kullanır.
 */

/** 6 haneli PIN: 1.000.000 olasılık, 4 haneli 10.000'e göre belirgin fark. */
export const PAIRING_PIN_LENGTH = 6;

/** Üst üste bu kadar yanlış PIN denemesinden sonra eşleştirme kilitlenir. */
export const MAX_PIN_ATTEMPTS = 5;

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * Sabit süreli string karşılaştırması.
 *
 * Erken çıkış yapmadığı için karakter karakter zamanlama farkı sızdırmaz.
 * Uzunluk farkı yine de gözlemlenebilir; PIN gibi sabit uzunluklu değerlerde
 * bu bilgi zaten açıktır.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = String(a ?? '');
  const right = String(b ?? '');
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** Modulo sapması olmadan `digits` haneli sayısal kod üretir. */
export function generateNumericCode(digits = PAIRING_PIN_LENGTH): string {
  const max = 10 ** digits;
  // 32 bitlik uzayı `max` ile bölünebilen en büyük değere kırp: kalan değerler
  // reddedilir, böylece her kod eşit olasılıkla üretilir.
  const limit = Math.floor(0x100000000 / max) * max;

  for (let attempt = 0; attempt < 16; attempt++) {
    const bytes = Crypto.getRandomBytes(4);
    const value =
      bytes[0] * 0x1000000 + bytes[1] * 0x10000 + bytes[2] * 0x100 + bytes[3];
    if (value < limit) {
      return String(value % max).padStart(digits, '0');
    }
  }

  // Teorik olarak buraya düşmek neredeyse imkânsız; yine de CSPRNG kullan.
  return String(Crypto.getRandomBytes(4)[0] % max).padStart(digits, '0');
}

/** Eşleştirme PIN'i (6 hane, baş sıfır korunur). */
export function generatePairingPin(): string {
  return generateNumericCode(PAIRING_PIN_LENGTH);
}

/** Kalıcı cihaz kimliği: platform + rastgele UUID. */
export function createDeviceId(): string {
  return `device_${Platform.OS}_${Crypto.randomUUID()}`;
}

/** Sunucunun istemciye verdiği uzun ömürlü eşleştirme token'ı. */
export function generatePairingToken(): string {
  return `token_${Date.now()}_${toHex(Crypto.getRandomBytes(16))}`;
}

/** İstek/korelasyon kimliği (`req_...`). */
export function generateRequestId(prefix = 'req'): string {
  return `${prefix}_${Date.now()}_${toHex(Crypto.getRandomBytes(6))}`;
}
