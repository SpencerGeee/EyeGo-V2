import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { Easing, withTiming, type EntryAnimationsValues, type ExitAnimationsValues, type LayoutAnimation } from 'react-native-reanimated';
import { durations } from '@eyego/config';

/**
 * REVEAL — A SECTION GROWS INTO PLACE (spec v2 §7, Yango `DriverSectionView`).
 *
 * Yango never pops a row into a card: one 0→1 animator drives the section's
 * HEIGHT (0 → its row height) and its OPACITY together, so the content below is
 * pushed down by the same motion that makes the new row visible. Removal is the
 * same thing reversed. A fade alone (what `contentEnter` does) leaves the rows
 * below jumping a full row in one frame.
 *
 * Mount it conditionally — `{cond && <Reveal>…</Reveal>}` — and the enter/exit
 * run on mount/unmount. Reduce Motion is honoured by Reanimated itself.
 */

const ease = Easing.bezier(0.22, 1, 0.36, 1);

export const revealEnter = (values: EntryAnimationsValues): LayoutAnimation => {
  'worklet';
  const cfg = { duration: durations.reveal, easing: ease };
  return {
    initialValues: { height: 0, opacity: 0 },
    animations: { height: withTiming(values.targetHeight, cfg), opacity: withTiming(1, cfg) },
  };
};

export const revealExit = (values: ExitAnimationsValues): LayoutAnimation => {
  'worklet';
  const cfg = { duration: durations.sheet, easing: Easing.in(Easing.quad) };
  return {
    initialValues: { height: values.currentHeight, opacity: 1 },
    animations: { height: withTiming(0, cfg), opacity: withTiming(0, cfg) },
  };
};

export function Reveal({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <Animated.View entering={revealEnter} exiting={revealExit} style={[{ overflow: 'hidden' }, style]}>
      {children}
    </Animated.View>
  );
}
