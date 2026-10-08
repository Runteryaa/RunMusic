import { useState, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../store/useStore';
import { getArtworkAsync } from '../../modules/audio-artwork/src';

interface TrackArtworkProps {
  uri?: string | null;
  trackId?: string | null;
  trackUri?: string | null;
  size?: number;
  borderRadius?: number;
  iconSize?: number;
  shadow?: boolean;
}

export function TrackArtwork({
  uri,
  trackId,
  trackUri,
  size = 40,
  borderRadius = 10,
  iconSize = 20,
  shadow = false,
}: TrackArtworkProps) {
  const [hasError, setHasError] = useState(false);
  const artworkMap = useStore((state) => state.artworkMap);
  const setArtwork = useStore((state) => state.setArtwork);

  // If direct uri provided and not errored, use it; otherwise check store by trackId
  const effectiveUri = uri || (trackId ? artworkMap[trackId] : undefined);

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
          onError={() => setHasError(true)}
        />
      </View>
    );
  }

  return (
    <View style={containerStyle}>
      <Ionicons name="musical-notes" size={iconSize} color="#3b82f6" />
    </View>
  );
}

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
