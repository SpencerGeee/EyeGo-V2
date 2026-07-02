import React, { forwardRef, useImperativeHandle, useState } from 'react';
import { View, StyleSheet, type ViewStyle, type StyleProp, type LayoutChangeEvent } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useAmbientRotation } from './useAmbientRotation';
import { usePerformanceTier } from './usePerformanceTier';

export interface GradientGlowBorderHandle {
  /** Speeds the ring up and flashes it bright — the RN equivalent of the
   * web sample's hover/focus reaction. Call on press/focus. */
  burst: () => void;
}

interface GradientGlowBorderProps {
  /** Gradient stops sweeping the ring. Pass a mostly-dark array with 1-2
   * bright accent stops (see PREMIUM_RING_COLORS) to get a thin orbiting
   * light streak instead of a flat half-and-half color wash. */
  colors: readonly [string, string, ...string[]];
  /** Stop positions (0-1) matching `colors`, e.g. PREMIUM_RING_LOCATIONS.
   * Omit for an even spread. */
  locations?: readonly [number, number, ...number[]];
  /** Solid color that fills the center, punching the "hole" so only a thin ring shows. */
  fillColor: string;
  borderRadius: number;
  thickness?: 'thin' | 'regular';
  glow?: boolean;
  glowColor?: string;
  /** Second glow tint layered behind the first for a two-tone bloom
   * (e.g. blue + orange). Omit for a single-color glow. */
  glowColorSecondary?: string;
  /** Low-perf-tier escape hatch: renders a static ring, no rotation/burst. */
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

const THICKNESS = { thin: 1.5, regular: 2.5 };

/** Default "premium" ring sweep — two narrow bright arcs (blue, orange)
 * orbiting against a near-black ring, matching the reference conic-gradient
 * technique (color arcs, not a flat-filled ring). Use with
 * PREMIUM_RING_LOCATIONS. */
export const PREMIUM_RING_COLORS = [
  '#0A0A0C', '#0A0A0C', '#3D7EFF', '#0A0A0C', '#0A0A0C',
  '#0A0A0C', '#FF7A3D', '#0A0A0C', '#0A0A0C',
] as const;
export const PREMIUM_RING_LOCATIONS = [0, 0.08, 0.22, 0.36, 0.5, 0.58, 0.72, 0.86, 1] as const;

export const GradientGlowBorder = forwardRef<GradientGlowBorderHandle, GradientGlowBorderProps>(
  function GradientGlowBorder(
    {
      colors,
      locations,
      fillColor,
      borderRadius,
      thickness = 'regular',
      glow = false,
      glowColor,
      glowColorSecondary,
      disabled,
      style,
      children,
    },
    ref
  ) {
    const tier = usePerformanceTier();
    // Low-tier devices default to a static ring (no continuous rotation)
    // unless the caller explicitly opts in/out via `disabled`.
    const isDisabled = disabled ?? tier === 'low';
    const [size, setSize] = useState({ width: 0, height: 0 });
    const ambient = useAmbientRotation();
    const burstOffset = useSharedValue(0);
    const flash = useSharedValue(0);
    const ringThickness = THICKNESS[thickness];

    useImperativeHandle(
      ref,
      () => ({
        burst: () => {
          if (isDisabled) return;
          burstOffset.value = withSequence(
            withTiming(140, { duration: 260, easing: Easing.out(Easing.cubic) }),
            withTiming(0, { duration: 600, easing: Easing.out(Easing.cubic) })
          );
          flash.value = withSequence(
            withTiming(0.9, { duration: 120 }),
            withTiming(0, { duration: 400 })
          );
        },
      }),
      [burstOffset, flash, isDisabled]
    );

    const rotatingStyle = useAnimatedStyle(() => ({
      transform: [{ rotate: `${ambient.value + burstOffset.value}deg` }],
    }));

    const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));

    const handleLayout = (e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      if (width !== size.width || height !== size.height) {
        setSize({ width, height });
      }
    };

    const diag = size.width && size.height
      ? Math.sqrt(size.width ** 2 + size.height ** 2) * 2.2
      : 0;
    const sweepStyle = {
      position: 'absolute' as const,
      width: diag,
      height: diag,
      top: (size.height - diag) / 2,
      left: (size.width - diag) / 2,
    };
    const innerRadius = Math.max(borderRadius - ringThickness, 0);

    return (
      // Outer wrapper is intentionally un-clipped: an iOS shadow placed
      // inside an overflow:'hidden' parent gets clipped to invisible, so the
      // glow lives here as a sibling of the masked ring container below,
      // sized to match it via StyleSheet.absoluteFillObject.
      <View>
        {glow && diag > 0 && (
          <>
            <View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFillObject,
                {
                  borderRadius,
                  // Android elevation only casts a shadow off an opaque
                  // silhouette; fully covered by the masked view on top so
                  // this never shows through visually.
                  backgroundColor: fillColor,
                  shadowColor: glowColor ?? colors[colors.length - 1],
                  shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: 0.32,
                  shadowRadius: 14,
                  elevation: 10,
                },
              ]}
            />
            {glowColorSecondary && (
              <View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFillObject,
                  {
                    borderRadius,
                    backgroundColor: fillColor,
                    shadowColor: glowColorSecondary,
                    shadowOffset: { width: 0, height: 0 },
                    shadowOpacity: 0.26,
                    shadowRadius: 20,
                    elevation: 10,
                  },
                ]}
              />
            )}
          </>
        )}

        <View
          style={[{ borderRadius, overflow: 'hidden' }, style]}
          onLayout={handleLayout}
        >
        {diag > 0 && (
          <>
            <Animated.View
              pointerEvents="none"
              style={[sweepStyle, isDisabled ? undefined : rotatingStyle]}
            >
              <LinearGradient
                colors={colors}
                locations={locations}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFillObject}
              />
            </Animated.View>

            {!isDisabled && (
              <Animated.View
                pointerEvents="none"
                style={[sweepStyle, { backgroundColor: '#FFFFFF' }, flashStyle]}
              />
            )}

            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: ringThickness,
                left: ringThickness,
                right: ringThickness,
                bottom: ringThickness,
                borderRadius: innerRadius,
                backgroundColor: fillColor,
              }}
            />
          </>
        )}

        {children}
        </View>
      </View>
    );
  }
);
