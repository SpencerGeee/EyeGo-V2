import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Stop } from 'react-native-svg';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * THE OFFER CLOCK, DRAWN AS A DRAINING RING.
 *
 * ── WHY IT IS NOT A `setInterval` REDRAW ────────────────────────────────────
 * Both offer surfaces already run a 500 ms interval to keep the digits honest,
 * and the obvious thing is to redraw the ring from the same tick. That is what
 * makes a countdown look cheap: a ring that jumps two degrees twice a second is
 * visibly a progress bar being nudged, not time passing.
 *
 * So the DIGITS stay on the interval — they only ever change once a second, and
 * a worklet cannot format text — and the RING is handed the deadline once and
 * animates to empty on the UI thread, linearly, in a single `withTiming`. It
 * keeps draining smoothly while JS is busy laying out the rest of the card,
 * which is exactly when a driver is looking at it.
 *
 * ── THE COLOUR ─────────────────────────────────────────────────────────────
 * Calm → amber → red is applied by the CALLER through `color`, because the same
 * urgency has to drive the fare text and the haptics, and three components
 * deciding independently is how they drift apart.
 */

export interface CountdownRingProps {
  /** Server-time deadline in ms. The ring is derived from this, never from a tick. */
  expiresAtMs: number;
  /** The full window in ms, so the ring starts at the right fraction after a resume. */
  windowMs: number;
  /** Current server time in ms — pass the store's `now()`, not `Date.now()`. */
  nowMs: number;
  size?: number;
  stroke?: number;
  color: string;
  trackColor: string;
  children?: React.ReactNode;
}

export function CountdownRing({
  expiresAtMs,
  windowMs,
  nowMs,
  size = 132,
  stroke = 6,
  color,
  trackColor,
  children,
}: CountdownRingProps) {
  const r = (size - stroke) / 2;
  const circumference = useMemo(() => 2 * Math.PI * r, [r]);

  // 1 = full window remaining, 0 = expired.
  const progress = useSharedValue(1);

  useEffect(() => {
    const remaining = Math.max(0, expiresAtMs - nowMs);
    const start = windowMs > 0 ? Math.min(1, remaining / windowMs) : 0;
    cancelAnimation(progress);
    progress.value = start;
    if (remaining <= 0) return;
    // Linear, because time is linear. An eased countdown lies about how much
    // of it is left, and a driver decides on that number.
    progress.value = withTiming(0, { duration: remaining, easing: Easing.linear });
    return () => cancelAnimation(progress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAtMs, windowMs]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - progress.value),
  }));

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <SvgGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity="1" />
            <Stop offset="1" stopColor={color} stopOpacity="0.45" />
          </SvgGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={trackColor} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="url(#ringGrad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          animatedProps={animatedProps}
          // Start at twelve o'clock and drain clockwise, which is the direction
          // every clock face in the world already taught the driver to read.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.inner}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  inner: { alignItems: 'center', justifyContent: 'center' },
});

export default CountdownRing;
