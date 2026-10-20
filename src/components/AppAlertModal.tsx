import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAlertStore } from '../store/useAlertStore';
import { useThemeStore } from '../store/useThemeStore';
import { useTranslation } from '../services/i18n';
import type { AlertButton } from 'react-native';

export const AppAlertModal: React.FC = () => {
  const { t } = useTranslation();
  const theme = useThemeStore((s) => s.theme);
  const currentAlert = useAlertStore((s) => s.currentAlert);
  const hideAlert = useAlertStore((s) => s.hideAlert);

  if (!currentAlert) return null;

  const { title, message, buttons = [], options } = currentAlert;

  // Alert türünü belirle (ikon ve renk teması)
  const lowerTitle = (title || '').toLowerCase();
  const lowerMsg = (message || '').toLowerCase();
  const hasDestructiveBtn = buttons.some((b) => b.style === 'destructive');

  const isDanger =
    hasDestructiveBtn ||
    lowerTitle.includes('hata') ||
    lowerTitle.includes('error') ||
    lowerTitle.includes('sil') ||
    lowerTitle.includes('kaldır') ||
    lowerTitle.includes('failed') ||
    lowerTitle.includes('delete');

  const isSuccess =
    !isDanger &&
    (lowerTitle.includes('başarılı') ||
      lowerTitle.includes('success') ||
      lowerTitle.includes('güncellendi') ||
      lowerTitle.includes('yüklendi'));

  const isWarning =
    !isDanger &&
    !isSuccess &&
    (lowerTitle.includes('izin') ||
      lowerTitle.includes('permission') ||
      lowerTitle.includes('uyarı') ||
      lowerTitle.includes('warning') ||
      lowerMsg.includes('izin'));

  let iconName: keyof typeof Ionicons.glyphMap = 'information-circle-outline';
  let iconColor = theme.primary;
  let iconBg = theme.primary + '18';

  if (isDanger) {
    iconName = lowerTitle.includes('sil') || lowerTitle.includes('delete') ? 'trash-outline' : 'alert-circle-outline';
    iconColor = '#ef4444';
    iconBg = 'rgba(239, 68, 68, 0.15)';
  } else if (isSuccess) {
    iconName = 'checkmark-circle-outline';
    iconColor = '#10b981';
    iconBg = 'rgba(16, 185, 129, 0.15)';
  } else if (isWarning) {
    iconName = 'warning-outline';
    iconColor = '#f59e0b';
    iconBg = 'rgba(245, 158, 11, 0.15)';
  }

  const handleButtonPress = (button: AlertButton) => {
    hideAlert();
    setTimeout(() => {
      button.onPress?.();
    }, 50);
  };

  const handleBackdropPress = () => {
    if (options?.cancelable === false) return;
    const cancelBtn = buttons.find((b) => b.style === 'cancel');
    hideAlert();
    if (cancelBtn?.onPress) {
      setTimeout(() => cancelBtn.onPress?.(), 50);
    } else if (options?.onDismiss) {
      setTimeout(() => options.onDismiss?.(), 50);
    }
  };

  const resolvedButtons = buttons.length > 0 ? buttons : [{ text: t('common.ok') }];
  const isTwoButtons = resolvedButtons.length === 2;
  const isMultiButtons = resolvedButtons.length > 2;

  return (
    <Modal
      transparent
      animationType="fade"
      visible={!!currentAlert}
      statusBarTranslucent
      onRequestClose={handleBackdropPress}
    >
      <View style={styles.backdrop}>
        {/* Arka plan dokunma algılayıcısı */}
        <Pressable style={styles.overlayPress} onPress={handleBackdropPress} />

        <View style={styles.card}>
          {/* İkon */}
          <View style={[styles.iconCircle, { backgroundColor: iconBg }]}>
            <Ionicons name={iconName} size={28} color={iconColor} />
          </View>

          {/* Başlık */}
          <Text style={styles.title}>{title}</Text>

          {/* Mesaj */}
          {message ? (
            <ScrollView
              style={styles.messageScroll}
              contentContainerStyle={styles.messageScrollContent}
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.message}>{message}</Text>
            </ScrollView>
          ) : null}

          {/* Butonlar */}
          {isTwoButtons ? (
            // 2 buton: Yan yana (sol İptal/İkincil, sağ Onay/Birincil/Yıkıcı)
            <View style={styles.twoButtonsRow}>
              {resolvedButtons.map((btn, idx) => {
                const isCancel = btn.style === 'cancel' || idx === 0 && resolvedButtons[1].style !== 'cancel';
                const isDestructive = btn.style === 'destructive';

                let btnBg = theme.primary;
                let textColor = '#ffffff';

                if (isCancel && !isDestructive) {
                  btnBg = '#27272a';
                } else if (isDestructive) {
                  btnBg = '#dc2626';
                }

                return (
                  <TouchableOpacity
                    key={`alert-btn-${idx}`}
                    style={[
                      styles.btn,
                      styles.twoBtnItem,
                      { backgroundColor: btnBg },
                      isCancel && !isDestructive && styles.cancelBorder,
                    ]}
                    onPress={() => handleButtonPress(btn)}
                    activeOpacity={0.75}
                  >
                    <Text
                      style={[
                        styles.btnText,
                        { color: textColor },
                        (isDestructive || !isCancel) && styles.btnTextBold,
                      ]}
                      numberOfLines={1}
                    >
                      {btn.text}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : isMultiButtons ? (
            // 3 veya daha fazla buton: Alt alta liste
            <View style={styles.multiButtonsCol}>
              {resolvedButtons.map((btn, idx) => {
                const isCancel = btn.style === 'cancel';
                const isDestructive = btn.style === 'destructive';

                let btnBg = '#27272a';
                let textColor = '#ffffff';

                if (isDestructive) {
                  btnBg = '#dc2626';
                } else if (!isCancel) {
                  btnBg = theme.primary;
                }

                return (
                  <TouchableOpacity
                    key={`alert-btn-${idx}`}
                    style={[
                      styles.btn,
                      styles.multiBtnItem,
                      { backgroundColor: btnBg },
                      isCancel && styles.cancelBorder,
                    ]}
                    onPress={() => handleButtonPress(btn)}
                    activeOpacity={0.75}
                  >
                    <Text
                      style={[
                        styles.btnText,
                        { color: textColor },
                        (isDestructive || !isCancel) && styles.btnTextBold,
                      ]}
                      numberOfLines={1}
                    >
                      {btn.text}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            // Tek buton: Tam genişlik
            <TouchableOpacity
              style={[
                styles.btn,
                styles.singleBtn,
                { backgroundColor: isDanger ? '#dc2626' : theme.primary },
              ]}
              onPress={() => handleButtonPress(resolvedButtons[0])}
              activeOpacity={0.8}
            >
              <Text style={[styles.btnText, styles.btnTextBold]}>
                {resolvedButtons[0].text}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  overlayPress: {
    ...StyleSheet.absoluteFill,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 22,
    padding: 22,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 12,
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  messageScroll: {
    maxHeight: 180,
    marginTop: 8,
    marginBottom: 18,
    width: '100%',
  },
  messageScrollContent: {
    paddingHorizontal: 4,
  },
  message: {
    fontSize: 14,
    color: '#a1a1aa',
    textAlign: 'center',
    lineHeight: 20,
  },
  btn: {
    height: 44,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  btnText: {
    fontSize: 14,
    color: '#ffffff',
    fontWeight: '600',
  },
  btnTextBold: {
    fontWeight: '700',
  },
  cancelBorder: {
    borderWidth: 1,
    borderColor: '#3f3f46',
  },
  singleBtn: {
    width: '100%',
    marginTop: 18,
  },
  twoButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    marginTop: 18,
  },
  twoBtnItem: {
    flex: 1,
  },
  multiButtonsCol: {
    width: '100%',
    gap: 8,
    marginTop: 18,
  },
  multiBtnItem: {
    width: '100%',
  },
});
