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
  cancelAnimation,
  runOnJS,
  useReducedMotion,
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
/** Cross-fade window between the clone and the real target content. */
const CROSSFADE_MS = 120;
/** Pixels of drag needed to fully reverse the morph (Yango: ~250–300). */
const GESTURE_FULL_REVERSE_DIST = 280;
/** Progress below this threshold commits the back-navigation on release. */
const GESTURE_COMMIT_THRESHOLD = 0.4;
/** Release velocity (px/s) that forces commit regardless of progress. */
const GESTURE_VELOCITY_THRESHOLD = 500;

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

  const overlayStyle = useAnimatedStyle(() => ({
    position: 'absolute' as const,
    left: interpolate(morphProgress.value, [0, 1], [sourceX.value, targetX.value]),
    top: interpolate(morphProgress.value, [0, 1], [sourceY.value, targetY.value]),
    width: interpolate(morphProgress.value, [0, 1], [sourceW.value, targetW.value]),
    height: interpolate(morphProgress.value, [0, 1], [sourceH.value, targetH.value]),
    borderRadius: interpolate(morphProgress.value, [0, 1], [sourceR.value, targetR.value]),
    opacity: cloneOpacity.value,
    overflow: 'hidden' as const,
  }));

  const contentStyle = useAnimatedStyle(() => ({
    width: interpolate(morphProgress.value, [0, 1], [sourceW.value, targetW.value]),
    height: interpolate(morphProgress.value, [0, 1], [sourceH.value, targetH.value]),
  }));

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
    }),
    [morphTo, morphBack, targetReady, startMorphBackGesture, activeId, phase]
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
