import React, { useEffect, useMemo } from 'react';
import { StyleSheet, Dimensions, Animated as RNAnimated } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { useActiveTrack } from 'react-native-track-player';
import { usePlayerUIStore } from '../store/usePlayerUIStore';
import { useStore } from '../store/useStore';
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

  const expandVal = useSharedValue(0);
  const rnExpandAnim = useMemo(() => new RNAnimated.Value(0), []);

  // "Player açılınca sözleri göster" tercihi: yalnızca player AÇILIRKEN uygulanır,
  // kullanıcı sonradan sözleri kapatırsa tekrar zorlanmaz.
  useEffect(() => {
    if (
      isFullscreenPlayerOpen &&
      useStore.getState().preferences.openPlayerWithLyrics
    ) {
      usePlayerUIStore.getState().setLyricsMode(true);
    }
  }, [isFullscreenPlayerOpen]);

  useEffect(() => {
    if (isFullscreenPlayerOpen) {
      expandVal.value = withSpring(1, {
        damping: 26,
        mass: 0.9,
        stiffness: 240,
      });
      RNAnimated.spring(rnExpandAnim, {
        toValue: 1,
        damping: 26,
        mass: 0.9,
        stiffness: 240,
        useNativeDriver: true, // We can now use native driver for opacity inside Fullscreen
      }).start();
    } else {
      expandVal.value = withSpring(0, {
        damping: 26,
        mass: 0.9,
        stiffness: 260,
      });
      RNAnimated.spring(rnExpandAnim, {
        toValue: 0,
        damping: 26,
        mass: 0.9,
        stiffness: 260,
        useNativeDriver: true,
      }).start();
    }
  }, [isFullscreenPlayerOpen, expandVal, rnExpandAnim]);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      bottom: interpolate(expandVal.value, [0, 1], [MINI_BOTTOM, 0]),
      marginHorizontal: interpolate(expandVal.value, [0, 0.7, 1], [MINI_MARGIN, 3, 0]),
      height: interpolate(expandVal.value, [0, 1], [MINI_HEIGHT, SCREEN_HEIGHT]),
      borderTopLeftRadius: interpolate(expandVal.value, [0, 0.45, 1], [MINI_RADIUS, 18, 0]),
      borderTopRightRadius: interpolate(expandVal.value, [0, 0.45, 1], [MINI_RADIUS, 18, 0]),
      borderTopWidth: interpolate(expandVal.value, [0, 0.75, 1], [1, 0.5, 0]),
      borderLeftWidth: interpolate(expandVal.value, [0, 0.75, 1], [1, 0.5, 0]),
      borderRightWidth: interpolate(expandVal.value, [0, 0.75, 1], [1, 0.5, 0]),
    };
  });

  const miniStyle = useAnimatedStyle(() => {
    return {
      opacity: interpolate(expandVal.value, [0, 0.16], [1, 0], Extrapolation.CLAMP),
    };
  });

  const fullStyle = useAnimatedStyle(() => {
    return {
      opacity: interpolate(expandVal.value, [0.12, 0.45], [0, 1], Extrapolation.CLAMP),
    };
  });

  if (!activeTrack) {
    return null;
  }

  return (
    <Animated.View
      style={[
        styles.expandingCard,
        {
          borderColor: theme.border || 'rgba(255, 255, 255, 0.12)',
          borderBottomWidth: 0,
        },
        animatedStyle,
      ]}
      pointerEvents="box-none">
      {/* 1. MINIPLAYER CONTENT LAYER */}
      <Animated.View
        style={[styles.miniContentLayer, miniStyle]}
        pointerEvents={isFullscreenPlayerOpen ? 'none' : 'auto'}>
        <MiniPlayer isEmbedded />
      </Animated.View>

      {/* 2. FULLSCREEN PLAYER CONTENT LAYER */}
      <Animated.View
        style={[styles.fullscreenContentLayer, fullStyle]}
        pointerEvents={isFullscreenPlayerOpen ? 'auto' : 'none'}>
        <FullscreenPlayerModal expandAnim={rnExpandAnim} />
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
