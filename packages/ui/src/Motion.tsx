import React, { forwardRef } from 'react';
import { Easing } from 'react-native-reanimated';
import { MotiView as BaseMotiView, MotiText as BaseMotiText } from 'moti';
import { defaultTransition, durations, easings } from '@eyego/config';

/**
 * Moti, with the platform's motion instead of the library's.
 *
 * THE PROBLEM THIS SOLVES. Moti's implicit transition is Reanimated 3's spring
 * default — `damping: 10, stiffness: 100`, i.e. ζ = 0.5, a **16.3 % overshoot
 * that takes 1.46 s to settle**. Roughly forty screens across the two apps
 * mount a `<MotiView>` with no `transition` prop, so forty screens were
 * animating with a bounce Apple's own system would never produce. That is the
 * whole of "the animations aren't snappy, it feels like a toy" — and because
 * it came from a default rather than from any line of code, there was nothing
 * to find by reading the screens.
 *
 * Fixing it at forty call sites would have fixed it until the forty-first
 * screen. So the fix is here: both apps import `MotiView` from `@eyego/ui`
 * rather than from `moti`, and an unspecified transition resolves to
 * `springs.standard` — Apple's ζ = 1.0, zero overshoot.
 *
 * A component that genuinely wants different physics still passes `transition`
 * and still wins. This only replaces the *absence* of a decision.
 *
 * @see packages/config/src/motion.ts for the tokens and their derivation.
 */

type MotiViewProps = React.ComponentProps<typeof BaseMotiView>;
type MotiTextProps = React.ComponentProps<typeof BaseMotiText>;

/**
 * Fill in whatever the caller left unsaid, without overriding what they said.
 *
 * A caller who asked for `type: 'timing'` gets timing — with the iOS
 * decelerate curve and the standard duration filled in, because a timing
 * transition with no easing is linear, and linear position changes are the
 * other half of what reads as "not native".
 */
function resolveTransition(transition: any) {
  const t = transition ?? {};
  if (t.type === 'timing') {
    return {
      duration: durations.base,
      easing: Easing.bezier(...(easings.decelerate as unknown as [number, number, number, number])),
      ...t,
    };
  }
  return { ...defaultTransition, ...t };
}

// `as any` on the spread only: Moti's props are a deeply generic type that does
// not survive being destructured and re-spread, and widening the public props
// type instead would lose the autocomplete every call site relies on.
export const MotiView = forwardRef<any, MotiViewProps>(function MotiView(
  { transition, ...rest },
  ref,
) {
  const Base = BaseMotiView as any;
  return <Base ref={ref} transition={resolveTransition(transition)} {...rest} />;
});

export const MotiText = forwardRef<any, MotiTextProps>(function MotiText(
  { transition, ...rest },
  ref,
) {
  const Base = BaseMotiText as any;
  return <Base ref={ref} transition={resolveTransition(transition)} {...rest} />;
});

// Re-exported so a screen never has a reason to import from 'moti' directly —
// mixing the two would quietly reintroduce the default this file exists to
// remove.
export { AnimatePresence } from 'moti';
