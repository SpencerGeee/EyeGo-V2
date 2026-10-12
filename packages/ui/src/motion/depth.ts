import { Easing, Keyframe } from 'react-native-reanimated';

/**
 * DEPTH — the booking flow's page turn ("everything should be having a 3D
 * effect that morphs and moves from one stage to the next").
 *
 * The outgoing page tilts back and recedes; the incoming one rises from below
 * and settles flat. Transform and opacity only, so it composites on the UI
 * thread with no layout. `perspective` must be the FIRST transform and every
 * frame must list the same transforms in the same order, or Android drops the
 * 3D and iOS interpolates nonsense.
 *
 * Gate on the device: on a 'low' performance tier, or with Reduce Motion on,
 * use the flat fade instead — see `usePerformanceTier`.
 */
const P = 900;
const RISE = 28;
const TILT_IN = -9;
const TILT_OUT = 7;

/** Incoming page for a 0→1 progress. Worklet. */
export function depthIncoming(p: number) {
  'worklet';
  return {
    opacity: p,
    transform: [
      { perspective: P },
      { translateY: (1 - p) * RISE },
      { rotateX: `${(1 - p) * TILT_IN}deg` },
      { scale: 0.96 + 0.04 * p },
    ],
  };
}

/** Outgoing page for the same progress. Worklet. */
export function depthOutgoing(p: number) {
  'worklet';
  return {
    opacity: 1 - p,
    transform: [
      { perspective: P },
      { translateY: -p * (RISE / 2) },
      { rotateX: `${p * TILT_OUT}deg` },
      { scale: 1 - 0.05 * p },
    ],
  };
}

/** The same rise as a mount animation, for steps inside one stage. */
export const depthEnter = new Keyframe({
  0: { opacity: 0, transform: [{ perspective: P }, { translateY: RISE }, { rotateX: `${TILT_IN}deg` }, { scale: 0.97 }] },
  100: {
    opacity: 1,
    transform: [{ perspective: P }, { translateY: 0 }, { rotateX: '0deg' }, { scale: 1 }],
    easing: Easing.out(Easing.cubic),
  },
}).duration(460);
