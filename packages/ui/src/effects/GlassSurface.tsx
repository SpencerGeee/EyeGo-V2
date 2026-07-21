import React from 'react';
import { View, StyleSheet, Platform, type ViewStyle, type StyleProp } from 'react-native';
import { BlurView } from 'expo-blur';
import { withOpacity } from '@eyego/config';
import { useThemedColors } from '../ColorsContext';
import { usePerformanceTier } from './usePerformanceTier';

// Liquid Glass — iOS 26+ only; fails silently everywhere else.
type LiquidGlassProps = {
  style?: StyleProp<ViewStyle>;
  colorScheme?: 'light' | 'dark' | 'system';
  tintColor?: string;
  effect?: 'clear' | 'regular' | 'none';
};
let LiquidGlassView: React.ComponentType<LiquidGlassProps> | null = null;
let isLiquidGlassSupported = false;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const lg = require('@callstack/liquid-glass');
  LiquidGlassView = lg.LiquidGlassView ?? null;
  isLiquidGlassSupported = lg.isLiquidGlassSupported ?? false;
} catch {
  // package not installed / platform unsupported — BlurView/View fallback below
}

interface GlassSurfaceProps {
  borderRadius?: number;
  /** 'high' = maximum transparency (thin frost, strong blur). 'low' = a denser panel. */
  intensity?: 'low' | 'high';
  /** Force a specific glass tint regardless of theme. Omit to auto-detect
   * from the active color scheme (dark theme -> dark glass, light theme ->
   * light glass) — every call site in both apps relies on this default;
   * none intentionally want a fixed tint independent of theme. */
  dark?: boolean;
  /** Faint complementary-tint rim offsets — a cheap nod to the web sample's
   * RGB-channel displacement trick. iOS only; skipped on Android. */
  chromaticHint?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

// Colors in this design system are always #RRGGBB hex — cheap perceived-
// luminance check to tell a light theme's near-white background apart from
// a dark theme's near-black one, so GlassSurface can auto-tint correctly.
export function isLightColor(hex: string): boolean {
  const c = hex.replace('#', '');
  if (c.length < 6) return false;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return false;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5;
}

/**
 * RN-native "frosted glass" panel. The web GlassSurface fakes chromatic
 * displacement via a live SVG feDisplacementMap used as a CSS
 * backdrop-filter — there's no RN equivalent (no DOM, no CSS
 * backdrop-filter, react-native-svg has no filter primitives), so this
 * recreates the same premium intent with native-friendly layers instead:
 * LiquidGlassView > BlurView > tinted View, plus a rim highlight border.
 */
export function GlassSurface({
  borderRadius = 0,
  intensity = 'high',
  dark: darkProp,
  chromaticHint = false,
  style,
  children,
}: GlassSurfaceProps) {
  const colors = useThemedColors();
  const dark = darkProp ?? !isLightColor(colors.background);
  const tier = usePerformanceTier();
  const effectiveIntensity = tier === 'low' ? 'low' : intensity;
  const effectiveChromaticHint = tier === 'low' ? false : chromaticHint;
  const blurIntensity = effectiveIntensity === 'high' ? 92 : 60;
  const fallbackAlpha = effectiveIntensity === 'high' ? 0.4 : 0.6;

  return (
    <View style={[{ borderRadius, overflow: 'hidden' }, style]}>
      {isLiquidGlassSupported && LiquidGlassView ? (
        // colorScheme defaults to 'system' — without it, the glass follows
        // the PHONE's OS-level light/dark setting, not this app's theme, so
        // on a light-system-mode device it renders Apple's bright glass
        // material regardless of `dark`. Force it explicitly.
        <LiquidGlassView
          style={StyleSheet.absoluteFill}
          colorScheme={dark ? 'dark' : 'light'}
          tintColor={withOpacity(dark ? colors.surfaceCard : '#FFFFFF', effectiveIntensity === 'high' ? 0.28 : 0.42)}
          effect={effectiveIntensity === 'high' ? 'clear' : 'regular'}
        />
      ) : Platform.OS === 'ios' ? (
        <BlurView
          intensity={blurIntensity}
          tint={dark ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: withOpacity(dark ? colors.surfaceCard : '#FFFFFF', fallbackAlpha) },
          ]}
        />
      )}

      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { borderRadius, borderWidth: 1, borderColor: colors.rimLight }]}
      />

      {effectiveChromaticHint && Platform.OS === 'ios' && (
        <>
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              {
                borderRadius,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: 'rgba(255,90,90,0.10)',
                transform: [{ translateX: 0.5 }],
              },
            ]}
          />
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              {
                borderRadius,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: 'rgba(90,150,255,0.10)',
                transform: [{ translateX: -0.5 }],
              },
            ]}
          />
        </>
      )}

      {children}
    </View>
  );
}
