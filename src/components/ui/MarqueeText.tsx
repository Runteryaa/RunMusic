import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, StyleProp, TextStyle, ViewStyle, ScrollView } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  Easing,
  cancelAnimation,
  withDelay,
  withSequence,
} from 'react-native-reanimated';

interface MarqueeTextProps {
  text: string;
  style?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  duration?: number;
  gap?: number;
}

export const MarqueeText: React.FC<MarqueeTextProps> = ({
  text,
  style,
  containerStyle,
  duration = 50, // ms per pixel
  gap = 30,
}) => {
  const [containerWidth, setContainerWidth] = useState(0);
  const [textWidth, setTextWidth] = useState(0);

  const translateX = useSharedValue(0);

  const shouldAnimate = textWidth > containerWidth && containerWidth > 0;

  useEffect(() => {
    if (shouldAnimate) {
      const distance = textWidth + gap;
      const totalDuration = distance * duration;

      translateX.value = 0;

      translateX.value = withRepeat(
        withSequence(
          withDelay(1500, withTiming(-distance, { duration: totalDuration, easing: Easing.linear }))
        ),
        -1, // Infinite
        false // Do not reverse
      );
    } else {
      cancelAnimation(translateX);
      translateX.value = 0;
    }

    return () => cancelAnimation(translateX);
  }, [shouldAnimate, textWidth, containerWidth, gap, duration, text, translateX]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    flexDirection: 'row',
  }));

  return (
    <View
      style={[styles.container, containerStyle]}
      onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
      pointerEvents="none"
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEnabled={false}
        bounces={false}
        contentContainerStyle={{ flexGrow: 1 }}
      >
        <Animated.View style={animatedStyle}>
          <Text
            style={[style, { paddingRight: shouldAnimate ? gap : 0 }]}
            onLayout={(e) => setTextWidth(e.nativeEvent.layout.width)}
            numberOfLines={1}
          >
            {text}
          </Text>
          {shouldAnimate && (
            <Text numberOfLines={1} style={style}>
              {text}
            </Text>
          )}
        </Animated.View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    width: '100%',
  },
});
