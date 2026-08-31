import React, { useEffect, useMemo } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeOut,
  FadeOutDown,
  FadeOutUp,
  ZoomOut,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { springs } from '@eyego/config';
import { useSmoothScreen } from '../motion/smooth/SmoothScreen';

/**
 * THE SHARED ENTRANCE — NOW ON THE SMOOTHNESS CLOCK.
 *
 * This is the single component every screen in both apps uses for mount
 * animations: 127 call sites across 26 files. Which is exactly why it is the
 * right place to fix navigation jank, and the wrong place to have been using
 * Reanimated LAYOUT animations.
 *
 * ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
 * `entering={FadeInUp.delay(d).duration(250)}` has two faults, and because this
 * component is everywhere, so did both apps:
 *
 *  1. IT FIRES DURING THE PUSH. A layout animation starts at MOUNT, which on a
 *     pushed screen is the same instant the native transition begins. A screen
 *     with eight `<Entrance>` children therefore runs eight animations
 *     describing an arrival the navigator is already animating, on the thread
 *     that is simultaneously building the screen. That is the whole of "the
 *     animations are fast and laggy and don't seem smooth at all".
 *
 *  2. IT TRAVELS TOO FAR. `FadeInUp` starts a full screen-height away, which is
 *     why these entrances read as a slam rather than a settle. See `OFFSETS`.
 *
 * ── WHAT IT DOES NOW ────────────────────────────────────────────────────────
 * Same props, same names, same look — different clock. It asks the screen
 * (`useSmoothScreen`) one question:
 *
 *   settled?   Has the navigation transition finished? If not, wait. The content
 *              is laid out and invisible, so nothing reflows when it appears;
 *              only opacity and transform change.
 *
 * Driven by one shared value per instance rather than a layout animation, so it
 * composites on the UI thread and can never contend with the navigator.
 *
 * It deliberately does NOT consult `firstAppearance` — see the note on
 * `animate` below for why that guard belongs to `SmoothIn` and would be a
 * regression here.
 *
 * OUTSIDE a `SmoothScreen` the context defaults to `settled: true`, so an
 * un-wrapped screen behaves exactly as before. Nothing had to be migrated for
 * this to be safe.
 *
 * EXITS stay as Reanimated layout animations: an exit runs while the element is
 * being removed, never while a screen is arriving, so it was never part of the
 * problem.
 */
export type EntranceAnimation =
  | 'fadeIn'
  | 'slideUp'
  | 'slideDown'
  | 'slideLeft'
  | 'slideRight'
  | 'scaleIn'
  | 'zoomInDown'
  | 'none';

export type ExitAnimation =
  | 'fadeOut'
  | 'slideOutDown'
  | 'slideOutUp'
  | 'scaleOut'
  | 'none';

export interface EntranceProps {
  /** Entrance animation variant. Default: 'fadeIn' */
  animation?: EntranceAnimation;
  /** Exit animation variant. Default: 'none' (no exit animation) */
  exitAnimation?: ExitAnimation;
  /** Delay before animating in (ms). Default: 0 */
  delay?: number;
  /** Animation duration (ms). Default: 250 */
  duration?: number;
  /** Apply to children via style prop */
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

/**
 * How far, and in which direction, each variant travels.
 *
 * Distances are deliberately SHORTER than Reanimated's `FadeInUp` default
 * (which starts a full screen-height away and is why those entrances read as a
 * slam rather than a settle). 14 pt is the distance Apple's own list rows move:
 * enough to give the fade a direction, too little to be a journey.
 */
const OFFSETS: Record<EntranceAnimation, { x: number; y: number; scale: number }> = {
  fadeIn:     { x: 0,   y: 0,   scale: 1 },
  slideUp:    { x: 0,   y: 14,  scale: 1 },
  slideDown:  { x: 0,   y: -14, scale: 1 },
  slideLeft:  { x: 16,  y: 0,   scale: 1 },
  slideRight: { x: -16, y: 0,   scale: 1 },
  scaleIn:    { x: 0,   y: 0,   scale: 0.94 },
  zoomInDown: { x: 0,   y: -12, scale: 0.94 },
  none:       { x: 0,   y: 0,   scale: 1 },
};

/** Map exit animation names to Reanimated exiting builders. */
function buildExit(exitAnimation: ExitAnimation, duration: number) {
  switch (exitAnimation) {
    case 'fadeOut':
      return FadeOut.duration(duration);
    case 'slideOutDown':
      return FadeOutDown.duration(duration);
    case 'slideOutUp':
      return FadeOutUp.duration(duration);
    case 'scaleOut':
      return ZoomOut.duration(duration);
    case 'none':
      return undefined;
  }
}

export function Entrance({
  animation = 'fadeIn',
  exitAnimation = 'none',
  delay = 0,
  duration = 250,
  style,
  children,
}: EntranceProps) {
  const { settled } = useSmoothScreen();
  const reducedMotion = useReducedMotion();

  /**
   * WHEN TO ANIMATE — AND WHY `firstAppearance` IS DELIBERATELY NOT HERE.
   *
   * `SmoothIn` gates on `firstAppearance` because it wraps LIST ROWS, where
   * re-animating a set the rider has already scrolled past is the reported
   * "it jumps back".
   *
   * `Entrance` must not. It wraps everything else — banners, sheets, empty
   * states, a wallet warning that appears mid-session — and those are genuinely
   * NEW when they mount. Suppressing them after the first blur would mean a
   * driver's second "dispatch cannot see you" banner of the day popped in with
   * no animation at all, which is a downgrade dressed as an optimisation.
   *
   * Mount IS the signal here, and it is already the right one: a screen that is
   * merely re-focused does not remount its children, so nothing replays. What
   * this component needed was not a memory — it was to stop running DURING the
   * transition, which `settled` is.
   *
   * `animation === 'none'` is an explicit caller opt-out; it used to be spelled
   * `FadeIn.duration(0)`, and a zero-length animation is still one the
   * scheduler has to run.
   */
  const animate = settled && !reducedMotion && animation !== 'none';

  const progress = useSharedValue(animate ? 0 : 1);
  const off = OFFSETS[animation] ?? OFFSETS.fadeIn;

  useEffect(() => {
    if (!animate) {
      progress.value = 1;
      return;
    }
    /**
     * Spring for the travel, not a timing.
     *
     * `springs.standard` is critically damped (see config/motion.ts): it
     * arrives without overshoot, and it is the same spring the panels and the
     * morph use — which is what makes a screen's contents look like they belong
     * to the surface that carried them in. `duration` survives only as the
     * fade's own ramp, for callers that deliberately asked for a slow one.
     */
    progress.value = withDelay(
      delay,
      duration === 250
        ? withSpring(1, springs.standard)
        : withTiming(1, { duration, easing: Easing.out(Easing.cubic) }),
    );
    return () => cancelAnimation(progress);
    // `animate` flipping false→true is the one transition worth reacting to;
    // re-running on every `delay`/`duration` identity change would restart the
    // entrance mid-flight, which is the replay bug in a different costume.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate]);

  const animatedStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const t: { translateX?: number; translateY?: number; scale?: number }[] = [];
    if (off.x) t.push({ translateX: (1 - p) * off.x });
    if (off.y) t.push({ translateY: (1 - p) * off.y });
    if (off.scale !== 1) t.push({ scale: off.scale + (1 - off.scale) * p });
    return { opacity: p, transform: t as never };
  });

  // Exiting is typed as `any` because Reanimated's exiting prop type varies
  // between Reanimated 3 and 4. We return undefined for 'none' (no exit).
  const exiting = useMemo<any>(
    () => buildExit(exitAnimation, duration),
    [exitAnimation, duration],
  );

  return (
    <Animated.View exiting={exiting} style={[style, animatedStyle]}>
      {children}
    </Animated.View>
  );
}
