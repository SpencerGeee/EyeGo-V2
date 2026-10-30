import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, FadeInDown, FadeInUp, ReduceMotion } from 'react-native-reanimated';

/**
 * ── CASCADE — ROWS ARRIVE ONE AFTER ANOTHER ─────────────────────────────────
 *
 * History: each row used to fly out of 3D depth and lock in, on top of the
 * container's own turn and a light sweeping the sheet edge — three animations
 * for one transition, which read as laggy, so it was retired to a plain
 * wrapper. That overcorrected (device recording 2026-10-30: "nothing feels as
 * premium as Yango"). Yango's lists do stagger; they just do it cheaply.
 *
 * So this is the cheap version: on MOUNT only, each direct child fades up a
 * few points, 40 ms after the one before. Opacity + translate, UI-thread
 * layout animations, no 3D, no sweep, nothing on re-render. Reduce Motion
 * turns it off. Rows past the first eight arrive with the eighth — a long
 * list should not take a second to finish drawing.
 */
export type CascadeStrength = 'full' | 'live';

const STEP_MS = 40;
const MAX_STAGGERED = 8;
const EASE = Easing.bezier(0.22, 1, 0.36, 1);

/** One level of fragments flattened, so `<><A/><B/></>` cascades as two rows. */
function rows(children: React.ReactNode): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  React.Children.toArray(children).forEach((c) => {
    if (React.isValidElement(c) && c.type === React.Fragment) {
      out.push(...React.Children.toArray((c.props as { children?: React.ReactNode }).children));
    } else {
      out.push(c);
    }
  });
  return out;
}

export function Cascade({
  children,
  dir = 1,
  strength = 'full',
  style,
  rowStyle,
}: {
  children: React.ReactNode;
  dir?: 1 | -1;
  strength?: CascadeStrength;
  style?: StyleProp<ViewStyle>;
  rowStyle?: StyleProp<ViewStyle>;
}) {
  const rise = strength === 'live' ? 6 : 10;
  const items = rows(children).map((child, i) => {
    const base = dir < 0 ? FadeInUp : FadeInDown;
    const entering = base
      .delay(Math.min(i, MAX_STAGGERED) * STEP_MS)
      .duration(280)
      .easing(EASE)
      .withInitialValues({ opacity: 0, transform: [{ translateY: dir < 0 ? -rise : rise }] })
      .reduceMotion(ReduceMotion.System);
    const key = React.isValidElement(child) && child.key != null ? child.key : `cascade-${i}`;
    return (
      <Animated.View key={key} entering={entering} style={rowStyle}>
        {child}
      </Animated.View>
    );
  });
  return style ? <View style={style}>{items}</View> : <>{items}</>;
}
