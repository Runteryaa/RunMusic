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
import { usePlayTracker } from '../hooks/usePlayTracker';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const MINI_HEIGHT = 62;
const MINI_BOTTOM = 55;
const MINI_RADIUS = 12;
const COLLAPSED_Y = SCREEN_HEIGHT - MINI_BOTTOM - MINI_HEIGHT;

export function ExpandingPlayer() {
  usePlayTracker();
  const activeTrack = useActiveTrack();
  const theme = useThemeStore((s) => s.theme);
  const isFullscreenPlayerOpen = usePlayerUIStore((s) => s.isFullscreenPlayerOpen);
  const reduceMotion = useStore((s) => s.preferences.reduceMotion);

  const expandVal = useSharedValue(0);
  const rnExpandAnim = useMemo(() => new RNAnimated.Value(0), []);

  // "Player açılınca sözleri göster" tercihi: yalnızca player AÇILIRKEN uygulanır
  useEffect(() => {
    if (
      isFullscreenPlayerOpen &&
      useStore.getState().preferences.openPlayerWithLyrics
    ) {
      usePlayerUIStore.getState().setLyricsMode(true);
    }
  }, [isFullscreenPlayerOpen]);

  useEffect(() => {
    const toValue = isFullscreenPlayerOpen ? 1 : 0;

    if (reduceMotion) {
      expandVal.value = toValue;
      rnExpandAnim.setValue(toValue);
      return;
    }

    expandVal.value = withSpring(toValue, {
      damping: 20,
      stiffness: 170,
      mass: 0.9,
      overshootClamping: false,
    });

    RNAnimated.spring(rnExpandAnim, {
      toValue,
      tension: 50,
      friction: 8,
      useNativeDriver: true,
    }).start();
  }, [isFullscreenPlayerOpen, expandVal, rnExpandAnim, reduceMotion]);

  // MiniPlayer: Altta sabit durur, açılırken hızlıca ve pürüzsüzce kaybolur
  const miniAnimatedStyle = useAnimatedStyle(() => {
    const opacity = interpolate(expandVal.value, [0, 0.12], [1, 0], Extrapolation.CLAMP);
    const translateY = interpolate(expandVal.value, [0, 0.12], [0, 6], Extrapolation.CLAMP);
    const scale = interpolate(expandVal.value, [0, 0.12], [1, 0.97], Extrapolation.CLAMP);

    return {
      opacity,
      transform: [{ translateY }, { scale }],
    };
  });

  // FullscreenPlayer: Tam ekran modal, miniplayer hizasından yukarı GPU transform (translateY) ile süzülür.
  // Layout reflow (height/bottom değişimi) olmadığı için 60-120 FPS pürüzsüz çalışır.
  const fullscreenAnimatedStyle = useAnimatedStyle(() => {
    const translateY = interpolate(
      expandVal.value,
      [0, 1],
      [COLLAPSED_Y, 0],
      Extrapolation.CLAMP
    );
    const scaleX = interpolate(
      expandVal.value,
      [0, 0.35, 1],
      [0.95, 0.985, 1],
      Extrapolation.CLAMP
    );
    const opacity = interpolate(
      expandVal.value,
      [0, 0.05, 1],
      [0, 1, 1],
      Extrapolation.CLAMP
    );
    const borderTopLeftRadius = interpolate(
      expandVal.value,
      [0, 0.6, 1],
      [MINI_RADIUS, 18, 0],
      Extrapolation.CLAMP
    );
    const borderTopRightRadius = interpolate(
      expandVal.value,
      [0, 0.6, 1],
      [MINI_RADIUS, 18, 0],
      Extrapolation.CLAMP
    );

    return {
      opacity,
      borderTopLeftRadius,
      borderTopRightRadius,
      transform: [{ translateY }, { scaleX }],
    };
  });

  if (!activeTrack) {
    return null;
  }

  return (
    <>
      {/* 1. MINIPLAYER CONTENT LAYER */}
      <Animated.View
        style={[
          styles.miniWrapper,
          miniAnimatedStyle,
        ]}
        pointerEvents={isFullscreenPlayerOpen ? 'none' : 'auto'}>
        <MiniPlayer />
      </Animated.View>

      {/* 2. FULLSCREEN PLAYER CONTENT LAYER (GPU Hızlandırmalı Sheet) */}
      <Animated.View
        style={[
          styles.fullscreenContainer,
          {
            borderColor: theme.border || 'rgba(255, 255, 255, 0.12)',
          },
          fullscreenAnimatedStyle,
        ]}
        pointerEvents={isFullscreenPlayerOpen ? 'auto' : 'none'}>
        <FullscreenPlayerModal expandAnim={rnExpandAnim} />
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  miniWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: MINI_BOTTOM,
    height: MINI_HEIGHT,
    zIndex: 9998,
  },
  fullscreenContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    height: SCREEN_HEIGHT,
    backgroundColor: '#18181b',
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 20,
    zIndex: 9999,
  },
});
