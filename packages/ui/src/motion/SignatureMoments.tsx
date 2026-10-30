import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { durations } from '@eyego/config';
import { useLoopsActive } from '../effects/useLoopsActive';

/**
 * SIGNATURE MOMENTS (spec v2 §7: "small, one at a time").
 *
 * Yango/Uber/Bolt ship these as Lottie files. Ours are plain Reanimated views —
 * no asset pipeline, no Skia canvas (never stack canvases on the trip sheet),
 * and the colour follows the theme. The searching radar already exists
 * (SearchingIndicator); these are the other two:
 *
 *   Celebrate   — one burst when the bus is found / the seat is booked
 *   WalkDots    — the walk to the stop, a light travelling along a dotted path
 */

const SPARKS = 12;

function Spark({ i, t, color }: { i: number; t: SharedValue<number>; color: string }) {
  const angle = (i / SPARKS) * Math.PI * 2;
  const reach = i % 2 === 0 ? 46 : 34;
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.15, 1], [0, 1, 0]),
    transform: [
      { translateX: Math.cos(angle) * reach * t.value },
      { translateY: Math.sin(angle) * reach * t.value },
      { scale: interpolate(t.value, [0, 1], [1, 0.4]) },
    ],
  }));
  return <Animated.View style={[styles.spark, { backgroundColor: color }, style]} />;
}

/**
 * One burst, then gone. Mount it with a `key` that changes only when there is
 * something to celebrate (e.g. the trip id), and it plays exactly once.
 */
export function Celebrate({ color, size = 96 }: { color: string; size?: number }) {
  const reduce = useReducedMotion();
  const t = useSharedValue(0);
  const ring = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    ring.value = withTiming(1, { duration: durations.slowest, easing: Easing.out(Easing.cubic) });
    t.value = withDelay(60, withTiming(1, { duration: durations.slowest + 200, easing: Easing.out(Easing.quad) }));
    return () => {
      cancelAnimation(t);
      cancelAnimation(ring);
    };
  }, [reduce, t, ring]);
  const ringStyle = useAnimatedStyle(() => ({
    opacity: interpolate(ring.value, [0, 0.2, 1], [0, 0.5, 0]),
    transform: [{ scale: interpolate(ring.value, [0, 1], [0.3, 1.4]) }],
  }));
  if (reduce) return null;
  return (
    <View pointerEvents="none" style={[styles.burst, { width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2 }]}>
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: size / 2, borderWidth: 2, borderColor: color }, ringStyle]} />
      {Array.from({ length: SPARKS }, (_, i) => (
        <Spark key={i} i={i} t={t} color={color} />
      ))}
    </View>
  );
}

const DOTS = 7;

function WalkDot({ i, t, color }: { i: number; t: SharedValue<number>; color: string }) {
  const style = useAnimatedStyle(() => {
    // The light sits at t·(DOTS-1); each dot glows as it passes.
    const d = Math.abs(t.value * (DOTS - 1) - i);
    return { opacity: interpolate(d, [0, 1.2], [1, 0.25], 'clamp'), transform: [{ scale: interpolate(d, [0, 1.2], [1.35, 1], 'clamp') }] };
  });
  return <Animated.View style={[styles.walkDot, { backgroundColor: color }, style]} />;
}

/** The walk to the stop: a light walking along a dotted path. Pauses in the background. */
export function WalkDots({ color }: { color: string }) {
  const active = useLoopsActive({ decorative: true });
  const reduce = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (!active || reduce) return;
    t.value = 0;
    t.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.quad) }), -1, false);
    return () => cancelAnimation(t);
  }, [active, reduce, t]);
  return (
    <View style={styles.walkRow} pointerEvents="none">
      {Array.from({ length: DOTS }, (_, i) => (
        <WalkDot key={i} i={i} t={t} color={color} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  burst: { position: 'absolute', left: '50%', top: '50%', alignItems: 'center', justifyContent: 'center' },
  spark: { position: 'absolute', width: 6, height: 6, borderRadius: 3 },
  walkRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  walkDot: { width: 5, height: 5, borderRadius: 2.5 },
});
