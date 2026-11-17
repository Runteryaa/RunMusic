import { useEffect } from 'react';
import { Alert } from 'react-native';
import * as Updates from 'expo-updates';

import { useTranslation } from '../services/i18n';

/**
 * Açılışta OTA güncellemesi denetimi.
 *
 * Akış bilinçli olarak kullanıcı onayına bağlı:
 * 1. Sürüm denetlenir; yeni sürüm varsa "indirilsin mi?" sorulur.
 * 2. Kullanıcı **reddederse indirme hiç başlatılmaz** (arka planda sessiz
 *    indirme yapılmaz; mobil veri harcanmaz).
 * 3. Kabul ederse indirme başlar ve bittiğinde yeniden başlatma izni istenir.
 *
 * Denetim uygulama açılışını geciktirmesin diye ilk yerleşimden birkaç saniye
 * sonra, oturumda yalnızca bir kez çalışır. Geliştirme derlemesinde
 * (`Updates.isEnabled === false`) tamamen devre dışıdır. Ağ hataları sessizce
 * yutulur: açılışta kullanıcıyı gereksiz uyarıyla meşgul etmemek için.
 */

/** Aynı oturumda ikinci kez denetlemesin (ör. yerleşim yeniden bağlanırsa). */
let hasRunThisSession = false;

/** Ayarlar ekranındaki elle denetimle çakışmasın diye paylaşılan kilit. */
let isUpdatePromptActive = false;

export function isUpdatePromptOpen(): boolean {
  return isUpdatePromptActive;
}

export function useStartupUpdateCheck(enabled = true) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!enabled) return;
    if (hasRunThisSession) return;
    if (!Updates.isEnabled) return;

    hasRunThisSession = true;
    let cancelled = false;
    const timer = setTimeout(() => {
      runCheck(cancelled, t);
    }, 2500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `t` dil değişiminde değişir; denetim zaten oturumda bir kez çalışır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}

async function runCheck(
  cancelled: boolean,
  t: ReturnType<typeof useTranslation>['t']
): Promise<void> {
  if (cancelled || isUpdatePromptActive) return;
  try {
    const check = await Updates.checkForUpdateAsync();
    if (cancelled || !check.isAvailable) return;

    isUpdatePromptActive = true;
    Alert.alert(
      t('settings.alerts.startup_update_title'),
      t('settings.alerts.startup_update_msg'),
      [
        {
          text: t('settings.alerts.not_now'),
          style: 'cancel',
          onPress: () => {
            isUpdatePromptActive = false;
          },
        },
        {
          text: t('settings.alerts.download'),
          onPress: () => {
            downloadUpdate(t).finally(() => {
              isUpdatePromptActive = false;
            });
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => {
          isUpdatePromptActive = false;
        },
      }
    );
  } catch (error) {
    // Açılışta güncelleme denetimi başarısız olursa sessiz kal.
    console.warn('Startup update check failed:', error);
  }
}

async function downloadUpdate(
  t: ReturnType<typeof useTranslation>['t']
): Promise<void> {
  try {
    const fetchResult = await Updates.fetchUpdateAsync();
    if (!fetchResult.isNew) return;

    Alert.alert(
      t('settings.alerts.update_ready_title'),
      t('settings.alerts.update_ready_msg'),
      [
        { text: t('settings.alerts.later'), style: 'cancel' },
        {
          text: t('settings.alerts.restart'),
          onPress: async () => {
            try {
              await Updates.reloadAsync();
            } catch (error) {
              console.warn('Update reload failed:', error);
            }
          },
        },
      ]
    );
  } catch (error) {
    console.warn('Startup update download failed:', error);
  }
}
