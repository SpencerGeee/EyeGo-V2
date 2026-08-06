import React, { useEffect, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  useReducedMotion,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { springs, withOpacity } from '@eyego/config';
import { useColors } from '../../utils/useColors';

/**
 * The "looking for a driver" indicator.
 *
 * WHAT IT REPLACES. Three stacked `MotiView` rings on a 2 s `loop: true` timing
 * transition, sitting inside a `GradientGlowBorder palette="green" glow` — an
 * oversized LinearGradient rotating forever plus four shadow-casting layers.
 * That is four independently-scheduled animations and five composited layers
 * for one spinner, on the screen where the app is simultaneously opening a
 * socket, running dispatch and drawing a map. It read as a green orb with
 * something crawling round it, and it cost frames at the worst possible moment.
 *
 * WHAT THIS IS. One shared value, `withRepeat` on the UI thread, driving two
 * rings whose phases are derived from it — so the whole indicator is a single
 * animation with no JS-thread involvement at all, and no gradient or shadow
 * layers. Concentric expanding rings behind a flat circle: the same
 * vocabulary iOS uses for AirDrop, Find My and Wallet's "hold near reader".
 *
 * The `matched` moment is the one place a bounce is allowed (see
 * `springs.accent`) — a thing that just succeeded and wants to be noticed.
 */

const CORE = 72;
const RING_MAX = 2.2;

type Status = 'searching' | 'matched' | 'error' | 'timeout';

interface Props {
  status: Status;
}

export function SearchingIndicator({ status }: Props) {
  const colors = useColors();
  const reduceMotion = useReducedMotion();
  const searching = status === 'searching';

  // ONE driver for the whole component. Both rings read phases off it, so the
  // second ring is free — it is not a second animation, it is an offset.
  const phase = useSharedValue(0);
  const pop = useSharedValue(0);

  useEffect(() => {
    if (searching && !reduceMotion) {
      phase.value = withRepeat(
        withTiming(1, { duration: 2200, easing: Easing.out(Easing.quad) }),
        -1,
        false,
      );
    } else {
      phase.value = withTiming(0, { duration: 200 });
    }
  }, [searching, reduceMotion, phase]);

  useEffect(() => {
    if (status !== 'matched') return;
    // The single overshoot in the whole flow, and it is earned.
    pop.value = withSequence(
      withSpring(1, springs.accent),
      withSpring(0, springs.standard),
    );
  }, [status, pop]);

  // The trailing ring is the leading ring, half a cycle behind.
  const phaseB = useDerivedValue(() => (phase.value + 0.5) % 1);

  // Both rings share one formula: scale out from the core, and fade well before
  // the edge so they dissolve rather than clipping against the panel.
  const ringAStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(phase.value, [0, 1], [0.85, RING_MAX]) }],
    opacity: interpolate(phase.value, [0, 0.15, 1], [0, 0.28, 0]),
  }));
  const ringBStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(phaseB.value, [0, 1], [0.85, RING_MAX]) }],
    opacity: interpolate(phaseB.value, [0, 0.15, 1], [0, 0.28, 0]),
  }));

  const coreStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pop.value * 0.08 }],
  }));

  const tone = useMemo(() => {
    if (status === 'error' || status === 'timeout') return colors.error;
    return colors.primary;
  }, [status, colors]);

  const icon =
    status === 'matched'
      ? 'checkmark'
      : status === 'error' || status === 'timeout'
        ? 'alert'
        : 'car-outline';

  return (
    <View style={styles.wrap} pointerEvents="none">
      {searching && !reduceMotion && (
        <>
          <Animated.View
            style={[styles.ring, { borderColor: tone }, ringAStyle]}
          />
          <Animated.View
            style={[styles.ring, { borderColor: tone }, ringBStyle]}
          />
        </>
      )}
      <Animated.View
        style={[
          styles.core,
          {
            backgroundColor: withOpacity(tone, 0.12),
            borderColor: withOpacity(tone, 0.45),
          },
          coreStyle,
        ]}
      >
        <Ionicons name={icon as any} size={30} color={tone} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: CORE * RING_MAX,
    height: CORE * RING_MAX,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: CORE,
    height: CORE,
    borderRadius: CORE / 2,
    borderWidth: 1.5,
  },
  core: {
    width: CORE,
    height: CORE,
    borderRadius: CORE / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
