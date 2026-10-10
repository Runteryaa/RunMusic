import React, { useMemo, useEffect } from 'react';
import {
  StyleSheet,
  Animated,
  Dimensions,
} from 'react-native';
import { useActiveTrack } from 'react-native-track-player';
import { usePlayerUIStore } from '../store/usePlayerUIStore';
import { useThemeStore } from '../store/useThemeStore';
import { MiniPlayer } from './MiniPlayer';
import { FullscreenPlayerModal } from './FullscreenPlayerModal';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const MINI_HEIGHT = 62;
const MINI_BOTTOM = 55;
const MINI_MARGIN = 10;
const MINI_RADIUS = 10;

export function ExpandingPlayer() {
  const activeTrack = useActiveTrack();
  const theme = useThemeStore((s) => s.theme);
  const isFullscreenPlayerOpen = usePlayerUIStore((s) => s.isFullscreenPlayerOpen);

  const expandAnim = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    if (isFullscreenPlayerOpen) {
      Animated.spring(expandAnim, {
        toValue: 1,
        damping: 26,
        mass: 0.9,
        stiffness: 240,
        useNativeDriver: false,
      }).start();
    } else {
      Animated.spring(expandAnim, {
        toValue: 0,
        damping: 26,
        mass: 0.9,
        stiffness: 260,
        useNativeDriver: false,
      }).start();
    }
  }, [isFullscreenPlayerOpen, expandAnim]);

  if (!activeTrack) {
    return null;
  }

  const containerBottom = expandAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [MINI_BOTTOM, 0],
  });

  const containerMarginHorizontal = expandAnim.interpolate({
    inputRange: [0, 0.7, 1],
    outputRange: [MINI_MARGIN, 3, 0],
  });

  const containerHeight = expandAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [MINI_HEIGHT, SCREEN_HEIGHT],
  });

  const containerRadius = expandAnim.interpolate({
    inputRange: [0, 0.45, 1],
    outputRange: [MINI_RADIUS, 18, 0],
  });

  const containerBorderWidth = expandAnim.interpolate({
    inputRange: [0, 0.75, 1],
    outputRange: [1, 0.5, 0],
  });

  const miniOpacity = expandAnim.interpolate({
    inputRange: [0, 0.16],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  const fullOpacity = expandAnim.interpolate({
    inputRange: [0.12, 0.45],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  return (
    <Animated.View
      style={[
        styles.expandingCard,
        {
          bottom: containerBottom,
          marginHorizontal: containerMarginHorizontal,
          height: containerHeight,
          borderTopLeftRadius: containerRadius,
          borderTopRightRadius: containerRadius,
          borderTopWidth: containerBorderWidth,
          borderLeftWidth: containerBorderWidth,
          borderRightWidth: containerBorderWidth,
          borderBottomWidth: 0,
          borderColor: theme.border || 'rgba(255, 255, 255, 0.12)',
        },
      ]}
      pointerEvents="box-none">
      {/* 1. MINIPLAYER CONTENT LAYER */}
      <Animated.View
        style={[
          styles.miniContentLayer,
          {
            opacity: miniOpacity,
          },
        ]}
        pointerEvents={isFullscreenPlayerOpen ? 'none' : 'auto'}>
        <MiniPlayer isEmbedded />
      </Animated.View>

      {/* 2. FULLSCREEN PLAYER CONTENT LAYER */}
      <Animated.View
        style={[
          styles.fullscreenContentLayer,
          {
            opacity: fullOpacity,
          },
        ]}
        pointerEvents={isFullscreenPlayerOpen ? 'auto' : 'none'}>
        <FullscreenPlayerModal expandAnim={expandAnim} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  expandingCard: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: '#18181b',
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 16,
    zIndex: 9999,
  },
  miniContentLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: MINI_HEIGHT,
  },
  fullscreenContentLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    height: SCREEN_HEIGHT,
  },
});
