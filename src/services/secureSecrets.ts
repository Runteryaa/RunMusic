import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

/**
 * Gizli kimlik bilgileri (oturum anahtarları / token'lar) için şifreli depo.
 *
 * NEDEN: Last.fm session key ve ListenBrainz token'ı düz AsyncStorage'da
 * tutuluyordu; Android'de bu veri root/cipher uygulamaları ve yedekleme
 * mekanizmaları üzerinden okunabilir. expo-secure-store Android Keystore ile
 * şifreler ve Android Auto Backup'tan hariç tutar.
 *
 * GÜVENLİ DÜŞÜŞ: SecureStore bazı özel cihazlarda kullanılamayabiliyor. Bu
 * durumda değer AsyncStorage'a yazılır; böylece kullanıcı bağlantısı çalışmaya
 * devam eder (şifreleme yoksa da işlev kaybı olmaz). Okuma sırasında
 * SecureStore'daki değer yoksa AsyncStorage yedeğine bakılır ve bir sonraki
 * yazmada yukarı taşınır.
 */

export type SecretName =
  | 'lastfm_session_key'
  | 'lastfm_custom_secret'
  | 'listenbrainz_token';

const FALLBACK_PREFIX = 'runmusic-secret-fallback:';

function fallbackKey(name: SecretName): string {
  return `${FALLBACK_PREFIX}${name}`;
}

/** Tek bir gizli değeri okur; önce SecureStore, sonra AsyncStorage yedeği. */
export async function getSecret(name: SecretName): Promise<string | null> {
  try {
    const secureValue = await SecureStore.getItemAsync(name);
    if (secureValue) return secureValue;
  } catch (error) {
    console.warn(`[secureSecrets] SecureStore okunamadı (${name}):`, error);
  }

  try {
    return (await AsyncStorage.getItem(fallbackKey(name))) || null;
  } catch {
    return null;
  }
}

/** Gizli değeri yazar. `null`/boş değer siler. */
export async function setSecret(name: SecretName, value: string | null): Promise<void> {
  const normalized = value && value.trim() ? value : null;

  try {
    if (normalized) {
      await SecureStore.setItemAsync(name, normalized);
    } else {
      await SecureStore.deleteItemAsync(name);
    }
    // SecureStore başarılıysa eski düz metin yedeği kalmasın.
    await AsyncStorage.removeItem(fallbackKey(name)).catch(() => {});
    return;
  } catch (error) {
    console.warn(`[secureSecrets] SecureStore yazılamadı (${name}), yedek kullanılacak:`, error);
  }

  try {
    if (normalized) {
      await AsyncStorage.setItem(fallbackKey(name), normalized);
    } else {
      await AsyncStorage.removeItem(fallbackKey(name));
    }
  } catch (error) {
    console.warn(`[secureSecrets] gizli değer yazılamadı (${name}):`, error);
  }
}

/**
 * Eski (düz AsyncStorage) kayıttan gelen değeri güvenli depoya taşır.
 * Güvenli depoda zaten bir değer varsa o kazanır; eski değer asla ezmez.
 */
export async function adoptSecret(
  name: SecretName,
  legacyValue: string | null | undefined
): Promise<string | null> {
  const existing = await getSecret(name);
  if (existing) return existing;
  if (!legacyValue) return null;
  await setSecret(name, legacyValue);
  return legacyValue;
}

/** Üç gizli değerin tamamını tek seferde okur. */
export async function loadAllSecrets(): Promise<Record<SecretName, string | null>> {
  const [lastfmSessionKey, lastfmCustomSecret, listenbrainzToken] = await Promise.all([
    getSecret('lastfm_session_key'),
    getSecret('lastfm_custom_secret'),
    getSecret('listenbrainz_token'),
  ]);

  return {
    lastfm_session_key: lastfmSessionKey,
    lastfm_custom_secret: lastfmCustomSecret,
    listenbrainz_token: listenbrainzToken,
  };
}
