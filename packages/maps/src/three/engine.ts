/**
 * ── A SMALL 3D ENGINE FOR MAP MARKERS ───────────────────────────────────────
 *
 * BUGFIX ("we need a better 3D model of the bus — if you tilt the map the 2D
 * image becomes flat"). Every vehicle on both maps was a top-down PNG: a decal
 * that lies on the ground, so tilting the camera squashed it into a sliver.
 * MapLibre cannot load 3D model files, so the models are drawn by us:
 *
 *   - Models are low-poly meshes built in code (models.ts): faces with an
 *     outward normal, a colour, and DECALS (windows, lights, livery) drawn on
 *     top of their face so they never fight the depth sort.
 *   - `projectModel` turns a mesh into 2D polygons for a heading (yaw relative
 *     to the screen) and the map's tilt (pitch): orthographic — at marker size
 *     perspective is invisible — with back-face culling, painter's ordering and
 *     one directional light. Pure math, unit-tested without Skia.
 *   - `drawModel` paints that with Skia. It renders into a Picture (for marker
 *     views — swapped synchronously, so a turning bus never flickers) or into
 *     a PNG data URI (for the native user-location layer, which takes images).
 *
 * Frames are cached by model, quantised yaw/pitch and size: a parked bus is
 * drawn once, and twelve buses facing roughly the same way share their frames.
 */

export type Vec3 = [number, number, number];

export interface Decal {
  pts: Vec3[];
  color: string;
  /** Light sources (head/tail lights): unshaded, with a soft halo. */
  glow?: boolean;
  /** Glass: darkened, with a sky sheen that brightens as it faces up. */
  glass?: boolean;
}

export interface Face {
  pts: Vec3[];
  /** Outward unit normal, in model space. */
  n: Vec3;
  color: string;
  alpha?: number;
  decals?: Decal[];
  /** Unlit (ground rings, halos). */
  flat?: boolean;
}

export interface Model {
  id: string;
  faces: Face[];
  /** Max distance of any vertex from the ground origin — fixes the frame scale. */
  radius: number;
  /** Footprint of the soft contact shadow (metres across x, along y). */
  shadow?: { w: number; l: number };
}

export interface ProjectedPoly {
  pts: [number, number][];
  fill: string;
  alpha: number;
  glow?: boolean;
}

export interface ProjectedFace extends ProjectedPoly {
  depth: number;
  decals: ProjectedPoly[];
}

// ── colour ──────────────────────────────────────────────────────────────────

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** `k` < 1 darkens, > 1 lightens; `sheen` mixes toward white. */
export function shadeHex(hex: string, k: number, sheen = 0): string {
  const [r, g, b] = rgb(hex);
  const f = (c: number) => Math.round(clamp(c * k + (255 - c * k) * sheen, 0, 255));
  return `#${[f(r), f(g), f(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

// ── projection ──────────────────────────────────────────────────────────────

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
/** Key light: high, from the upper left of the screen, slightly toward the viewer. */
const LIGHT = norm([-0.45, -0.25, 0.86]);
const AMBIENT = 0.58;

/**
 * Mesh → painter-ordered 2D polygons in model units (y up).
 *
 * `yawDeg`: the model's nose, clockwise from screen-up (heading − map bearing).
 * `pitchDeg`: map tilt, 0 = straight down.
 */
export function projectModel(model: Model, yawDeg: number, pitchDeg: number): ProjectedFace[] {
  const yaw = (yawDeg * Math.PI) / 180;
  const th = (clamp(pitchDeg, 0, 72) * Math.PI) / 180;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const ct = Math.cos(th);
  const st = Math.sin(th);
  // Clockwise turn in the ground plane (x right, y up).
  const rot = (p: Vec3): Vec3 => [p[0] * cy + p[1] * sy, -p[0] * sy + p[1] * cy, p[2]];
  // Camera tilted toward screen-down: screen up = (0, cosθ, sinθ); toward camera = (0, −sinθ, cosθ).
  const toScreen = (p: Vec3): [number, number] => [p[0], p[1] * ct + p[2] * st];
  const depthOf = (p: Vec3) => -p[1] * st + p[2] * ct;

  const out: ProjectedFace[] = [];
  for (const f of model.faces) {
    const n = rot(f.n);
    const facing = -n[1] * st + n[2] * ct;
    if (facing <= 0.001) continue; // back face
    const pts = f.pts.map(rot);
    const lambert = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
    const k = f.flat ? 1 : AMBIENT + (1 - AMBIENT) * lambert;
    const depth = pts.reduce((s, p) => s + depthOf(p), 0) / pts.length;
    out.push({
      pts: pts.map(toScreen),
      fill: shadeHex(f.color, k),
      alpha: f.alpha ?? 1,
      depth,
      decals: (f.decals ?? []).map((d) => ({
        pts: d.pts.map(rot).map(toScreen),
        // Glass catches the sky the more it faces up; lights are not lit, they light.
        fill: d.glow ? d.color : d.glass ? shadeHex(d.color, k, 0.08 + 0.3 * Math.max(0, n[2])) : shadeHex(d.color, k),
        alpha: 1,
        glow: d.glow,
      })),
    });
  }
  out.sort((a, b) => a.depth - b.depth); // far → near
  return out;
}

// ── drawing (Skia, required lazily so the math above runs in plain node) ────

/* eslint-disable @typescript-eslint/no-var-requires */
function skia(): any {
  return require('@shopify/react-native-skia');
}

/** Paint `model` into a Skia canvas of `px`×`px`, ground origin at the centre. */
export function drawModel(canvas: any, model: Model, yawDeg: number, pitchDeg: number, px: number): void {
  const { Skia, BlurStyle } = skia();
  const scale = (px * 0.46) / model.radius;
  const c = px / 2;
  const X = (x: number) => c + x * scale;
  const Y = (y: number) => c - y * scale;
  const pathOf = (pts: [number, number][]) => {
    const p = Skia.Path.Make();
    pts.forEach(([x, y], i) => (i ? p.lineTo(X(x), Y(y)) : p.moveTo(X(x), Y(y))));
    p.close();
    return p;
  };

  // Contact shadow: the footprint on the ground, blurred.
  if (model.shadow) {
    const { w, l } = model.shadow;
    const ground: ProjectedFace[] = projectModel(
      {
        id: 'shadow',
        radius: model.radius,
        faces: [{ n: [0, 0, 1], color: '#000000', flat: true, pts: [[-w / 2, -l / 2, 0], [w / 2, -l / 2, 0], [w / 2, l / 2, 0], [-w / 2, l / 2, 0]] }],
      },
      yawDeg,
      pitchDeg,
    );
    if (ground[0]) {
      const paint = Skia.Paint();
      paint.setAntiAlias(true);
      paint.setColor(Skia.Color('rgba(0,0,0,0.34)'));
      paint.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, Math.max(1.5, px * 0.035), true));
      canvas.drawPath(pathOf(ground[0].pts), paint);
    }
  }

  const fill = Skia.Paint();
  fill.setAntiAlias(true);
  // A hairline of the face's own colour closes the AA seams between faces.
  const seam = Skia.Paint();
  seam.setAntiAlias(true);
  seam.setStyle(1);
  seam.setStrokeWidth(Math.max(0.6, px / 220));
  const halo = Skia.Paint();
  halo.setAntiAlias(true);
  halo.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, Math.max(1, px * 0.02), true));

  for (const f of projectModel(model, yawDeg, pitchDeg)) {
    const p = pathOf(f.pts);
    fill.setColor(Skia.Color(f.fill));
    fill.setAlphaf(f.alpha);
    canvas.drawPath(p, fill);
    if (f.alpha >= 1) {
      seam.setColor(Skia.Color(f.fill));
      canvas.drawPath(p, seam);
    }
    for (const d of f.decals) {
      const dp = pathOf(d.pts);
      if (d.glow) {
        halo.setColor(Skia.Color(d.fill));
        halo.setAlphaf(0.55);
        canvas.drawPath(dp, halo);
      }
      fill.setColor(Skia.Color(d.fill));
      fill.setAlphaf(1);
      canvas.drawPath(dp, fill);
    }
  }
}

// ── frames ──────────────────────────────────────────────────────────────────

const YAW_STEP = 4;
const PITCH_STEP = 5;
export const quantYaw = (deg: number) => ((Math.round((((deg % 360) + 360) % 360) / YAW_STEP) * YAW_STEP) % 360);
export const quantPitch = (deg: number) => clamp(Math.round((Number.isFinite(deg) ? deg : 0) / PITCH_STEP) * PITCH_STEP, 0, 70);

const CACHE_CAP = 360;
const pictures = new Map<string, any>();
const uris = new Map<string, string>();

function remember<T>(cache: Map<string, T>, key: string, make: () => T | null): T | null {
  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key);
    cache.set(key, hit); // LRU touch
    return hit;
  }
  const v = make();
  if (v == null) return null;
  cache.set(key, v);
  if (cache.size > CACHE_CAP) cache.delete(cache.keys().next().value as string);
  return v;
}

/** A recorded Skia Picture of one frame — for <Canvas><Picture/></Canvas>. */
export function modelPicture(model: Model, yawDeg: number, pitchDeg: number, px: number): any {
  const yaw = quantYaw(yawDeg);
  const pitch = quantPitch(pitchDeg);
  return remember(pictures, `${model.id}|${yaw}|${pitch}|${px}`, () => {
    const { Skia } = skia();
    const rec = Skia.PictureRecorder();
    const canvas = rec.beginRecording(Skia.XYWHRect(0, 0, px, px));
    drawModel(canvas, model, yaw, pitch, px);
    return rec.finishRecordingAsPicture();
  });
}

/** One frame as a PNG data URI — for native map layers that take an image. */
export function modelDataUri(model: Model, yawDeg: number, pitchDeg: number, px: number): string | null {
  const yaw = quantYaw(yawDeg);
  const pitch = quantPitch(pitchDeg);
  return remember(uris, `${model.id}|${yaw}|${pitch}|${px}`, () => {
    try {
      const { Skia } = skia();
      const surface = Skia.Surface.Make(px, px);
      if (!surface) return null;
      const canvas = surface.getCanvas();
      canvas.clear(Skia.Color('transparent'));
      drawModel(canvas, model, yaw, pitch, px);
      surface.flush?.();
      const b64 = surface.makeImageSnapshot().encodeToBase64();
      return b64 ? `data:image/png;base64,${b64}` : null;
    } catch {
      return null;
    }
  });
}

// ── primitive builders (outward normals by construction) ───────────────────

type YZ = [number, number];

/**
 * A y–z profile (counter-clockwise, y forward, z up) extruded across
 * x ∈ [−hw, hw]: both sides plus one band per edge. `sideDecals` are given in
 * the profile's own (y, z) and mirrored onto both sides.
 */
export function prism(
  profile: YZ[],
  hw: number,
  color: string,
  opts: {
    sides?: { yz: YZ[]; color: string; glass?: boolean; glow?: boolean }[];
    /** Per-edge override (colour, decals) for the band faces, by edge index. */
    band?: (i: number, n: Vec3) => { color?: string; decals?: Decal[] } | null;
  } = {},
): Face[] {
  const faces: Face[] = [];
  const decalsAt = (x: number): Decal[] =>
    (opts.sides ?? []).map((d) => ({ pts: d.yz.map(([y, z]) => [x, y, z] as Vec3), color: d.color, glass: d.glass, glow: d.glow }));
  faces.push({ n: [1, 0, 0], color, pts: profile.map(([y, z]) => [hw, y, z]), decals: decalsAt(hw * 1.0005) });
  faces.push({ n: [-1, 0, 0], color, pts: [...profile].reverse().map(([y, z]) => [-hw, y, z]), decals: decalsAt(-hw * 1.0005) });
  for (let i = 0; i < profile.length; i++) {
    const [y0, z0] = profile[i];
    const [y1, z1] = profile[(i + 1) % profile.length];
    const n = norm([0, z1 - z0, -(y1 - y0)]);
    if (n[2] < -0.9) continue; // the underside is never seen
    const extra = opts.band?.(i, n) ?? null;
    faces.push({
      n,
      color: extra?.color ?? color,
      pts: [[-hw, y0, z0], [hw, y0, z0], [hw, y1, z1], [-hw, y1, z1]],
      decals: extra?.decals,
    });
  }
  return faces;
}

/** Axis-aligned box. */
export function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: string, top?: string): Face[] {
  return [
    { n: [0, 0, 1], color: top ?? color, pts: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]] },
    { n: [1, 0, 0], color, pts: [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]] },
    { n: [-1, 0, 0], color, pts: [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]] },
    { n: [0, 1, 0], color, pts: [[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]] },
    { n: [0, -1, 0], color, pts: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]] },
  ];
}

/** Cylinder along x (a wheel): `seg` sides plus two caps; `hub` decal on the outer cap. */
export function cylinderX(y: number, z: number, r: number, x0: number, x1: number, color: string, hub?: string, seg = 12): Face[] {
  const ring = Array.from({ length: seg }, (_, i) => (i / seg) * Math.PI * 2);
  const at = (x: number, a: number, rr = r): Vec3 => [x, y + Math.cos(a) * rr, z + Math.sin(a) * rr];
  const faces: Face[] = ring.map((a, i) => {
    const b = ring[(i + 1) % seg];
    const m = (a + b) / 2;
    return { n: [0, Math.cos(m), Math.sin(m)] as Vec3, color, pts: [at(x0, a), at(x1, a), at(x1, b), at(x0, b)] };
  });
  const outer = Math.abs(x1) > Math.abs(x0) ? x1 : x0;
  const inner = outer === x1 ? x0 : x1;
  const sign = outer > 0 ? 1 : -1;
  faces.push({
    n: [sign, 0, 0],
    color,
    pts: ring.map((a) => at(outer, a)),
    decals: hub ? [{ pts: ring.map((a) => at(outer + sign * 0.002, a, r * 0.52)), color: hub }] : undefined,
  });
  faces.push({ n: [-sign, 0, 0], color, pts: ring.map((a) => at(inner, a)) });
  return faces;
}

/** Vertical frustum (r0 at z0 → r1 at z1), with a top cap. */
export function frustumZ(cx: number, cy: number, r0: number, r1: number, z0: number, z1: number, color: string, seg = 12): Face[] {
  const ring = Array.from({ length: seg }, (_, i) => (i / seg) * Math.PI * 2);
  const at = (a: number, r: number, z: number): Vec3 => [cx + Math.cos(a) * r, cy + Math.sin(a) * r, z];
  const slope = (r0 - r1) / Math.max(0.0001, z1 - z0);
  const faces: Face[] = ring.map((a, i) => {
    const b = ring[(i + 1) % seg];
    const m = (a + b) / 2;
    return { n: norm([Math.cos(m), Math.sin(m), slope]), color, pts: [at(a, r0, z0), at(b, r0, z0), at(b, r1, z1), at(a, r1, z1)] };
  });
  faces.push({ n: [0, 0, 1], color, pts: ring.map((a) => at(a, r1, z1)) });
  return faces;
}

/** Low-poly sphere (icosahedron, one subdivision = 80 facets — a cut gem). */
export function gem(c: Vec3, r: number, color: string): Face[] {
  const t = (1 + Math.sqrt(5)) / 2;
  let v: Vec3[] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
    [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map((p) => norm(p as Vec3));
  let tris: [number, number, number][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  const mid = new Map<string, number>();
  const m = (a: number, b: number) => {
    const k = a < b ? `${a}_${b}` : `${b}_${a}`;
    const hit = mid.get(k);
    if (hit !== undefined) return hit;
    v.push(norm([(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2]));
    mid.set(k, v.length - 1);
    return v.length - 1;
  };
  tris = tris.flatMap(([a, b, cc]) => {
    const ab = m(a, b), bc = m(b, cc), ca = m(cc, a);
    return [[a, ab, ca], [b, bc, ab], [cc, ca, bc], [ab, bc, ca]] as [number, number, number][];
  });
  return tris.map(([a, b, cc]) => {
    const n = norm([v[a][0] + v[b][0] + v[cc][0], v[a][1] + v[b][1] + v[cc][1], v[a][2] + v[b][2] + v[cc][2]]);
    const P = (p: Vec3): Vec3 => [c[0] + p[0] * r, c[1] + p[1] * r, c[2] + p[2] * r];
    return { n, color, pts: [P(v[a]), P(v[b]), P(v[cc])] };
  });
}

/** A flat disc on the ground (rings, halos, ground plates). */
export function disc(r: number, color: string, alpha = 1, z = 0.004, seg = 24): Face {
  return {
    n: [0, 0, 1],
    color,
    alpha,
    flat: true,
    pts: Array.from({ length: seg }, (_, i) => {
      const a = (i / seg) * Math.PI * 2;
      return [Math.cos(a) * r, Math.sin(a) * r, z] as Vec3;
    }),
  };
}

export function radiusOf(faces: Face[]): number {
  let r = 0;
  for (const f of faces) for (const p of f.pts) r = Math.max(r, Math.hypot(p[0], p[1], p[2]));
  return r;
}
