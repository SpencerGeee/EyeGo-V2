import { box, cylinderX, disc, frustumZ, gem, prism, radiusOf, type Decal, type Face, type Model, type Vec3 } from './engine';

/**
 * THE MODELS. Built in metres, nose along +y, ground at z = 0, centred on the
 * origin so a marker turns on the spot. Each is memoised by its colours.
 */

const TIRE = '#1A1C21';
const HUB = '#A9AFB8';
const GLASS = '#121822';
const TRIM = '#2A2E36';
const HEADLIGHT = '#FFF3D1';
const TAILLIGHT = '#E5484D';

const memo = new Map<string, Model>();
function once(key: string, build: () => Model): Model {
  let m = memo.get(key);
  if (!m) memo.set(key, (m = build()));
  return m;
}

export interface Livery {
  /** Paint. */
  body?: string;
  /** Tier stripe + roof sign. */
  accent?: string;
}

/**
 * A 14-seat minibus — the whole fleet. Three stacked prisms (lower body,
 * glasshouse, roof) give it the van silhouette: short sloped nose, raked
 * windscreen, long flat roof. Windows, lights and the livery stripe are decals
 * on their faces; wheels, mirrors and the EyeGo roof sign are their own parts.
 */
export function minibus(livery: Livery = {}): Model {
  const body = livery.body ?? '#F3F4F6';
  const accent = livery.accent ?? '#22C55E';
  return once(`minibus|${body}|${accent}`, () => {
    const faces: Face[] = [];

    // Lower body: bumper to beltline, short sloped bonnet at the front.
    faces.push(
      ...prism(
        [[-3.0, 0.3], [3.0, 0.3], [3.0, 1.02], [2.72, 1.26], [-3.0, 1.26]],
        1.02,
        body,
        {
          sides: [{ yz: [[-2.95, 0.7], [2.95, 0.7], [2.95, 0.86], [-2.95, 0.86]], color: accent }],
          band: (i) => {
            if (i === 1) {
              // Nose: grille, headlights, bumper.
              const at = (x: number, z: number): Vec3 => [x, 3.0005, z];
              const quad = (x0: number, x1: number, z0: number, z1: number, color: string, glow?: boolean): Decal => ({
                pts: [at(x0, z0), at(x1, z0), at(x1, z1), at(x0, z1)],
                color,
                glow,
              });
              return {
                decals: [
                  quad(-1.02, 1.02, 0.3, 0.44, TRIM),
                  quad(-0.42, 0.42, 0.52, 0.76, TRIM),
                  quad(0.55, 0.9, 0.78, 0.95, HEADLIGHT, true),
                  quad(-0.9, -0.55, 0.78, 0.95, HEADLIGHT, true),
                ],
              };
            }
            if (i === 4) {
              // Tail: lights and bumper.
              const at = (x: number, z: number): Vec3 => [x, -3.0005, z];
              const quad = (x0: number, x1: number, z0: number, z1: number, color: string, glow?: boolean): Decal => ({
                pts: [at(x0, z0), at(x1, z0), at(x1, z1), at(x0, z1)],
                color,
                glow,
              });
              return {
                decals: [
                  quad(-1.02, 1.02, 0.3, 0.44, TRIM),
                  quad(0.68, 0.95, 0.74, 1.08, TAILLIGHT, true),
                  quad(-0.95, -0.68, 0.74, 1.08, TAILLIGHT, true),
                ],
              };
            }
            return null;
          },
        },
      ),
    );

    // Glasshouse: pillars in body colour, the windows as decals.
    const slopeY = (z: number) => 2.68 - 0.82 * (z - 1.26);
    const win = (y0: number, y1: number): [number, number][] => [[y0, 1.36], [y1, 1.36], [y1, 2.14], [y0, 2.14]];
    faces.push(
      ...prism(
        [[-2.95, 1.26], [2.68, 1.26], [1.86, 2.26], [-2.95, 2.26]],
        0.97,
        body,
        {
          sides: [
            { yz: win(-2.8, -1.66), color: GLASS, glass: true },
            { yz: win(-1.54, -0.4), color: GLASS, glass: true },
            { yz: win(-0.28, 0.86), color: GLASS, glass: true },
            { yz: [[0.98, 1.36], [slopeY(1.36) - 0.1, 1.36], [slopeY(2.14) - 0.1, 2.14], [0.98, 2.14]], color: GLASS, glass: true },
          ],
          band: (i) => {
            if (i === 1) {
              // Windscreen.
              const P = (x: number, t: number): Vec3 => [x, 2.68 - 0.82 * t + 0.001, 1.26 + t];
              return { decals: [{ pts: [P(-0.86, 0.08), P(0.86, 0.08), P(0.86, 0.92), P(-0.86, 0.92)], color: GLASS, glass: true }] };
            }
            if (i === 3) {
              // Rear window.
              const P = (x: number, z: number): Vec3 => [x, -2.9505, z];
              return { decals: [{ pts: [P(-0.8, 1.4), P(0.8, 1.4), P(0.8, 2.12), P(-0.8, 2.12)], color: GLASS, glass: true }] };
            }
            return null;
          },
        },
      ),
    );

    // Roof, and the lit EyeGo sign on it — what the rider recognises from above.
    faces.push(...prism([[-2.92, 2.26], [1.84, 2.26], [1.74, 2.42], [-2.86, 2.42]], 0.93, body));
    faces.push(...box(-0.36, 0.36, -0.42, 0.42, 2.42, 2.62, accent));

    // Wheels, slightly proud of the body; mirrors at the A-pillars.
    for (const y of [1.95, -1.95]) {
      faces.push(...cylinderX(y, 0.33, 0.33, 0.9, 1.07, TIRE, HUB));
      faces.push(...cylinderX(y, 0.33, 0.33, -0.9, -1.07, TIRE, HUB));
    }
    faces.push(...box(1.0, 1.16, 2.38, 2.5, 1.44, 1.64, TRIM), ...box(-1.16, -1.0, 2.38, 2.5, 1.44, 1.64, TRIM));

    return { id: `minibus|${body}|${accent}`, faces, radius: radiusOf(faces), shadow: { w: 2.4, l: 6.5 } };
  });
}

/** Pickup: a faceted sphere on a stem over a ground ring — "here". */
export function pickupPin(color = '#22C55E'): Model {
  return once(`pickup|${color}`, () => {
    const faces: Face[] = [
      disc(1.1, color, 0.22),
      disc(0.42, color, 0.9, 0.006),
      ...frustumZ(0, 0, 0.11, 0.08, 0, 2.5, '#E8EAED', 10),
      ...gem([0, 0, 3.05], 0.66, color),
    ];
    return { id: `pickup|${color}`, faces, radius: radiusOf(faces), shadow: { w: 0.9, l: 0.9 } };
  });
}

/** Drop-off: a dark cube on a stem with a light inset on every face — "there". */
export function dropoffPin(color = '#111318', inset = '#FFFFFF'): Model {
  return once(`dropoff|${color}|${inset}`, () => {
    const s = 0.6;
    const z0 = 2.5;
    const z1 = z0 + s * 2;
    const cube = box(-s, s, -s, s, z0, z1, color);
    const k = s * 0.42;
    const zc = (z0 + z1) / 2;
    const insets: Decal[][] = [
      [{ pts: [[-k, -k, z1 + 0.002], [k, -k, z1 + 0.002], [k, k, z1 + 0.002], [-k, k, z1 + 0.002]], color: inset }],
      [{ pts: [[s + 0.002, -k, zc - k], [s + 0.002, k, zc - k], [s + 0.002, k, zc + k], [s + 0.002, -k, zc + k]], color: inset }],
      [{ pts: [[-s - 0.002, k, zc - k], [-s - 0.002, -k, zc - k], [-s - 0.002, -k, zc + k], [-s - 0.002, k, zc + k]], color: inset }],
      [{ pts: [[k, s + 0.002, zc - k], [-k, s + 0.002, zc - k], [-k, s + 0.002, zc + k], [k, s + 0.002, zc + k]], color: inset }],
      [{ pts: [[-k, -s - 0.002, zc - k], [k, -s - 0.002, zc - k], [k, -s - 0.002, zc + k], [-k, -s - 0.002, zc + k]], color: inset }],
    ];
    cube.forEach((f, i) => (f.decals = insets[i]));
    const faces: Face[] = [disc(1.0, color, 0.18), ...frustumZ(0, 0, 0.11, 0.08, 0, z0, '#E8EAED', 10), ...cube];
    return { id: `dropoff|${color}|${inset}`, faces, radius: radiusOf(faces), shadow: { w: 0.9, l: 0.9 } };
  });
}

/** A bus stop: post, a lit sign box with a bus glyph, a kerb plate. */
export function busStop(color = '#3B82F6'): Model {
  return once(`stop|${color}`, () => {
    const sign = box(-0.42, 0.42, -0.42, 0.42, 2.3, 3.0, color);
    // The glyph: a white bus body with two dark windows, on each side face.
    const glyph = (side: 0 | 1 | 2 | 3): Decal[] => {
      const z = (a: number) => 2.3 + a;
      const P = (u: number, v: number): Vec3 =>
        side === 0 ? [0.4225, u, z(v)] : side === 1 ? [-0.4225, -u, z(v)] : side === 2 ? [-u, 0.4225, z(v)] : [u, -0.4225, z(v)];
      const quad = (u0: number, u1: number, v0: number, v1: number, color: string): Decal => ({
        pts: [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)],
        color,
      });
      return [quad(-0.28, 0.28, 0.18, 0.52, '#FFFFFF'), quad(-0.22, -0.02, 0.34, 0.47, '#1B2230'), quad(0.04, 0.22, 0.34, 0.47, '#1B2230')];
    };
    sign[1].decals = glyph(0);
    sign[2].decals = glyph(1);
    sign[3].decals = glyph(2);
    sign[4].decals = glyph(3);
    const faces: Face[] = [
      ...box(-0.55, 0.55, -0.55, 0.55, 0, 0.06, '#C9CDD3'),
      ...box(-0.07, 0.07, -0.07, 0.07, 0.06, 2.3, '#9AA1AB'),
      ...sign,
    ];
    return { id: `stop|${color}`, faces, radius: radiusOf(faces), shadow: { w: 1.0, l: 1.0 } };
  });
}

/** The rider: a figure on a ground disc, with a soft wedge showing which way they face. */
export function riderPuck(color = '#3B82F6'): Model {
  return once(`rider|${color}`, () => {
    const wedge: Face = {
      n: [0, 0, 1],
      color,
      alpha: 0.28,
      flat: true,
      pts: [[0, 0.2, 0.003], [-0.75, 1.55, 0.003], [0, 1.85, 0.003], [0.75, 1.55, 0.003]],
    };
    const faces: Face[] = [
      disc(0.95, '#FFFFFF', 0.95),
      disc(0.78, color, 1, 0.006),
      wedge,
      ...frustumZ(0, 0, 0.36, 0.22, 0.006, 1.05, '#FFFFFF', 12),
      ...gem([0, 0, 1.42], 0.3, '#FFFFFF'),
    ];
    return { id: `rider|${color}`, faces, radius: radiusOf(faces), shadow: { w: 0.8, l: 0.8 } };
  });
}
