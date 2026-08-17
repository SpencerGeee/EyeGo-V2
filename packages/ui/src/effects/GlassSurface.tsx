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

  /**
   * THE SCRIM — WHY GLASS IS NOT JUST BLUR.
   *
   * Reported as "the transparent background is really making things look messed
   * up and busy" and, on the tier picker, "the map is bleeding into the
   * selection so it's harder to read". Both are the same defect: the three
   * material branches below each sample whatever is behind the card and tint it
   * only lightly — Liquid Glass at 0.28 with `effect: 'clear'`, `BlurView` with
   * no tint of its own at all. Blur reduces DETAIL behind a card; it does not
   * reduce CONTRAST. Over a shader or a map, high-contrast content survives the
   * blur as bright smears, and small text sitting on top of those smears is
   * genuinely hard to read no matter how much blur you add.
   *
   * So every material now sits under one explicit tint. The card is a dark
   * surface with the background showing through it, rather than the background
   * with a card faintly implied over it — the ambient colour still reads at the
   * edges and through the rim, which is the part that looked good, without the
   * busyness underneath the words.
   *
   * `low` is the denser panel (sheets, anything holding a form); `high` is the
   * lighter one used for cards floating over the map.
   */
  /**
   * LIGHT GLASS IS NOT DARK GLASS WITH THE COLOURS SWAPPED.
   *
   * BUGFIX ("in light mode the glass cards can barely be seen, and the white
   * isn't even a clearer shade of white — it's more like a tint of it").
   *
   * Both halves of that sentence are this line. In DARK mode a 0.78 scrim works
   * because the card is near-black and the ground behind it is a green shader:
   * whatever bleeds through is darker than the card and the card still reads as
   * a card. In LIGHT mode the scrim is white and the ground is a white-based
   * green shader, so 22% of an ambient green wash came through every card —
   * that is the "tint", literally — and the card's own white was never clean
   * enough to separate from the white page behind it.
   *
   * So light glass is nearly opaque. The material underneath still does its job
   * at the very edges and through the rim, which is where glass reads anyway,
   * and the card face is the clean white the design wants. The separation is
   * then carried by the rim and the lift below rather than by a tonal step that
   * does not exist between two whites.
   */
  const scrimAlpha = dark
    ? (effectiveIntensity === 'high' ? 0.78 : 0.88)
    : (effectiveIntensity === 'high' ? 0.94 : 0.97);
  const scrimColor = withOpacity(dark ? colors.surfaceCard : '#FFFFFF', scrimAlpha);

  /**
   * On a dark ground a card separates by being LIGHTER than the page. On a light
   * one there is nothing above white to step to, so the separation has to come
   * from elevation instead — the reason every light-mode design system has a
   * shadow ramp and dark ones largely do not.
   *
   * Android only, and deliberately: this view carries `overflow: 'hidden'` so
   * its rounded corners clip the blur material, and on iOS a clipped view does
   * not cast its shadow — the two cannot both be on this node, and the clipping
   * is load-bearing. iOS gets its separation from the rim below, which the light
   * palette strengthens for exactly this reason.
   */
  const lift: ViewStyle = !dark && Platform.OS === 'android' ? { elevation: 3 } : {};

  /**
   * The card edge. On dark surfaces the rim is a highlight and can be subtle
   * because the card's own brightness already separates it; on a light one the
   * rim IS the separation between two whites, so it is drawn a step stronger.
   */
  const rimColor = dark ? colors.rimLight : withOpacity('#0B1220', 0.16);

  return (
    <View style={[{ borderRadius, overflow: 'hidden' }, lift, style]}>
      {isLiquidGlassSupported && LiquidGlassView ? (
        // colorScheme defaults to 'system' — without it, the glass follows
        // the PHONE's OS-level light/dark setting, not this app's theme, so
        // on a light-system-mode device it renders Apple's bright glass
        // material regardless of `dark`. Force it explicitly.
        //
        // `regular` in both intensities now: `clear` is Apple's most
        // transparent material and the scrim below has to fight it for every
        // point of contrast, which wastes the blur rather than using it.
        <LiquidGlassView
          style={StyleSheet.absoluteFill}
          colorScheme={dark ? 'dark' : 'light'}
          tintColor={withOpacity(dark ? colors.surfaceCard : '#FFFFFF', 0.2)}
          effect="regular"
        />
      ) : Platform.OS === 'ios' ? (
        <BlurView
          intensity={blurIntensity}
          tint={dark ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
          style={StyleSheet.absoluteFill}
        />
      ) : null}

      {/* Painted OVER the material, not under it: the point is to darken the
          blurred result, and a scrim behind a BlurView is simply blurred along
          with everything else. On Android, where there is no material at all,
          this is the whole surface. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: scrimColor }]} />

      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { borderRadius, borderWidth: 1, borderColor: rimColor }]}
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
