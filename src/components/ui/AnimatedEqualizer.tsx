import React, { useEffect, useMemo } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { useStore } from '../../store/useStore';

interface AnimatedEqualizerProps {
  isPlaying?: boolean;
  color: string;
  size?: number; // Yükseklik baz alınır (varsayılan: 14)
}

/**
 * Spotify / Apple Music tarzı ritmik hareket eden mini ekolayzer dalgaları.
 * GPU dostu olması için native driver ile scaleY dönüşümü kullanır.
 */
export function AnimatedEqualizer({ isPlaying = false, color, size = 14 }: AnimatedEqualizerProps) {
  const reduceMotion = useStore((s) => s.preferences.reduceMotion);

  const anim1 = useMemo(() => new Animated.Value(0.3), []);
  const anim2 = useMemo(() => new Animated.Value(0.6), []);
  const anim3 = useMemo(() => new Animated.Value(0.4), []);

  useEffect(() => {
    if (reduceMotion || !isPlaying) {
      // Duraklatıldığında veya hareketi azalt açıkken sakin dinlenme pozisyonuna geç
      Animated.parallel([
        Animated.timing(anim1, { toValue: 0.25, duration: 200, useNativeDriver: true }),
        Animated.timing(anim2, { toValue: 0.25, duration: 200, useNativeDriver: true }),
        Animated.timing(anim3, { toValue: 0.25, duration: 200, useNativeDriver: true }),
      ]).start();
      return;
    }

    // Farklı frekans ve hızlarda organik döngüler
    const loop1 = Animated.loop(
      Animated.sequence([
        Animated.timing(anim1, { toValue: 1.0, duration: 380, useNativeDriver: true }),
        Animated.timing(anim1, { toValue: 0.3, duration: 420, useNativeDriver: true }),
      ])
    );

    const loop2 = Animated.loop(
      Animated.sequence([
        Animated.timing(anim2, { toValue: 0.25, duration: 320, useNativeDriver: true }),
        Animated.timing(anim2, { toValue: 0.95, duration: 360, useNativeDriver: true }),
        Animated.timing(anim2, { toValue: 0.45, duration: 300, useNativeDriver: true }),
      ])
    );

    const loop3 = Animated.loop(
      Animated.sequence([
        Animated.timing(anim3, { toValue: 0.85, duration: 440, useNativeDriver: true }),
        Animated.timing(anim3, { toValue: 0.2, duration: 390, useNativeDriver: true }),
      ])
    );

    loop1.start();
    loop2.start();
    loop3.start();

    return () => {
      loop1.stop();
      loop2.stop();
      loop3.stop();
    };
  }, [isPlaying, reduceMotion, anim1, anim2, anim3]);

  const barWidth = Math.max(2.5, Math.round(size * 0.18));
  const barGap = Math.max(2, Math.round(size * 0.14));

  return (
    <View style={[styles.container, { height: size, width: barWidth * 3 + barGap * 2 }]}>
      <View style={styles.barWrapper}>
        <Animated.View
          style={[
            styles.bar,
            {
              backgroundColor: color,
              width: barWidth,
              height: size,
              transform: [{ scaleY: anim1 }],
            },
          ]}
        />
      </View>
      <View style={[styles.barWrapper, { marginHorizontal: barGap }]}>
        <Animated.View
          style={[
            styles.bar,
            {
              backgroundColor: color,
              width: barWidth,
              height: size,
              transform: [{ scaleY: anim2 }],
            },
          ]}
        />
      </View>
      <View style={styles.barWrapper}>
        <Animated.View
          style={[
            styles.bar,
            {
              backgroundColor: color,
              width: barWidth,
              height: size,
              transform: [{ scaleY: anim3 }],
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  barWrapper: {
    height: '100%',
    justifyContent: 'flex-end',
  },
  bar: {
    borderRadius: 2,
    transformOrigin: 'bottom',
  },
});
