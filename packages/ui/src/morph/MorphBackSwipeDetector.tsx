import React, { useCallback, useMemo, useRef } from 'react';
import { StyleSheet, type ViewStyle, type StyleProp } from 'react-native';
import {
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useMorphOptional } from './MorphProvider';

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
 *
 * ── CRASH FIX (SIGABRT on any drag over a morph target) ──────────────────────
 * The Pan callbacks below are plain JS closures: they read React context
 * (`morph`), call `useCallback` handlers, mutate refs and reach into the
 * provider, which calls `setState`. But `react-native-reanimated/plugin`
 * AUTO-WORKLETIZES callbacks passed to `Gesture.Pan().onStart/onUpdate/onEnd/
 * onFinalize`, so all of that was being executed on the UI runtime, where those
 * JS-thread functions do not exist. The first drag threw inside the worklet and
 * an uncaught JS error on the UI runtime aborts the process — the reported
 * "the map crashes when I tap/move it" (the where-to surface wraps its whole
 * body in this detector). Crash log `ios crash logs/EyeGo-2026-07-29-232912.ips`:
 *   RNGestureHandlerManager sendEventForReanimated
 *     -> REANodesManager dispatchEvent
 *       -> worklets::WorkletEventHandler::process
 *         -> HermesRuntimeImpl::throwPendingError -> abort()
 *
 * `.runOnJS(true)` pins the whole gesture to the JS thread, which is where this
 * logic has to run (it drives React state and provider callbacks). The progress
 * shared value is still written from JS, which Reanimated fully supports, so the
 * overlay keeps animating on the UI thread. Any future callback added here must
 * stay JS-thread-safe or the gesture must be split into a worklet half.
 */
interface MorphBackSwipeDetectorProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Called when the gesture completes the reverse morph and the screen
   *  should navigate back. If omitted, the gesture only reverses the morph
   *  overlay visually — the caller must navigate back separately. */
  onSwipeBack?: () => void;
}

export function MorphBackSwipeDetector({
  children,
  style,
  onSwipeBack,
}: MorphBackSwipeDetectorProps) {
  const morph = useMorphOptional();
  const commitRef = useRef<(() => void) | null>(null);
  // Sync the onSwipeBack prop into a ref so the gesture callback always
  // sees the latest value without re-creating the gesture.
  const swipeBackRef = useRef(onSwipeBack);
  swipeBackRef.current = onSwipeBack;

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
    // Call the user-provided callback first, then the ref-based fallback
    swipeBackRef.current?.();
    commitRef.current?.();
  }, []);

  // JS-thread gesture — see the crash note above for why `.runOnJS(true)` is
  // load-bearing and not an optimisation choice.
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
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
        .minDistance(14)
        .activeOffsetY(14)
        .failOffsetY(-14) // Only activate on downward swipe
        // A drag that starts horizontally is a map pan / carousel swipe, never a
        // dismiss — without this the detector claimed those too.
        .failOffsetX([-24, 24]),
    [canSwipeBack, morph, onCommit],
  );

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View style={[styles.fill, style]}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

/**
 * NOT `{ flex: 1 }`, and the difference is load-bearing — this is the bug behind
 * "the where-to fields are malformed and tapping them does nothing".
 *
 * A caller cannot override a `flex` shorthand with longhands, because Yoga does
 * not resolve them the way style-merging suggests. `YGNodeResolveFlexBasisPtr`
 * is, in effect:
 *
 *     if (flexBasis is a DEFINITE value)  return flexBasis;   // auto fails this
 *     if (flex is set && flex > 0)        return 0;
 *     return auto;
 *
 * `flexBasis: 'auto'` has unit `Auto`, so it does NOT satisfy the first test and
 * falls through to the second — where a `flex: 1` sitting underneath it in the
 * merged style still forces the basis to ZERO. `flexGrow` resolves the other way
 * round (an explicit longhand does win), so a caller spelling out
 * `{ flexGrow: 0, flexShrink: 0, flexBasis: 'auto' }` to get a content-sized
 * wrapper got the worst of both: basis 0 from our `flex`, and grow 0 from their
 * own style, leaving a definite main-axis size of zero that could never grow
 * back.
 *
 * `SearchStage` does exactly that (`swipeZone`, deliberately not `flex: 1` so the
 * detector cannot claim every pan over the map). The result was a zero-height
 * swipe zone, so the where-to card had no height, its two field rows collapsed,
 * and a Pressable with no box has nothing to tap. Three previous fixes pinned
 * widths and heights further down the tree; none of them could work, because the
 * zero was being introduced above them here.
 *
 * The longhands below are inert for a caller that overrides them and identical
 * to `flex: 1` for one that does not. `MorphTarget` already carries the same
 * fix and the same reasoning.
 */
const styles = StyleSheet.create({
  fill: { flexGrow: 1, flexShrink: 1, flexBasis: 'auto' },
});
