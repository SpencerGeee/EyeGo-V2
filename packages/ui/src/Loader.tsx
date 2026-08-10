import React, { useEffect, useMemo } from 'react';
import { View, StyleSheet, type ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  cancelAnimation,
  withRepeat,
  withTiming,
  interpolate,
  Extrapolation,
  Easing,
} from 'react-native-reanimated';
import { fonts, fontSizes } from '@eyego/config';
import { useThemedColors } from './ColorsContext';
import { Text } from './Text';

interface LoaderProps {
  /** Contextual label, e.g. "Finding your driver…" or "Processing payment…". */
  label?: string;
  size?: number;
  style?: ViewStyle;
  /** Override the stroke colour. Defaults to the theme's `onSurface`. */
  color?: string;
}

/**
 * The orbiting-square loader.
 *
 * Two hollow rounded squares walk the perimeter of a box, half a cycle apart.
 * At each corner the leading square stretches into a bar, reaches the next
 * corner, and contracts again — so the pair reads as one continuous figure
 * folding around itself rather than as two shapes chasing each other. It is
 * distinctive at a glance and, unlike a spinner, it is obvious which way time
 * is going.
 *
 * ── HOW THE MOTION IS EXPRESSED ──────────────────────────────────────────────
 * The original is a CSS keyframe set that animates `inset` through eight
 * positions. `inset` has a direct equivalent here — `top`/`right`/`bottom`/
 * `left` on an absolutely-positioned child — so the port is the same eight
 * keyframes interpolated on the UI thread, not an approximation with
 * transforms. That matters: the shape is drawn with a uniform 3 pt border, and
 * `scaleX`/`scaleY` would stretch that border along with the box, turning a
 * even outline into a lopsided one at every corner.
 *
 * Animating layout properties is normally the wrong instinct — see
 * SwipeToConfirm, where exactly that was the bug. It is fine here and only
 * here: both squares are absolutely positioned, so neither can trigger a
 * sibling's layout, and the whole figure is one small fixed-size box.
 *
 * ── WHY NOT THE OLD ARC ──────────────────────────────────────────────────────
 * A slim arc on a faint track is what every framework ships by default, which
 * is precisely the objection: it is the shape of "no one chose this". The
 * timing conventions it encoded are kept — one legible cycle, upright label,
 * accent used sparingly — the geometry is not.
 */
export function Loader({ label, size = 56, style, color }: LoaderProps) {
  const colors = useThemedColors();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: 2500, easing: Easing.linear }),
      -1,
      false,
    );
    // A loader is by definition unmounted the moment the thing it was waiting
    // for arrives; without this its infinite repeat kept running after.
    return () => {
      cancelAnimation(progress);
    };
  }, [progress]);

  /**
   * The eight keyframes, as inset fractions of the box.
   *
   * Read a column at a time: at t=0 the square sits top-left (`right` and
   * `bottom` are inset); by t=0.125 the `bottom` inset has gone, so it has
   * grown downward into a bar; by t=0.25 the `top` inset has come in and it is
   * a square again, now bottom-left. And so on, once around.
   */
  const frames = useMemo(() => {
    const I = size * (35 / 65); // the original's 35 in a 65 box
    return {
      stops: [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1],
      top: [0, 0, I, I, I, 0, 0, 0, 0],
      right: [I, I, I, 0, 0, 0, 0, 0, I],
      bottom: [I, 0, 0, 0, 0, 0, I, I, I],
      left: [0, 0, 0, 0, I, I, I, 0, 0],
    };
  }, [size]);

  const strokeColor = color ?? colors.onSurface;
  const borderWidth = Math.max(2, Math.round(size * (3 / 65)));

  // The second square is half a cycle behind the first, which is the whole
  // trick: the two are always on opposite sides, so the figure never collapses
  // into a single blob. Written out twice rather than through a factory — two
  // `useAnimatedStyle` calls have to be two unconditional hook calls.
  const spanA = useAnimatedStyle(() => {
    const t = progress.value % 1;
    return {
      top: interpolate(t, frames.stops, frames.top, Extrapolation.CLAMP),
      right: interpolate(t, frames.stops, frames.right, Extrapolation.CLAMP),
      bottom: interpolate(t, frames.stops, frames.bottom, Extrapolation.CLAMP),
      left: interpolate(t, frames.stops, frames.left, Extrapolation.CLAMP),
    };
  }, [frames]);

  const spanB = useAnimatedStyle(() => {
    const t = (progress.value + 0.5) % 1;
    return {
      top: interpolate(t, frames.stops, frames.top, Extrapolation.CLAMP),
      right: interpolate(t, frames.stops, frames.right, Extrapolation.CLAMP),
      bottom: interpolate(t, frames.stops, frames.bottom, Extrapolation.CLAMP),
      left: interpolate(t, frames.stops, frames.left, Extrapolation.CLAMP),
    };
  }, [frames]);

  const spanBase = {
    position: 'absolute' as const,
    borderWidth,
    borderColor: strokeColor,
    borderRadius: size / 2,
  };

  return (
    <View style={[styles.container, style]}>
      <View
        style={{ width: size, height: size }}
        accessibilityRole="progressbar"
        accessibilityLabel={label ?? 'Loading'}
      >
        <Animated.View style={[spanBase, spanA]} />
        <Animated.View style={[spanBase, spanB]} />
      </View>

      {!!label && (
        <Text
          variant="bodySmall"
          color={colors.onSurfaceVariant}
          style={styles.label}
          numberOfLines={2}
        >
          {label}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    marginTop: 16,
    textAlign: 'center',
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodySmall,
    lineHeight: Math.round(fontSizes.bodySmall * 1.3),
    // Slightly open, but nowhere near the letter-spaced caps this used to be —
    // a wait message is read, not displayed.
    letterSpacing: 0.1,
    maxWidth: 220,
  },
});
