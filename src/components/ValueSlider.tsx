/* eslint-disable react-hooks/refs -- Refs below are only read inside PanResponder event callbacks. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

const THUMB_SIZE = 20;
const TRACK_HEIGHT = 4;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function quantize(value: number, min: number, max: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return clamp(value, min, max);
  const steps = Math.round((value - min) / step);
  const quantized = min + steps * step;
  return clamp(Math.round(quantized * 1000) / 1000, min, max);
}

export interface ValueSliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  accentColor: string;
  trackColor?: string;
  style?: StyleProp<ViewStyle>;
  onChange: (value: number) => void;
  /** Kaydırma bittiğinde (veya erişilebilirlik adımında) son değeri bildirir. */
  onSlidingComplete?: (value: number) => void;
}

/**
 * Bağımlılıksız, PanResponder tabanlı yatay değer kaydırıcısı.
 *
 * Uzun bir kaydırma sırasında bile dışarıya yalnızca `step` katları gönderilir.
 * Erişilebilirlik için artır/azalt eylemleri de desteklenir.
 */
export function ValueSlider({
  value,
  min,
  max,
  step = 0.5,
  disabled = false,
  accentColor,
  trackColor = '#3f3f46',
  style,
  onChange,
  onSlidingComplete,
}: ValueSliderProps) {
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const valueRef = useRef(value);
  const configRef = useRef({ min, max, step, disabled });
  const onChangeRef = useRef(onChange);
  const onSlidingCompleteRef = useRef(onSlidingComplete);

  useEffect(() => {
    valueRef.current = value;
    configRef.current = { min, max, step, disabled };
    onChangeRef.current = onChange;
    onSlidingCompleteRef.current = onSlidingComplete;
  }, [value, min, max, step, disabled, onChange, onSlidingComplete]);

  const updateFromX = useCallback((x: number) => {
    const currentWidth = widthRef.current;
    const config = configRef.current;
    if (config.disabled || currentWidth <= THUMB_SIZE) return;

    const ratio = clamp((x - THUMB_SIZE / 2) / (currentWidth - THUMB_SIZE), 0, 1);
    const raw = config.min + ratio * (config.max - config.min);
    const next = quantize(raw, config.min, config.max, config.step);
    if (Math.abs(next - valueRef.current) < 0.0001) return;
    valueRef.current = next;
    onChangeRef.current(next);
  }, []);

  const finish = useCallback(() => {
    if (configRef.current.disabled) return;
    onSlidingCompleteRef.current?.(valueRef.current);
  }, []);

  const adjust = useCallback(
    (direction: 1 | -1) => {
      const config = configRef.current;
      if (config.disabled) return;
      const next = quantize(
        valueRef.current + direction * config.step,
        config.min,
        config.max,
        config.step
      );
      if (Math.abs(next - valueRef.current) < 0.0001) return;
      valueRef.current = next;
      onChangeRef.current(next);
      // Erişilebilirlikte her adım ayrı bir tamamlanmış değişikliktir.
      onSlidingCompleteRef.current?.(next);
    },
    []
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !configRef.current.disabled,
        onMoveShouldSetPanResponder: () => !configRef.current.disabled,
        onPanResponderGrant: (event) => {
          updateFromX(event.nativeEvent.locationX);
        },
        onPanResponderMove: (event) => {
          updateFromX(event.nativeEvent.locationX);
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: finish,
        onPanResponderTerminate: finish,
      }),
    [finish, updateFromX]
  );

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    if (!Number.isFinite(nextWidth)) return;
    widthRef.current = nextWidth;
    setWidth(nextWidth);
  }, []);

  const range = max - min;
  const ratio = range > 0 ? clamp((value - min) / range, 0, 1) : 0;
  const travel = Math.max(0, width - THUMB_SIZE);
  const thumbLeft = ratio * travel;

  return (
    <View
      style={[styles.container, disabled && styles.disabled, style]}
      onLayout={onLayout}
      accessible
      accessibilityRole="adjustable"
      accessibilityState={{ disabled }}
      accessibilityValue={{
        min,
        max,
        now: value,
        text: `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`,
      }}
      accessibilityActions={[
        { name: 'increment', label: 'Increase' },
        { name: 'decrement', label: 'Decrease' },
      ]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'increment') adjust(1);
        else if (event.nativeEvent.actionName === 'decrement') adjust(-1);
      }}
      {...panResponder.panHandlers}>
      <View style={[styles.track, { backgroundColor: trackColor }]} />
      <View
        style={[
          styles.fill,
          {
            backgroundColor: disabled ? trackColor : accentColor,
            width: width > 0 ? thumbLeft + THUMB_SIZE / 2 : 0,
          },
        ]}
      />
      <View
        style={[
          styles.thumb,
          {
            backgroundColor: disabled ? '#52525b' : accentColor,
            left: thumbLeft,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 32,
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.45,
  },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    top: (32 - TRACK_HEIGHT) / 2,
  },
  fill: {
    position: 'absolute',
    left: 0,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    top: (32 - TRACK_HEIGHT) / 2,
  },
  thumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    top: (32 - THUMB_SIZE) / 2,
    borderWidth: 2,
    borderColor: '#ffffff',
  },
});
