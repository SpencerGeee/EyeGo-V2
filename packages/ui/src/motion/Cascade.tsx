import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

/**
 * ── CASCADE — RETIRED TO A PLAIN WRAPPER ────────────────────────────────────
 *
 * Each row of a stage used to fly out of 3D depth and lock in, one after
 * another, on every stage change — on top of the container's own turn and a
 * light sweeping the sheet edge. Three animations for one transition is what
 * read as laggy. The stage's content now changes as ONE fade-through (see
 * depth.ts and MapSheetHost); rows simply are where they belong.
 *
 * Kept as a component so its 27 call sites keep their layout (`style`).
 */
export type CascadeStrength = 'full' | 'live';

export function Cascade({
  children,
  style,
}: {
  children: React.ReactNode;
  dir?: 1 | -1;
  strength?: CascadeStrength;
  style?: StyleProp<ViewStyle>;
  rowStyle?: StyleProp<ViewStyle>;
}) {
  return style ? <View style={style}>{children}</View> : <>{children}</>;
}
