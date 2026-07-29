import React, { useEffect, useRef } from 'react';
import { View, type ViewStyle } from 'react-native';
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
  const animatedStyle = useAnimatedStyle(() => {
    if (!progress || !isActiveMorph) return { opacity: contentOpacity.value };
    return {
      opacity: interpolate(
        progress.value,
        [CONTENT_FADE_IN_START, CONTENT_FADE_IN_END],
        [0, 1],
        Extrapolation.CLAMP,
      ),
    };
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
      <Animated.View style={animatedStyle}>{children}</Animated.View>
    </View>
  );
}
