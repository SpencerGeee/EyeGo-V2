import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
  Extrapolation,
  cancelAnimation,
  runOnJS,
  useReducedMotion,
  type SharedValue,
} from 'react-native-reanimated';
import { springs, durations } from '@eyego/config';
import { useThemedColors } from '../ColorsContext';
import { usePerformanceTier } from '../effects/usePerformanceTier';

export interface MorphRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What a MorphSource registers so the provider can fly a clone of it. */
export interface MorphSourceEntry {
  measure: () => Promise<MorphRect | null>;
  getClone: () => React.ReactNode;
  borderRadius: number;
  backgroundColor?: string;
  hide: () => void;
  show: () => void;
}

type MorphPhase = 'idle' | 'forward' | 'settled' | 'reverse' | 'gesture';

interface MorphContextValue {
  registerSource: (id: string, entry: MorphSourceEntry) => () => void;
  morphTo: (id: string, navigate: () => void) => void;
  morphBack: (navigateBack: () => void) => void;
  targetReady: (id: string, rect: MorphRect, borderRadius: number) => void;
  /**
   * Yango-style gesture-interruptible reverse. Call from a PanGestureHandler's
   * onStart/onActive/onEnd to drive the morph progress. Exposed so target
   * screens can mount a MorphBackSwipeDetector or custom gesture handler.
   *
   * - onStart: cancel any running spring so the gesture takes over
   * - onActive(dy): set morphProgress based on drag Y (0 = fully reversed)
   * - onEnd(velocityY, commit): if past threshold, spring to 0 && call commit;
   *   else spring back to 1
   */
  startMorphBackGesture: (onCommit: () => void) => MorphBackGestureHandle;
  activeId: string | null;
  phase: MorphPhase;
  /**
   * 0 = clone sitting on the source, 1 = clone landed on the target. Exposed so
   * MorphTarget can reveal the real destination content DURING the flight
   * rather than after it — without this the destination only appeared once the
   * spring had already settled, which is what made every morph read as a fade.
   */
  morphProgress: SharedValue<number>;
}

export interface MorphBackGestureHandle {
  onStart: () => void;
  onActive: (translationY: number) => void;
  onEnd: (velocityY: number) => void;
}

const MorphContext = createContext<MorphContextValue | null>(null);

export function useMorph() {
  const ctx = useContext(MorphContext);
  if (!ctx) throw new Error('useMorph must be used inside <MorphProvider>');
  return ctx;
}

/** Non-throwing variant for components that may render outside the provider. */
export function useMorphOptional() {
  return useContext(MorphContext);
}

/** If the destination never mounts a MorphTarget, dissolve the clone. */
const TARGET_TIMEOUT_MS = 700;
/** Cross-fade window between the clone and the real target content — 200ms
 *  (up from 120ms) so the eye registers the real content before the clone
 *  disappears, avoiding the previous "flash" feel. */
const CROSSFADE_MS = 200;
/** Pixels of drag needed to fully reverse the morph (Yango: ~250–300). */
const GESTURE_FULL_REVERSE_DIST = 280;
/** Progress below this threshold commits the back-navigation on release. */
const GESTURE_COMMIT_THRESHOLD = 0.4;
/** Release velocity (px/s) that forces commit regardless of progress. */
const GESTURE_VELOCITY_THRESHOLD = 500;

/**
 * Fraction of the flight over which the cloned SOURCE content fades out, and
 * the window over which the real DESTINATION content fades in (MorphTarget
 * reads these too). They overlap deliberately — a hard handover at a single
 * point reads as a cut, and no overlap at all reads as two separate fades.
 */
export const CONTENT_FADE_OUT_END = 0.32;
export const CONTENT_FADE_IN_START = 0.28;
export const CONTENT_FADE_IN_END = 0.78;

/**
 * Container-transform ("morph") primitive — Yango-style.
 *
 * Architecture (progress-driven, gesture-interruptible):
 * ------------------------------------------------------------------------
 * The overlay position is derived from `morphProgress` (0→1 shared value),
 * interpolating between the source and target rects. This lets both spring
 * animations AND gesture input drive the same progress value, giving
 * interruptible, velocity-aware morphs with zero positional snap.
 *
 * Forward:  measure source → mount clone at source frame → navigate →
 *           target mounts → springs morphProgress 0→1 → crossfade
 * Reverse:  re-mount clone → springs morphProgress 1→0 → unmount
 * Gesture:  gesture handler cancels the spring → drives progress directly →
 *           on end, snaps to 0 (reverse) or 1 (forward) based on
 *           velocity + position threshold
 */
export function MorphProvider({ children }: { children: React.ReactNode }) {
  const colors = useThemedColors();
  const tier = usePerformanceTier();
  const reducedMotion = useReducedMotion();

  const sources = useRef(new Map<string, MorphSourceEntry>());

  const [activeId, setActiveId] = useState<string | null>(null);
  const [phase, setPhase] = useState<MorphPhase>('idle');
  const [cloneNode, setCloneNode] = useState<React.ReactNode>(null);
  const [cloneBg, setCloneBg] = useState<string | undefined>(undefined);

  // Source rect — set once when morphTo fires
  const sourceX = useSharedValue(0);
  const sourceY = useSharedValue(0);
  const sourceW = useSharedValue(0);
  const sourceH = useSharedValue(0);
  const sourceR = useSharedValue(0);

  // Target rect — set when target screen mounts and reports its frame
  const targetX = useSharedValue(0);
  const targetY = useSharedValue(0);
  const targetW = useSharedValue(0);
  const targetH = useSharedValue(0);
  const targetR = useSharedValue(0);

  // Progress: 0 = source position, 1 = target position
  const morphProgress = useSharedValue(0);
  // Clone crossfade opacity (1 while clone is visible, 0 after settling)
  const cloneOpacity = useSharedValue(1);

  // Ref for the gesture commit callback (set by startMorphBackGesture)
  const gestureCommitRef = useRef<(() => void) | null>(null);

  // Track flight data for cleanup
  const flightRef = useRef<{
    id: string;
    sourceRect: MorphRect;
    sourceRadius: number;
    targetRect: MorphRect | null;
    targetRadius: number;
    timeout: ReturnType<typeof setTimeout> | null;
  } | null>(null);

  const skipMorph = tier === 'low' || reducedMotion;

  // ─── Cleanup ───────────────────────────────────────────────────────────

  const cleanup = useCallback((restoreSource: boolean) => {
    const f = flightRef.current;
    if (f?.timeout) clearTimeout(f.timeout);
    if (restoreSource && f) sources.current.get(f.id)?.show();
    flightRef.current = null;
    setCloneNode(null);
    setActiveId(null);
    setPhase('idle');
  }, []);

  // ─── Settle (crossfade clone → real content) ───────────────────────────

  const settle = useCallback(() => {
    setPhase('settled');
    cloneOpacity.value = withTiming(0, { duration: CROSSFADE_MS });
    setTimeout(() => {
      const f = flightRef.current;
      if (f?.timeout) clearTimeout(f.timeout);
      setCloneNode(null);
    }, CROSSFADE_MS + 20);
  }, [cloneOpacity]);

  // ─── Forward morph ─────────────────────────────────────────────────────

  const morphTo = useCallback(
    (id: string, navigate: () => void) => {
      const entry = sources.current.get(id);
      if (!entry || skipMorph || flightRef.current) {
        navigate();
        return;
      }
      entry.measure().then((rect) => {
        if (!rect || rect.width <= 0 || rect.height <= 0) {
          navigate();
          return;
        }

        // Set source rects
        sourceX.value = rect.x;
        sourceY.value = rect.y;
        sourceW.value = rect.width;
        sourceH.value = rect.height;
        sourceR.value = entry.borderRadius;

        // Reset target rects to source (will update when target mounts)
        targetX.value = rect.x;
        targetY.value = rect.y;
        targetW.value = rect.width;
        targetH.value = rect.height;
        targetR.value = entry.borderRadius;

        // Reset progress to 0 (clone sits at source position)
        morphProgress.value = 0;
        cloneOpacity.value = 1;

        // Set up flight tracking
        flightRef.current = {
          id,
          sourceRect: rect,
          sourceRadius: entry.borderRadius,
          targetRect: null,
          targetRadius: entry.borderRadius,
          timeout: setTimeout(() => {
            cloneOpacity.value = withTiming(0, { duration: durations.fast });
            setTimeout(() => cleanup(true), durations.fast);
          }, TARGET_TIMEOUT_MS),
        };

        setCloneBg(entry.backgroundColor);
        setCloneNode(entry.getClone());
        setActiveId(id);
        setPhase('forward');
        entry.hide();
        navigate();
      });
    },
    [skipMorph, cleanup, sourceX, sourceY, sourceW, sourceH, sourceR,
     targetX, targetY, targetW, targetH, targetR, morphProgress, cloneOpacity]
  );

  // ─── Target ready ──────────────────────────────────────────────────────

  const targetReady = useCallback(
    (id: string, rect: MorphRect, borderRadius: number) => {
      const f = flightRef.current;
      if (!f || f.id !== id) return;
      if (f.timeout) {
        clearTimeout(f.timeout);
        f.timeout = null;
      }

      // Set target rects
      targetX.value = rect.x;
      targetY.value = rect.y;
      targetW.value = rect.width;
      targetH.value = rect.height;
      targetR.value = borderRadius;
      f.targetRect = rect;
      f.targetRadius = borderRadius;

      // Spring progress from 0 → 1 — the overlay flies from source to target
      morphProgress.value = withSpring(1, springs.morph, (finished) => {
        if (finished) runOnJS(settle)();
      });
    },
    [targetX, targetY, targetW, targetH, targetR, morphProgress, settle]
  );

  // ─── Gesture-interruptible reverse ─────────────────────────────────────

  // Stable JS-thread commit — invoked from a worklet via runOnJS. Inline
  // arrow closures passed to runOnJS don't serialize reliably in release
  // builds (a known crash source), so the callback is hoisted here.
  const runGestureCommit = useCallback(() => {
    const cb = gestureCommitRef.current;
    gestureCommitRef.current = null;
    cb?.();
  }, []);

  const startMorphBackGesture = useCallback(
    (onCommit: () => void): MorphBackGestureHandle => {
      gestureCommitRef.current = onCommit;

      const handle: MorphBackGestureHandle = {
        onStart: () => {
          // Interrupt any running spring — gesture takes over
          cancelAnimation(morphProgress);
          setPhase('gesture');
        },

        onActive: (translationY: number) => {
          // Map drag Y to progress decrease (Yango: ~280px = full reverse)
          const drag = translationY / GESTURE_FULL_REVERSE_DIST;
          morphProgress.value = Math.max(0, Math.min(1, 1 - drag));
        },

        onEnd: (velocityY: number) => {
          const p = morphProgress.value;
          const commit = p <= GESTURE_COMMIT_THRESHOLD || velocityY > GESTURE_VELOCITY_THRESHOLD;

          if (commit) {
            // Snap to 0 (fully reversed) then call the commit callback
            morphProgress.value = withSpring(0, springs.morph, (finished) => {
              if (finished) runOnJS(runGestureCommit)();
            });
          } else {
            // Snap back to 1 (cancel gesture, stay on target screen)
            morphProgress.value = withSpring(1, springs.morph);
            setPhase('settled');
          }
        },
      };

      return handle;
    },
    [morphProgress, runGestureCommit]
  );

  // ─── Reverse morph (programmatic back) ─────────────────────────────────

  const morphBack = useCallback(
    (navigateBack: () => void) => {
      const f = flightRef.current;
      const entry = f ? sources.current.get(f.id) : null;
      if (!f || !f.targetRect || !entry || skipMorph) {
        cleanup(true);
        navigateBack();
        return;
      }

      // Re-mount the clone at the target frame
      sourceX.value = f.sourceRect.x;
      sourceY.value = f.sourceRect.y;
      sourceW.value = f.sourceRect.width;
      sourceH.value = f.sourceRect.height;
      sourceR.value = f.sourceRadius;

      targetX.value = f.targetRect.x;
      targetY.value = f.targetRect.y;
      targetW.value = f.targetRect.width;
      targetH.value = f.targetRect.height;
      targetR.value = f.targetRadius;

      morphProgress.value = 1;
      cloneOpacity.value = 1;
      setCloneNode(entry.getClone());
      setPhase('reverse');

      // Pop the screen, then spring progress back to 0
      navigateBack();

      morphProgress.value = withSpring(0, springs.morph, (finished) => {
        if (finished) runOnJS(finishReverse)();
      });
    },
    [skipMorph, cleanup, sourceX, sourceY, sourceW, sourceH, sourceR,
     targetX, targetY, targetW, targetH, targetR, morphProgress, cloneOpacity]
  );

  const finishReverse = useCallback(() => {
    cloneOpacity.value = withTiming(0, { duration: 80 }, () => {
      runOnJS(cleanup)(true);
    });
  }, [cloneOpacity, cleanup]);

  // ─── Overlay style — progress-driven interpolation ─────────────────────

  // BUGFIX: this used to animate raw left/top/width/height every frame.
  // Even though the values are computed on the UI thread (Reanimated
  // worklet), *assigning* them to layout properties still forces a native
  // layout pass every frame — width/height changes ripple through the
  // native layout engine (and can cascade to children), which is far more
  // expensive than a GPU-composited transform. That's what "technically
  // smooth" morphs still look janky, especially for a card growing to
  // full-screen (a large width/height delta re-laid-out ~60x/sec).
  //
  // Fix: give the overlay a FIXED layout frame (pinned at the target rect)
  // and drive 100% of the position/size animation through `transform`
  // (translateX/Y + scaleX/Y) instead — pure GPU compositing, zero layout
  // recalculation per frame. The inner content gets the inverse scale so
  // the cloned content itself isn't visually stretched/squished by the
  // outer transform (standard "container transform" technique).
  const overlayStyle = useAnimatedStyle(() => {
    const w = interpolate(morphProgress.value, [0, 1], [sourceW.value, targetW.value]);
    const h = interpolate(morphProgress.value, [0, 1], [sourceH.value, targetH.value]);
    const x = interpolate(morphProgress.value, [0, 1], [sourceX.value, targetX.value]);
    const y = interpolate(morphProgress.value, [0, 1], [sourceY.value, targetY.value]);
    const baseW = targetW.value || 1;
    const baseH = targetH.value || 1;
    return {
      position: 'absolute' as const,
      left: targetX.value,
      top: targetY.value,
      width: baseW,
      height: baseH,
      borderRadius: interpolate(morphProgress.value, [0, 1], [sourceR.value, targetR.value]),
      opacity: cloneOpacity.value,
      overflow: 'hidden' as const,
      transform: [
        { translateX: x - targetX.value },
        { translateY: y - targetY.value },
        { scaleX: w / baseW },
        { scaleY: h / baseH },
      ],
    };
  });

  // BUGFIX ("the where-to animation looks like a fast fade, not a morph"):
  // the inner inverse-scale exactly cancels the container's scale, so the
  // cloned content rendered at a constant size for the entire flight. Nothing
  // about the content grew, moved or changed — the only thing animating was
  // the clip rectangle, and since the destination content stayed hidden at
  // opacity 0 until `settle()` fired, what a user actually saw was a 200ms
  // crossfade bolted onto the end. That is why it read as a fade.
  //
  // The inverse scale is kept (it is what stops the source content from being
  // stretched by the container transform), but the clone content now fades out
  // over the first third of the flight while MorphTarget fades the real
  // destination content in over the middle — the two halves of a proper
  // container transform, overlapping the container's own growth instead of
  // queueing behind it.
  const contentStyle = useAnimatedStyle(() => {
    const w = interpolate(morphProgress.value, [0, 1], [sourceW.value, targetW.value]);
    const h = interpolate(morphProgress.value, [0, 1], [sourceH.value, targetH.value]);
    const baseW = targetW.value || 1;
    const baseH = targetH.value || 1;
    return {
      width: baseW,
      height: baseH,
      opacity: interpolate(
        morphProgress.value,
        [0, CONTENT_FADE_OUT_END],
        [1, 0],
        Extrapolation.CLAMP,
      ),
      transform: [
        { scaleX: baseW / (w || 1) },
        { scaleY: baseH / (h || 1) },
      ],
    };
  });

  // phaseRef for reading phase inside callbacks
  const phaseRef = useRef<MorphPhase>('idle');
  phaseRef.current = phase;

  // Teardown on unmount — cancel any in-flight spring and clear the flight
  // timeout so a settle/cleanup callback can't fire against a dead tree.
  React.useEffect(() => {
    return () => {
      cancelAnimation(morphProgress);
      cancelAnimation(cloneOpacity);
      const f = flightRef.current;
      if (f?.timeout) clearTimeout(f.timeout);
    };
  }, [morphProgress, cloneOpacity]);

  // ─── Context value ─────────────────────────────────────────────────────

  const value = useMemo<MorphContextValue>(
    () => ({
      registerSource: (id, entry) => {
        sources.current.set(id, entry);
        return () => {
          if (sources.current.get(id) === entry) sources.current.delete(id);
        };
      },
      morphTo,
      morphBack,
      targetReady,
      startMorphBackGesture,
      activeId,
      phase,
      morphProgress,
    }),
    [morphTo, morphBack, targetReady, startMorphBackGesture, activeId, phase, morphProgress]
  );

  return (
    <MorphContext.Provider value={value}>
      <View style={styles.host} pointerEvents="box-none">
        {children}
        {cloneNode != null && (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <Animated.View
              style={[
                overlayStyle,
                { backgroundColor: cloneBg ?? colors.backgroundDeep },
              ]}
            >
              <Animated.View style={contentStyle}>{cloneNode}</Animated.View>
            </Animated.View>
          </View>
        )}
      </View>
    </MorphContext.Provider>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1 },
});
