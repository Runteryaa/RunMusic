import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useThemeStore } from '../store/useThemeStore';
import { useTranslation } from '../services/i18n';
import { withAlpha } from './ui/GradientSurface';

/**
 * Sanatçı adı değiştirme penceresi.
 *
 * Modal içinde gerçek bulanıklık (expo-blur) Android'de çalışmadığı için cam
 * etkisi saydam katmanlarla veriliyor; kart uygulamanın koyu kart dilini
 * koruyor. Kaydetme işi çağırana aittir: burada yalnızca ad toplanır.
 */
export interface ArtistRenameModalProps {
  visible: boolean;
  /** Kutuya önceden yazılacak ad (mevcut sanatçı adı). */
  initialValue: string;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}

export function ArtistRenameModal({
  visible,
  initialValue,
  onCancel,
  onSubmit,
}: ArtistRenameModalProps) {
  const { t } = useTranslation();
  const theme = useThemeStore((s) => s.theme);
  const [value, setValue] = useState(initialValue);

  // Pencere her açıldığında mevcut adla başla.
  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);

  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.card} onPress={(event) => event.stopPropagation()}>
          <View style={styles.headerRow}>
            <View
              style={[
                styles.iconCircle,
                { backgroundColor: withAlpha(theme.primary, 0.16) },
              ]}>
              <Ionicons name="pencil" size={18} color={theme.primary} />
            </View>
            <Text style={styles.title}>{t('artist.rename_title')}</Text>
          </View>

          <Text style={styles.hint}>{t('artist.rename_hint')}</Text>

          <TextInput
            value={value}
            onChangeText={setValue}
            placeholder={t('artist.rename_placeholder')}
            placeholderTextColor="#71717a"
            style={[styles.input, { borderColor: withAlpha(theme.primary, 0.45) }]}
            autoFocus
            selectTextOnFocus
            returnKeyType="done"
            onSubmitEditing={() => {
              if (canSubmit) onSubmit(trimmed);
            }}
          />

          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.cancelBtn}
              activeOpacity={0.75}
              onPress={onCancel}>
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.applyBtn,
                { backgroundColor: theme.primary },
                !canSubmit && styles.applyBtnDisabled,
              ]}
              activeOpacity={0.85}
              disabled={!canSubmit}
              onPress={() => onSubmit(trimmed)}>
              <Text style={styles.applyText}>{t('artist.rename_apply')}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 22,
    padding: 20,
    backgroundColor: 'rgba(24, 24, 27, 0.96)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
  hint: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 12.5,
    lineHeight: 18,
    marginBottom: 14,
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#ffffff',
    fontSize: 16,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 18,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  cancelText: {
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 14,
    fontWeight: '600',
  },
  applyBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 14,
  },
  applyBtnDisabled: {
    opacity: 0.45,
  },
  applyText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
});
