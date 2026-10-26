import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  StyleProp,
  ViewStyle,
  useWindowDimensions,
} from 'react-native';
import { useIsFocused } from 'expo-router';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import { AD_UNIT_IDS } from '../services/adService';
import { useThemeStore } from '../store/useThemeStore';
import { useStore } from '../store/useStore';
import { useIsAppActive } from '../hooks/useIsAppActive';
import { useComponentDiagnostics } from '../hooks/useComponentDiagnostics';
import { recordEvent } from '../services/memoryDiagnostics';

interface AdBannerProps {
  style?: StyleProp<ViewStyle>;
  size?: BannerAdSize;
}

export function AdBanner({ style, size = BannerAdSize.ANCHORED_ADAPTIVE_BANNER }: AdBannerProps) {
  useComponentDiagnostics('AdBanner');
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const containerRef = useRef<View>(null);
  const { height: windowHeight } = useWindowDimensions();
  const isFocused = useIsFocused();
  const theme = useThemeStore((s) => s.theme);
  const isDevModeActive = useStore((s) => s.preferences.isDevModeActive);
  const isAppActive = useIsAppActive();

  const canRender = isAppActive && isFocused && !isDevModeActive;

  // Ads are expensive native views. Keep only the ones currently inside the
  // viewport mounted; everything else is a lightweight placeholder that
  // preserves layout height so the list does not jump while scrolling.
  const measureVisibility = useCallback(() => {
    if (!canRender) {
      setIsVisible(false);
      return;
    }
    const node = containerRef.current;
    if (!node) return;
    node.measureInWindow((_x, y, _width, height) => {
      if (!canRender) return;
      const visible = height > 0 && y < windowHeight && y + height > 0;
      setIsVisible((previous) => (previous === visible ? previous : visible));
    });
  }, [canRender, windowHeight]);

  useEffect(() => {
    if (!canRender) {
      setIsVisible(false);
      setIsLoaded(false);
      setHasError(false);
      return;
    }

    measureVisibility();
    const interval = setInterval(measureVisibility, 1000);
    return () => clearInterval(interval);
  }, [canRender, measureVisibility]);

  // Release the native ad view as soon as the banner leaves the viewport.
  useEffect(() => {
    if (!isVisible) {
      setIsLoaded(false);
      setHasError(false);
    }
  }, [isVisible]);

  if (isDevModeActive || hasError) {
    return null;
  }

  return (
    <View
      ref={containerRef}
      collapsable={false}
      onLayout={measureVisibility}
      style={[
        styles.container,
        isLoaded ? styles.containerVisible : styles.containerPlaceholder,
        isLoaded && { borderColor: theme.border || '#27272a' },
        style,
      ]}>
      {isVisible ? (
        <>
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
              recordEvent('ad_loaded');
            }}
            onAdFailedToLoad={(error) => {
              console.log('[AdBanner] Ad failed to load:', error);
              setHasError(true);
              setIsLoaded(false);
              recordEvent(
                'ad_failed',
                String((error as { code?: string | number; message?: string })?.code ?? error)
              );
            }}
          />
        </>
      ) : null}
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
  containerPlaceholder: {
    marginVertical: 10,
    minHeight: 56,
    borderWidth: 0,
    backgroundColor: 'transparent',
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
