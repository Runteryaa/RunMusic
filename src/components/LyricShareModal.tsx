import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ThemeColors } from '../services/colorThemeService';

/** Paylaşım kartına sığabilecek en fazla satır. */
const MAX_SHARE_LINES = 8;

export interface LyricShareLine {
  key: string;
  text: string;
  /** Varsa, satırın altında daha küçük gösterilen arka vokal. */
  background?: string;
}

interface ShareModules {
  captureRef: (ref: unknown, options?: Record<string, unknown>) => Promise<string>;
  isAvailableAsync: () => Promise<boolean>;
  shareAsync: (url: string, options?: Record<string, unknown>) => Promise<void>;
}

/**
 * Görüntü yakalama ve paylaşma modülleri YALNIZCA paylaşım istendiğinde
 * yüklenir.
 *
 * Sebep: bu modüller native taraf gerektirir. Paylaşım özelliğinden önce
 * derlenmiş bir APK'ya OTA ile bu JS düşerse, modülü üstte `import` etmek
 * uygulamayı açılışta çökertirdi. Dinamik yükleme sayesinde eski derlemeler
 * çalışmaya devam eder, yalnızca paylaş butonu "güncelleme gerekli" der.
 */
async function loadShareModules(): Promise<ShareModules | null> {
  try {
    const viewShot: any = await import('react-native-view-shot');
    const sharing: any = await import('expo-sharing');
    const captureRef = viewShot?.captureRef ?? viewShot?.default?.captureRef;
    const isAvailableAsync = sharing?.isAvailableAsync ?? sharing?.default?.isAvailableAsync;
    const shareAsync = sharing?.shareAsync ?? sharing?.default?.shareAsync;
    if (!captureRef || !isAvailableAsync || !shareAsync) return null;
    return { captureRef, isAvailableAsync, shareAsync };
  } catch {
    return null;
  }
}

interface LyricShareModalProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  artist: string;
  artworkUri: string | null;
  sourceLabel?: string;
  lines: LyricShareLine[];
  /** Panel açıldığında seçili gelecek satırlar (genelde çalan satır). */
  initialKeys: string[];
  theme: ThemeColors;
  t: (key: string, params?: Record<string, string | number>) => string;
}

/**
 * Apple Music / Spotify tarzı söz kartı paylaşımı.
 *
 * Kullanıcı satırları seçer, kart canlı olarak önizlenir ve "Paylaş" ile kart
 * PNG'ye çevrilip sistem paylaşım sayfasına verilir.
 */
export function LyricShareModal({
  visible,
  onClose,
  title,
  artist,
  artworkUri,
  sourceLabel,
  lines,
  initialKeys,
  theme,
  t,
}: LyricShareModalProps) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const cardWidth = Math.min(Math.max(windowWidth - 72, 240), 300);

  const [selected, setSelected] = useState<string[]>(initialKeys);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cardRef = useRef<View>(null);

  const initialSignature = initialKeys.join('\u0001');

  // Panel her açıldığında seçim, çalan satıra sıfırlanır.
  useEffect(() => {
    if (!visible) return;
    setSelected(initialSignature ? initialSignature.split('\u0001') : []);
    setError(null);
    setBusy(false);
  }, [visible, initialSignature]);

  const toggleLine = useCallback(
    (key: string) => {
      setError(null);
      setSelected((previous) => {
        if (previous.includes(key)) return previous.filter((item) => item !== key);
        if (previous.length >= MAX_SHARE_LINES) {
          setError(t('player.share_lyrics_limit', { count: MAX_SHARE_LINES }));
          return previous;
        }
        return [...previous, key];
      });
    },
    [t]
  );

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // Kartta satırlar her zaman paneldeki sırayla görünür.
  const selectedLines = useMemo(
    () => lines.filter((line) => selectedSet.has(line.key)),
    [lines, selectedSet]
  );

  const handleShare = useCallback(async () => {
    if (busy || selectedLines.length === 0 || !cardRef.current) return;
    setBusy(true);
    setError(null);
    try {
      const modules = await loadShareModules();
      if (!modules) {
        setError(t('player.share_unavailable'));
        return;
      }
      const uri = await modules.captureRef(cardRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
      });
      // view-shot Android'de şemasız bir yol döndürebilir; expo-sharing dosya
      // URL'i bekler.
      const shareUri = uri.startsWith('file://') ? uri : `file://${uri}`;
      if (!(await modules.isAvailableAsync())) {
        setError(t('player.share_unavailable'));
        return;
      }
      await modules.shareAsync(shareUri, {
        mimeType: 'image/png',
        dialogTitle: t('player.share_lyrics'),
        UTI: 'public.png',
      });
    } catch {
      setError(t('player.share_failed'));
    } finally {
      setBusy(false);
    }
  }, [busy, selectedLines.length, t]);

  const renderLine = useCallback(
    ({ item }: { item: LyricShareLine }) => {
      const isSelected = selectedSet.has(item.key);
      return (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => toggleLine(item.key)}
          style={[styles.lineRow, isSelected && { backgroundColor: theme.surface }]}>
          <View
            style={[
              styles.checkbox,
              { borderColor: isSelected ? theme.primary : 'rgba(255,255,255,0.28)' },
              isSelected && { backgroundColor: theme.primary },
            ]}>
            {isSelected ? <Ionicons name="checkmark" size={12} color="#0b0b0e" /> : null}
          </View>
          <View style={styles.lineTextWrap}>
            <Text numberOfLines={2} style={styles.lineText}>
              {item.text}
            </Text>
            {item.background ? (
              <Text numberOfLines={1} style={styles.lineBackgroundText}>
                {item.background}
              </Text>
            ) : null}
          </View>
        </TouchableOpacity>
      );
    },
    [selectedSet, theme.primary, theme.surface, toggleLine]
  );

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t('player.share_lyrics')}</Text>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={t('player.share_lyrics_close')}>
            <Ionicons name="close" size={22} color="rgba(255,255,255,0.7)" />
          </TouchableOpacity>
        </View>

        {/* Paylaşılacak kart: canlı önizleme ve yakalanan görüntünün kaynağı. */}
        <View style={styles.previewWrap}>
          <View
            ref={cardRef}
            collapsable={false}
            style={[styles.card, { width: cardWidth, backgroundColor: '#0a0a0d' }]}>
            {artworkUri ? (
              <Image
                source={{ uri: artworkUri }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                blurRadius={26}
                cachePolicy="memory-disk"
              />
            ) : (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.primaryDark }]} />
            )}
            <View style={styles.cardScrim} />
            <View style={[styles.cardTint, { backgroundColor: theme.glowColor }]} />

            <View style={styles.cardContent}>
              <View style={styles.cardHeader}>
                {artworkUri ? (
                  <Image
                    source={{ uri: artworkUri }}
                    style={styles.cardArtwork}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                  />
                ) : (
                  <View style={[styles.cardArtwork, { backgroundColor: 'rgba(255,255,255,0.12)' }]} />
                )}
                <View style={styles.cardMeta}>
                  <Text numberOfLines={1} style={styles.cardTitle}>
                    {title || '—'}
                  </Text>
                  <Text numberOfLines={1} style={styles.cardArtist}>
                    {artist || '—'}
                  </Text>
                </View>
              </View>

              <View style={styles.cardLines}>
                {selectedLines.length > 0 ? (
                  selectedLines.map((line) => (
                    <View key={`card-${line.key}`} style={styles.cardLineBlock}>
                      <Text style={styles.cardLineText}>{line.text}</Text>
                      {line.background ? (
                        <Text style={styles.cardLineBackground}>{line.background}</Text>
                      ) : null}
                    </View>
                  ))
                ) : (
                  <Text style={styles.cardEmptyText}>{t('player.share_lyrics_empty')}</Text>
                )}
              </View>

              <View style={styles.cardFooter}>
                <Text style={styles.cardWordmark}>RunMusic</Text>
                {sourceLabel ? (
                  <Text numberOfLines={1} style={styles.cardSource}>
                    {sourceLabel}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>
        </View>

        <View style={styles.pickerHeader}>
          <Text style={styles.pickerHint}>{t('player.share_lyrics_hint')}</Text>
          <TouchableOpacity
            onPress={() => {
              setError(null);
              setSelected([]);
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[styles.pickerAction, { color: theme.textAccent }]}>
              {t('player.share_lyrics_clear')}
            </Text>
          </TouchableOpacity>
        </View>

        <FlatList
          data={lines}
          keyExtractor={(item) => item.key}
          renderItem={renderLine}
          style={styles.pickerList}
          contentContainerStyle={styles.pickerListContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        />

        <View style={styles.footer}>
          <Text style={styles.counterText}>
            {selectedLines.length}/{MAX_SHARE_LINES}
          </Text>
          {error ? (
            <Text numberOfLines={2} style={styles.errorText}>
              {error}
            </Text>
          ) : null}
          <TouchableOpacity
            activeOpacity={0.8}
            disabled={busy || selectedLines.length === 0}
            onPress={handleShare}
            style={[
              styles.shareBtn,
              { backgroundColor: theme.primary },
              (busy || selectedLines.length === 0) && styles.shareBtnDisabled,
            ]}>
            {busy ? (
              <ActivityIndicator size="small" color="#0b0b0e" />
            ) : (
              <Ionicons name="share-outline" size={18} color="#0b0b0e" />
            )}
            <Text style={styles.shareBtnText}>{t('player.share_lyrics_action')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'rgba(9, 9, 12, 0.98)',
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  previewWrap: {
    alignItems: 'center',
    paddingBottom: 16,
  },
  card: {
    borderRadius: 26,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOpacity: 0.45,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  cardScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(6, 6, 10, 0.62)',
  },
  cardTint: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.55,
  },
  cardContent: {
    padding: 18,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardArtwork: {
    width: 46,
    height: 46,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  cardMeta: {
    flex: 1,
    marginLeft: 11,
  },
  cardTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  cardArtist: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  cardLines: {
    marginTop: 20,
    marginBottom: 10,
  },
  cardLineBlock: {
    marginBottom: 10,
  },
  cardLineText: {
    color: '#ffffff',
    fontSize: 18,
    lineHeight: 25,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  cardLineBackground: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    marginTop: 2,
  },
  cardEmptyText: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 14,
    fontWeight: '600',
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  cardWordmark: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  cardSource: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 10,
    fontWeight: '600',
    marginLeft: 10,
    flexShrink: 1,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 6,
  },
  pickerHint: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12.5,
    fontWeight: '600',
    flexShrink: 1,
  },
  pickerAction: {
    fontSize: 12.5,
    fontWeight: '700',
    marginLeft: 10,
  },
  pickerList: {
    flex: 1,
  },
  pickerListContent: {
    paddingBottom: 8,
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 10,
    marginBottom: 2,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  lineTextWrap: {
    flex: 1,
    marginLeft: 10,
  },
  lineText: {
    color: '#ffffff',
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: '600',
  },
  lineBackgroundText: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    marginTop: 1,
  },
  footer: {
    paddingTop: 10,
  },
  counterText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11.5,
    fontWeight: '600',
    textAlign: 'right',
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 13,
    marginTop: 6,
  },
  shareBtnDisabled: {
    opacity: 0.4,
  },
  shareBtnText: {
    color: '#0b0b0e',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
});
