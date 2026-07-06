import React, { useEffect, useRef } from 'react';
import { View, type ViewStyle } from 'react-native';
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
 * MorphProvider once laid out. The provider handles the clone visibility
 * and crossfade — this component just measures and reports.
 *
 * Renders children normally when no morph is active (deep links, fallback).
 */
export function MorphTarget({ id, borderRadius = 0, style, children }: MorphTargetProps) {
  const morph = useMorphOptional();
  const ref = useRef<View>(null);
  const reported = useRef(false);

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
      {children}
    </View>
  );
}
