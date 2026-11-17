import React, { useMemo } from 'react';
import { StyleSheet, Text, View, Modal } from 'react-native';
import { TouchableOpacity } from './ui/TouchableOpacity';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { useThemeStore } from '../store/useThemeStore';
import { useTranslation } from '../services/i18n';
import { useRemoteConnectStore } from '../store/useRemoteConnectStore';

export function PairChallengeModal() {
  const { t } = useTranslation();
  const theme = useThemeStore((s) => s.theme);
  const challenge = useRemoteConnectStore((s) => s.pendingPairChallenge);
  const setChallenge = useRemoteConnectStore((s) => s.setPendingPairChallenge);
  const roomCode = useRemoteConnectStore((s) => s.internetRoomCode);
  const hostDeviceName = useRemoteConnectStore((s) => s.customDeviceName);

  // QR, telefonun kamera uygulamasıyla okutulunca `runmusic://pair?...`
  // derin bağlantısı açılır ve istemcide PIN otomatik dolar.
  const pairingLink = useMemo(() => {
    if (!challenge) return '';
    const params = new URLSearchParams({ pin: challenge.pin });
    if (hostDeviceName) params.set('name', hostDeviceName);
    if (roomCode) params.set('room', roomCode);
    return `runmusic://pair?${params.toString()}`;
  }, [challenge, hostDeviceName, roomCode]);

  if (!challenge) return null;

  const handleApprove = () => {
    challenge.resolve(true);
    setChallenge(null);
  };

  const handleReject = () => {
    challenge.resolve(false);
    setChallenge(null);
  };

  return (
    <Modal
      transparent
      animationType="fade"
      visible={!!challenge}
      onRequestClose={handleReject}
    >
      <View style={styles.overlay}>
        <View style={[styles.card, { borderColor: theme.border }]}>
          <View style={[styles.iconCircle, { backgroundColor: theme.primary + '20' }]}>
            <Ionicons name="wifi" size={32} color={theme.primary} />
          </View>

          <Text style={styles.title}>
            {t('remote.pair_request')}
          </Text>

          <Text style={[styles.deviceName, { color: theme.primaryLight || theme.primary }]}>
            {challenge.clientDeviceName}
          </Text>

          <Text style={styles.subtitle}>
            {t('remote.pair_request_desc')}
          </Text>

          <View style={[styles.pinBox, { borderColor: theme.border }]}>
            <Text style={[styles.pinText, { color: theme.primaryLight || theme.primary }]}>
              {challenge.pin}
            </Text>
          </View>

          {/* QR: kamera uygulamasıyla okutulduğunda PIN istemcide otomatik dolar. */}
          <View style={styles.qrSection}>
            <View style={styles.qrBox}>
              <QRCode value={pairingLink} size={132} backgroundColor="#ffffff" color="#0b0b0f" />
            </View>
            <Text style={styles.qrHint}>{t('remote.qr_hint')}</Text>
          </View>

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.button, styles.rejectBtn, { borderColor: theme.border }]}
              onPress={handleReject}
              activeOpacity={0.7}
            >
              <Text style={styles.rejectBtnText}>
                {t('remote.reject')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.approveBtn, { backgroundColor: theme.primary }]}
              onPress={handleApprove}
              activeOpacity={0.7}
            >
              <Text style={styles.approveBtnText}>
                {t('remote.approve')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 20,
    backgroundColor: '#1c1c1e',
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 4,
    textAlign: 'center',
  },
  deviceName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: 'rgba(255,255,255,0.65)',
    textAlign: 'center',
    marginBottom: 20,
  },
  pinBox: {
    backgroundColor: '#121214',
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    marginBottom: 24,
    alignItems: 'center',
  },
  pinText: {
    fontSize: 32,
    fontWeight: 'bold',
    letterSpacing: 8,
    fontFamily: 'monospace',
  },
  qrSection: {
    alignItems: 'center',
    gap: 8,
    marginBottom: 20,
  },
  qrBox: {
    backgroundColor: '#ffffff',
    padding: 10,
    borderRadius: 14,
  },
  qrHint: {
    fontSize: 12,
    lineHeight: 17,
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'center',
    maxWidth: 280,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  button: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rejectBtn: {
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  approveBtn: {},
  rejectBtnText: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.7)',
  },
  approveBtnText: {
    fontSize: 15,
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
});
