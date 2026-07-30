import React, { memo } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Ellipse, Path, Rect, G } from 'react-native-svg';

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
 * ART DIRECTION (rewritten 2026-07-30 — the first pass read as "really bad"
 * on-device, and it was: the body was a plain rounded rectangle sitting on a
 * 26×42 near-black ellipse, so at 48 px the whole marker was a dark smudge with
 * no discernible vehicle in it). Uber's published approach ("Upgrading Uber's 3D
 * fleet") is a *shaded, intentionally low-detail* 3/4-lit top-down model at
 * ~64 px, not a flat silhouette, with the light always coming from the same
 * direction and a small contact shadow rather than a halo. That is what this
 * now draws:
 *   - a tight, offset contact shadow (not a giant dark oval),
 *   - a light outer stroke so the vehicle separates from dark map tiles,
 *   - a body gradient lit from the top-left with a specular band along the roof,
 *   - real glass shapes (raked windshield, smaller rear screen) and mirrors,
 *   - warm headlights at the nose and red tail lights at the rear, which is what
 *     actually makes the heading readable at a glance.
 *
 * Rendered inside a `MarkerView`, so it must stay cheap: pure SVG, no animation,
 * no RN shadow layers (the contact shadow is one ellipse in the same pass).
 */
export interface CarMarkerProps {
  /** Overall marker size in px. The vehicle is drawn to fill it. */
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
  /** Vehicle class — a minibus silhouette for the shared-fleet tiers. */
  variant?: 'car' | 'van';
  /** Light outline drawn around the body so it reads on dark tiles. */
  outlineColor?: string;
}

function CarMarkerImpl({
  size = 46,
  bodyColor = '#232A38',
  accentColor = '#3AA0FF',
  glassColor = '#BFDBFF',
  glyphRotation = 0,
  shadow = true,
  variant = 'car',
  outlineColor = 'rgba(255,255,255,0.92)',
}: CarMarkerProps) {
  // The viewBox is 60×100 (tall) so the silhouette has room for a nose. The
  // marker box stays square to keep the rotation centre at the vehicle's
  // centroid — rotating about anything else makes the vehicle swing around the
  // map instead of turning in place.
  const boxW = size * 0.62;
  const boxH = size;
  const isVan = variant === 'van';

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg
        width={boxW}
        height={boxH}
        viewBox="0 0 60 100"
        style={{ transform: [{ rotate: `${glyphRotation}deg` }] }}
      >
        <Defs>
          {/* Lit from the top-left, consistently, on every variant — the single
              cheapest thing that makes a flat shape read as a solid object. */}
          <LinearGradient id="cmBody" x1="0.1" y1="0" x2="0.9" y2="1">
            <Stop offset="0" stopColor={bodyColor} stopOpacity="1" />
            <Stop offset="0.55" stopColor={bodyColor} stopOpacity="1" />
            <Stop offset="1" stopColor="#0A0D14" stopOpacity="1" />
          </LinearGradient>
          {/* Specular band down the middle of the roof. */}
          <LinearGradient id="cmSheen" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
            <Stop offset="0.42" stopColor="#FFFFFF" stopOpacity="0.16" />
            <Stop offset="0.6" stopColor="#FFFFFF" stopOpacity="0.06" />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </LinearGradient>
          <LinearGradient id="cmGlass" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={glassColor} stopOpacity="0.92" />
            <Stop offset="1" stopColor={glassColor} stopOpacity="0.42" />
          </LinearGradient>
          <RadialGradient id="cmShadow" cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor="#000000" stopOpacity="0.42" />
            <Stop offset="1" stopColor="#000000" stopOpacity="0" />
          </RadialGradient>
        </Defs>

        {/* Contact shadow: tight, offset down-right to match the light
            direction, and faded at the edge. Deliberately much smaller than the
            body — a shadow larger than the object is what made the old marker a
            blob. */}
        {shadow && <Ellipse cx="32" cy="53" rx="23" ry="40" fill="url(#cmShadow)" />}

        {/* Wheels first so the body overlaps them, as seen from above. */}
        <G opacity={0.85}>
          <Rect x="3" y={isVan ? 22 : 25} width="7.5" height="16" rx="3.5" fill="#080A0F" />
          <Rect x="49.5" y={isVan ? 22 : 25} width="7.5" height="16" rx="3.5" fill="#080A0F" />
          <Rect x="3" y={isVan ? 63 : 61} width="7.5" height="16" rx="3.5" fill="#080A0F" />
          <Rect x="49.5" y={isVan ? 63 : 61} width="7.5" height="16" rx="3.5" fill="#080A0F" />
        </G>

        {isVan ? (
          <>
            {/* Minibus / trotro: tall boxy body, short blunt nose, big
                windscreen — the shared fleet most EyeGo trips actually run. */}
            <Path
              d="M18 3h24c5.5 0 9 3.6 9.6 9.2C52.5 21 53 33 53 50s-.5 29-1.4 37.8C51 93.4 47.5 97 42 97H18c-5.5 0-9-3.6-9.6-9.2C7.5 79 7 67 7 50s.5-29 1.4-37.8C9 6.6 12.5 3 18 3z"
              fill="url(#cmBody)"
              stroke={outlineColor}
              strokeWidth="2"
            />
            {/* Windscreen — wide and raked, the clearest "this end is the front"
                cue on a box-shaped vehicle. */}
            <Path d="M14 15c3.4-4.4 28.6-4.4 32 0 1.4 1.8 1.9 4.3 1.9 6.6-6 2.6-29.8 2.6-35.8 0 0-2.3.5-4.8 1.9-6.6z" fill="url(#cmGlass)" />
            {/* Roof panel + brand accent stripe running the length of it. */}
            <Rect x="13" y="27" width="34" height="46" rx="7" fill="url(#cmSheen)" />
            <Rect x="26" y="27" width="8" height="46" rx="4" fill={accentColor} opacity={0.5} />
            {/* Rear screen. */}
            <Path d="M14 87c3.4 3.6 28.6 3.6 32 0 1-1.1 1.5-2.9 1.6-4.6-6-2-30-2-35.2 0 .1 1.7.6 3.5 1.6 4.6z" fill="url(#cmGlass)" opacity={0.62} />
            {/* Mirrors. */}
            <Rect x="4.5" y="18" width="5" height="3.2" rx="1.6" fill="#0A0D14" />
            <Rect x="50.5" y="18" width="5" height="3.2" rx="1.6" fill="#0A0D14" />
            {/* Lights. */}
            <Rect x="13" y="5.5" width="10" height="4" rx="2" fill="#FFF6D2" opacity={0.96} />
            <Rect x="37" y="5.5" width="10" height="4" rx="2" fill="#FFF6D2" opacity={0.96} />
            <Rect x="13" y="91" width="10" height="3.4" rx="1.7" fill="#FF5A5A" opacity={0.9} />
            <Rect x="37" y="91" width="10" height="3.4" rx="1.7" fill="#FF5A5A" opacity={0.9} />
          </>
        ) : (
          <>
            {/* Saloon: tapered nose at the top, wider haunches at the rear. */}
            <Path
              d="M30 3c8.4 0 13.8 6.4 16.4 15.6C48.9 27.4 50 38.6 50 50s-1.1 22.6-3.6 31.4C43.8 90.6 38.4 97 30 97s-13.8-6.4-16.4-15.6C11.1 72.6 10 61.4 10 50s1.1-22.6 3.6-31.4C16.2 9.4 21.6 3 30 3z"
              fill="url(#cmBody)"
              stroke={outlineColor}
              strokeWidth="2"
            />
            {/* Raked windshield. */}
            <Path d="M17.5 31.5c3.6-5.2 21.4-5.2 25 0 1.7 2.4 2.2 5 2.2 7.3-6.4 2.5-23 2.5-29.4 0 0-2.3.5-4.9 2.2-7.3z" fill="url(#cmGlass)" />
            {/* Roof sheen + brand accent so the heading is legible at 48 px. */}
            <Rect x="16" y="41" width="28" height="27" rx="9" fill="url(#cmSheen)" />
            <Rect x="26" y="41" width="8" height="27" rx="4" fill={accentColor} opacity={0.5} />
            {/* Rear screen. */}
            <Path d="M18 71.5c3.4 4.6 20.6 4.6 24 0 1.4-1.9 1.8-4.2 1.8-6.2-6.2-2.2-21.4-2.2-27.6 0 0 2 .4 4.3 1.8 6.2z" fill="url(#cmGlass)" opacity={0.66} />
            {/* Mirrors. */}
            <Rect x="6.5" y="34" width="5" height="3.2" rx="1.6" fill="#0A0D14" />
            <Rect x="48.5" y="34" width="5" height="3.2" rx="1.6" fill="#0A0D14" />
            {/* Headlights / tail lights. */}
            <Rect x="16" y="7.5" width="9" height="4" rx="2" fill="#FFF6D2" opacity={0.96} />
            <Rect x="35" y="7.5" width="9" height="4" rx="2" fill="#FFF6D2" opacity={0.96} />
            <Rect x="16" y="89.5" width="9" height="3.4" rx="1.7" fill="#FF5A5A" opacity={0.9} />
            <Rect x="35" y="89.5" width="9" height="3.4" rx="1.7" fill="#FF5A5A" opacity={0.9} />
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
