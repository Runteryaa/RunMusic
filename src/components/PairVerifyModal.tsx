import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../store/useThemeStore';
import { useRemoteConnectStore } from '../store/useRemoteConnectStore';
import { tcpClient } from '../services/remote/tcpClient';

export function PairVerifyModal() {
  const theme = useThemeStore((s) => s.theme);
  const pendingVerify = useRemoteConnectStore((s) => s.pendingPinVerification);
  const setPendingVerify = useRemoteConnectStore((s) => s.setPendingPinVerification);
  const connectedDeviceName = useRemoteConnectStore((s) => s.connectedDeviceName);

  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!pendingVerify) return null;

  const handleVerify = () => {
    const trimmed = pin.trim();
    if (trimmed.length !== 4) {
      setError('Lütfen 4 haneli PIN kodunu girin.');
      return;
    }
    setError(null);
    pendingVerify(trimmed);
    setPendingVerify(null);
    setPin('');
  };

  const handleCancel = () => {
    setError(null);
    setPin('');
    setPendingVerify(null);
    tcpClient.disconnect();
  };

  return (
    <Modal
      transparent
      animationType="fade"
      visible={!!pendingVerify}
      onRequestClose={handleCancel}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <View style={[styles.card, { borderColor: theme.border }]}>
          <View style={[styles.iconCircle, { backgroundColor: theme.primary + '20' }]}>
            <Ionicons name="keypad" size={28} color={theme.primary} />
          </View>

          <Text style={styles.title}>
            PIN Kodunu Girin
          </Text>

          <Text style={styles.subtitle}>
            {connectedDeviceName
              ? `${connectedDeviceName} ekranında görüntülenen 4 haneli eşleşme kodunu girin:`
              : 'Ana cihaz ekranındaki 4 haneli PIN kodunu girin:'}
          </Text>

          <TextInput
            style={[
              styles.input,
              {
                borderColor: error ? '#EF4444' : theme.border,
              },
            ]}
            value={pin}
            onChangeText={(val) => {
              setError(null);
              setPin(val.replace(/[^0-9]/g, ''));
            }}
            placeholder="0000"
            placeholderTextColor="rgba(255,255,255,0.25)"
            keyboardType="number-pad"
            maxLength={4}
            autoFocus
            textAlign="center"
          />

          {error && (
            <Text style={styles.errorText}>
              {error}
            </Text>
          )}

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.button, styles.cancelBtn, { borderColor: theme.border }]}
              onPress={handleCancel}
              activeOpacity={0.7}
            >
              <Text style={styles.cancelBtnText}>
                İptal
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.button,
                styles.verifyBtn,
                { backgroundColor: theme.primary, opacity: pin.length === 4 ? 1 : 0.6 },
              ]}
              onPress={handleVerify}
              disabled={pin.length !== 4}
              activeOpacity={0.7}
            >
              <Text style={styles.verifyBtnText}>
                Bağlan
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
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
    maxWidth: 360,
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
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: 'rgba(255,255,255,0.65)',
    textAlign: 'center',
    marginBottom: 20,
  },
  input: {
    width: '100%',
    maxWidth: 180,
    height: 56,
    borderRadius: 14,
    backgroundColor: '#121214',
    color: '#FFFFFF',
    borderWidth: 1.5,
    fontSize: 30,
    fontWeight: 'bold',
    letterSpacing: 8,
    fontFamily: 'monospace',
    marginBottom: 12,
  },
  errorText: {
    fontSize: 13,
    color: '#EF4444',
    marginBottom: 16,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    marginTop: 8,
  },
  button: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelBtn: {
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  verifyBtn: {},
  cancelBtnText: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.7)',
  },
  verifyBtnText: {
    fontSize: 15,
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
});
