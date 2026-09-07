import React from 'react';
import { View, StyleSheet, Platform, type ViewStyle, type StyleProp } from 'react-native';
import { BlurView } from 'expo-blur';
import { usePerformanceTier } from './usePerformanceTier';

interface ChromeBlurProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Passed straight through to `BlurView` on the tier that renders one. */
  intensity?: number;
  tint?: 'light' | 'dark' | 'default' | 'systemChromeMaterialDark' | 'systemChromeMaterialLight';
  /**
   * The flat fill used instead of a blur. Give it the colour the blurred
   * result reads as on this screen — a pill over dark map tiles is near-black,
   * a tab bar is the app's own chrome colour.
   */
  fallbackColor: string;
}

/**
 * A blurred chrome surface — ETA pills, status banners, the tab bar — that
 * stops being a blur on a device that cannot afford one.
 *
 * ── WHY THIS EXISTS SEPARATELY FROM `GlassSurface` ──────────────────────────
 *
 * BUGFIX ("getting to the tracking page and accepting rides, the page became
 * super laggy and slow").
 *
 * `GlassSurface` is tier-aware, but these small pieces of chrome were raw
 * `<BlurView>`s and so were not: they ran at full strength on every device.
 * The driver's tracking screen had three of them — two ETA pills and a status
 * banner — sitting directly over a live `MapView`.
 *
 * That placement is the expensive part, not the blur itself. A blur samples
 * whatever is behind it, so a blur over a map that is being panned by GPS
 * fixes has to be recomputed on EVERY frame the map moves, for the whole life
 * of the trip. Three of them plus the map plus a shader is what the phone was
 * actually being asked to do.
 *
 * At pill size the difference between a blur and a correctly-chosen flat fill
 * is close to invisible, so below the top tier this renders the fill and the
 * screen gets its frames back. Android never had `expo-blur` parity worth the
 * cost here and takes the fill unconditionally.
 */
export function ChromeBlur({
  children,
  style,
  intensity = 60,
  tint = 'dark',
  fallbackColor,
}: ChromeBlurProps) {
  const tier = usePerformanceTier();

  if (tier !== 'high' || Platform.OS !== 'ios') {
    return <View style={[style, { backgroundColor: fallbackColor }]}>{children}</View>;
  }

  return (
    <BlurView intensity={intensity} tint={tint} style={style}>
      {children}
    </BlurView>
  );
}

/** Convenience for full-bleed chrome (tab bars, headers). */
export function ChromeBlurFill(props: Omit<ChromeBlurProps, 'style'> & { style?: StyleProp<ViewStyle> }) {
  return <ChromeBlur {...props} style={[StyleSheet.absoluteFill, props.style]} />;
}

export default ChromeBlur;
