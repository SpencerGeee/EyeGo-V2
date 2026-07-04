import React, { useEffect, useRef } from 'react';
import { View, type ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { durations } from '@eyego/config';
import { useMorphOptional } from './MorphProvider';

interface MorphTargetProps {
  /** Must match the MorphSource id that launched the morph. */
  id: string;
  /** Corner radius the clone should land on (this element's radius). */
  borderRadius?: number;
  style?: ViewStyle | ViewStyle[];
  children: React.ReactNode;
}

/**
 * Wraps the element a morph lands on. Reports its window frame to
 * MorphProvider once laid out; keeps its content invisible while the clone
 * is in flight, then fades it in under the clone's cross-fade.
 * Renders children normally when no morph is active (deep links, fallback).
 */
export function MorphTarget({ id, borderRadius = 0, style, children }: MorphTargetProps) {
  const morph = useMorphOptional();
  const ref = useRef<View>(null);
  const inbound = morph?.activeId === id && morph.phase === 'forward';
  const reversing = morph?.activeId === id && morph.phase === 'reverse';
  const opacity = useSharedValue(inbound ? 0 : 1);
  const reported = useRef(false);

  useEffect(() => {
    if (!morph) return;
    if (morph.activeId !== id) return;
    if (morph.phase === 'settled') {
      opacity.value = withTiming(1, { duration: durations.fast });
    } else if (morph.phase === 'reverse') {
      opacity.value = withTiming(0, { duration: 80 });
    }
  }, [morph, morph?.phase, id, opacity]);

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
        } else {
          // Give up gracefully — provider timeout dissolves the clone.
        }
      });
    });
  };

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <View ref={ref} collapsable={false} onLayout={onLayout} style={style}>
      <Animated.View style={[{ flex: 1 }, animStyle]} pointerEvents={inbound || reversing ? 'none' : 'auto'}>
        {children}
      </Animated.View>
    </View>
  );
}
