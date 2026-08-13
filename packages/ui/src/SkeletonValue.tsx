import React from 'react';
import { View, ViewStyle, DimensionValue } from 'react-native';

import { Skeleton } from './Skeleton';

/**
 * A figure that is either a real number or a placeholder — never a fake zero.
 *
 * ── THE BUG THIS EXISTS TO KILL ──────────────────────────────────────────────
 * `formatGhs(balance ?? 0)` renders "GH₵0.00" for as long as the request is in
 * flight and then swaps in the real amount. Reported as "it shows a figure that
 * updates automatically after some seconds", and it is worse than it sounds: a
 * rider who glances at their wallet during that window reads a balance of zero as
 * fact. The same pattern was on the driver's earnings, where zero is alarming.
 *
 * `?? 0` is the right default for ARITHMETIC and the wrong default for DISPLAY.
 * A value that is not known yet has to look like a value that is not known yet.
 *
 * ── USAGE ────────────────────────────────────────────────────────────────────
 * ```tsx
 * <SkeletonValue loading={isPending} width={110} height={28}>
 *   <Text style={styles.balance}>{formatGhs(balance ?? 0)}</Text>
 * </SkeletonValue>
 * ```
 *
 * Size the placeholder to the text it replaces. A skeleton that is a different
 * size from its content makes the layout jump when it resolves, which is the
 * thing the skeleton was supposed to prevent.
 */
export function SkeletonValue({
  loading,
  children,
  width = 96,
  height = 20,
  borderRadius = 6,
  style,
}: {
  loading: boolean;
  children: React.ReactNode;
  width?: DimensionValue;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}) {
  if (!loading) return <>{children}</>;

  return (
    // The wrapper reserves the row height so the surrounding layout is identical
    // whether the value has arrived or not.
    <View
      style={[{ height, justifyContent: 'center' }, style]}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
    >
      <Skeleton width={width} height={height} borderRadius={borderRadius} />
    </View>
  );
}
