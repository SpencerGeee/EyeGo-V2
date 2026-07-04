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

type MorphPhase = 'idle' | 'forward' | 'settled' | 'reverse';

interface MorphContextValue {
  registerSource: (id: string, entry: MorphSourceEntry) => () => void;
  morphTo: (id: string, navigate: () => void) => void;
  morphBack: (navigateBack: () => void) => void;
  targetReady: (id: string, rect: MorphRect, borderRadius: number) => void;
  /** Morph currently in flight / settled for this id (MorphTarget coordination). */
  activeId: string | null;
  phase: MorphPhase;
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
const CROSSFADE_MS = 150;

/**
 * Container-transform ("morph") primitive. Reanimated shared-element
 * transitions are unavailable on new-arch + Reanimated 4.1, so this flies a
 * measured clone in a root overlay instead: measure source → mount clone at
 * the source frame → navigate (route must use animation 'none' or 'fade') →
 * spring the clone to the target frame → cross-fade into the real content.
 * Falls back to plain navigation on low-tier devices or reduced motion.
 */
export function MorphProvider({ children }: { children: React.ReactNode }) {
  const colors = useThemedColors();
  const tier = usePerformanceTier();
  const reducedMotion = useReducedMotion();

  const sources = useRef(new Map<string, MorphSourceEntry>());
  const flight = useRef<{
    id: string;
    sourceRect: MorphRect;
    sourceRadius: number;
    targetRect: MorphRect | null;
    targetRadius: number;
    timeout: ReturnType<typeof setTimeout> | null;
  } | null>(null);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [phase, setPhase] = useState<MorphPhase>('idle');
  const [cloneNode, setCloneNode] = useState<React.ReactNode>(null);
  const [cloneBg, setCloneBg] = useState<string | undefined>(undefined);

  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const w = useSharedValue(0);
  const h = useSharedValue(0);
  const r = useSharedValue(0);
  const cloneOpacity = useSharedValue(1);
  // Fixed content box so the clone's children never relayout mid-flight.
  const contentW = useSharedValue(0);
  const contentH = useSharedValue(0);

  const skipMorph = tier === 'low' || reducedMotion;

  const cleanup = useCallback((restoreSource: boolean) => {
    const f = flight.current;
    if (f?.timeout) clearTimeout(f.timeout);
    if (restoreSource && f) sources.current.get(f.id)?.show();
    flight.current = null;
    setCloneNode(null);
    setActiveId(null);
    setPhase('idle');
  }, []);

  const registerSource = useCallback((id: string, entry: MorphSourceEntry) => {
    sources.current.set(id, entry);
    return () => {
      // Another instance may have re-registered under the same id already.
      if (sources.current.get(id) === entry) sources.current.delete(id);
    };
  }, []);

  const morphTo = useCallback(
    (id: string, navigate: () => void) => {
      const entry = sources.current.get(id);
      if (!entry || skipMorph || flight.current) {
        navigate();
        return;
      }
      entry.measure().then((rect) => {
        if (!rect || rect.width <= 0 || rect.height <= 0) {
          navigate();
          return;
        }
        flight.current = {
          id,
          sourceRect: rect,
          sourceRadius: entry.borderRadius,
          targetRect: null,
          targetRadius: entry.borderRadius,
          timeout: setTimeout(() => {
            // Destination never reported a MorphTarget — dissolve gracefully.
            cloneOpacity.value = withTiming(0, { duration: durations.fast });
            setTimeout(() => cleanup(true), durations.fast);
          }, TARGET_TIMEOUT_MS),
        };
        x.value = rect.x;
        y.value = rect.y;
        w.value = rect.width;
        h.value = rect.height;
        r.value = entry.borderRadius;
        contentW.value = rect.width;
        contentH.value = rect.height;
        cloneOpacity.value = 1;
        setCloneBg(entry.backgroundColor);
        setCloneNode(entry.getClone());
        setActiveId(id);
        setPhase('forward');
        entry.hide();
        navigate();
      });
    },
    [skipMorph, cleanup, x, y, w, h, r, contentW, contentH, cloneOpacity]
  );

  const settle = useCallback(() => {
    setPhase('settled');
    cloneOpacity.value = withTiming(0, { duration: CROSSFADE_MS });
    setTimeout(() => {
      const f = flight.current;
      // Keep flight data for morphBack — only drop the clone node.
      if (f?.timeout) clearTimeout(f.timeout);
      setCloneNode(null);
    }, CROSSFADE_MS + 20);
  }, [cloneOpacity]);

  const targetReady = useCallback(
    (id: string, rect: MorphRect, borderRadius: number) => {
      const f = flight.current;
      if (!f || f.id !== id || phaseRef.current !== 'forward') return;
      if (f.timeout) {
        clearTimeout(f.timeout);
        f.timeout = null;
      }
      f.targetRect = rect;
      f.targetRadius = borderRadius;
      x.value = withSpring(rect.x, springs.snappy);
      y.value = withSpring(rect.y, springs.snappy);
      h.value = withSpring(rect.height, springs.snappy);
      r.value = withSpring(borderRadius, springs.snappy);
      w.value = withSpring(rect.width, springs.snappy, (finished) => {
        if (finished) runOnJS(settle)();
      });
    },
    [x, y, w, h, r, settle]
  );

  // phase is read inside stable callbacks — mirror it in a ref.
  const phaseRef = useRef<MorphPhase>('idle');
  phaseRef.current = phase;

  const morphBack = useCallback(
    (navigateBack: () => void) => {
      const f = flight.current;
      const entry = f ? sources.current.get(f.id) : null;
      if (!f || !f.targetRect || !entry || skipMorph) {
        cleanup(true);
        navigateBack();
        return;
      }
      // Re-mount the clone at the target frame, pop the screen beneath it,
      // then spring home to the source frame.
      x.value = f.targetRect.x;
      y.value = f.targetRect.y;
      w.value = f.targetRect.width;
      h.value = f.targetRect.height;
      r.value = f.targetRadius;
      cloneOpacity.value = 1;
      setCloneNode(entry.getClone());
      setPhase('reverse');
      navigateBack();
      x.value = withSpring(f.sourceRect.x, springs.snappy);
      y.value = withSpring(f.sourceRect.y, springs.snappy);
      h.value = withSpring(f.sourceRect.height, springs.snappy);
      r.value = withSpring(f.sourceRadius, springs.snappy);
      w.value = withSpring(f.sourceRect.width, springs.snappy, (finished) => {
        if (finished) runOnJS(finishReverse)();
      });
    },
    [skipMorph, cleanup, x, y, w, h, r, cloneOpacity]
  );

  const finishReverse = useCallback(() => {
    cloneOpacity.value = withTiming(0, { duration: 80 }, () => {
      runOnJS(cleanup)(true);
    });
  }, [cloneOpacity, cleanup]);

  const overlayStyle = useAnimatedStyle(() => ({
    position: 'absolute' as const,
    left: x.value,
    top: y.value,
    width: w.value,
    height: h.value,
    borderRadius: r.value,
    opacity: cloneOpacity.value,
    overflow: 'hidden' as const,
  }));

  const contentStyle = useAnimatedStyle(() => ({
    width: contentW.value,
    height: contentH.value,
  }));

  const value = useMemo<MorphContextValue>(
    () => ({ registerSource, morphTo, morphBack, targetReady, activeId, phase }),
    [registerSource, morphTo, morphBack, targetReady, activeId, phase]
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
