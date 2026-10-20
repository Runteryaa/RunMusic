import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useExtensionStore } from '../store/useExtensionStore';
import { useThemeStore } from '../store/useThemeStore';
import { useTranslation } from '../services/i18n';

export const InstallExtensionModal: React.FC = () => {
  const { t } = useTranslation();
  const theme = useThemeStore((s) => s.theme);
  const isOpen = useExtensionStore((s) => s.isInstallModalOpen);
  const close = useExtensionStore((s) => s.closeInstallModal);
  const installExtension = useExtensionStore((s) => s.installExtension);

  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);

  const handleInstall = async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      Alert.alert(t('common.error'), t('extensions.invalid_url'));
      return;
    }

    setLoading(true);
    try {
      const ext = await installExtension(trimmed);
      setUrl('');
      Alert.alert(
        t('extensions.installed_title'),
        t('extensions.installed_msg', { name: ext.manifest.name })
      );
    } catch (err: any) {
      Alert.alert(t('extensions.install_failed_title'), err?.message || t('extensions.manifest_failed_msg'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      visible={isOpen}
      transparent
      animationType="fade"
      onRequestClose={close}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}
      >
        <TouchableOpacity
          activeOpacity={1}
          style={styles.overlayTouch}
          onPress={close}
        />

        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <View style={[styles.iconWrap, { backgroundColor: theme.primary + '20' }]}>
                <Ionicons name="extension-puzzle-outline" size={22} color={theme.primary} />
              </View>
              <Text style={styles.title}>{t('extensions.install_modal_title')}</Text>
            </View>
            <TouchableOpacity onPress={close} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={24} color="#a1a1aa" />
            </TouchableOpacity>
          </View>

          <Text style={styles.description}>
            {t('extensions.install_modal_desc')}
          </Text>

          <View style={styles.inputContainer}>
            <Ionicons name="link-outline" size={20} color="#71717a" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="https://example.com/manifest.json"
              placeholderTextColor="#52525b"
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              editable={!loading}
            />
            {url.length > 0 && (
              <TouchableOpacity onPress={() => setUrl('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close-circle" size={18} color="#71717a" />
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity
            style={styles.sampleFillBtn}
            onPress={() => setUrl('https://runteryaa.github.io/RunMusic/examples/sample-audio-extension/manifest.json')}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons name="sparkles" size={14} color={theme.primary} style={{ marginRight: 6 }} />
            <Text style={[styles.sampleFillText, { color: theme.primary }]}>
              {t('extensions.fill_sample')}
            </Text>
          </TouchableOpacity>

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={close}
              disabled={loading}
            >
              <Text style={styles.cancelBtnText}>{t('common.cancel')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.installBtn, { backgroundColor: theme.primary }, loading && styles.disabledBtn]}
              onPress={handleInstall}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <>
                  <Ionicons name="download-outline" size={18} color="#ffffff" style={{ marginRight: 6 }} />
                  <Text style={styles.installBtnText}>{t('extensions.install_btn')}</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  overlayTouch: {
    ...StyleSheet.absoluteFill,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#18181b',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: '#27272a',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
  },
  description: {
    fontSize: 13,
    color: '#a1a1aa',
    lineHeight: 18,
    marginBottom: 20,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#09090b',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#27272a',
    paddingHorizontal: 12,
    height: 48,
    marginBottom: 24,
  },
  inputIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    color: '#ffffff',
    fontSize: 14,
    height: '100%',
  },
  sampleFillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  sampleFillText: {
    fontSize: 12,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelBtnText: {
    color: '#a1a1aa',
    fontWeight: '600',
    fontSize: 14,
  },
  installBtn: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 96,
  },
  disabledBtn: {
    opacity: 0.6,
  },
  installBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
});
