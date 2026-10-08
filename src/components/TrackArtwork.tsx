import { useState, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

interface TrackArtworkProps {
  uri?: string | null;
  size?: number;
  borderRadius?: number;
  iconSize?: number;
  shadow?: boolean;
}

export function TrackArtwork({
  uri,
  size = 40,
  borderRadius = 10,
  iconSize = 20,
  shadow = false,
}: TrackArtworkProps) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [uri]);

  const containerStyle = [
    styles.container,
    {
      width: size,
      height: size,
      borderRadius,
    },
    shadow && styles.shadowBox,
  ];

  if (uri && !hasError) {
    return (
      <View style={containerStyle}>
        <Image
          source={{ uri }}
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
