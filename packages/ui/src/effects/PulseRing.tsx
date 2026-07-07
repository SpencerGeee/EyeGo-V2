import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';

/**
 * Radar pulse — 2-3 staggered rings expanding and fading from a center
 * point (the Uber/Yango "searching / waiting at pickup" treatment).
 * Pure UI-thread Reanimated loop; renders nothing at the center so it can
 * wrap or sit behind an existing pin.
 */
export interface PulseRingProps {
  /** Diameter the rings expand to. */
  size?: number;
  color?: string;
  ringCount?: number;
  /** One full expand+fade cycle per ring, ms. */
  duration?: number;
  children?: React.ReactNode;
}

function Ring({ size, color, delay, duration }: { size: number; color: string; delay: number; duration: number }) {
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration, easing: Easing.out(Easing.quad) }), -1, false));
    return () => cancelAnimation(t);
  }, [t, delay, duration]);

  const style = useAnimatedStyle(() => ({
    opacity: (1 - t.value) * 0.55,
    transform: [{ scale: 0.25 + t.value * 0.75 }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ring,
        { width: size, height: size, borderRadius: size / 2, borderColor: color, backgroundColor: color + '14' },
        style,
      ]}
    />
  );
}

export function PulseRing({ size = 120, color = '#4be277', ringCount = 3, duration = 2200, children }: PulseRingProps) {
  return (
    <View style={[styles.wrap, { width: size, height: size }]} pointerEvents="box-none">
      {Array.from({ length: ringCount }).map((_, i) => (
        <Ring key={i} size={size} color={color} delay={(duration / ringCount) * i} duration={duration} />
      ))}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    borderWidth: 1.5,
  },
});
