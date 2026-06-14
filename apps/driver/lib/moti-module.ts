// ───────────────────────────────────────────────
// Moti Module Type Fix
// Works around TypeScript limitation where
// TransitionConfig & Partial<Record<keyof Animate, TransitionConfig>>
// creates an index signature conflict for the 'type' property.
// ───────────────────────────────────────────────

import React from 'react';

// Import the original moti components with their original types
import {
  View as OrigView,
  Text as OrigText,
  Image as OrigImage,
  SafeAreaView as OrigSafeAreaView,
  ScrollView as OrigScrollView,
  MotiProgressBar,
  type MotiProgressBarProps,
} from 'moti/build/components';

// Simpler transition type that avoids the intersection with index signature
export type MotiTransitionSimple = {
  type?: 'spring' | 'timing' | 'decay' | 'no-animation';
  stiffness?: number;
  damping?: number;
  mass?: number;
  overshootClamping?: boolean;
  delay?: number;
  duration?: number;
  loop?: boolean;
  repeat?: number;
  repeatReverse?: boolean;
  [key: string]: unknown;
};

// Widen the transition prop for each animated component.
// This is a correct type declaration — at runtime these components
// accept any valid Reanimated animation config. The original type
// is overly restrictive due to a TS intersection limitation.
export const View = OrigView as React.ForwardRefExoticComponent<
  Omit<React.ComponentPropsWithoutRef<typeof OrigView>, 'transition'> & {
    transition?: MotiTransitionSimple;
  }
>;

export const Text = OrigText as React.ForwardRefExoticComponent<
  Omit<React.ComponentPropsWithoutRef<typeof OrigText>, 'transition'> & {
    transition?: MotiTransitionSimple;
  }
>;

export const Image = OrigImage as React.ForwardRefExoticComponent<
  Omit<React.ComponentPropsWithoutRef<typeof OrigImage>, 'transition'> & {
    transition?: MotiTransitionSimple;
  }
>;

export const SafeAreaView = OrigSafeAreaView as React.ForwardRefExoticComponent<
  Omit<React.ComponentPropsWithoutRef<typeof OrigSafeAreaView>, 'transition'> & {
    transition?: MotiTransitionSimple;
  }
>;

export const ScrollView = OrigScrollView as React.ForwardRefExoticComponent<
  Omit<React.ComponentPropsWithoutRef<typeof OrigScrollView>, 'transition'> & {
    transition?: MotiTransitionSimple;
  }
>;

// Moti-prefixed aliases
export const MotiView = View;
export const MotiText = Text;
export const MotiImage = Image;
export const MotiSafeAreaView = SafeAreaView;
export const MotiScrollView = ScrollView;

// Re-export progress bar (doesn't have transition prop issue)
export { MotiProgressBar };
export type { MotiProgressBarProps };

// Re-export ALL core functionality unchanged
// moti/build/core includes all exports from moti/build/core/types via its export *
export {
  AnimatePresence,
  motify,
  useAnimationState,
  useDynamicAnimation,
  useMotify,
  type MotiProps,
  type MotiTransition,
  type MotiTransitionProp,
// TransitionConfig is already declared in types.d.ts — omit to avoid TS2300 duplicate
  type UseAnimationState,
  type UseAnimationStateConfig,
  type UseDynamicAnimationState,
  type DynamicStyleProp,
  type StyleValueWithReplacedTransforms,
  type StyleValueWithSequenceArrays,
  type MotiTranformProps,
  type OnDidAnimate,
} from 'moti/build/core';
