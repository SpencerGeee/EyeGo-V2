import React from 'react';
import { Model3D, minibus, useMapBearing, useMapPitch } from '@eyego/maps';
import { getTierTheme, normalizeTier } from '@eyego/ui';
import { useColors } from '../../utils/useColors';

interface VehicleMarkerProps {
  /** Degrees clockwise from north — the smoothed bearing, not a raw GPS fix. */
  bearing: number;
  /** Footprint of the vehicle itself, in points (the 3D frame is larger). */
  size?: number;
  /** The ride's tier: its colour is the livery stripe and roof sign. */
  tier?: string | null;
}

/**
 * The vehicle on the rider's map — a real 3D minibus.
 *
 * BUGFIX ("we need a better 3D model of the bus — if you tilt the map the 2D
 * image becomes flat"). This was a top-down PNG rotated by a screen transform:
 * flat on the ground, so a tilt showed a squashed rectangle, and rotated by
 * the raw compass bearing, so it pointed the wrong way the moment the map was
 * rotated. It is now the shared low-poly model (packages/maps/three), drawn for
 * its heading RELATIVE to the map's bearing and at the map's tilt — the sides,
 * windows and wheels appear as the camera leans, and it points down its road
 * however the map is turned.
 *
 * Premium wears graphite, every tier wears its own colour on the stripe and
 * roof sign — the car that is coming for you looks like the one you booked.
 */
export function VehicleMarker({ bearing, size = 34, tier }: VehicleMarkerProps) {
  const colors = useColors();
  const mapBearing = useMapBearing();
  const pitch = useMapPitch();
  const theme = getTierTheme(colors, tier ?? 'ECONOMY');
  const model = minibus({
    body: normalizeTier(tier ?? 'ECONOMY') === 'PREMIUM' ? '#2F3440' : '#F3F4F6',
    accent: theme.accent,
  });
  // The frame is the model's turning circle: ~1.6x the vehicle's length.
  return <Model3D model={model} heading={bearing} bearing={mapBearing} pitch={pitch} size={Math.round(size * 1.65)} />;
}
