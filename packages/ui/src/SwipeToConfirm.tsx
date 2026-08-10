import React, { useCallback, useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';

/**
 * Slide-to-confirm control — the gesture Uber/Bolt/Lyft use for the irreversible
 * steps of a trip ("Start trip", "I've arrived", "Complete trip") instead of a
 * plain button.
 *
 * The point is not decoration: a tap is one accidental brush of a thumb against
 * a phone in a cradle on a bumpy road, and the driver-side actions it guards
 * (arriving, ending a trip, settling fares) cannot be undone. A deliberate
 * ~65 %-of-the-track drag cannot be produced by accident, which is exactly why
 * every ride-hailing app moved these actions to a swipe.
 *
 * Behaviour:
 *  - drag the thumb right; the track fills and the label fades out behind it
 *  - release past `threshold` (fraction of travel) → snaps to the end, fires
 *    `onConfirm` once, and stays filled while `loading` is true
 *  - release short → springs back, nothing fires
 *
 * ── Worklet safety ────────────────────────────────────────────────────────────
 * `react-native-reanimated/plugin` AUTO-WORKLETIZES the callbacks passed to
 * `Gesture.Pan().onUpdate/onEnd`, so they run on the UI runtime where JS-thread
 * functions do not exist — calling one directly from there throws inside the
 * worklet, and an uncaught error on the UI runtime *aborts the process* (that is
 * the SIGABRT this codebase already hit once in MorphBackSwipeDetector). The
 * callbacks below therefore touch nothing but shared values, and the one hop
 * back to JS goes through `runOnJS`.
 */
export interface SwipeToConfirmProps {
  label: string;
  onConfirm: () => void;
  /** Keeps the track filled and the gesture disabled while an action is in flight. */
  loading?: boolean;
  disabled?: boolean;
  /** Fraction of the travel distance that counts as a commit. */
  threshold?: number;
  /** Filled-track / thumb colour. */
  color?: string;
  /** Colour of the text and glyph drawn ON the thumb. */
  onColor?: string;
  trackColor?: string;
  borderColor?: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
  loadingLabel?: string;
  /**
   * The action came back successful. The control holds at the end of the track
   * with a filled bar and a checkmark instead of springing back.
   *
   * BUGFIX ("i swipe to start the trip and it just resets the swipe circle to
   * the initial point — the only way i can tell it worked is to check the
   * status field at the top"). Success and failure were literally the same
   * animation: the reset below fires whenever `loading` goes false, and it goes
   * false on both. So the one control guarding the irreversible steps of a trip
   * gave the driver no way to tell whether the irreversible thing had happened,
   * which is also how a driver ends up swiping twice and collecting a 409.
   */
  confirmed?: boolean;
  /** Label shown while `confirmed` is true. */
  confirmedLabel?: string;
}

const THUMB_INSET = 4;

export function SwipeToConfirm({
  label,
  onConfirm,
  loading = false,
  disabled = false,
  threshold = 0.65,
  color = '#3AA0FF',
  onColor = '#0A0D14',
  trackColor = 'rgba(255,255,255,0.06)',
  borderColor = 'rgba(255,255,255,0.14)',
  height = 60,
  style,
  loadingLabel,
  confirmed = false,
  confirmedLabel,
}: SwipeToConfirmProps) {
  const thumbSize = height - THUMB_INSET * 2;
  // Travel is measured, not assumed: the control is full-width in a panel whose
  // width depends on the device and the panel's padding.
  const trackWidth = useSharedValue(0);
  const x = useSharedValue(0);
  const committed = useSharedValue(false);
  const locked = disabled || loading || confirmed;

  const fire = useCallback(() => {
    onConfirm();
  }, [onConfirm]);

  // Reset when the caller stops loading without unmounting us — but ONLY when
  // the action did not succeed. A confirmed action holds at the end of the
  // track; springing back there is what made a successful swipe indistinguishable
  // from a rejected one (see `confirmed` above).
  React.useEffect(() => {
    if (confirmed) return;
    if (!loading && committed.value) {
      committed.value = false;
      x.value = withSpring(0, { damping: 30, stiffness: 220 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, confirmed]);

  /**
   * SUCCESS HAS TO ANNOUNCE ITSELF.
   *
   * "The checkmark that appears is way too subtle and most drivers might miss
   * it" — and they would: the confirmed state was a colour change on a control
   * the driver has just taken their eyes off, on a phone in a cradle, in
   * daylight. So success now MOVES. The whole track pops once (a fast
   * overshoot, then a spring back to rest) and the check punches in on the
   * thumb behind it.
   *
   * Both are `transform`-only and run entirely on the UI thread — no layout,
   * no measurement, nothing per-frame on the JS thread. The cost is two shared
   * values that are idle except for ~400 ms after a swipe lands.
   */
  const pop = useSharedValue(1);
  const check = useSharedValue(0);

  React.useEffect(() => {
    if (!confirmed) {
      pop.value = 1;
      check.value = 0;
      return;
    }
    const max = Math.max(1, trackWidth.value - thumbSize - THUMB_INSET * 2);
    x.value = withTiming(max, { duration: 180 });
    pop.value = withSequence(
      withTiming(1.045, { duration: 130 }),
      withSpring(1, { damping: 13, stiffness: 260 }),
    );
    check.value = withSequence(
      withTiming(0, { duration: 120 }),
      withSpring(1, { damping: 11, stiffness: 320 }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmed]);

  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const checkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.4 + check.value * 0.6 }],
    opacity: check.value,
  }));

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!locked)
        .activeOffsetX(6)
        .failOffsetY([-14, 14])
        .onUpdate((e) => {
          if (committed.value) return;
          const max = Math.max(1, trackWidth.value - thumbSize - THUMB_INSET * 2);
          x.value = Math.min(Math.max(0, e.translationX), max);
        })
        .onEnd(() => {
          if (committed.value) return;
          const max = Math.max(1, trackWidth.value - thumbSize - THUMB_INSET * 2);
          if (x.value >= max * threshold) {
            committed.value = true;
            x.value = withTiming(max, { duration: 140 });
            runOnJS(fire)();
          } else {
            x.value = withSpring(0, { damping: 31, stiffness: 240 });
          }
        }),
    [locked, threshold, thumbSize, fire, committed, x, trackWidth],
  );

  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  // The fill grows with the thumb so the control reads as "progress toward the
  // action" rather than "a knob that moved".
  //
  // PERFORMANCE (this is the reported "swipe to start is laggy"). This used to
  // animate `width` every frame. Width is a LAYOUT property: each frame of the
  // drag queued a full Yoga layout pass for this subtree on the UI thread, so
  // the one control in the app that must track a finger exactly was the one
  // doing the most work per frame — while the thumb beside it, on a pure
  // `translateX`, cost nothing.
  //
  // The fill is now full-width and parked off to the left, revealed by sliding
  // in. `transform` is composited: no layout, no measurement. Same pixels.
  const fillStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: -(trackWidth.value - (x.value + thumbSize + THUMB_INSET * 2)) },
    ],
  }));

  const labelStyle = useAnimatedStyle(() => {
    const max = Math.max(1, trackWidth.value - thumbSize - THUMB_INSET * 2);
    return {
      opacity: interpolate(x.value, [0, max * 0.55], [1, 0], Extrapolation.CLAMP),
    };
  });

  return (
    <Animated.View
      style={[
        styles.track,
        { height, borderRadius: height / 2, backgroundColor: trackColor, borderColor },
        style,
        popStyle,
      ]}
      onLayout={(e) => {
        trackWidth.value = e.nativeEvent.layout.width;
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Swipe right to confirm"
      accessibilityState={{ disabled: locked }}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.fill,
          // A confirmed action reads as solid, not as a translucent hint of
          // progress — the bar is the receipt for something that already happened.
          { borderRadius: height / 2, backgroundColor: color, opacity: confirmed ? 1 : 0.22 },
          fillStyle,
        ]}
      />

      {/* The success label sits above the fill and does NOT fade with the drag,
          so the driver has something explicit to read at the end of the swipe
          rather than inferring it from the status chip at the top of the screen. */}
      {confirmed && (
        <View style={styles.labelWrap} pointerEvents="none">
          <Text variant="labelLarge" style={{ color: onColor }}>
            {confirmedLabel ?? 'Done'}
          </Text>
        </View>
      )}

      <Animated.View style={[styles.labelWrap, labelStyle]} pointerEvents="none">
        {!confirmed && (
        <Text variant="labelLarge" style={{ color: locked ? 'rgba(255,255,255,0.5)' : '#FFFFFF' }}>
          {loading ? (loadingLabel ?? 'Working…') : label}
        </Text>
        )}
        {!loading && !confirmed && (
          <View style={styles.chevrons}>
            <Ionicons name="chevron-forward" size={14} color="rgba(255,255,255,0.28)" />
            <Ionicons name="chevron-forward" size={14} color="rgba(255,255,255,0.5)" />
            <Ionicons name="chevron-forward" size={14} color="rgba(255,255,255,0.75)" />
          </View>
        )}
      </Animated.View>

      <GestureDetector gesture={pan}>
        <Animated.View
          style={[
            styles.thumb,
            {
              width: thumbSize,
              height: thumbSize,
              borderRadius: thumbSize / 2,
              left: THUMB_INSET,
              top: THUMB_INSET,
              // `confirmed` is a locked state too, but it must not look greyed
              // out — success keeps the accent colour, only refusal dims.
              backgroundColor: confirmed ? color : locked ? 'rgba(255,255,255,0.22)' : color,
            },
            thumbStyle,
          ]}
        >
          {confirmed ? (
            <Animated.View style={checkStyle}>
              <Ionicons name="checkmark" size={26} color={onColor} />
            </Animated.View>
          ) : (
            <Ionicons
              name={loading ? 'ellipsis-horizontal' : 'arrow-forward'}
              size={20}
              color={onColor}
            />
          )}
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    borderWidth: 1,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // Full-width and translated, never resized — see fillStyle. `right: 0` is what
  // makes it full-width without a measured number, so the transform is the only
  // thing that changes per frame.
  fill: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  labelWrap: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  chevrons: { flexDirection: 'row', alignItems: 'center' },
  thumb: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
