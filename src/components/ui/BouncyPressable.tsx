import React, { useMemo } from 'react';
import {
  Animated,
  Pressable,
  PressableProps,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { useStore } from '../../store/useStore';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface BouncyPressableProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle> | ((state: { pressed: boolean }) => StyleProp<ViewStyle>);
  activeScale?: number;
  tension?: number;
  friction?: number;
  children: React.ReactNode | ((state: { pressed: boolean }) => React.ReactNode);
}

/**
 * Organik yay fizikli (spring physics) mikro-etkileşimli dokunma bileşeni.
 * Tuşa basıldığında yumuşakça küçülür, bırakıldığında tatlı bir esneme ile orijinal boyutuna döner.
 * preferences.reduceMotion aktifse yay animasyonunu otomatik olarak atlar.
 */
export function BouncyPressable({
  style,
  activeScale = 0.92,
  tension = 180,
  friction = 12,
  disabled,
  onPressIn,
  onPressOut,
  children,
  ...rest
}: BouncyPressableProps) {
  const reduceMotion = useStore((s) => s.preferences.reduceMotion);
  const scaleAnim = useMemo(() => new Animated.Value(1), []);

  const handlePressIn = (e: any) => {
    if (!reduceMotion && !disabled) {
      Animated.spring(scaleAnim, {
        toValue: activeScale,
        useNativeDriver: true,
        tension,
        friction,
      }).start();
    }
    onPressIn?.(e);
  };

  const handlePressOut = (e: any) => {
    if (!reduceMotion && !disabled) {
      Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension,
        friction,
      }).start();
    }
    onPressOut?.(e);
  };

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={(state) => {
        const resolvedStyle = typeof style === 'function' ? style(state) : style;
        return [
          resolvedStyle,
          !reduceMotion && {
            transform: [{ scale: scaleAnim }],
          },
        ];
      }}>
      {typeof children === 'function' ? (state) => children(state) : children}
    </AnimatedPressable>
  );
}
