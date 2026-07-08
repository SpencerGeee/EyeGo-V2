import React, { useMemo } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  FadeInLeft,
  FadeInRight,
  ZoomIn,
  ZoomInDown,
  FadeOut,
  FadeOutDown,
  FadeOutUp,
  ZoomOut,
  type EntryExitAnimationFunction,
} from 'react-native-reanimated';

/**
 * Shared entrance/exit animation primitive — the single component every screen
 * uses for mount/unmount animations. No more scattered MotiView configs.
 *
 * All animations use Reanimated's built-in entering/exiting (UI-thread, no
 * layout cost). Config is memoized so re-renders don't re-trigger mount anims.
 *
 * Usage:
 *   <Entrance animation="slideUp" exitAnimation="fadeOut" delay={50}>
 *     <YourComponent />
 *   </Entrance>
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

/** Map entrance animation names to Reanimated entering builders. */
function buildEntrance(animation: EntranceAnimation, delay: number, duration: number) {
  switch (animation) {
    case 'fadeIn':
      return FadeIn.delay(delay).duration(duration);
    case 'slideUp':
      return FadeInUp.delay(delay).duration(duration);
    case 'slideDown':
      return FadeInDown.delay(delay).duration(duration);
    case 'slideLeft':
      return FadeInLeft.delay(delay).duration(duration);
    case 'slideRight':
      return FadeInRight.delay(delay).duration(duration);
    case 'scaleIn':
      return ZoomIn.delay(delay).duration(duration);
    case 'zoomInDown':
      return ZoomInDown.delay(delay).duration(duration);
    case 'none':
      return FadeIn.duration(0);
  }
}

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
  // Memoize so re-renders don't re-trigger mount/unmount animations.
  const entering = useMemo<EntryExitAnimationFunction | typeof FadeIn>(
    () => buildEntrance(animation, delay, duration),
    [animation, delay, duration],
  );

  // Exiting is typed as `any` because Reanimated's exiting prop type varies
  // between Reanimated 3 and 4. We return undefined for 'none' (no exit).
  const exiting = useMemo<any>(
    () => buildExit(exitAnimation, duration),
    [exitAnimation, duration],
  );

  return (
    <Animated.View entering={entering} exiting={exiting} style={style}>
      {children}
    </Animated.View>
  );
}
