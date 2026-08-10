import React, { useEffect } from 'react';
import { View, StyleSheet, type ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  cancelAnimation,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { fonts, fontSizes } from '@eyego/config';
import { useThemedColors } from './ColorsContext';
import { Text } from './Text';

interface LoaderProps {
  /** Contextual label, e.g. "Finding your driver…" or "Processing payment…". */
  label: string;
  size?: number;
  style?: ViewStyle;
}

/**
 * Blocking-wait loader: a thin indeterminate ring with a static label beneath.
 *
 * WHAT THIS REPLACED, AND WHY ("the green loader orb thing that appears on
 * selection of a created trip is not aesthetic — i told you to redesign it").
 * The previous version was a solid `colors.primary` disc at ~55 % opacity with
 * a 30 pt glow behind it, a second green radial-gradient disc on top, and the
 * label set in letter-spaced caps on a curved SVG path ORBITING the whole thing
 * once every nine seconds. Three problems, all of them structural rather than a
 * matter of taste:
 *
 *   - A large saturated blob is the loudest thing that can be on a screen. It
 *     dominated a moment that is, by definition, not the content.
 *   - Text on a rotating path is unreadable for most of its rotation — it is
 *     upside down for a quarter of every cycle — so the one piece of
 *     information the loader carries was the part hardest to consume.
 *   - Nine seconds per revolution reads as *stalled*. A progress indicator's
 *     job is to say "still working"; anything slower than about a second per
 *     turn says the opposite.
 *
 * What replaces it is the idiom every native app converged on: a slim arc on a
 * faint track, one turn per ~0.9 s, tapering to transparent at its tail so the
 * motion is legible without a hard leading edge. The label sits still, upright,
 * below it. The accent colour appears only in the arc — a few pixels of it —
 * which is enough to be branded and not enough to be the subject.
 */
export function Loader({ label, size = 44, style }: LoaderProps) {
  const colors = useThemedColors();
  const rotation = useSharedValue(0);

  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, { duration: 900, easing: Easing.linear }),
      -1,
      false,
    );
    // A loader is by definition unmounted the moment the thing it was waiting
    // for arrives; without this its infinite repeat kept running after.
    return () => {
      cancelAnimation(rotation);
    };
  }, [rotation]);

  const rotateStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  // Stroke is proportional so the ring stays optically consistent at any size.
  const stroke = Math.max(2, size * 0.075);
  const r = (size - stroke) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  // ~70 % of the ring is drawn, the rest is the gap the eye reads as motion.
  const arc = circumference * 0.7;

  return (
    <View style={[styles.container, style]}>
      <Animated.View style={[{ width: size, height: size }, rotateStyle]}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Defs>
            {/* Tapers the arc to nothing at its tail, so the ring has a
                direction without a blunt end stopping the eye. */}
            <LinearGradient id="loaderArc" x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0%" stopColor={colors.primary} stopOpacity={0} />
              <Stop offset="55%" stopColor={colors.primary} stopOpacity={0.55} />
              <Stop offset="100%" stopColor={colors.primary} stopOpacity={1} />
            </LinearGradient>
          </Defs>

          {/* The track: present, but barely. It exists to stop the arc reading
              as a fragment floating in space. */}
          <Circle
            cx={c}
            cy={c}
            r={r}
            stroke={colors.outlineVariant ?? colors.outline}
            strokeWidth={stroke}
            strokeOpacity={0.35}
            fill="none"
          />
          <Circle
            cx={c}
            cy={c}
            r={r}
            stroke="url(#loaderArc)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${arc} ${circumference}`}
            fill="none"
          />
        </Svg>
      </Animated.View>

      {!!label && (
        <Text
          variant="bodySmall"
          color={colors.onSurfaceVariant}
          style={styles.label}
          numberOfLines={2}
        >
          {label}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    marginTop: 14,
    textAlign: 'center',
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodySmall,
    lineHeight: Math.round(fontSizes.bodySmall * 1.3),
    // Slightly open, but nowhere near the letter-spaced caps this used to be —
    // a wait message is read, not displayed.
    letterSpacing: 0.1,
    maxWidth: 220,
  },
});
