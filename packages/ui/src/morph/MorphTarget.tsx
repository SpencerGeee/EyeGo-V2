import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import {
  useMorphOptional,
  CONTENT_FADE_IN_START,
  CONTENT_FADE_IN_END,
} from './MorphProvider';

interface MorphTargetProps {
  /** Must match the MorphSource id that launched the morph. */
  id: string;
  /** Corner radius the clone should land on (this element's radius). */
  borderRadius?: number;
  style?: ViewStyle | ViewStyle[];
  children: React.ReactNode;
}

// Must match MorphProvider's CROSSFADE_MS — the clone overlay fades out over
// this same window, so the real content needs to fade in in lockstep.
const CROSSFADE_MS = 200;

// NOT `flex: 1`. In React Native the `flex` shorthand expands to
// `flexGrow: n, flexShrink: 1, flexBasis: 0` — and a flexBasis of ZERO in a
// column parent whose own height is indefinite (every content-sized morph
// target: the where-to card, sheets, chips) contributes 0 to the parent's
// content height and has no free space to grow back into. The wrapper measured
// 0 tall, so the card below it was laid out against a zero-height box and its
// `alignItems: 'stretch'` row collapsed every child to height 0 — the reported
// "where-to page is showing the one line thing" (an empty 48pt pill with the
// timeline dots spilling out underneath it).
// `flexBasis: 'auto'` keeps the full-screen behaviour the flex was added for
// (grow into the free space of a `flex: 1` parent — see the black-map note
// below) while letting an auto-height parent measure real content.
const styles = StyleSheet.create({
  fill: { flexGrow: 1, flexShrink: 1, flexBasis: 'auto' },
});

/**
 * Wraps the element a morph lands on. Reports its window frame to
 * MorphProvider once laid out. The provider handles the clone visibility
 * and crossfade — this component just measures and reports.
 *
 * Renders children normally when no morph is active (deep links, fallback).
 * While a forward morph targeting this id is in flight, content is hidden
 * (opacity 0) until the clone settles — previously it rendered unconditionally,
 * so the full destination screen was visible underneath from frame one while
 * the small clone was still visibly ballooning open on top of it.
 */
export function MorphTarget({ id, borderRadius = 0, style, children }: MorphTargetProps) {
  const morph = useMorphOptional();
  const ref = useRef<View>(null);
  const reported = useRef(false);

  const isActiveMorph = !!morph && morph.activeId === id;
  const isIncomingMorph = isActiveMorph && morph!.phase === 'forward';
  const contentOpacity = useSharedValue(isIncomingMorph ? 0 : 1);
  const progress = morph?.morphProgress;
  // Only a LIVE flight is allowed to drive this screen's visibility. Once the
  // flight has settled (or was never really in the air) the screen owns its own
  // opacity — reading a stale `morphProgress` after the fact is how the where-to
  // card ended up rendered at opacity 0 with nothing but the leftover clone
  // visible, and no way for the rider to interact with it.
  const flightOwnsOpacity =
    isActiveMorph && (morph!.phase === 'forward' || morph!.phase === 'gesture' || morph!.phase === 'reverse');

  useEffect(() => {
    if (!morph || morph.activeId !== id) {
      // No morph in flight for this id (deep link, or the flight has been torn
      // down). Content must be visible — an earlier version left it at 0 here,
      // which could strand a screen permanently blank if the flight was
      // cancelled by the target timeout.
      contentOpacity.value = 1;
      return;
    }
    if (morph.phase === 'settled') {
      // Belt and braces: the progress-driven style below has normally already
      // brought this to 1 by the time the spring settles.
      contentOpacity.value = withTiming(1, { duration: CROSSFADE_MS });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [morph?.activeId, morph?.phase, id]);

  // BUGFIX (morphs "look like a fast fade"): the destination content used to
  // sit at opacity 0 for the ENTIRE flight and only cross-fade in after the
  // spring settled. So the growth and the content change never overlapped —
  // the eye saw a container slide, then a separate fade. Driving opacity from
  // the live morph progress instead means the destination resolves *while* the
  // container is still travelling, which is what makes a container transform
  // read as one continuous morph. It also makes the reverse gesture correct for
  // free: drag back and the content dissolves progressively with your finger
  // instead of snapping at the end.
  // FAIL-SAFE: a forward flight that never reports a usable target frame, or a
  // target screen that outlives its flight, must not leave the screen blank.
  // Whatever else happens, the content is visible this long after mount.
  const REVEAL_DEADLINE_MS = 1200;
  useEffect(() => {
    if (!isIncomingMorph) return;
    const t = setTimeout(() => {
      contentOpacity.value = withTiming(1, { duration: CROSSFADE_MS });
    }, REVEAL_DEADLINE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isIncomingMorph]);

  const animatedStyle = useAnimatedStyle(() => {
    if (!progress || !flightOwnsOpacity) return { opacity: contentOpacity.value };
    // Even while the flight owns the reveal, never go BELOW whatever the
    // fail-safe has already raised the content to.
    const fromProgress = interpolate(
      progress.value,
      [CONTENT_FADE_IN_START, CONTENT_FADE_IN_END],
      [0, 1],
      Extrapolation.CLAMP,
    );
    // The floor applies to the ENTRANCE only. During a reverse/gesture dismissal
    // the content is supposed to dissolve back with the finger, so there it
    // follows progress alone.
    return { opacity: isIncomingMorph ? Math.max(contentOpacity.value, fromProgress) : fromProgress };
  });

  const onLayout = () => {
    if (!morph || reported.current || morph.activeId !== id || morph.phase !== 'forward') return;
    reported.current = true;
    // New-arch Android can report a zero frame on the first layout pass —
    // defer one frame before measuring in window coordinates.
    requestAnimationFrame(() => {
      const node = ref.current;
      if (!node) return;
      node.measureInWindow((x, y, width, height) => {
        if (width > 0 && height > 0) {
          morph.targetReady(id, { x, y, width, height }, borderRadius);
        }
        // If width/height is 0, the provider's TARGET_TIMEOUT_MS will
        // dissolve the clone gracefully.
      });
    });
  };

  return (
    <View ref={ref} collapsable={false} onLayout={onLayout} style={style}>
      {/* BUGFIX ("the map is pure black on the tracking page"): this wrapper
          carried ONLY the animated opacity, so it had no flex — a full-screen
          target like <MorphTarget style={{ flex: 1 }}> stretched the OUTER view
          while this inner one collapsed to its content height. Anything the
          screen positioned with `position: absolute` + absoluteFill (every
          MapView in both apps) then filled a zero-height box, so the native map
          measured 0×0, never reported a size, never attached its camera, and
          rendered nothing — reading on-device as a black screen behind the
          panel. `flex: 1` here is inert for content-sized targets (Yoga only
          distributes free space, of which an auto-height parent has none) and
          restores the full height for screen-sized ones. */}
      <Animated.View style={[styles.fill, animatedStyle]}>{children}</Animated.View>
    </View>
  );
}
