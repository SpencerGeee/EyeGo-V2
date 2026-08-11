import React from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Canvas, Rect, RadialGradient, vec } from '@shopify/react-native-skia';

/**
 * A soft coloured bloom anchored to the BOTTOM of a surface.
 *
 * WHAT THIS IS FOR. The rider's tracking panel is the screen they stare at for
 * the length of a ride, and it was a flat dark sheet. This puts a slow wash of
 * brand colour along its lower edge so the panel reads as lit rather than
 * printed — the thing that separates a premium surface from a plain one.
 *
 * WHAT IT MUST NEVER DO is make the panel harder to read. Three constraints
 * enforce that, and all three are deliberate:
 *
 *   1. ANCHORED LOW. The gradient's centre sits BELOW the surface's bottom
 *      edge, so the brightest part of the bloom is off-canvas and only its
 *      falloff is visible. Text lives in the upper two-thirds of a panel; the
 *      light lives in the bottom third.
 *   2. CAPPED OPACITY. `intensity` tops out well under half. Past roughly 0.2
 *      the wash starts competing with body text on a dark sheet, which is the
 *      failure this is written to avoid.
 *   3. STATIC. One paint, no animation loop, no shader clock. This mounts on a
 *      screen already running MapLibre and a gesture-driven panel; a breathing
 *      gradient here would be the third thing asking for the same frame.
 *
 * Absolutely positioned and `pointerEvents="none"` — it is scenery, and must
 * never intercept a touch meant for the content above it.
 */
export interface CardAuroraGlowProps {
  /** Bloom colour. Use a brand accent; it is washed out heavily by `intensity`. */
  color?: string;
  /**
   * Peak alpha of the bloom, 0-0.28. Clamped, because the whole value of this
   * component is that it cannot be turned up until the text stops reading.
   */
  intensity?: number;
  /**
   * How far up the surface the light reaches, as a fraction of its height.
   * 0.55 keeps it clear of a two-line headline at the top of a panel.
   */
  reach?: number;
  style?: StyleProp<ViewStyle>;
}

/** Hard ceiling. See constraint 2 above — this is not a tuning knob. */
const MAX_INTENSITY = 0.28;

export function CardAuroraGlow({
  color = '#22C55E',
  intensity = 0.16,
  reach = 0.55,
  style,
}: CardAuroraGlowProps) {
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  const alpha = Math.max(0, Math.min(intensity, MAX_INTENSITY));

  // Skia needs real pixel dimensions; there is nothing to paint until layout
  // has happened, and painting into a zero-sized canvas throws on some drivers.
  if (size.width <= 0 || size.height <= 0) {
    return (
      <View
        style={[StyleSheet.absoluteFill, style]}
        onLayout={(e) => setSize(e.nativeEvent.layout)}
      />
    );
  }

  const { width, height } = size;
  // Centre BELOW the bottom edge so only the falloff lands on the surface.
  const centre = vec(width / 2, height * 1.08);
  const radius = Math.max(width * 0.75, height * reach * 1.6);

  return (
    <View
      style={[StyleSheet.absoluteFill, style]}
      onLayout={(e) => setSize(e.nativeEvent.layout)}
      pointerEvents="none"
    >
      <Canvas style={StyleSheet.absoluteFill}>
        <Rect x={0} y={0} width={width} height={height}>
          <RadialGradient
            c={centre}
            r={radius}
            // Fades to fully transparent well before the top of the surface, so
            // there is no visible band where the wash stops.
            colors={[
              withAlpha(color, alpha),
              withAlpha(color, alpha * 0.45),
              withAlpha(color, 0),
            ]}
            positions={[0, 0.45, 1]}
          />
        </Rect>
      </Canvas>
    </View>
  );
}

/** `#RRGGBB` + alpha → `#RRGGBBAA`. Skia wants the alpha in the colour. */
function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}
