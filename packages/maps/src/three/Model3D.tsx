import React, { useEffect, useMemo, useState } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import { Canvas, Picture } from '@shopify/react-native-skia';
import { modelPicture, quantPitch, quantYaw, type Model } from './engine';

export interface Model3DProps {
  model: Model;
  /** Degrees clockwise. A world heading (from north) when `bearing` is given, else screen-relative. */
  heading?: number;
  /** The map's bearing — pass `useMapBearing()` from inside a map. */
  bearing?: number;
  /** The map's tilt — pass `useMapPitch()` from inside a map. */
  pitch?: number;
  /** Frame edge in points. The model fills ~90% of it at its widest. */
  size?: number;
  /** A slow showroom spin (degrees per second), for hero use off the map. */
  spin?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * A 3D model as a view: one tiny Skia canvas showing the cached frame for the
 * current heading and tilt. Swapping a Picture is synchronous, so a bus turning
 * a corner never flashes blank between frames the way an <Image> source swap
 * can. See engine.ts for why this exists at all.
 */
export function Model3D({ model, heading = 0, bearing = 0, pitch = 0, size = 48, spin, style }: Model3DProps) {
  const [spinDeg, setSpinDeg] = useState(0);
  useEffect(() => {
    if (!spin) return;
    let raf = 0;
    let last = Date.now();
    const tick = () => {
      const now = Date.now();
      setSpinDeg((d) => (d + ((now - last) / 1000) * spin) % 360);
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spin]);

  const yaw = quantYaw(heading - bearing + spinDeg);
  const tilt = quantPitch(pitch);
  const picture = useMemo(() => modelPicture(model, yaw, tilt, size), [model, yaw, tilt, size]);
  if (!picture) return null;
  return (
    <Canvas style={[{ width: size, height: size }, style]} pointerEvents="none">
      <Picture picture={picture} />
    </Canvas>
  );
}
