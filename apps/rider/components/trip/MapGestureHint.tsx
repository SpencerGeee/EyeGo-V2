import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { fonts, radii, spacing, withOpacity } from '@eyego/config';
import { Text } from '@eyego/ui';

import { useColors, type Colors } from '../../utils/useColors';

/**
 * "YOU CAN MOVE THIS MAP."
 *
 * FEATURE ("on the book-a-ride page of the rider app that shows the map at the
 * top, when it's shown, add an overlay animation that shows an animation of
 * pinching out or something, for users to know that they can control the camera
 * of the map").
 *
 * ── THE PROBLEM IT SOLVES ───────────────────────────────────────────────────
 * The map on this stage occupies the top third of the screen behind a scrim,
 * with an opaque sheet below it. Every visual cue on the screen says the sheet
 * is the interface and the map is a picture of the route — which is exactly
 * backwards, because the map is live and pinchable and answers the question the
 * rider is actually weighing while they pick a tier ("how far IS that").
 * Nothing told them.
 *
 * ── WHY IT LOOKS LIKE THIS ──────────────────────────────────────────────────
 * A hint is a teaching device, and a teaching device that outstays its lesson
 * becomes clutter, so every decision here is about leaving:
 *
 *   IT SHOWS THE GESTURE, NOT A SENTENCE. Two dots start together and spread
 *       apart on a diagonal — the actual shape of a pinch-out, at the actual
 *       speed a thumb and finger make it. The words underneath are a caption,
 *       not the message.
 *   IT PLAYS TWICE AND GOES. Two cycles is enough to read as deliberate and
 *       short enough that nobody has to wait it out. There is no dismiss
 *       control because there is nothing to dismiss by the time you would
 *       reach for one.
 *   IT NEVER COMES BACK. Once a rider has seen it, the flag is stored and this
 *       renders nothing forever. A hint on the twentieth booking is an insult.
 *   IT CANNOT BE IN THE WAY. `pointerEvents="none"` throughout, so the very
 *       first pinch it is teaching lands on the map underneath it rather than
 *       on the hint about pinching.
 *
 * Reduced motion gets the caption alone, held still: the instruction survives,
 * the demonstration does not.
 */

const SEEN_KEY = 'eyego.hint.mapPinch.v1';

export function MapGestureHint({
  /** The map window's height. The hint centres itself in it. */
  height,
  /** Delay before it starts, so it lands after the stage has settled. */
  delayMs = 900,
}: {
  height: number;
  delayMs?: number;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const reducedMotion = useReducedMotion();

  /**
   * `null` while we are still asking storage. Rendering nothing until the
   * answer lands is what stops a returning rider seeing a one-frame flash of a
   * hint they retired months ago.
   */
  const [eligible, setEligible] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(SEEN_KEY)
      .then((v) => {
        if (!cancelled) setEligible(v == null);
      })
      .catch(() => {
        // Storage is not a reason to withhold a hint; worst case it repeats.
        if (!cancelled) setEligible(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const life = useSharedValue(0);
  const spread = useSharedValue(0);

  useEffect(() => {
    if (!eligible || height <= 0) return undefined;

    // Mark it seen the moment it is shown, not when it finishes: a rider who
    // navigates away mid-hint has still seen the hint.
    void AsyncStorage.setItem(SEEN_KEY, String(Date.now())).catch(() => {});

    const CYCLE = 1500;
    const HOLD = reducedMotion ? 2600 : CYCLE * 2;

    life.value = withDelay(
      delayMs,
      withSequence(
        withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) }),
        withDelay(HOLD, withTiming(0, { duration: 420, easing: Easing.in(Easing.cubic) })),
      ),
    );

    if (!reducedMotion) {
      spread.value = withDelay(
        delayMs + 200,
        withRepeat(
          withSequence(
            // Out — the gesture being taught. Slow enough to follow.
            withTiming(1, { duration: 620, easing: Easing.inOut(Easing.cubic) }),
            withTiming(1, { duration: 220 }),
            // And back, so the loop reads as one gesture repeated rather than
            // as two dots drifting.
            withTiming(0, { duration: 520, easing: Easing.inOut(Easing.cubic) }),
          ),
          2,
          false,
        ),
      );
    }

    return () => {
      cancelAnimation(life);
      cancelAnimation(spread);
    };
  }, [eligible, height, delayMs, reducedMotion, life, spread]);

  const wrapStyle = useAnimatedStyle(() => ({ opacity: life.value }));

  // 34 pt of travel each way: far enough to read as a pinch across a phone's
  // width, short enough that the dots stay inside the caption's own footprint.
  const dotA = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(spread.value, [0, 1], [0, -24]) },
      { translateY: interpolate(spread.value, [0, 1], [0, -24]) },
      { scale: interpolate(spread.value, [0, 1], [0.92, 1]) },
    ],
    opacity: 0.65 + spread.value * 0.35,
  }));
  const dotB = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(spread.value, [0, 1], [0, 24]) },
      { translateY: interpolate(spread.value, [0, 1], [0, 24]) },
      { scale: interpolate(spread.value, [0, 1], [0.92, 1]) },
    ],
    opacity: 0.65 + spread.value * 0.35,
  }));
  /** The ring between them opens with the gesture — the "more map" idea. */
  const ringStyle = useAnimatedStyle(() => ({
    opacity: 0.1 + spread.value * 0.22,
    transform: [{ scale: interpolate(spread.value, [0, 1], [0.55, 1.15]) }],
  }));

  if (!eligible || height <= 0) return null;

  return (
    <Animated.View style={[styles.wrap, { height }, wrapStyle]} pointerEvents="none">
      <View style={styles.stage}>
        <Animated.View style={[styles.ring, ringStyle]} />
        {!reducedMotion && (
          <>
            <Animated.View style={[styles.dot, dotA]} />
            <Animated.View style={[styles.dot, dotB]} />
          </>
        )}
      </View>

      <View style={styles.caption}>
        <Ionicons name="resize-outline" size={13} color={colors.onSurface} />
        <Text style={styles.captionText}>Pinch to zoom, drag to look around</Text>
      </View>
    </Animated.View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    wrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.base,
    },
    stage: { width: 92, height: 92, alignItems: 'center', justifyContent: 'center' },
    ring: {
      position: 'absolute',
      width: 88,
      height: 88,
      borderRadius: 44,
      borderWidth: 1.5,
      borderColor: colors.onSurface,
    },
    dot: {
      position: 'absolute',
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: withOpacity(colors.onSurface, 0.9),
      borderWidth: 2,
      borderColor: withOpacity(colors.backgroundDeep, 0.5),
    },
    caption: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.sm,
      borderRadius: radii.full,
      // Opaque rather than glass: this sits on live map tiles, and a caption
      // that is only readable over a park is not a caption.
      backgroundColor: withOpacity(colors.backgroundDeep, 0.86),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.rimLight,
    },
    captionText: {
      fontFamily: fonts.semiBold,
      fontSize: 12,
      lineHeight: 16,
      letterSpacing: 0.1,
      color: colors.onSurface,
    },
  });

export default MapGestureHint;
