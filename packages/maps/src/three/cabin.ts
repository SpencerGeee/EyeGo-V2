import { box, cylinderX, projectModel, shadeHex, type Decal, type Face, type Model, type Vec3 } from './engine';

/**
 * ── THE SEAT CABIN: THE BUS, ROOF OFF, SEEN FROM THE DOOR ───────────────────
 *
 * ("the choose your seat page needs a redesign completely — make the 3D
 * effect appear here but make it infinitely nice"). The hero bus lands on it
 * top-down and the camera tilts down into it: a floor with a lit aisle, low
 * walls with a light along their rim, the cab and its dash, and every seat a
 * cushion and a backrest coloured by what you can do with it. A chosen seat
 * stands taller and glows. Same engine as every other model — pure math here,
 * so it renders (and is checked) in plain node.
 */

/** The seat-map layout (rider VehicleCabin's `layoutFor`), as plain data. */
export interface CabinLayoutInput {
  kind: 'saloon' | 'van' | 'minibus';
  front: number[];
  rows: { pair: number[]; single: number | null }[];
  bench: number[];
}
export type CabinSeatState = 'free' | 'selected' | 'held' | 'taken' | 'off';
export interface CabinSeatSpot { n: number; x: number; y: number; bench: boolean }
export interface CabinPlan {
  kind: CabinLayoutInput['kind'];
  seats: CabinSeatSpot[];
  halfW: number;
  halfL: number;
  /** The sliding door's span along y (right side), front edge first. */
  door: [number, number] | null;
  driver: [number, number];
}
export interface CabinLook {
  accent: string;
  dark: boolean;
  held?: string;
  /** The tier's paint — the same livery the hero bus wore on the way in. */
  body?: string;
}
/** The camera the cabin is framed for: its tilt and every heading the orbit reaches. */
export interface CabinView { pitch: number; yaws: number[] }

const TIRE = '#1A1C21';
const HUB = '#A9AFB8';
const TRIM = '#3A414C';
const SEAT = 0.44;
const SEAT_GAP = 0.05;
const ROW_PITCH = 0.8;
const WALL_H = 0.42;
const WALL_T = 0.06;
/** Cushion height; a chosen seat rises above the rest by `LIFT`. */
export const CUSHION_Z = 0.3;
export const LIFT = 0.12;

/**
 * Where every seat stands, in metres: x right, y forward (nose = +y), floor
 * at z 0, origin mid-cabin. Driver on the LEFT (Ghana drives on the right),
 * sliding door on the RIGHT just behind the cab, rows of 2 + 1, a rear bench.
 */
export function cabinPlan(layout: CabinLayoutInput): CabinPlan {
  const saloon = layout.kind === 'saloon';
  const across = saloon ? Math.max(3, layout.bench.length) : 4;
  const halfW = (across * SEAT + (across - 1) * SEAT_GAP) / 2 + 0.06;
  const col = (i: number) => -halfW + 0.06 + SEAT / 2 + i * (SEAT + SEAT_GAP);
  const dash = saloon ? 0.9 : 0.45;
  const doorLen = saloon ? 0 : 0.62;
  const seats: CabinSeatSpot[] = [];
  const cabY = -(dash + SEAT / 2);
  layout.front.forEach((n, i) => seats.push({ n, x: col(across - layout.front.length + i), y: cabY, bench: false }));
  let y = cabY - ROW_PITCH - doorLen;
  const door: [number, number] | null = doorLen ? [cabY - SEAT / 2 - 0.06, cabY - SEAT / 2 - 0.06 - doorLen - 0.24] : null;
  for (const row of layout.rows) {
    row.pair.forEach((n, i) => seats.push({ n, x: col(i), y, bench: false }));
    if (row.single != null) seats.push({ n: row.single, x: col(across - 1), y, bench: false });
    y -= ROW_PITCH;
  }
  if (!layout.rows.length && !saloon) y += ROW_PITCH * 0.25;
  const bw = layout.bench.length * SEAT + (layout.bench.length - 1) * SEAT_GAP;
  layout.bench.forEach((n, i) => seats.push({ n, x: -bw / 2 + SEAT / 2 + i * (SEAT + SEAT_GAP), y, bench: true }));
  const rear = y - SEAT / 2 - (saloon ? 0.7 : 0.3);
  // Centre the cabin on the origin, front to back.
  const mid = rear / 2;
  for (const s of seats) s.y -= mid;
  return {
    kind: layout.kind,
    seats,
    halfW,
    halfL: -mid,
    door: door ? [door[0] - mid, door[1] - mid] : null,
    driver: [col(0), cabY - mid],
  };
}

const memo = new Map<string, Model>();

export function cabin(plan: CabinPlan, states: Record<number, CabinSeatState>, look: CabinLook, view: CabinView): Model {
  const key = `cabin|${plan.kind}|${plan.seats.length}|${look.accent}|${look.dark}|${look.body ?? ''}|${view.pitch}|${view.yaws.join(',')}|${plan.seats.map((s) => `${s.n}${(states[s.n] ?? 'off')[0]}`).join('')}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const { halfW: W, halfL: L } = plan;
  const faces: Face[] = [];
  const shell = look.body ?? (look.dark ? '#D9DEE5' : '#EEF1F5');
  const floor = look.dark ? '#151920' : '#2A3039';
  const t = WALL_T;
  const rim = (x0: number, x1: number, y0: number, y1: number): Decal => ({
    pts: [[x0, y0, WALL_H + 0.002], [x1, y0, WALL_H + 0.002], [x1, y1, WALL_H + 0.002], [x0, y1, WALL_H + 0.002]],
    color: look.accent,
    glow: true,
  });

  // Under the floor: the body skirt and the wheels — a vehicle cut open, not a tray.
  for (const f of box(-W - t, W + t, -L - t, L + t, -0.34, 0, shell)) faces.push({ ...f, order: -3 });
  for (const sx of [1, -1]) {
    for (const wy of [L - 0.7, -L + 0.65]) {
      const x0 = sx * (W + t - 0.02);
      for (const f of cylinderX(wy, -0.24, 0.29, x0, x0 + sx * 0.16, TIRE, HUB)) faces.push({ ...f, order: -2 });
    }
  }

  // The floor, with the aisle runner and its two light lines.
  const aisle = plan.kind !== 'saloon';
  const aX0 = -W + 0.06 + 2 * SEAT + SEAT_GAP + 0.04;
  const aX1 = W - 0.06 - SEAT - 0.04;
  const strip = (x0: number, x1: number, y0: number, y1: number, z: number, color: string, glow?: boolean): Decal => ({
    pts: [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]],
    color,
    glow,
  });
  faces.push({
    n: [0, 0, 1],
    color: floor,
    order: -1,
    pts: [[-W, -L, 0], [W, -L, 0], [W, L, 0], [-W, L, 0]],
    decals: aisle
      ? [
          strip(aX0, aX1, -L + 0.12, L - 0.5, 0.001, look.dark ? '#1F252E' : '#353D48'),
          strip(aX0, aX0 + 0.022, -L + 0.12, L - 0.5, 0.002, look.accent, true),
          strip(aX1 - 0.022, aX1, -L + 0.12, L - 0.5, 0.002, look.accent, true),
          ...(plan.door ? [strip(W - 0.42, W, plan.door[1], plan.door[0], 0.002, '#F5B94A', true)] : []),
        ]
      : undefined,
  });

  // Low walls with a light along the rim. The door is a real gap on the right.
  // The tier stripe runs along the outside, where it ran on the bus.
  const stripe = (x: number, y0: number, y1: number): Decal => ({
    pts: [[x, y0, 0.14], [x, y1, 0.14], [x, y1, 0.22], [x, y0, 0.22]],
    color: look.accent,
  });
  const wall = (x0: number, x1: number, y0: number, y1: number) => {
    const b = box(x0, x1, y0, y1, 0, WALL_H, shell);
    b[0] = { ...b[0], decals: [rim(x0, x1, y0, y1)] };
    if (y1 - y0 > 0.5) {
      // box(): [1] is the +x side, [2] the −x side — the outside of the right and left walls.
      if (x1 > 0) b[1] = { ...b[1], decals: [{ ...stripe(x1 + 0.001, y0, y1), pts: stripe(x1 + 0.001, y0, y1).pts.slice().reverse() }] };
      else b[2] = { ...b[2], decals: [stripe(x0 - 0.001, y0, y1)] };
    }
    faces.push(...b);
  };
  wall(-W - t, -W, -L - t, L + t);
  if (plan.door) {
    wall(W, W + t, plan.door[0], L + t);
    wall(W, W + t, -L - t, plan.door[1]);
  } else {
    wall(W, W + t, -L - t, L + t);
  }
  wall(-W, W, -L - t, -L);

  // The cab: a dash across the front with its own light, the driver's seat and wheel.
  const dash = box(-W, W, L - 0.26, L, 0, 0.36, TRIM, '#2A3039');
  dash[0] = { ...dash[0], decals: [strip(-W + 0.1, W - 0.1, L - 0.25, L - 0.22, 0.362, look.accent, true)] };
  faces.push(...dash);
  const [dx, dy] = plan.driver;
  faces.push(...seatFaces(dx, dy, '#59616D', 0));
  faces.push(...box(dx - 0.16, dx + 0.16, L - 0.4, L - 0.34, 0.34, 0.48, '#20242B'));

  // The seats.
  for (const s of plan.seats) {
    const st = states[s.n] ?? 'off';
    const color =
      st === 'selected' ? look.accent
      : st === 'held' ? look.held ?? '#F5A524'
      : st === 'taken' ? (look.dark ? '#3B414B' : '#4B525D')
      : st === 'off' ? (look.dark ? '#262B33' : '#39404A')
      : look.dark ? '#E9EEF4' : '#FFFFFF';
    faces.push(...seatFaces(s.x, s.y, color, st === 'selected' ? LIFT : 0, st === 'selected' ? look.accent : undefined));
  }
  const model: Model = { id: key, faces, radius: fitRadius(faces, view), shadow: { w: 2 * W + 0.5, l: 2 * L + 0.5 } };
  if (memo.size > 64) memo.clear(); // ponytail: whole-cache reset; per-key LRU if a page ever cycles >64 states
  memo.set(key, model);
  return model;
}

/**
 * The frame scale. A cabin is long and thin, so the usual 3D radius would
 * leave it a sliver in a square frame; this is the largest half-extent it
 * actually PROJECTS to at any heading the orbit reaches — it fills the frame
 * at its widest and never clips while turning.
 */
function fitRadius(faces: Face[], view: CabinView): number {
  let r = 0.1;
  for (const yaw of view.yaws) {
    for (const f of projectModel({ id: 'fit', faces, radius: 1 }, yaw, view.pitch)) {
      for (const [x, y] of f.pts) r = Math.max(r, Math.abs(x), Math.abs(y));
    }
  }
  return r * 1.04;
}

/** Top-centre of a seat's cushion — where its number and tap target sit. */
export function seatTop(s: CabinSeatSpot, selected: boolean): Vec3 {
  return [s.x, s.y + 0.04, CUSHION_Z + (selected ? LIFT : 0)];
}

/** One seat facing forward: cushion, backrest behind it; `glow` lights the cushion. */
function seatFaces(x: number, y: number, color: string, lift: number, glow?: string): Face[] {
  const h = SEAT / 2;
  const top = CUSHION_Z + lift;
  const cushion = box(x - h, x + h, y - h + 0.08, y + h, 0, top, shadeHex(color, 0.8), color);
  // The upholstery seam: an inset panel on every cushion, lit on a chosen one.
  cushion[0] = {
    ...cushion[0],
    decals: [{
      pts: [[x - h + 0.05, y - h + 0.13, top + 0.001], [x + h - 0.05, y - h + 0.13, top + 0.001], [x + h - 0.05, y + h - 0.05, top + 0.001], [x - h + 0.05, y + h - 0.05, top + 0.001]],
      color: shadeHex(color, 0.92),
    }],
  };
  if (glow) {
    cushion[0] = {
      ...cushion[0],
      decals: [{
        pts: [[x - h + 0.07, y - h + 0.15, top + 0.002], [x + h - 0.07, y - h + 0.15, top + 0.002], [x + h - 0.07, y + h - 0.07, top + 0.002], [x - h + 0.07, y + h - 0.07, top + 0.002]],
        color: shadeHex(glow, 1.1, 0.4),
        glow: true,
      }],
    };
  }
  const back = box(x - h, x + h, y - h, y - h + 0.09, 0, top + 0.26, shadeHex(color, 0.86), color);
  return [...cushion, ...back];
}
