import React, { memo } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Ellipse, Path, Rect, G } from 'react-native-svg';

/**
 * Top-down vehicle marker — the thing Uber/Bolt/Yango put on the rider's map so
 * a glance tells you where the car is AND which way it is pointing.
 *
 * Why a drawn model instead of an icon in a circle: a circular badge has no
 * front, so rotating it communicates nothing. This silhouette is nose-up
 * (heading 0 = pointing to the top of the artwork), which is the contract
 * `AnimatedMarkerView`'s `rotation` prop expects — pass a TRUE compass bearing
 * and let the map layer do the bearing compensation. Never bake an artwork tilt
 * into the bearing (that is the "+45°" bug from the driver screens); if the
 * artwork ever needs a nudge, rotate it here via `glyphRotation`.
 *
 * Rendered inside a `MarkerView`, so it must be cheap: pure SVG, no animation,
 * no shadow layers (a real shadow is drawn as one ellipse in the same pass).
 */
export interface CarMarkerProps {
  /** Overall marker size in px. The car is drawn to fill it. */
  size?: number;
  /** Body fill. Defaults to the EyeGo dark-graphite vehicle. */
  bodyColor?: string;
  /** Roof/cabin accent — the brand color reads best here. */
  accentColor?: string;
  /** Glass color. */
  glassColor?: string;
  /** Extra artwork-only rotation in degrees. Keep at 0 unless the art changes. */
  glyphRotation?: number;
  /** Drop the ground shadow (e.g. when the marker sits on a dark polyline). */
  shadow?: boolean;
  /** Vehicle class — a bus/minibus silhouette for the shared-fleet tiers. */
  variant?: 'car' | 'van';
}

function CarMarkerImpl({
  size = 46,
  bodyColor = '#1F2430',
  accentColor = '#3AA0FF',
  glassColor = '#CFE4FF',
  glyphRotation = 0,
  shadow = true,
  variant = 'car',
}: CarMarkerProps) {
  // The viewBox is 60×100 (tall) so the silhouette has room for a nose. The
  // marker box stays square to keep the rotation centre at the car's centroid —
  // rotating about anything else makes the car swing around the map instead of
  // turning in place.
  const boxW = size * 0.62;
  const boxH = size;

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg
        width={boxW}
        height={boxH}
        viewBox="0 0 60 100"
        style={{ transform: [{ rotate: `${glyphRotation}deg` }] }}
      >
        <Defs>
          <LinearGradient id="carBody" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={bodyColor} stopOpacity="1" />
            <Stop offset="1" stopColor="#0B0E14" stopOpacity="1" />
          </LinearGradient>
          <LinearGradient id="carGlass" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={glassColor} stopOpacity="0.95" />
            <Stop offset="1" stopColor={glassColor} stopOpacity="0.55" />
          </LinearGradient>
        </Defs>

        {shadow && <Ellipse cx="30" cy="54" rx="26" ry="42" fill="#000" opacity={0.18} />}

        {/* Wheels first so the body overlaps them, as seen from above. */}
        <G opacity={0.9}>
          <Rect x="1" y="24" width="9" height="18" rx="4" fill="#0A0C11" />
          <Rect x="50" y="24" width="9" height="18" rx="4" fill="#0A0C11" />
          <Rect x="1" y="60" width="9" height="18" rx="4" fill="#0A0C11" />
          <Rect x="50" y="60" width="9" height="18" rx="4" fill="#0A0C11" />
        </G>

        {variant === 'van' ? (
          <>
            {/* Minibus: near-rectangular body, flat nose — the shared fleet. */}
            <Rect x="6" y="4" width="48" height="92" rx="14" fill="url(#carBody)" />
            <Rect x="11" y="9" width="38" height="15" rx="7" fill="url(#carGlass)" />
            <Rect x="11" y="31" width="38" height="26" rx="6" fill={accentColor} opacity={0.28} />
            <Rect x="11" y="62" width="38" height="16" rx="6" fill="url(#carGlass)" opacity={0.75} />
          </>
        ) : (
          <>
            {/* Saloon: tapered nose at the top, wider haunches at the rear. */}
            <Path
              d="M30 2c9 0 15 7 17.5 16.5C50 28 51 39 51 50s-1 22-3.5 31.5C45 91 39 98 30 98s-15-7-17.5-16.5C10 72 9 61 9 50s1-22 3.5-31.5C15 9 21 2 30 2z"
              fill="url(#carBody)"
            />
            {/* Windshield + rear glass. */}
            <Path d="M17 30c4-6 22-6 26 0 2 3 2 6 0 8-5 4-21 4-26 0-2-2-2-5 0-8z" fill="url(#carGlass)" />
            <Path d="M18 74c4 5 20 5 24 0 2-2 2-5 0-7-5-3-19-3-24 0-2 2-2 5 0 7z" fill="url(#carGlass)" opacity={0.8} />
            {/* Roof panel in the brand accent — this is what makes the heading
                legible at a glance on a small map. */}
            <Rect x="16" y="42" width="28" height="26" rx="9" fill={accentColor} opacity={0.32} />
            {/* Headlights. */}
            <Rect x="15" y="7" width="9" height="4" rx="2" fill="#FFF3C4" opacity={0.95} />
            <Rect x="36" y="7" width="9" height="4" rx="2" fill="#FFF3C4" opacity={0.95} />
            {/* Tail lights. */}
            <Rect x="15" y="90" width="9" height="3.5" rx="1.75" fill="#FF5A5A" opacity={0.9} />
            <Rect x="36" y="90" width="9" height="3.5" rx="1.75" fill="#FF5A5A" opacity={0.9} />
          </>
        )}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
});

export const CarMarker = memo(CarMarkerImpl);
