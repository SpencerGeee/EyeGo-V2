/**
 * ── THE HERO SHAPES, AS POINT CLOUDS ────────────────────────────────────────
 *
 * Each onboarding hero is a set of N points in a [-1, 1] box (y down) that the
 * particle field morphs between. They are drawn procedurally — outlines walked
 * at even spacing (a crisp silhouette) plus a seeded scatter inside the fills
 * (body) — so there is no image pipeline to run and nothing to ship but code.
 * Built once at module load; plain numbers, so they cross to the UI thread
 * as-is. Deterministic (seeded), so a shape is identical on every launch.
 */

export type Pt = [number, number];
type Poly = Pt[];

/** Mulberry32 — tiny, seeded, good enough for a dot cloud. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rect = (x: number, y: number, w: number, h: number, r = 0, seg = 6): Poly => {
  if (r <= 0) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const out: Poly = [];
  const corner = (cx: number, cy: number, a0: number) => {
    for (let k = 0; k <= seg; k++) {
      const a = a0 + (k / seg) * (Math.PI / 2);
      out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  };
  corner(x + w - r, y + r, -Math.PI / 2);
  corner(x + w - r, y + h - r, 0);
  corner(x + r, y + h - r, Math.PI / 2);
  corner(x + r, y + r, Math.PI);
  return out;
};

const circle = (cx: number, cy: number, r: number, seg = 28): Poly =>
  Array.from({ length: seg }, (_, k) => {
    const a = (k / seg) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as Pt;
  });

const ellipse = (cx: number, cy: number, rx: number, ry: number, seg = 36): Poly =>
  Array.from({ length: seg }, (_, k) => {
    const a = (k / seg) * Math.PI * 2;
    return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry] as Pt;
  });

function perimeter(p: Poly, closed = true): number {
  let L = 0;
  const n = closed ? p.length : p.length - 1;
  for (let i = 0; i < n; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    L += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return L;
}

/** `count` points evenly along a polygon's edge. */
function walk(p: Poly, count: number, closed = true): Pt[] {
  const L = perimeter(p, closed);
  const out: Pt[] = [];
  if (count <= 0 || L <= 0) return out;
  const step = L / count;
  let i = 0;
  let along = 0;
  let a = p[0];
  let b = p[1 % p.length];
  let seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
  for (let k = 0; k < count; k++) {
    const d = k * step;
    while (along + seg < d && i < p.length - 1) {
      along += seg;
      i++;
      a = p[i];
      b = p[(i + 1) % p.length];
      seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    const t = seg > 0 ? (d - along) / seg : 0;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

function inside(pt: Pt, poly: Poly): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** `count` seeded points inside a polygon (and outside every hole). */
function fill(poly: Poly, count: number, rand: () => number, holes: Poly[] = []): Pt[] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly) {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  const out: Pt[] = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 60) {
    const p: Pt = [minX + rand() * (maxX - minX), minY + rand() * (maxY - minY)];
    if (inside(p, poly) && !holes.some((h) => inside(p, h))) out.push(p);
  }
  return out;
}

/** An outline + fill recipe; weights are shares of the shape's N points. */
type Part = { poly: Poly; edge: number; body?: number; holes?: Poly[]; open?: boolean };

function compose(parts: Part[], n: number, seed: number): Pt[] {
  const rand = rng(seed);
  const total = parts.reduce((s, p) => s + p.edge + (p.body ?? 0), 0);
  const out: Pt[] = [];
  for (const p of parts) {
    out.push(...walk(p.poly, Math.round((p.edge / total) * n), !p.open));
    if (p.body) out.push(...fill(p.poly, Math.round((p.body / total) * n), rand, p.holes));
  }
  while (out.length < n) out.push(out[Math.floor(rand() * out.length)] ?? [0, 0]);
  out.length = n;
  // Shuffle so the ripple delay (by index) runs through the whole figure,
  // not one part after another.
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ── The six heroes ─────────────────────────────────────────────────────────

/** 1 · A minibus in profile: body, a row of windows, two wheels. */
function van(n: number): Pt[] {
  const body: Poly = [[-0.92, 0.28], [-0.92, -0.18], [-0.78, -0.38], [0.5, -0.4], [0.74, -0.18], [0.92, 0.0], [0.92, 0.28]];
  const windows = [0, 1, 2, 3].map((k) => rect(-0.72 + k * 0.3, -0.3, 0.24, 0.16, 0.03, 3));
  const front: Poly = [[0.52, -0.3], [0.7, -0.12], [0.52, -0.12]];
  return compose(
    [
      { poly: body, edge: 34, body: 26, holes: [...windows, front] },
      ...windows.map((w) => ({ poly: w, edge: 4 })),
      { poly: front, edge: 3 },
      { poly: circle(-0.52, 0.3, 0.15), edge: 7, body: 3 },
      { poly: circle(0.56, 0.3, 0.15), edge: 7, body: 3 },
    ],
    n,
    11,
  );
}

/** 2 · Two tier cards, fanned. */
function cards(n: number): Pt[] {
  const rot = (p: Poly, a: number, cx: number, cy: number): Poly =>
    p.map(([x, y]) => [cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)] as Pt);
  const a = rot(rect(-0.86, -0.42, 0.94, 0.66, 0.1), -0.14, -0.4, -0.1);
  const b = rot(rect(-0.08, -0.22, 0.94, 0.66, 0.1), 0.12, 0.4, 0.1);
  return compose(
    [
      { poly: a, edge: 26, body: 14 },
      { poly: b, edge: 26, body: 14 },
      { poly: rect(-0.7, -0.25, 0.32, 0.1, 0.04), edge: 4 },
      { poly: rect(0.08, -0.04, 0.32, 0.1, 0.04), edge: 4 },
    ],
    n,
    23,
  );
}

/** 3 · Seats filling: two rows of seats and a falling price line. */
function seats(n: number): Pt[] {
  const parts: Part[] = [];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 4; c++) {
      parts.push({ poly: rect(-0.8 + c * 0.42, -0.5 + r * 0.42, 0.32, 0.32, 0.07), edge: 6, body: c + r * 4 < 5 ? 5 : 0 });
    }
  }
  const line: Poly = [[-0.85, 0.5], [-0.4, 0.42], [0.0, 0.56], [0.4, 0.64], [0.85, 0.76]];
  parts.push({ poly: line, edge: 10, open: true });
  return compose(parts, n, 37);
}

/** 4 · A payment card and a phone showing a code. */
function pay(n: number): Pt[] {
  return compose(
    [
      { poly: rect(-0.92, -0.32, 1.08, 0.7, 0.1), edge: 26, body: 12 },
      { poly: rect(-0.92, -0.16, 1.08, 0.12), edge: 6, body: 6 },
      { poly: rect(-0.78, 0.12, 0.22, 0.14, 0.03), edge: 3 },
      { poly: rect(0.3, -0.56, 0.56, 1.06, 0.12), edge: 22, body: 6, holes: [rect(0.38, -0.44, 0.4, 0.78, 0.04)] },
      ...[0, 1, 2, 3].map((k) => ({ poly: circle(0.42 + k * 0.106, -0.04, 0.034, 8), edge: 2, body: 1 })),
    ],
    n,
    41,
  );
}

/** 5 · A map pin on a pulsing ring, a route curling in. */
function pin(n: number): Pt[] {
  const drop: Poly = [];
  for (let k = 0; k <= 40; k++) {
    const a = Math.PI * 0.82 + (k / 40) * Math.PI * 1.36;
    drop.push([Math.cos(a) * 0.34, -0.3 + Math.sin(a) * 0.34]);
  }
  drop.push([0, 0.34]);
  const route: Poly = [[-0.9, 0.2], [-0.62, 0.02], [-0.3, 0.12], [-0.08, 0.36]];
  return compose(
    [
      { poly: drop, edge: 26, body: 14, holes: [circle(0, -0.3, 0.12, 16)] },
      { poly: circle(0, -0.3, 0.12, 16), edge: 6 },
      { poly: ellipse(0, 0.42, 0.62, 0.16), edge: 18 },
      { poly: ellipse(0, 0.42, 0.36, 0.09), edge: 8 },
      { poly: route, edge: 8, open: true },
    ],
    n,
    53,
  );
}

/** 6 · The EyeGo mark: an eye with its iris, a light streak through it. */
function mark(n: number): Pt[] {
  const upper: Poly = [];
  const lower: Poly = [];
  for (let k = 0; k <= 32; k++) {
    const x = -0.9 + (k / 32) * 1.8;
    const y = 0.42 * Math.sqrt(Math.max(0, 1 - (x / 0.9) ** 2)) * 0.95;
    upper.push([x, -y]);
    lower.push([x, y]);
  }
  const eye: Poly = [...upper, ...lower.slice(1, -1).reverse()];
  return compose(
    [
      { poly: eye, edge: 30 },
      { poly: circle(0, 0, 0.26), edge: 16, body: 16, holes: [circle(0, 0, 0.1, 16)] },
      { poly: circle(0, 0, 0.1, 16), edge: 6 },
      { poly: [[-1, 0.62], [1, 0.62]], edge: 10, open: true },
    ],
    n,
    67,
  );
}

export const SHAPES = [van, cards, seats, pay, pin, mark] as const;

/** All six clouds at `n` points, flattened `[x0, y0, x1, y1, …]` per shape. */
export function buildClouds(n: number): number[][] {
  return SHAPES.map((make) => make(n).flatMap(([x, y]) => [x, y]));
}

/**
 * A stable "swirl" offset per particle: a point on a hollow sphere, projected
 * — the dust the hero dissolves into between shapes. Plus a depth 0..1 that
 * decides size, brightness and parallax.
 */
export function buildScatter(n: number): { scatter: number[]; depth: number[] } {
  const rand = rng(97);
  const scatter: number[] = [];
  const depth: number[] = [];
  for (let i = 0; i < n; i++) {
    const u = rand() * 2 - 1;
    const th = rand() * Math.PI * 2;
    const r = 0.95 + rand() * 0.35;
    const s = Math.sqrt(1 - u * u);
    scatter.push(Math.cos(th) * s * r, u * r * 0.8);
    depth.push((Math.sin(th) * s + 1) / 2);
  }
  return { scatter, depth };
}
