import React, { useEffect, useRef } from 'react';
import { View, type ViewStyle } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useMorphOptional } from './MorphProvider';

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

  const isIncomingMorph = !!morph && morph.activeId === id && morph.phase === 'forward';
  const contentOpacity = useSharedValue(isIncomingMorph ? 0 : 1);

  useEffect(() => {
    if (!morph || morph.activeId !== id) return;
    if (morph.phase === 'forward') {
      contentOpacity.value = 0;
    } else {
      // 'settled' (or any other phase once this id is active again) — reveal
      // in lockstep with the clone's own fade-out in MorphProvider.settle().
      contentOpacity.value = withTiming(1, { duration: CROSSFADE_MS });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [morph?.activeId, morph?.phase, id]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: contentOpacity.value }));

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
