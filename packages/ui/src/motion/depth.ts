import { Easing, Keyframe, useReducedMotion } from 'react-native-reanimated';
import { useMeasuredPerformanceTier } from '../effects/usePerformanceTier';

/**
 * ── A STAGE CHANGE IS A FADE-THROUGH ON ONE AXIS ────────────────────────────
 *
 * REPLACED the 3D card-deck turn (perspective, tilt, sink) that every step of
 * both apps used. On a phone it read as heavy and laggy ("the morph from
 * driver-is-here to arriving-in is bad and laggy") and it was one of five
 * motion systems stacked on the same transition.
 *
 * This is Material's shared-axis / fade-through, which is also what Uber and
 * Bolt do inside their sheets: the old content leaves fast (fades and lifts a
 * few points), the new content waits for it, then rises a few points and
 * fades in. Short, calm, transform + opacity only — nothing to lay out, nothing
 * a busy JS thread can stall. The names are kept so every caller switches at once.
 */
const RISE = 10;
const LIFT = 6;
/** Material's emphasized-decelerate: arrives quickly, settles softly, never overshoots. */
const IN = Easing.bezier(0.05, 0.7, 0.1, 1);
const OUT = Easing.bezier(0.3, 0, 0.8, 0.15);

/** Forward (+1) or back (−1) through a flow. */
export type DepthDirection = 1 | -1;

const clamp01 = (v: number) => {
  'worklet';
  return v < 0 ? 0 : v > 1 ? 1 : v;
};

/** Incoming content for a 0→1 progress: waits for the outgoing, then rises in. Worklet. */
export function depthIncoming(progress: number, dir: number = 1) {
  'worklet';
  const p = clamp01((progress - 0.3) / 0.7);
  return {
    opacity: p,
    transform: [{ translateY: (1 - p) * (dir >= 0 ? RISE : -RISE) }],
  };
}

/** Outgoing content for the same progress: gone in the first third. Worklet. */
export function depthOutgoing(progress: number, dir: number = 1) {
  'worklet';
  const p = clamp01(progress / 0.3);
  return {
    opacity: 1 - p,
    transform: [{ translateY: p * (dir >= 0 ? -LIFT : LIFT) }],
  };
}

const enterFrames = (dy: number) => ({
  0: { opacity: 0, transform: [{ translateY: dy }] },
  // The hold is the "through": the old content is leaving during it.
  30: { opacity: 0, transform: [{ translateY: dy }] },
  100: { opacity: 1, transform: [{ translateY: 0 }], easing: IN },
});

/** A step arriving forward. */
export const depthEnter = new Keyframe(enterFrames(RISE)).duration(340);

/** The forward entrance held back `ms` — a NEW instance every call (Keyframe builders mutate). */
export const depthEnterAfter = (ms: number) => new Keyframe(enterFrames(RISE)).duration(340).delay(ms);

/** A step arriving back. */
export const depthEnterBack = new Keyframe(enterFrames(-RISE)).duration(340);

/** A step leaving. Direction-neutral: `exiting` reads the element's last render. */
export const depthExit = new Keyframe({
  0: { opacity: 1, transform: [{ translateY: 0 }] },
  100: { opacity: 0, transform: [{ translateY: -LIFT }], easing: OUT },
}).duration(110);

/**
 * Should stage changes animate at all on this phone right now?
 *
 * Reduce Motion always wins; otherwise only a device the probe measured as
 * genuinely struggling gets the plain dissolve.
 */
export function useDepthMotion(): boolean {
  const reduce = useReducedMotion();
  const tier = useMeasuredPerformanceTier();
  return !reduce && tier !== 'low';
}
