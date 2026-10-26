import React, { memo, useState, useEffect } from 'react';
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
  const [hasError, setHasError] = useState(false);
  const themePrimary = useThemeStore((state) => state.theme.primary);
  const setArtwork = useStore((state) => state.setArtwork);

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

  const effectiveUri = uri || storeArtwork;

  useEffect(() => {
    setHasError(false);
    // If no artwork known yet, and we have the file trackUri, extract it asynchronously
    if (!effectiveUri && trackUri) {
      let isMounted = true;
      getArtworkAsync(trackUri, trackId ?? null).then((resolved) => {
        if (isMounted && resolved && trackId) {
          setArtwork(trackId, resolved);
        }
      });
      return () => {
        isMounted = false;
      };
    }
  }, [effectiveUri, trackUri, trackId, setArtwork]);

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
          onError={() => setHasError(true)}
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
