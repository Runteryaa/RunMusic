import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
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
export const MAX_SHARE_LINES = 8;

export interface LyricShareLine {
  key: string;
  text: string;
  /** Varsa, satırın altında daha küçük gösterilen arka vokal. */
  background?: string;
  /** Diyalog satırı sağa hizalıysa (karşılıklı söyleşi) kartta da sağa yaslanır. */
  align?: 'start' | 'end';
}

interface CaptureModules {
  captureRef: (ref: unknown, options?: Record<string, unknown>) => Promise<string>;
  isAvailableAsync?: () => Promise<boolean>;
  shareAsync?: (url: string, options?: Record<string, unknown>) => Promise<void>;
  saveToLibraryAsync?: (localUri: string) => Promise<void>;
  requestPermissionsAsync?: (
    writeOnly?: boolean,
    granularPermissions?: ('audio' | 'photo' | 'video')[]
  ) => Promise<{ granted: boolean }>;
}

/**
 * Görüntü yakalama, paylaşma ve galeriye kaydetme modülleri YALNIZCA gerektiğinde
 * yüklenir.
 *
 * Sebep: bu modüller native taraf gerektirir. Özellikten önce derlenmiş bir
 * APK'ya OTA ile bu JS düşerse, modülü üstte `import` etmek uygulamayı açılışta
 * çökertirdi. Dinamik yükleme sayesinde eski derlemeler çalışmaya devam eder,
 * yalnızca ilgili buton "güncelleme gerekli" der.
 */
async function loadCaptureModules(): Promise<CaptureModules | null> {
  let captureRef: CaptureModules['captureRef'] | undefined;
  try {
    const viewShot: any = await import('react-native-view-shot');
    captureRef = viewShot?.captureRef ?? viewShot?.default?.captureRef;
  } catch {
    return null;
  }
  if (!captureRef) return null;

  const modules: CaptureModules = { captureRef };

  try {
    const sharing: any = await import('expo-sharing');
    modules.isAvailableAsync = sharing?.isAvailableAsync ?? sharing?.default?.isAvailableAsync;
    modules.shareAsync = sharing?.shareAsync ?? sharing?.default?.shareAsync;
  } catch {
    // Paylaşım yoksa indirme yine çalışsın.
  }

  try {
    const media: any = await import('expo-media-library/legacy');
    modules.saveToLibraryAsync =
      media?.saveToLibraryAsync ?? media?.default?.saveToLibraryAsync;
    modules.requestPermissionsAsync =
      media?.requestPermissionsAsync ?? media?.default?.requestPermissionsAsync;
  } catch {
    // Galeriye kaydetme yoksa paylaşım yine çalışsın.
  }

  return modules;
}

interface LyricSharePreviewModalProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  artist: string;
  artworkUri: string | null;
  /** Seçilen satırlar, paneldeki sırayla. */
  lines: LyricShareLine[];
  theme: ThemeColors;
  t: (key: string, params?: Record<string, string | number>) => string;
}

/**
 * Apple Music / Spotify tarzı söz kartı önizlemesi.
 *
 * Satır seçimi artık söz panelinin kendisinde yapılıyor; bu modal yalnızca
 * seçilen satırlardan oluşan kartı gösterir ve PNG olarak indirme/paylaşma
 * seçeneklerini sunar.
 */
export function LyricSharePreviewModal({
  visible,
  onClose,
  title,
  artist,
  artworkUri,
  lines,
  theme,
  t,
}: LyricSharePreviewModalProps) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const cardWidth = Math.min(Math.max(windowWidth - 104, 220), 300);

  const [busy, setBusy] = useState<'share' | 'download' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const cardRef = useRef<View>(null);

  // Modal her açıldığında durum sıfırlanır.
  useEffect(() => {
    if (!visible) return;
    setBusy(null);
    setError(null);
    setSaved(false);
  }, [visible]);

  // "Galeriye kaydedildi" geri bildirimi kısa süre sonra kendiliğinden silinir.
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 2600);
    return () => clearTimeout(timer);
  }, [saved]);

  const captureCard = useCallback(async () => {
    const modules = await loadCaptureModules();
    if (!modules || !cardRef.current) return null;
    const uri = await modules.captureRef(cardRef, {
      format: 'png',
      quality: 1,
      result: 'tmpfile',
    });
    // view-shot Android'de şemasız bir yol döndürebilir; dosya API'leri
    // `file://` şeması bekler.
    const fileUri = uri.startsWith('file://') ? uri : `file://${uri}`;
    return { modules, fileUri };
  }, []);

  const handleDownload = useCallback(async () => {
    if (busy) return;
    setBusy('download');
    setError(null);
    try {
      const captured = await captureCard();
      if (!captured) {
        setError(t('player.share_unavailable'));
        return;
      }
      const { modules, fileUri } = captured;
      if (!modules.saveToLibraryAsync || !modules.requestPermissionsAsync) {
        setError(t('player.share_unavailable'));
        return;
      }
      const permission = await modules.requestPermissionsAsync(false, ['photo']);
      if (!permission.granted) {
        setError(t('player.share_download_permission'));
        return;
      }
      await modules.saveToLibraryAsync(fileUri);
      setSaved(true);
    } catch {
      setError(t('player.share_download_failed'));
    } finally {
      setBusy(null);
    }
  }, [busy, captureCard, t]);

  const handleShare = useCallback(async () => {
    if (busy) return;
    setBusy('share');
    setError(null);
    try {
      const captured = await captureCard();
      if (!captured) {
        setError(t('player.share_unavailable'));
        return;
      }
      const { modules, fileUri } = captured;
      if (!modules.shareAsync || !modules.isAvailableAsync) {
        setError(t('player.share_unavailable'));
        return;
      }
      if (!(await modules.isAvailableAsync())) {
        setError(t('player.share_unavailable'));
        return;
      }
      await modules.shareAsync(fileUri, {
        mimeType: 'image/png',
        dialogTitle: t('player.share_lyrics'),
        UTI: 'public.png',
      });
    } catch {
      setError(t('player.share_failed'));
    } finally {
      setBusy(null);
    }
  }, [busy, captureCard, t]);

  const cardMaxHeight = Math.max(240, windowHeight - insets.top - insets.bottom - 280);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      statusBarTranslucent
      onRequestClose={busy ? undefined : onClose}>
      <Pressable style={styles.backdrop} onPress={busy ? undefined : onClose}>
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{t('player.share_lyrics')}</Text>
            <TouchableOpacity
              onPress={onClose}
              disabled={!!busy}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={t('player.share_lyrics_close')}>
              <Ionicons name="close" size={22} color="rgba(255,255,255,0.7)" />
            </TouchableOpacity>
          </View>

          <View style={styles.previewWrap}>
            <View
              ref={cardRef}
              collapsable={false}
              style={[
                styles.card,
                { width: cardWidth, maxHeight: cardMaxHeight, backgroundColor: '#0a0a0d' },
              ]}>
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
                    <View
                      style={[styles.cardArtwork, { backgroundColor: 'rgba(255,255,255,0.12)' }]}
                    />
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
                  {lines.length > 0 ? (
                    lines.map((line) => {
                      const lineEnd = line.align === 'end';
                      return (
                        <View
                          key={`card-${line.key}`}
                          style={[styles.cardLineBlock, lineEnd && styles.cardLineBlockEnd]}>
                          <Text style={[styles.cardLineText, lineEnd && styles.cardLineTextEnd]}>
                            {line.text}
                          </Text>
                          {line.background ? (
                            <Text
                              style={[
                                styles.cardLineBackground,
                                lineEnd && styles.cardLineTextEnd,
                              ]}>
                              {line.background}
                            </Text>
                          ) : null}
                        </View>
                      );
                    })
                  ) : (
                    <Text style={styles.cardEmptyText}>{t('player.share_lyrics_empty')}</Text>
                  )}
                </View>

                <View style={styles.cardFooter}>
                  <Text style={styles.cardWordmark}>RunMusic</Text>
                </View>
              </View>
            </View>
          </View>

          {error ? (
            <Text numberOfLines={2} style={styles.errorText}>
              {error}
            </Text>
          ) : saved ? (
            <View style={styles.savedRow}>
              <Ionicons name="checkmark-circle" size={14} color="#10b981" />
              <Text style={styles.savedText}>{t('player.share_downloaded')}</Text>
            </View>
          ) : null}

          <View style={styles.actions}>
            <TouchableOpacity
              activeOpacity={0.8}
              disabled={!!busy || lines.length === 0}
              onPress={handleDownload}
              style={[
                styles.actionBtn,
                styles.downloadBtn,
                (busy || lines.length === 0) && styles.actionBtnDisabled,
              ]}>
              {busy === 'download' ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Ionicons name="download-outline" size={18} color="#ffffff" />
              )}
              <Text style={styles.downloadBtnText}>{t('player.share_download')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.8}
              disabled={!!busy || lines.length === 0}
              onPress={handleShare}
              style={[
                styles.actionBtn,
                { backgroundColor: theme.primary },
                (busy || lines.length === 0) && styles.actionBtnDisabled,
              ]}>
              {busy === 'share' ? (
                <ActivityIndicator size="small" color="#0b0b0e" />
              ) : (
                <Ionicons name="share-outline" size={18} color="#0b0b0e" />
              )}
              <Text style={[styles.shareBtnText, { color: '#0b0b0e' }]}>
                {t('player.share_lyrics_action')}
              </Text>
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
    backgroundColor: 'rgba(4, 4, 7, 0.78)',
    justifyContent: 'center',
    paddingHorizontal: 26,
  },
  sheet: {
    alignItems: 'stretch',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 14,
    paddingHorizontal: 4,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  previewWrap: {
    alignItems: 'center',
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
    marginTop: 18,
    marginBottom: 8,
  },
  cardLineBlock: {
    marginBottom: 9,
  },
  cardLineBlockEnd: {
    alignItems: 'flex-end',
  },
  cardLineText: {
    color: '#ffffff',
    fontSize: 17,
    lineHeight: 24,
    // Paneldeki sözlerle aynı ağırlık: Apple Music'in söz tipografisi kalın.
    fontWeight: '800',
    letterSpacing: -0.3,
    /*
     * Kart dışa aktarılan bir görsel: burada bulanıklık değil hâle kullanılıyor.
     * Geniş yarıçap + düşük opaklık, harfi net bırakıp arkasındaki fotoğrafa
     * karşı yumuşak bir ışık veriyor.
     */
    textShadowColor: 'rgba(255, 255, 255, 0.55)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  cardLineTextEnd: {
    textAlign: 'right',
  },
  cardLineBackground: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    marginTop: 2,
    textShadowColor: 'rgba(255, 255, 255, 0.45)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
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
    marginTop: 6,
  },
  cardWordmark: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 12,
    textAlign: 'center',
  },
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
  },
  savedText: {
    color: '#10b981',
    fontSize: 12,
    fontWeight: '700',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 13,
  },
  downloadBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
  },
  downloadBtnText: {
    color: '#ffffff',
    fontSize: 14.5,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  shareBtnText: {
    fontSize: 14.5,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  actionBtnDisabled: {
    opacity: 0.45,
  },
});
