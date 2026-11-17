import React, { useCallback, useState } from 'react';
import {
  Animated,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

/**
 * Dokunma geri bildirimi olan buton (RN `TouchableOpacity` yerine).
 *
 * NEDEN: uygulamada butonlar yalnızca `activeOpacity` ile tepki veriyordu; bu
 * da koyu arayüzde neredeyse fark edilmiyordu. Burada ek olarak **hafif küçülme**
 * uygulanır: basıldığı anda buton %3 kadar küçülür, bırakınca yumuşakça eski
 * hâline döner. Tepki kasıtlı olarak küçük tutulur (abartılı zıplama yok),
 * ama dokunuşun algılandığı net biçimde görülür.
 *
 * Kullanım: RN `TouchableOpacity` ile aynı API. `activeOpacity` korunur,
 * `pressScale` ile küçülme oranı değiştirilebilir.
 *
 * NOT: ölçek `useNativeDriver` ile çalışır; gölge/elevation animasyonu yok.
 */
export interface TouchableOpacityProps extends Omit<PressableProps, 'style'> {
  /** Basılıyken opaklık (RN varsayılanı gibi). */
  activeOpacity?: number;
  /**
   * Basılıyken ölçek (1 = küçülme yok). Verilmezse `activeOpacity` 1 olan
   * (ör. tam ekran arka plan) butonlarda küçülme uygulanmaz.
   */
  pressScale?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const PRESS_IN_MS = 90;
const PRESS_OUT_MS = 160;

export function TouchableOpacity({
  activeOpacity = 0.85,
  pressScale,
  style,
  onPressIn,
  onPressOut,
  disabled,
  children,
  ...rest
}: TouchableOpacityProps) {
  // `useState` ile tutulur: Animated.Value örneği render'lar arasında sabit
  // kalır, `useRef().current` erişimi ise render sırasında okunmuş sayılıyor.
  const [scale] = useState(() => new Animated.Value(1));
  const [opacity] = useState(() => new Animated.Value(1));

  // Arka plan katmanları (activeOpacity=1) küçülmemeli; onlarda yalnızca
  // opaklık sabit kalır, dokunuş yine algılanır.
  const scaleOnPress = pressScale ?? (activeOpacity >= 1 ? 1 : 0.97);

  const animate = useCallback(
    (toScale: number, toOpacity: number, duration: number) => {
      Animated.parallel([
        Animated.timing(scale, { toValue: toScale, duration, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: toOpacity, duration, useNativeDriver: true }),
      ]).start();
    },
    [opacity, scale]
  );

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(event) => {
        animate(scaleOnPress, activeOpacity, PRESS_IN_MS);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        animate(1, 1, PRESS_OUT_MS);
        onPressOut?.(event);
      }}
      style={[style, { opacity, transform: [{ scale }] }]}>
      {children}
    </AnimatedPressable>
  );
}
