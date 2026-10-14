import React, { useState } from 'react';
import { StyleSheet, View, Text, StyleProp, ViewStyle } from 'react-native';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import { AD_UNIT_IDS } from '../services/adService';
import { useThemeStore } from '../store/useThemeStore';
import { useStore } from '../store/useStore';

interface AdBannerProps {
  style?: StyleProp<ViewStyle>;
  size?: BannerAdSize;
}

export function AdBanner({ style, size = BannerAdSize.ANCHORED_ADAPTIVE_BANNER }: AdBannerProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const theme = useThemeStore((s) => s.theme);
  const isDevModeActive = useStore((s) => s.preferences.isDevModeActive);

  if (isDevModeActive || hasError) {
    return null;
  }

  return (
    <View
      style={[
        styles.container,
        isLoaded ? styles.containerVisible : styles.containerHidden,
        { borderColor: theme.border || '#27272a' },
        style,
      ]}>
      {isLoaded && (
        <View style={styles.adBadgeContainer}>
          <Text style={styles.adBadgeText}>Ad</Text>
        </View>
      )}
      <BannerAd
        unitId={AD_UNIT_IDS.BANNER}
        size={size}
        requestOptions={{
          requestNonPersonalizedAdsOnly: true,
        }}
        onAdLoaded={() => {
          setIsLoaded(true);
          setHasError(false);
        }}
        onAdFailedToLoad={(error) => {
          console.log('[AdBanner] Ad failed to load:', error);
          setHasError(true);
          setIsLoaded(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    alignSelf: 'center',
    width: '100%',
  },
  containerVisible: {
    marginVertical: 10,
    borderRadius: 12,
    backgroundColor: '#18181b',
    borderWidth: 1,
    paddingVertical: 6,
    minHeight: 56,
  },
  containerHidden: {
    height: 0,
    width: 0,
    opacity: 0,
    marginVertical: 0,
    borderWidth: 0,
  },
  adBadgeContainer: {
    position: 'absolute',
    top: 2,
    right: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    zIndex: 10,
  },
  adBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#a1a1aa',
    textTransform: 'uppercase',
  },
});
