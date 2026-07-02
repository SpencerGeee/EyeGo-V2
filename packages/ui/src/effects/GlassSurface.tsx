import React from 'react';
import { View, StyleSheet, Platform, type ViewStyle, type StyleProp } from 'react-native';
import { BlurView } from 'expo-blur';
import { withOpacity } from '@eyego/config';
import { useThemedColors } from '../ColorsContext';
import { usePerformanceTier } from './usePerformanceTier';

// Liquid Glass — iOS 26+ only; fails silently everywhere else.
let LiquidGlassView: React.ComponentType<{ style?: StyleProp<ViewStyle> }> | null = null;
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
  dark?: boolean;
  /** Faint complementary-tint rim offsets — a cheap nod to the web sample's
   * RGB-channel displacement trick. iOS only; skipped on Android. */
  chromaticHint?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
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
  dark = true,
  chromaticHint = false,
  style,
  children,
}: GlassSurfaceProps) {
  const colors = useThemedColors();
  const tier = usePerformanceTier();
  const effectiveIntensity = tier === 'low' ? 'low' : intensity;
  const effectiveChromaticHint = tier === 'low' ? false : chromaticHint;
  const blurIntensity = effectiveIntensity === 'high' ? 92 : 60;
  const fallbackAlpha = effectiveIntensity === 'high' ? 0.4 : 0.6;

  return (
    <View style={[{ borderRadius, overflow: 'hidden' }, style]}>
      {isLiquidGlassSupported && LiquidGlassView ? (
        <LiquidGlassView style={StyleSheet.absoluteFill} />
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
