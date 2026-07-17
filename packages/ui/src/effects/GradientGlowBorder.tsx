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
  /** Named preset that supplies colors/locations/glow tints in one go —
   * explicit `colors`/`locations`/`glowColor*` props override it. */
  palette?: 'default' | 'gold' | 'royal' | 'economy' | 'comfort' | 'driver' | 'green';
  /** Gradient stops sweeping the ring. Pass a mostly-dark array with 1-2
   * bright accent stops (see PREMIUM_RING_COLORS) to get a thin orbiting
   * light streak instead of a flat half-and-half color wash. */
  colors?: readonly [string, string, ...string[]];
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

const THICKNESS = { thin: 2, regular: 3 };

/** Default "premium" ring sweep — two narrow bright arcs (blue, orange),
 * each with a white-hot highlight core, orbiting against a near-black ring —
 * matching the reference conic-gradient technique (saturated color arcs with
 * a hot center, not a flat-filled ring). Use with PREMIUM_RING_LOCATIONS. */
export const PREMIUM_RING_COLORS = [
  '#0A0A0C', '#0A0A0C', '#3D7EFF', '#9CC5FF', '#3D7EFF', '#0A0A0C',
  '#0A0A0C', '#FF7A3D', '#FFC59C', '#FF7A3D', '#0A0A0C', '#0A0A0C',
] as const;
export const PREMIUM_RING_LOCATIONS = [
  0, 0.06, 0.18, 0.22, 0.26, 0.38, 0.5, 0.62, 0.66, 0.7, 0.82, 1,
] as const;

export interface RingPalette {
  colors: readonly [string, string, ...string[]];
  locations: readonly [number, number, ...number[]];
  glowColor: string;
  glowColorSecondary?: string;
}

/** Context-matched ring palettes so a glow can follow the surface it wraps —
 * e.g. the gold PREMIUM tier card gets a gold ring, not the default
 * blue/orange. Same two-arc + hot-core construction as PREMIUM_RING_COLORS. */
export const RING_PALETTES: Record<'default' | 'gold' | 'royal' | 'economy' | 'comfort' | 'driver' | 'green', RingPalette> = {
  default: {
    colors: PREMIUM_RING_COLORS,
    locations: PREMIUM_RING_LOCATIONS,
    glowColor: '#3D7EFF',
    glowColorSecondary: '#FF7A3D',
  },
  gold: {
    colors: [
      '#0A0A0C', '#0A0A0C', '#FFD700', '#FFF3B0', '#FFD700', '#0A0A0C',
      '#0A0A0C', '#FFB300', '#FFE082', '#FFB300', '#0A0A0C', '#0A0A0C',
    ],
    locations: PREMIUM_RING_LOCATIONS,
    glowColor: '#FFD700',
    glowColorSecondary: '#FF8F00',
  },
  royal: {
    colors: [
      '#0A0A0C', '#0A0A0C', '#7000FF', '#C9A6FF', '#7000FF', '#0A0A0C',
      '#0A0A0C', '#B14BFF', '#E3C9FF', '#B14BFF', '#0A0A0C', '#0A0A0C',
    ],
    locations: PREMIUM_RING_LOCATIONS,
    glowColor: '#7000FF',
    glowColorSecondary: '#B14BFF',
  },
  economy: {
    colors: [
      '#0A0A0C', '#0A0A0C', '#00F0FF', '#B8FBFF', '#00F0FF', '#0A0A0C',
      '#0A0A0C', '#00C2CC', '#9CF2F7', '#00C2CC', '#0A0A0C', '#0A0A0C',
    ],
    locations: PREMIUM_RING_LOCATIONS,
    glowColor: '#00F0FF',
    glowColorSecondary: '#00C2CC',
  },
  comfort: {
    colors: [
      '#0A0A0C', '#0A0A0C', '#3D7EFF', '#9CC5FF', '#3D7EFF', '#0A0A0C',
      '#0A0A0C', '#2A5FD6', '#8FB4F2', '#2A5FD6', '#0A0A0C', '#0A0A0C',
    ],
    locations: PREMIUM_RING_LOCATIONS,
    glowColor: '#3D7EFF',
    glowColorSecondary: '#2A5FD6',
  },
  /** Driver-native two-arc sweep — cool blue → cyan, no orange. Use for the
   * single hero glow per driver screen (replaces the rider blue/orange combo,
   * which reads muddy/purple against the driver blue theme). */
  driver: {
    colors: [
      '#0A0A0C', '#0A0A0C', '#3D7EFF', '#9CC5FF', '#3D7EFF', '#0A0A0C',
      '#0A0A0C', '#00E0FF', '#9CF2FF', '#00E0FF', '#0A0A0C', '#0A0A0C',
    ],
    locations: PREMIUM_RING_LOCATIONS,
    glowColor: '#3D7EFF',
    glowColorSecondary: '#00E0FF',
  },
  /** Brand-green sweep with a gold hot-core fleck for contrast — for surfaces
   * sitting over the green video background (rider home "Suggested for you"),
   * so the ring reads as premium without clashing against the green backdrop. */
  green: {
    colors: [
      '#0A0A0C', '#0A0A0C', '#1FAE52', '#9CFFC2', '#4BE277', '#0A0A0C',
      '#0A0A0C', '#D6A800', '#FFE9A0', '#D6A800', '#0A0A0C', '#0A0A0C',
    ],
    locations: PREMIUM_RING_LOCATIONS,
    glowColor: '#4BE277',
    glowColorSecondary: '#D6A800',
  },
};

export const GradientGlowBorder = forwardRef<GradientGlowBorderHandle, GradientGlowBorderProps>(
  function GradientGlowBorder(
    {
      palette,
      colors: colorsProp,
      locations: locationsProp,
      fillColor,
      borderRadius,
      thickness = 'regular',
      glow = false,
      glowColor: glowColorProp,
      glowColorSecondary: glowColorSecondaryProp,
      disabled,
      style,
      children,
    },
    ref
  ) {
    const preset = RING_PALETTES[palette ?? 'default'];
    const colors = colorsProp ?? preset.colors;
    const locations = locationsProp ?? (colorsProp ? undefined : preset.locations);
    const glowColor = glowColorProp ?? (palette ? preset.glowColor : undefined);
    const glowColorSecondary = glowColorSecondaryProp ?? (palette ? preset.glowColorSecondary : undefined);
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

    // Layout props (flex, width, margins…) must live on the outer wrapper —
    // it's the node that participates in the parent's layout. Everything else
    // (padding, row direction, minHeight…) styles the clipped content box.
    const {
      flex,
      flexGrow,
      flexShrink,
      flexBasis,
      alignSelf,
      width,
      minWidth,
      maxWidth,
      margin,
      marginTop,
      marginBottom,
      marginLeft,
      marginRight,
      marginHorizontal,
      marginVertical,
      marginStart,
      marginEnd,
      ...contentStyle
    } = (StyleSheet.flatten(style) ?? {}) as ViewStyle;
    const layoutStyle: ViewStyle = {
      flex,
      flexGrow,
      flexShrink,
      flexBasis,
      alignSelf,
      width,
      minWidth,
      maxWidth,
      margin,
      marginTop,
      marginBottom,
      marginLeft,
      marginRight,
      marginHorizontal,
      marginVertical,
      marginStart,
      marginEnd,
    };

    return (
      // Outer wrapper is intentionally un-clipped: an iOS shadow placed
      // inside an overflow:'hidden' parent gets clipped to invisible, so the
      // glow lives here as a sibling of the masked ring container below,
      // sized to match it via StyleSheet.absoluteFillObject.
      <View style={layoutStyle}>
        {glow && diag > 0 && (
          <>
            {/* Wide soft bloom — the ambient halo that reads from a distance. */}
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
                  shadowOpacity: 0.65,
                  shadowRadius: 28,
                  elevation: 14,
                },
              ]}
            />
            {/* Tight hot core — a saturated, close-in pass so the ring itself
             * looks lit, not just hazy at the edges. */}
            <View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFillObject,
                {
                  borderRadius,
                  backgroundColor: fillColor,
                  shadowColor: glowColor ?? colors[colors.length - 1],
                  shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: 0.9,
                  shadowRadius: 8,
                  elevation: 14,
                },
              ]}
            />
            {glowColorSecondary && (
              <>
                <View
                  pointerEvents="none"
                  style={[
                    StyleSheet.absoluteFillObject,
                    {
                      borderRadius,
                      backgroundColor: fillColor,
                      shadowColor: glowColorSecondary,
                      shadowOffset: { width: 0, height: 0 },
                      shadowOpacity: 0.55,
                      shadowRadius: 36,
                      elevation: 14,
                    },
                  ]}
                />
                <View
                  pointerEvents="none"
                  style={[
                    StyleSheet.absoluteFillObject,
                    {
                      borderRadius,
                      backgroundColor: fillColor,
                      shadowColor: glowColorSecondary,
                      shadowOffset: { width: 0, height: 0 },
                      shadowOpacity: 0.75,
                      shadowRadius: 10,
                      elevation: 14,
                    },
                  ]}
                />
              </>
            )}
          </>
        )}

        <View
          style={[{ borderRadius, overflow: 'hidden' }, contentStyle]}
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
