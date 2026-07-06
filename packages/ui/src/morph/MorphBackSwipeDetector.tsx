import React, { useCallback, useRef } from 'react';
import { View, type ViewStyle, type StyleProp } from 'react-native';
import {
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
  cancelAnimation,
} from 'react-native-reanimated';
import { springs } from '@eyego/config';
import { useMorphOptional } from './MorphProvider';

interface MorphBackSwipeDetectorProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Yango-style gesture handler for reverse morph. Wrap the content of a morph
 * target screen with this component to enable pull-down-to-dismiss with
 * velocity-aware snapping.
 *
 * How it works:
 * 1. User drags down on the target screen → gesture drives morphProgress
 *    (the shared value that controls the overlay position) from 1 toward 0
 * 2. At each frame, the MorphProvider's overlay repositions between the
 *    target and source frames via interpolate(morphProgress, ...)
 * 3. On release:
 *    - If progress ≤ 0.4 OR velocity ≥ 500px/s → spring to 0 and navigate back
 *    - Otherwise → spring back to 1 (cancel the gesture, stay on screen)
 *
 * Only activates when the provider has an active morph flight and the phase
 * is 'settled' (not during the forward flight itself).
 */
export function MorphBackSwipeDetector({
  children,
  style,
}: MorphBackSwipeDetectorProps) {
  const morph = useMorphOptional();
  const commitRef = useRef<(() => void) | null>(null);

  // Worklet-safe refs for the gesture handle + active state
  const gestureHandleRef = useRef<ReturnType<
    NonNullable<typeof morph>['startMorphBackGesture']
  > | null>(null);
  const isActiveRef = useRef(false);

  // Check if this screen is the active morph target and is settled
  const canSwipeBack = useCallback(() => {
    return (
      morph &&
      morph.activeId !== null &&
      (morph.phase === 'settled' || morph.phase === 'gesture')
    );
  }, [morph]);

  // Store the navigation-back callback so the gesture can trigger it
  const onCommit = useCallback(() => {
    isActiveRef.current = false;
    gestureHandleRef.current = null;
    commitRef.current?.();
  }, []);

  // Reanimated gesture — runs on the UI thread
  const panGesture = Gesture.Pan()
    .onStart(() => {
      if (!canSwipeBack() || !morph) return;
      isActiveRef.current = true;
      const handle = morph.startMorphBackGesture(onCommit);
      gestureHandleRef.current = handle;
      handle.onStart();
    })
    .onUpdate((event) => {
      if (!isActiveRef.current || !gestureHandleRef.current) return;
      gestureHandleRef.current.onActive(event.translationY);
    })
    .onEnd((event) => {
      if (!isActiveRef.current || !gestureHandleRef.current) return;
      gestureHandleRef.current.onEnd(event.velocityY);
    })
    .onFinalize(() => {
      // Cleanup if gesture was cancelled (e.g. by a system gesture)
      isActiveRef.current = false;
    })
    .minDistance(10)
    .activeOffsetY(10)
    .failOffsetY(-10); // Only activate on downward swipe

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View style={[{ flex: 1 }, style]}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}
