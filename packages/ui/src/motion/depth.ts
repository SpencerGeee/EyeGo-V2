import { Easing, Keyframe, useReducedMotion } from 'react-native-reanimated';
import { useMeasuredPerformanceTier } from '../effects/usePerformanceTier';

/**
 * DEPTH — the booking flow's page turn ("everything should be having a 3D
 * effect that morphs and moves from one stage to the next … one continuous
 * story").
 *
 * A CARD DECK. Going forward, the page you are on tips back on its hinge and
 * sinks away into the distance while the next one swings up from below and
 * lands flat in front of you. Going back is the same move in reverse: the
 * current card drops away below and the previous one comes back down out of
 * the depth it fell into. Every stage of both apps turns on this one move, so
 * the flow reads as ONE story told card by card, not a set of screens.
 *
 * Transform and opacity only, so it composites on the UI thread with no
 * layout. `perspective` must be the FIRST transform and every frame must list
 * the same transforms in the same order, or Android drops the 3D and iOS
 * interpolates nonsense.
 *
 * The first pass was 9° and 28 pt — measured on a phone it read as a fade.
 * These numbers are deliberately theatrical; the perspective is deep enough
 * that a full-screen page tipping 24° does not swing its near edge off the
 * sides of the display.
 */
const P = 1100;
const RISE = 84;
const TILT_IN = -24;
const TILT_OUT = 20;
const SINK = 0.14;
/** Expo-out: the card arrives fast and spends its last frames settling flat. */
const LAND = Easing.bezier(0.16, 1, 0.3, 1);

/** Forward (+1) or back (−1) through a flow. */
export type DepthDirection = 1 | -1;

const clamp01 = (v: number) => {
  'worklet';
  return v < 0 ? 0 : v > 1 ? 1 : v;
};

/** Incoming page for a 0→1 progress. Worklet. */
export function depthIncoming(progress: number, dir: number = 1) {
  'worklet';
  const p = clamp01(progress);
  const q = 1 - p;
  return {
    opacity: clamp01(p * 1.7),
    transform: [
      { perspective: P },
      // Forward: up from below, top edge leaning toward you. Back: down from
      // the depth above, top edge leaning away — where the old card went.
      { translateY: q * (dir >= 0 ? RISE : -RISE * 0.7) },
      { rotateX: `${q * (dir >= 0 ? TILT_IN : TILT_OUT)}deg` },
      { scale: 1 - q * (dir >= 0 ? 0.08 : SINK) },
    ],
  };
}

/** Outgoing page for the same progress. Worklet. */
export function depthOutgoing(progress: number, dir: number = 1) {
  'worklet';
  const p = clamp01(progress);
  return {
    opacity: clamp01(1 - p * 1.6),
    transform: [
      { perspective: P },
      { translateY: p * (dir >= 0 ? -RISE * 0.55 : RISE) },
      { rotateX: `${p * (dir >= 0 ? TILT_OUT : TILT_IN)}deg` },
      { scale: 1 - p * (dir >= 0 ? SINK : 0.06) },
    ],
  };
}

const flat = { opacity: 1, transform: [{ perspective: P }, { translateY: 0 }, { rotateX: '0deg' }, { scale: 1 }] };

const enterFrames = () => ({
  0: { opacity: 0, transform: [{ perspective: P }, { translateY: RISE }, { rotateX: `${TILT_IN}deg` }, { scale: 0.92 }] },
  100: { ...flat, easing: LAND },
});

/** A step inside one stage arriving FORWARD: swings up from below and lands flat. */
export const depthEnter = new Keyframe(enterFrames()).duration(640);

/**
 * The forward entrance held back `ms` — a NEW instance every call. Never write
 * `depthEnter.delay(…)`: Keyframe's builders mutate and return `this`, so that
 * would delay every other user of the shared one too. Memoise the result.
 */
export const depthEnterAfter = (ms: number) => new Keyframe(enterFrames()).duration(640).delay(ms);

/** A step arriving BACK: comes down out of the depth the forward move sent it into. */
export const depthEnterBack = new Keyframe({
  0: { opacity: 0, transform: [{ perspective: P }, { translateY: -RISE * 0.7 }, { rotateX: `${TILT_OUT}deg` }, { scale: 1 - SINK }] },
  100: { ...flat, easing: LAND },
}).duration(600);

/**
 * A step leaving. Direction-neutral ON PURPOSE: Reanimated reads `exiting` from
 * the element's LAST render, which happened before anyone knew which way the
 * next step goes. Tipping back and sinking straight away reads right for both.
 */
export const depthExit = new Keyframe({
  0: flat,
  100: {
    opacity: 0,
    transform: [{ perspective: P }, { translateY: -RISE * 0.3 }, { rotateX: `${TILT_OUT * 0.8}deg` }, { scale: 1 - SINK }],
    easing: Easing.in(Easing.cubic),
  },
}).duration(340);

/**
 * Should the flow turn in 3D on this phone right now?
 *
 * ONE gate for every stage of both apps (it used to be re-derived in six
 * files). Reduce Motion always wins. Otherwise only a device the probe has
 * measured as genuinely struggling — in all three windows, not once during
 * launch — falls back to the flat dissolve. The static shader ceiling (old
 * Android) is NOT consulted: tilting a card costs the GPU nothing.
 */
export function useDepthMotion(): boolean {
  const reduce = useReducedMotion();
  const tier = useMeasuredPerformanceTier();
  return !reduce && tier !== 'low';
}
