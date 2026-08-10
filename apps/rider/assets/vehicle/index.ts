/**
 * THE VEHICLE MODEL SHOWN ON THE RIDER'S MAP.
 *
 * Installed: a 402x402 top-down minibus render, nose north, real alpha, with
 * the vehicle's bounding box centred on the canvas centre to the pixel.
 *
 * ── Replacing the artwork ────────────────────────────────────────────────────
 * `PROMPT.md` in this folder is the generation prompt and the post-processing
 * checklist. A fresh render will almost certainly arrive on a tall rectangular
 * canvas with the vehicle off-centre; re-canvas it to a square with the
 * vehicle centred before committing, because of the two constraints below.
 *
 * ── What the artwork needs to be ─────────────────────────────────────────────
 * - SQUARE canvas, vehicle CENTRED in it. Two separate reasons, both invisible
 *   until it moves: `resizeMode: 'contain'` scales the whole canvas into the
 *   34pt marker, so padding baked into the source shrinks the vehicle inside
 *   the box; and the rotation pivot is the canvas centre, so a vehicle that is
 *   off-centre orbits that point instead of turning on the spot.
 * - TOP-DOWN or a shallow 3/4 from directly above. The marker is rotated to the
 *   driver's bearing, so any perspective baked into the render will visibly
 *   swing around as the vehicle turns. Straight-down survives rotation; a
 *   side-on or hero angle does not.
 * - NOSE POINTING UP (toward the top edge of the image). Rotation is applied as
 *   `bearing` degrees clockwise from north, so 0° must already look like a
 *   vehicle heading north.
 * - REAL alpha, tightly cropped. Not a white background that merely looks
 *   transparent in a viewer — check the corner pixels, not the preview.
 * - At least ~384px square, since the marker draws at 34pt and that is 102px
 *   on a @3x screen. One oversized file beats density variants here: the size
 *   is set explicitly in `VehicleMarker`, so the intrinsic dimensions never
 *   reach layout and only the downsample quality matters.
 *
 * If this is ever set back to null, `VehicleMarker` falls back to the arrow
 * puck. That fallback exists so the map degrades to something honest rather
 * than to a broken-image box; it is not a licence to ship placeholder art.
 */
import type { ImageSourcePropType } from 'react-native';

export const VEHICLE_MODEL: ImageSourcePropType | null = require('./minibus.png');
