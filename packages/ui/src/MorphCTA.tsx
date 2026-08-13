import React, { useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { springs, radii, fonts, fontSizes } from '@eyego/config';
import { Pressable } from './Pressable';
import { Text } from './Text';
import { GradientGlowBorder, RING_PALETTES } from './effects/GradientGlowBorder';
import { useThemedColors } from './ColorsContext';

/**
 * THE CTA THAT DOES NOT GET REPLACED.
 *
 * A normal implementation swaps the button for a spinner: `{loading ? <Loader/>
 * : <Button/>}`. Two components, two mounts, and the moment the rider commits
 * to a ride — the single most important beat in the flow — the thing they just
 * pressed vanishes and something else appears in its place. It reads as the app
 * losing its train of thought.
 *
 * Here the button IS the spinner. One node, one identity: the full-width pill
 * contracts to a 56 pt circle while the label fades out under it and the ring
 * fades in, then expands back when the wait ends. Because the resting shape is
 * a pill, its corner radius already equals half its height — so the circle
 * needs no radius animation at all, only width. The shape change is one number.
 *
 * ── WHY `width` IS ACCEPTABLE HERE ──────────────────────────────────────────
 *
 * The sheet above deliberately avoids animating layout props, because doing so
 * on a large subtree costs a Yoga pass per frame. This is the opposite case: a
 * leaf node with two absolutely-positioned children. Nothing re-flows when it
 * narrows, so the layout pass is over a subtree of size one. Using `scaleX`
 * instead would be cheaper still, and wrong — it would squash the label and the
 * ring into ellipses on the way through.
 */

export interface MorphCTAProps {
  label: string;
  onPress?: () => void;
  /** Contract to the loading bubble. */
  loading?: boolean;
  disabled?: boolean;
  /** Fill colour. Defaults to the theme primary. */
  color?: string;
  /** Label / ring colour. Defaults to the theme on-primary. */
  onColor?: string;
  style?: StyleProp<ViewStyle>;
  height?: number;
  /**
   * Wrap the fill in the animated ring the flow's hero CTAs wear.
   *
   * It contracts with the button, because the ring is drawn to the shape's own
   * bounds rather than to a fixed width — so the pill's sweep becomes the
   * loader's halo rather than disappearing at the moment the rider is waiting
   * on something and most wants to see the app is alive.
   */
  glow?: boolean;
  /** `glow` only — which ring sweep. Carries the tier the rider just picked. */
  palette?: keyof typeof RING_PALETTES;
  accessibilityLabel?: string;
  /** Announced while contracted, so the state change is not visual-only. */
  loadingLabel?: string;
  testID?: string;
}

export function MorphCTA({
  label,
  onPress,
  loading = false,
  disabled = false,
  color,
  onColor,
  style,
  height = 56,
  glow = false,
  palette,
  accessibilityLabel,
  loadingLabel = 'Working',
  testID,
}: MorphCTAProps) {
  const colors = useThemedColors();
  const fill = color ?? colors.primary;
  const ink = onColor ?? colors.onPrimary;

  /**
   * The resting width, measured rather than assumed. The CTA sits inside sheet
   * padding that differs per stage, so a hard-coded width would leave a visible
   * gap on one screen and overflow on another.
   */
  const [fullWidth, setFullWidth] = useState(0);
  const onMeasure = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    setFullWidth((prev) => (prev !== w ? w : prev));
  };

  const width = useSharedValue(0);
  const label01 = useSharedValue(1);
  const spin = useSharedValue(0);

  useEffect(() => {
    // Before the first measurement there is no honest target to spring toward;
    // springing from 0 to a width we are about to correct produces a visible
    // stretch on mount.
    if (fullWidth <= 0) return;
    const target = loading ? height : fullWidth;
    if (width.value === 0) {
      width.value = target;
      label01.value = loading ? 0 : 1;
      return;
    }
    width.value = withSpring(target, springs.morph);
    // The label leaves faster than the shape moves. Text that is still legible
    // while the pill is halfway to a circle looks squeezed; gone by a third of
    // the way through, it looks like it dissolved into the ring.
    label01.value = withTiming(loading ? 0 : 1, { duration: loading ? 140 : 220 });
  }, [loading, fullWidth, height, width, label01]);

  useEffect(() => {
    if (loading) {
      spin.value = 0;
      spin.value = withRepeat(
        withTiming(360, { duration: 900, easing: Easing.linear }),
        -1,
        false,
      );
    } else {
      cancelAnimation(spin);
      spin.value = 0;
    }
    return () => cancelAnimation(spin);
  }, [loading, spin]);

  const shapeStyle = useAnimatedStyle(() => ({
    width: width.value === 0 ? undefined : width.value,
  }));

  const labelStyle = useAnimatedStyle(() => ({
    opacity: label01.value,
    // A hair of scale so the text reads as being absorbed rather than switched
    // off. Kept tiny — anything larger competes with the shape change.
    transform: [{ scale: 0.94 + label01.value * 0.06 }],
  }));

  const ringStyle = useAnimatedStyle(() => ({
    opacity: 1 - label01.value,
    transform: [{ rotate: `${spin.value}deg` }],
  }));

  const ringSize = Math.round(height * 0.4);

  return (
    /* The outer view holds the resting width; the animated child is what
       narrows. Measuring the animated node itself would feed its own animation
       back into the measurement. */
    <View style={[styles.track, style]} onLayout={onMeasure} pointerEvents="box-none">
      <Animated.View style={shapeStyle}>
        <Pressable
          onPress={loading ? undefined : onPress}
          disabled={disabled || loading}
          accessibilityRole="button"
          accessibilityLabel={loading ? loadingLabel : accessibilityLabel ?? label}
          accessibilityState={{ disabled: disabled || loading, busy: loading }}
          testID={testID}
          style={[
            styles.pill,
            {
              height,
              borderRadius: height / 2,
              // The ring owns the fill when it is present — painting a solid
              // colour underneath it would sit on top of the punched centre
              // and hide the sweep entirely.
              backgroundColor: glow ? 'transparent' : fill,
              opacity: disabled && !loading ? 0.5 : 1,
              shadowColor: fill,
              shadowOpacity: glow ? 0 : 0.35,
            },
          ]}
        >
          {glow && (
            <GradientGlowBorder
              style={StyleSheet.absoluteFill}
              fillColor={fill}
              borderRadius={height / 2}
              palette={palette}
              thickness="thin"
              glow
              glowIntensity={0.6}
            />
          )}
          <Animated.View style={[styles.layer, labelStyle]} pointerEvents="none">
            <Text
              numberOfLines={1}
              style={[styles.label, { color: ink }]}
            >
              {label}
            </Text>
          </Animated.View>

          {/* A bordered circle with one transparent quadrant, rotated. No SVG,
              no Skia canvas, no extra native view — a spinner should not cost
              more than the thing it is waiting on. */}
          <Animated.View style={[styles.layer, ringStyle]} pointerEvents="none">
            <View
              style={{
                width: ringSize,
                height: ringSize,
                borderRadius: ringSize / 2,
                borderWidth: 2.5,
                borderColor: ink,
                borderTopColor: 'transparent',
              }}
            />
          </Animated.View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { width: '100%', alignItems: 'center' },
  pill: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
    borderRadius: radii.full,
  },
  layer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.titleMedium,
    lineHeight: Math.round(fontSizes.titleMedium * 1.3),
    letterSpacing: -0.2,
  },
});
