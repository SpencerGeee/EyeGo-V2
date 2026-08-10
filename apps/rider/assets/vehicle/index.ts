/**
 * THE VEHICLE MODEL SHOWN ON THE RIDER'S MAP.
 *
 * ── How to install the artwork ───────────────────────────────────────────────
 * 1. Drop the render in this folder as `minibus.png` (plus optional
 *    `minibus@2x.png` / `minibus@3x.png` — Metro picks the right density
 *    automatically from the same `require`).
 * 2. Change `VEHICLE_MODEL` below from `null` to:
 *        require('./minibus.png')
 * That is the whole switch. Nothing else in the app needs editing.
 *
 * ── What the artwork needs to be ─────────────────────────────────────────────
 * - TOP-DOWN or a shallow 3/4 from directly above. The marker is rotated to the
 *   driver's bearing, so any perspective baked into the render will visibly
 *   swing around as the vehicle turns. Straight-down survives rotation; a
 *   side-on or hero angle does not.
 * - NOSE POINTING UP (toward the top edge of the image). Rotation is applied as
 *   `bearing` degrees clockwise from north, so 0° must already look like a
 *   vehicle heading north.
 * - TRANSPARENT background, tightly cropped, with the vehicle centred in the
 *   canvas — the marker rotates about the image's centre, so an off-centre
 *   vehicle will orbit rather than pivot.
 * - Around 128x128 at @1x (so 384x384 at @3x). It renders at ~34pt.
 * - A soft contact shadow baked in reads well on both the light and dark map
 *   styles; a hard drop shadow does not.
 *
 * Until the file is in place `VEHICLE_MODEL` stays null and `VehicleMarker`
 * falls back to the arrow puck. That is deliberate: shipping a placeholder
 * vehicle would put exactly the "cheap SVG" on the map that this exists to
 * replace, and a missing `require` is a bundler error rather than a graceful
 * degradation.
 */
import type { ImageSourcePropType } from 'react-native';

export const VEHICLE_MODEL: ImageSourcePropType | null = null;
