import { useCallback, useMemo, useState } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  type WithSpringConfig,
} from 'react-native-reanimated';

/**
 * Panel motion engine — the sheet is a finite-state surface
 * (hidden / collapsed / expanded), driven by exactly ONE shared value
 * (`y`, the sheet's top edge in screen px). Everything else (backdrop
 * opacity, header fades, control offsets) derives from the 0..1
 * `progress` value so child blocks never invent their own motion.
 *
 * Gesture ownership: the pan is simultaneous with the inner scroll's
 * native gesture. While the panel is expanded and the content is
 * scrolled away from its top, the scroll owns the gesture and the pan
 * keeps re-anchoring; the moment the scroll returns to top, a continued
 * pull-down hands over to the panel with no visible seam.
 *
 * Release always snaps to a stop with a velocity-fed spring — position
 * projected ~150ms ahead picks the nearest stop, and a fast flick
 * always advances one stop in the flick direction.
 */

export type PanelState = 'hidden' | 'collapsed' | 'expanded';

export interface PanelSnapPoints {
  /** Sheet top (y, screen px) when fully off-screen. */
  hidden: number;
  /** Optional mid stop. */
  collapsed?: number;
  /** Sheet top when fully open. */
  expanded: number;
}

export interface PanelMotionOptions {
  snapPoints: PanelSnapPoints;
  initialState?: PanelState;
  /** Allow dragging past the lowest stop to dismiss (default true). */
  dismissible?: boolean;
  spring?: WithSpringConfig;
  onStateChange?: (state: PanelState) => void;
  /** Fires once the sheet has fully settled off-screen. */
  onDismissed?: () => void;
}

/** Physical (not duration-based) so release inherits finger velocity. */
export const panelSpring: WithSpringConfig = { stiffness: 320, damping: 34, mass: 0.9 };

const FLICK_VELOCITY = 900; // px/s — beyond this, always advance a stop
const PROJECTION = 0.15; // s of velocity projection for snap choice
const RUBBER_BAND = 0.14; // resistance when dragging past fully-open

export function usePanelMotion({
  snapPoints,
  initialState = 'hidden',
  dismissible = true,
  spring = panelSpring,
  onStateChange,
  onDismissed,
}: PanelMotionOptions) {
  const { hidden, collapsed, expanded } = snapPoints;

  const yFor = useCallback(
    (s: PanelState) => (s === 'expanded' ? expanded : s === 'collapsed' ? collapsed ?? expanded : hidden),
    [expanded, collapsed, hidden]
  );

  const y = useSharedValue(yFor(initialState));
  const startY = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const stateSV = useSharedValue<PanelState>(initialState);
  const [panelState, setPanelState] = useState<PanelState>(initialState);

  const emitState = useCallback(
    (s: PanelState) => {
      setPanelState(s);
      onStateChange?.(s);
    },
    [onStateChange]
  );
  const emitDismissed = useCallback(() => {
    onDismissed?.();
  }, [onDismissed]);

  /** 0 = hidden, 1 = expanded. Derive all secondary motion from this. */
  const progress = useDerivedValue(
    () => interpolate(y.value, [hidden, expanded], [0, 1], Extrapolation.CLAMP),
    [hidden, expanded]
  );

  /** Attach to the inner scrollable so the engine can arbitrate ownership. */
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  const nativeGesture = useMemo(() => Gesture.Native(), []);

  const panGesture = useMemo(() => {
    const settle = (target: number, velocity: number) => {
      'worklet';
      const s: PanelState = target === expanded ? 'expanded' : target === hidden ? 'hidden' : 'collapsed';
      stateSV.value = s;
      runOnJS(emitState)(s);
      y.value = withSpring(target, { ...spring, velocity }, (finished) => {
        if (finished && s === 'hidden') runOnJS(emitDismissed)();
      });
    };

    return Gesture.Pan()
      .simultaneousWithExternalGesture(nativeGesture)
      .onStart(() => {
        startY.value = y.value;
      })
      .onUpdate((e) => {
        if (stateSV.value === 'expanded' && scrollY.value > 1) {
          // Scroll owns the gesture; re-anchor for a seamless takeover.
          startY.value = expanded - e.translationY;
          y.value = expanded;
          return;
        }
        const raw = startY.value + e.translationY;
        const lowest = dismissible ? hidden : collapsed ?? expanded;
        let next = Math.min(raw, lowest);
        if (raw < expanded) next = expanded - (expanded - raw) * RUBBER_BAND;
        y.value = next;
      })
      .onEnd((e) => {
        const stops: number[] = [expanded];
        if (collapsed != null) stops.push(collapsed);
        if (dismissible) stops.push(hidden);

        let target: number;
        if (Math.abs(e.velocityY) > FLICK_VELOCITY) {
          const down = e.velocityY > 0;
          const ahead = stops.filter((s) => (down ? s > y.value + 1 : s < y.value - 1));
          target = ahead.length
            ? down
              ? Math.min(...ahead)
              : Math.max(...ahead)
            : down
              ? Math.max(...stops)
              : Math.min(...stops);
        } else {
          const projected = y.value + e.velocityY * PROJECTION;
          target = stops.reduce(
            (best, s) => (Math.abs(s - projected) < Math.abs(best - projected) ? s : best),
            stops[0]
          );
        }
        settle(target, e.velocityY);
      });
  }, [expanded, collapsed, hidden, dismissible, spring, nativeGesture, emitState, emitDismissed, y, startY, scrollY, stateSV]);

  /** Programmatic snap (open / collapse / dismiss). */
  const snapToState = useCallback(
    (s: PanelState) => {
      stateSV.value = s;
      emitState(s);
      y.value = withSpring(yFor(s), spring, (finished) => {
        'worklet';
        if (finished && s === 'hidden') runOnJS(emitDismissed)();
      });
    },
    [yFor, spring, emitState, emitDismissed, y, stateSV]
  );

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));

  return {
    y,
    progress,
    panelState,
    stateSV,
    panGesture,
    nativeGesture,
    scrollHandler,
    scrollY,
    sheetStyle,
    snapToState,
  };
}
