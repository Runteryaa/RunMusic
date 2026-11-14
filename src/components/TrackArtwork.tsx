import React, { memo, useState, useEffect, useRef, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../store/useStore';
import { useThemeStore } from '../store/useThemeStore';
import { getArtworkAsync } from '../../modules/audio-artwork/src';
import { useComponentDiagnostics } from '../hooks/useComponentDiagnostics';

interface TrackArtworkProps {
  uri?: string | null;
  trackId?: string | null;
  trackUri?: string | null;
  size?: number;
  borderRadius?: number;
  iconSize?: number;
  shadow?: boolean;
}

/**
 * Kapak yolu bilinen ama dosyası artık yoksa (ör. Android önbelleği temizledi
 * veya kullanıcı ayarlardan kapak önbelleğini sildi) kaydı tazele.
 *
 * `artworkMap` tek başına yetmez: kütüphane satırları `metadataMap[id].artwork`
 * değerini de kullanır, bu yüzden iki harita birlikte güncellenir.
 */
function persistResolvedArtwork(id: string, artwork: string): void {
  const store = useStore.getState();
  const existing = store.metadataMap[id];
  store.setBatchTrackMetadata({
    [id]: { ...(existing || {}), artwork },
  });
}

export const TrackArtwork = memo(function TrackArtwork({
  uri,
  trackId,
  trackUri,
  size = 40,
  borderRadius = 10,
  iconSize = 20,
  shadow = false,
}: TrackArtworkProps) {
  useComponentDiagnostics('TrackArtwork');
  const themePrimary = useThemeStore((state) => state.theme.primary);

  // Subscribe to a single artwork string instead of the whole artwork/metadata
  // maps. A metadata scan that adds artwork for one track must not re-render
  // every visible row in the library or queue. When the caller already supplied
  // a URI this selector intentionally stays undefined.
  const storeArtwork = useStore((state) => {
    if (uri) return undefined;
    if (trackId) {
      const direct =
        state.metadataMap[trackId]?.artwork || state.artworkMap[trackId];
      if (direct) return direct;
    }
    if (trackUri) {
      return state.metadataMap[trackUri]?.artwork || state.artworkMap[trackUri];
    }
    return undefined;
  });

  const baseUri = uri || storeArtwork;
  // Kaynak dosyası kaybolmuş bir yol için yeniden çıkarılan kapak burada tutulur.
  const [resolvedUri, setResolvedUri] = useState<string | null>(null);
  const [hasError, setHasError] = useState(false);
  const attemptedRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Kaynak değişince (başka şarkı) geçici çözümü ve hata durumunu sıfırla.
  useEffect(() => {
    setResolvedUri(null);
    setHasError(false);
    attemptedRef.current = null;
  }, [baseUri]);

  const effectiveUri = resolvedUri ?? baseUri;

  const extractArtwork = useCallback(() => {
    if (!trackUri) return;
    // Aynı kaynak için sonsuz yeniden deneme yapma.
    const token = effectiveUri || '__missing__';
    if (attemptedRef.current === token) return;
    attemptedRef.current = token;
    getArtworkAsync(trackUri, trackId ?? null).then((resolved) => {
      if (!isMountedRef.current || !resolved) return;
      if (resolved === effectiveUri) return;
      setResolvedUri(resolved);
      setHasError(false);
      if (trackId) persistResolvedArtwork(trackId, resolved);
    });
  }, [effectiveUri, trackUri, trackId]);

  useEffect(() => {
    // If no artwork known yet, and we have the file trackUri, extract it asynchronously
    if (!effectiveUri) {
      extractArtwork();
    }
  }, [effectiveUri, extractArtwork]);

  const handleError = useCallback(() => {
    // Yol geçersiz (dosya silinmiş): kapağı gömülü etiketten yeniden çıkar.
    setHasError(true);
    extractArtwork();
  }, [extractArtwork]);

  const containerStyle = [
    styles.container,
    {
      width: size,
      height: size,
      borderRadius,
    },
    shadow && styles.shadowBox,
  ];

  if (effectiveUri && !hasError) {
    return (
      <View style={containerStyle}>
        <Image
          source={{ uri: effectiveUri }}
          style={{ width: size, height: size, borderRadius }}
          contentFit="cover"
          transition={200}
          // Bu bileşen şarkı değişince YENİDEN MOUNT EDİLMEZ, aynı instance yeni
          // bir kaynak alır. Bu durumda expo-image önceki görseli yeni görsel
          // tamamen yüklenene kadar göstermeye devam eder; yani bir an ÖNCEKİ
          // şarkının kapağı görünür. recyclingKey bu içeriği sıfırlar.
          recyclingKey={effectiveUri}
          onError={handleError}
        />
      </View>
    );
  }

  return (
    <View style={containerStyle}>
      <Ionicons name="musical-notes" size={iconSize} color={themePrimary} />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  shadowBox: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 8,
  },
});
