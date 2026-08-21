import React, { useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, LayoutChangeEvent } from 'react-native';
import Animated, {
  type SharedValue,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withRepeat,
  withSequence,
  withDelay,
  interpolate,
  interpolateColor,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { fonts, spacing, springs } from '@eyego/config';
import { Text } from '@eyego/ui';
import { useColors, type DriverColors } from '../../utils/useColors';

export interface RailStep {
  /** Stable key — the wire status this step stands for. */
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Accent for this step when it is the live one. */
  color: string;
}

/**
 * THE STATUS OF THE RIDE, AS A THING THAT MOVES.
 *
 * "I need a more dramatic and intuitive way of switching the statuses on the
 * manage page ... right now it's kinda basic."
 *
 * What was there was a row of static chips whose only difference between states
 * was a background tint — so advancing the ride, the single most consequential
 * action on the screen, produced a colour change roughly as loud as a hover.
 * A driver glancing down mid-traffic could not tell that their tap had landed.
 *
 * Three things carry the change here, and they are deliberately different
 * channels so no single one has to be noticed:
 *
 *  1. A CONTINUOUS RAIL that fills. Progress is one shared value driven by a
 *     spring, so the fill physically travels from the old step to the new one
 *     rather than teleporting. Distance travelled is the feedback.
 *  2. THE LIVE STEP BREATHES. A slow, low-amplitude halo — never a flashing
 *     one — marks where the ride actually is when nothing is happening.
 *  3. AN ARRIVAL BEAT. On a change, the newly-live node pops and the whole rail
 *     takes a haptic. Fires only on a real transition, never on mount, so
 *     opening the screen is quiet.
 *
 * All of it runs on the UI thread through Reanimated shared values: this sits
 * on a screen that is also drawing a live map, and a status rail that costs JS
 * frames would take them from the thing the driver is steering by.
 */
export function TripStatusRail({
  steps,
  currentIndex,
}: {
  steps: RailStep[];
  currentIndex: number;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Clamped: `stepIndexFor` answers -1 for a status off the rail (a cancelled
  // trip, an unknown value from an older build). -1 must read as "nothing done
  // yet", not as a negative width.
  const safeIndex = Math.max(0, Math.min(currentIndex, steps.length - 1));

  /** 0 → steps.length-1, in step units. The rail's fill is derived from it. */
  const progress = useSharedValue(safeIndex);
  /** One-shot 0→1→0 on every real transition. Drives the pop and the sweep. */
  const beat = useSharedValue(0);
  /** Continuous 0→1 loop for the live node's halo. */
  const halo = useSharedValue(0);
  const [railWidth, setRailWidth] = React.useState(0);

  // Mount must not fire the beat: a driver opening the screen mid-ride has not
  // just advanced anything, and celebrating a status they set ten minutes ago
  // is exactly the kind of noise that teaches people to ignore the signal.
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      progress.value = safeIndex;
      return;
    }
    progress.value = withSpring(safeIndex, springs.emphasized);
    beat.value = withSequence(
      withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) }),
      withDelay(120, withTiming(0, { duration: 420, easing: Easing.inOut(Easing.quad) })),
    );
    // Success rather than impact: the ride moved forward, and the driver's hand
    // is usually not on the phone by the time this lands.
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, [safeIndex, progress, beat]);

  useEffect(() => {
    halo.value = withRepeat(
      withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    return () => cancelAnimation(halo);
  }, [halo]);

  const segments = Math.max(1, steps.length - 1);

  const fillStyle = useAnimatedStyle(() => ({
    width: railWidth * (progress.value / segments),
  }));

  // A brief brightening that rides the leading edge of the fill. Reads as the
  // rail being charged rather than merely resized.
  const sweepStyle = useAnimatedStyle(() => ({
    opacity: interpolate(beat.value, [0, 1], [0, 0.9]),
    transform: [{ translateX: railWidth * (progress.value / segments) - 28 }],
  }));

  return (
    <View style={styles.wrap}>
      <View style={styles.railRow} onLayout={(e: LayoutChangeEvent) => setRailWidth(e.nativeEvent.layout.width)}>
        <View style={styles.railTrack} />
        <Animated.View style={[styles.railFill, fillStyle]} />
        <Animated.View style={[styles.railSweep, sweepStyle]} pointerEvents="none" />
      </View>

      <View style={styles.nodesRow}>
        {steps.map((step, i) => (
          <StepNode
            key={step.key}
            step={step}
            index={i}
            done={i < safeIndex}
            progress={progress}
            beat={beat}
            halo={halo}
            colors={colors}
            styles={styles}
          />
        ))}
      </View>
    </View>
  );
}

function StepNode({
  step,
  index,
  done,
  progress,
  beat,
  halo,
  colors,
  styles,
}: {
  step: RailStep;
  index: number;
  /**
   * Plain prop, not read off `progress`. The tick is an icon NAME, and a name
   * cannot be animated — reading a shared value during render to pick it would
   * be both non-reactive and a Reanimated warning.
   */
  done: boolean;
  progress: SharedValue<number>;
  beat: SharedValue<number>;
  halo: SharedValue<number>;
  colors: DriverColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  /**
   * `phase` is the node's own relationship to progress, as a number rather than
   * a set of booleans: -1 and below is "still ahead", 0 is "live", above 0 is
   * "done". Deriving every visual from one continuous value is what lets the
   * node cross between states smoothly instead of snapping when a boolean flips.
   */
  const dotStyle = useAnimatedStyle(() => {
    const phase = progress.value - index;
    const live = interpolate(Math.abs(phase), [0, 1], [1, 0], 'clamp');
    return {
      transform: [
        { scale: 1 + live * 0.22 + (phase >= -0.5 && phase <= 0.5 ? beat.value * 0.18 : 0) },
      ],
      backgroundColor: interpolateColor(
        Math.min(1, Math.max(0, phase + 1)),
        [0, 1, 2],
        [colors.surfaceContainerHighest, step.color, colors.primary],
      ),
      borderColor: interpolateColor(
        Math.min(1, Math.max(0, phase + 1)),
        [0, 1],
        [colors.outlineVariant, step.color],
      ),
    };
  });

  // The halo only exists on the live node. Rendering it everywhere at zero
  // opacity would be four extra composited layers for nothing.
  const haloStyle = useAnimatedStyle(() => {
    const live = interpolate(Math.abs(progress.value - index), [0, 0.6], [1, 0], 'clamp');
    return {
      opacity: live * interpolate(halo.value, [0, 1], [0.1, 0.34]),
      transform: [{ scale: live * interpolate(halo.value, [0, 1], [1.05, 1.6]) }],
    };
  });

  const labelStyle = useAnimatedStyle(() => {
    const phase = progress.value - index;
    const live = interpolate(Math.abs(phase), [0, 1], [1, 0], 'clamp');
    return {
      opacity: phase >= -0.5 ? 1 : 0.45,
      transform: [{ translateY: live * -1 }],
    };
  });

  return (
    <View style={styles.node}>
      <View style={styles.dotWrap}>
        <Animated.View style={[styles.halo, { backgroundColor: step.color }, haloStyle]} pointerEvents="none" />
        <Animated.View style={[styles.dot, dotStyle]}>
          <Ionicons
            name={done ? 'checkmark' : step.icon}
            size={12}
            color={colors.onPrimary ?? '#fff'}
          />
        </Animated.View>
      </View>
      <Animated.View style={labelStyle}>
        <Text style={styles.nodeLabel} numberOfLines={1}>
          {step.label}
        </Text>
      </Animated.View>
    </View>
  );
}

const DOT = 26;

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    wrap: { paddingHorizontal: spacing['2xl'], paddingTop: spacing.sm },
    // The rail sits behind the nodes and spans the same box, inset by half a
    // node so it starts and ends at the dot centres rather than the screen edge.
    railRow: {
      height: 3,
      marginHorizontal: DOT / 2,
      marginBottom: -(DOT / 2 + 1),
      justifyContent: 'center',
    },
    railTrack: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.outlineVariant,
      borderRadius: 2,
    },
    railFill: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      backgroundColor: colors.primary,
      borderRadius: 2,
    },
    railSweep: {
      position: 'absolute',
      left: 0,
      top: -3,
      height: 9,
      width: 56,
      borderRadius: 5,
      backgroundColor: colors.primary,
    },
    nodesRow: { flexDirection: 'row', justifyContent: 'space-between' },
    node: { alignItems: 'center', gap: spacing.xs, flex: 1 },
    dotWrap: { width: DOT, height: DOT, alignItems: 'center', justifyContent: 'center' },
    halo: { position: 'absolute', width: DOT, height: DOT, borderRadius: DOT / 2 },
    dot: {
      width: DOT,
      height: DOT,
      borderRadius: DOT / 2,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
    },
    nodeLabel: {
      fontFamily: fonts.semiBold,
      fontSize: 9.5,
      letterSpacing: 0.2,
      textAlign: 'center',
      color: colors.onSurfaceVariant,
    },
  });

export default TripStatusRail;
