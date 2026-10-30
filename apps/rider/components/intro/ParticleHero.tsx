import { useLoopsActive } from '@eyego/ui';
import React, { useEffect, useMemo } from 'react';
import { Canvas, Points, Oval, Circle, BlurMask, Group, vec } from '@shopify/react-native-skia';
import {
  Easing,
  cancelAnimation,
  interpolateColor,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { buildClouds, buildScatter } from './shapes';

/**
 * ── THE PARTICLE MORPH ──────────────────────────────────────────────────────
 *
 * The onboarding's signature: the hero dissolves into a swirling cloud of
 * dust and re-forms as the next one. One source of truth — `progress`, the
 * pager position (0…5) — so a finger dragging between pages scrubs the morph
 * live and autoplay is just a scroll.
 *
 * Per particle i, between shape a and b at fraction f:
 *   delay  d = i/N · 0.25                       (a ripple through the figure)
 *   t      = clamp((f − d) / 0.75)
 *   t < ½  source → swirl point   (ease-in)
 *   t ≥ ½  swirl point → target   (ease-out)
 * The swirl points sit on a hollow sphere around the hero and the whole cloud
 * turns ~32° while scattered; nearer particles (depth) travel 1.3× farther,
 * are bigger and brighter, and only the nearest band gets the bloom pass.
 *
 * Everything is computed in worklets on the UI thread and drawn as three
 * Skia `Points` batches — never a React view per dot. Low-end: 480 points and
 * no bloom.
 */

const BANDS = 3;
const easeIn = (t: number) => {
  'worklet';
  return t * t * t;
};
const easeOut = (t: number) => {
  'worklet';
  return 1 - Math.pow(1 - t, 3);
};

export function ParticleHero({
  progress,
  intro,
  width,
  height,
  accents,
  low,
}: {
  progress: SharedValue<number>;
  /** 0 → 1 on first launch: the cloud forms out of the centre. */
  intro: SharedValue<number>;
  width: number;
  height: number;
  /** One accent per slide. */
  accents: string[];
  low: boolean;
}) {
  const N = low ? 480 : 900;
  const data = useMemo(() => {
    const clouds = buildClouds(N);
    const { scatter, depth } = buildScatter(N);
    const bands: number[][] = Array.from({ length: BANDS }, () => []);
    depth.forEach((d, i) => bands[Math.min(BANDS - 1, Math.floor(d * BANDS))].push(i));
    return { clouds, scatter, depth, bands };
  }, [N]);

  // The idle clock: float, tilt and shimmer. One loop, cancelled on unmount.
  const clock = useSharedValue(0);
  // Gated like every other loop (RN perf rules): paused while backgrounded.
  const loopsActive = useLoopsActive();
  useEffect(() => {
    if (!loopsActive) return;
    clock.value = withRepeat(withTiming(1, { duration: 12000, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(clock);
  }, [clock, loopsActive]);

  const size = Math.min(width * 0.86, height * 0.92);
  const cx = width / 2;
  const cy = height * 0.48;
  const scale = size * 0.46;
  const { clouds, scatter, depth, bands } = data;
  const last = clouds.length - 1;

  const geom = { N, last, cx, cy, scale };
  const far = useBand(progress, intro, clock, clouds, scatter, depth, bands[0], geom);
  const mid = useBand(progress, intro, clock, clouds, scatter, depth, bands[1], geom);
  const near = useBand(progress, intro, clock, clouds, scatter, depth, bands[2], geom);

  const stops = accents.map((_, i) => i);
  const tint = useDerivedValue(() => interpolateColor(progress.value, stops, accents));
  const fade = useDerivedValue(() => 0.25 + 0.75 * intro.value);

  // A few motes of dust that drift regardless of the morph.
  const motes = useMemo(
    () => Array.from({ length: 8 }, (_, i) => ({ x: ((i * 37) % 100) / 100, y: ((i * 53) % 100) / 100, s: 0.6 + (i % 3) * 0.4, ph: i * 0.8 })),
    [],
  );

  return (
    <Canvas style={{ width, height }} pointerEvents="none">
      {/* The ground glow under the hero — the slide's accent, blurred. */}
      <Oval x={cx - width * 0.35} y={cy + size * 0.36} width={width * 0.7} height={40} color={tint} opacity={0.35}>
        <BlurMask blur={26} style="normal" />
      </Oval>

      {motes.map((m, i) => (
        <Mote key={i} clock={clock} x={m.x * width} y={m.y * height} s={m.s} ph={m.ph} color={tint} />
      ))}

      <Group opacity={fade}>
        <Points points={far} mode="points" color={tint} strokeWidth={1.6} strokeCap="round" opacity={0.45} />
        <Points points={mid} mode="points" color="#CFF7DC" strokeWidth={2.1} strokeCap="round" opacity={0.75} />
        {!low ? (
          <Points points={near} mode="points" color={tint} strokeWidth={5} strokeCap="round" opacity={0.35}>
            <BlurMask blur={4} style="normal" />
          </Points>
        ) : null}
        <Points points={near} mode="points" color="#FFFFFF" strokeWidth={2.8} strokeCap="round" opacity={0.95} />
      </Group>
    </Canvas>
  );
}

/** One depth band's points for this frame — see the header for the maths. */
function useBand(
  progress: SharedValue<number>,
  intro: SharedValue<number>,
  clock: SharedValue<number>,
  clouds: number[][],
  scatter: number[],
  depth: number[],
  band: number[],
  { N, last, cx, cy, scale }: { N: number; last: number; cx: number; cy: number; scale: number },
) {
  return useDerivedValue(() => {
      const p = progress.value;
      const a = Math.max(0, Math.min(last, Math.floor(p)));
      const b = Math.min(last, a + 1);
      const f = Math.max(0, Math.min(1, p - a));
      const A = clouds[a];
      const B = clouds[b];
      const k = clock.value * Math.PI * 2;
      const turn = Math.sin(Math.PI * f) * 0.56;
      const cr = Math.cos(turn);
      const sr = Math.sin(turn);
      const tilt = Math.cos(Math.sin(k) * 0.07);
      const float = Math.sin(k * 2) * 0.03;
      const into = easeOut(intro.value);
      const out: ReturnType<typeof vec>[] = [];
      for (let j = 0; j < band.length; j++) {
        const i = band[j];
        const d = (i / N) * 0.25;
        const t = Math.max(0, Math.min(1, (f - d) / 0.75));
        const par = 1 + depth[i] * 0.3;
        const sx = (scatter[2 * i] * cr - scatter[2 * i + 1] * sr) * par;
        const sy = (scatter[2 * i] * sr + scatter[2 * i + 1] * cr) * par;
        let x;
        let y;
        if (t < 0.5) {
          const u = easeIn(t * 2);
          x = A[2 * i] + (sx - A[2 * i]) * u;
          y = A[2 * i + 1] + (sy - A[2 * i + 1]) * u;
        } else {
          const u = easeOut((t - 0.5) * 2);
          x = sx + (B[2 * i] - sx) * u;
          y = sy + (B[2 * i + 1] - sy) * u;
        }
        x = x * tilt + Math.sin(k * 6 + i) * 0.006;
        y = y + float + Math.cos(k * 5 + i * 1.7) * 0.006;
        // First launch: everything starts as a speck at the centre.
        x = sx * 0.05 + (x - sx * 0.05) * into;
        y = sy * 0.05 + (y - sy * 0.05) * into;
        out.push(vec(cx + x * scale, cy + y * scale));
      }
      return out;
    });
}

function Mote({
  clock, x, y, s, ph, color,
}: { clock: SharedValue<number>; x: number; y: number; s: number; ph: number; color: SharedValue<string> }) {
  const cx = useDerivedValue(() => x + Math.sin(clock.value * Math.PI * 2 + ph) * 14);
  const cy = useDerivedValue(() => y + Math.cos(clock.value * Math.PI * 2 * 0.7 + ph) * 10);
  return <Circle cx={cx} cy={cy} r={s} color={color} opacity={0.35} />;
}
