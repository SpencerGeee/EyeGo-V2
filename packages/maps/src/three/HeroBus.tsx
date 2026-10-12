import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
  type WithSpringConfig,
} from 'react-native-reanimated';
import { Model3D } from './Model3D';
import type { Model } from './engine';

/**
 * ── THE HERO BUS ────────────────────────────────────────────────────────────
 *
 * ("each stage … should have a 3D effect that morphs and moves from one stage
 * to the next"). One minibus is the protagonist of a booking: it waits beside
 * "Where to?", becomes the ride you choose, docks into the review, and touches
 * down on your pickup when the search starts. It is ONE object moving, not a
 * picture per screen.
 *
 * How, cheaply. Each stage marks where the bus belongs with a `HeroBusSlot`.
 * The slot draws the bus itself while it is the resting place — so it scrolls
 * and lays out like any view. When a NEW slot appears, a single transit layer
 * picks the bus up at the old slot's position, flies it to the new one on the
 * stage's own spring (transform-only, UI thread), and hands it to the new slot
 * on landing. At most two tiny cached-frame canvases exist at once, and only
 * during the flight. A `land` slot is a destination, not a home: the bus
 * touches down there, shrinks and dissolves.
 */

const FRAME = 140;
export const SHOWROOM_YAW = 228;
export const SHOWROOM_PITCH = 58;

interface Rect { x: number; y: number }
interface SlotEntry { id: string; seq: number; at: Rect | null; size: number; yaw: number; pitch: number; land: boolean; model?: Model }

type Store = {
  slots: Map<string, SlotEntry>;
  /** The slot that currently draws the bus itself (null while in flight). */
  resting: string | null;
  listeners: Set<() => void>;
  seq: number;
  version: number;
};

const Ctx = createContext<{
  store: Store;
  model: Model;
  spinKey: string;
  reduced: boolean;
} | null>(null);

function emit(s: Store) {
  s.version += 1;
  s.listeners.forEach((l) => l());
}

/** The newest measured slot — where the bus should be now. */
function target(s: Store): SlotEntry | null {
  let best: SlotEntry | null = null;
  s.slots.forEach((v) => { if (v.at && (!best || v.seq > best.seq)) best = v; });
  return best;
}

export function HeroBusProvider({
  model,
  spinKey,
  spring,
  reduced = false,
  children,
}: {
  model: Model;
  /** Changing it plays one turntable revolution (e.g. the chosen tier). */
  spinKey: string;
  spring: WithSpringConfig;
  /** Low-tier device or Reduce Motion: no flight, no spin — the bus just appears. */
  reduced?: boolean;
  children: React.ReactNode;
}) {
  const store = useRef<Store>({ slots: new Map(), resting: null, listeners: new Set(), seq: 0, version: 0 }).current;
  const value = useMemo(() => ({ store, model, spinKey, reduced }), [store, model, spinKey, reduced]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <Transit store={store} model={model} spring={spring} reduced={reduced} />
    </Ctx.Provider>
  );
}

const noop = () => () => {};
function useStore(store: Store | undefined) {
  const subscribe = useCallback(
    (l: () => void) => { if (!store) return () => {}; store.listeners.add(l); return () => { store.listeners.delete(l); }; },
    [store],
  );
  return useSyncExternalStore(store ? subscribe : noop, () => store?.version ?? 0);
}

/** The one layer that carries the bus between slots. */
function Transit({ store, model, spring, reduced }: { store: Store; model: Model; spring: WithSpringConfig; reduced: boolean }) {
  useStore(store);
  const goal = target(store);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0);
  const last = useRef<SlotEntry | null>(null);
  const [pose, setPose] = useState<{ yaw: number; pitch: number; model?: Model }>({ yaw: SHOWROOM_YAW, pitch: SHOWROOM_PITCH });

  const settle = useCallback((id: string) => {
    if (target(store)?.id !== id) return; // a newer slot took over mid-flight
    store.resting = id;
    emit(store);
    // Hand-off: the slot draws on the next frame, THEN this layer lets go —
    // hiding it first would blink the bus out for a frame.
    requestAnimationFrame(() => requestAnimationFrame(() => { opacity.value = 0; }));
  }, [store, opacity]);

  useEffect(() => {
    const from = last.current;
    if (!goal || !goal.at) { last.current = goal; return; }
    if (from && from.id === goal.id && from.at && goal.at.x === from.at.x && goal.at.y === from.at.y) return;
    last.current = goal;
    const toScale = goal.size / FRAME;
    // Nowhere to fly from (first slot), or flights are off: rest in place.
    if (!from || !from.at || reduced || from.id === goal.id) {
      opacity.value = 0;
      if (goal.land) { store.resting = null; emit(store); return; }
      if (store.resting !== goal.id) { store.resting = goal.id; emit(store); }
      return;
    }
    // Pick it up where it was drawn…
    x.value = from.at.x;
    y.value = from.at.y;
    scale.value = from.size / FRAME;
    opacity.value = 1;
    setPose({ yaw: goal.yaw, pitch: goal.pitch, model: goal.model ?? from.model });
    store.resting = null;
    emit(store);
    // …and fly it to the new slot on the stage's own spring.
    x.value = withSpring(goal.at.x, spring);
    y.value = withSpring(goal.at.y, spring, (done) => {
      'worklet';
      if (done && !goal.land) runOnJS(settle)(goal.id);
    });
    if (goal.land) {
      // Touch down, then shrink into the point and dissolve.
      scale.value = withSequence(
        withSpring(toScale, spring),
        withTiming(toScale * 0.2, { duration: 420, easing: Easing.in(Easing.cubic) }),
      );
      opacity.value = withDelay(700, withTiming(0, { duration: 360 }));
    } else {
      scale.value = withSpring(toScale, spring);
    }
  }, [goal, reduced, spring, store, settle, x, y, scale, opacity]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: x.value - FRAME / 2 },
      { translateY: y.value - FRAME / 2 },
      { scale: scale.value },
    ],
  }));

  return (
    <Animated.View pointerEvents="none" style={[styles.transit, style]}>
      <Model3D model={pose.model ?? model} heading={pose.yaw} pitch={pose.pitch} size={FRAME} />
    </Animated.View>
  );
}

/**
 * Where the bus belongs on this stage. Draws it here while it is the resting
 * slot; marks the spot otherwise. Without a provider it simply draws `model`.
 */
export function HeroBusSlot({
  id,
  size,
  yaw = SHOWROOM_YAW,
  pitch = SHOWROOM_PITCH,
  land = false,
  model: ownModel,
  settleMs = 0,
  style,
}: {
  id: string;
  size: number;
  yaw?: number;
  pitch?: number;
  /** A destination: the bus touches down here and dissolves. */
  land?: boolean;
  /** This slot's own livery (a trip's tier); otherwise the provider's. */
  model?: Model;
  /**
   * Wait this long before the first measure — a slot on a screen that is still
   * being pushed would otherwise be measured mid-slide and the bus would fly
   * to where the screen WAS.
   */
  settleMs?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const ctx = useContext(Ctx);
  const ref = useRef<View>(null);
  // onLayout fires on mount; a settling slot ignores it until its delay is up.
  const readyAt = useRef(Date.now() + settleMs);
  const store = ctx?.store;
  useStore(store);

  const measure = useCallback(() => {
    if (!store || !store.slots.has(id) || Date.now() < readyAt.current) return;
    ref.current?.measureInWindow((x, y, w, h) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const prev = store.slots.get(id);
      const at = { x: Math.round(x + w / 2), y: Math.round(y + h / 2) };
      if (prev?.at && prev.at.x === at.x && prev.at.y === at.y && prev.size === size) return;
      store.slots.set(id, { id, seq: prev?.seq ?? ++store.seq, at, size, yaw, pitch, land, model: ownModel });
      emit(store);
    });
  }, [store, id, size, yaw, pitch, land, ownModel]);

  useEffect(() => {
    if (!store) return;
    store.slots.set(id, { id, seq: ++store.seq, at: null, size, yaw, pitch, land, model: ownModel });
    // Measured twice: once on arrival, once after the stage's own transition
    // has settled (a slot measured mid-transition is a few points off).
    const a = setTimeout(measure, 40 + settleMs);
    const b = setTimeout(measure, 720 + settleMs);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
      store.slots.delete(id);
      if (store.resting === id) store.resting = null;
      emit(store);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, id]);

  const model = ownModel ?? ctx?.model;
  const resting = !store || store.resting === id;
  return (
    <View ref={ref} collapsable={false} onLayout={measure} style={[{ width: size, height: size }, style]} pointerEvents="none">
      {model && resting && !land ? (
        <Turntable model={model} size={size} yaw={yaw} pitch={pitch} spinKey={ctx?.spinKey ?? ''} reduced={ctx?.reduced ?? false} />
      ) : null}
    </View>
  );
}

/**
 * One full revolution, easing out, each time `spinKey` changes — then rest at
 * the showroom angle. Once, not forever: an idle spin is a loop on a screen a
 * rider may sit on for a minute. Frames come from the engine's cache.
 */
function Turntable({ model, size, yaw, pitch, spinKey, reduced }: { model: Model; size: number; yaw: number; pitch: number; spinKey: string; reduced: boolean }) {
  const [turn, setTurn] = useState(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; } // arriving is not a change
    if (reduced) return;
    let raf = 0;
    let lastDeg = -1;
    const t0 = Date.now();
    const tick = () => {
      const p = Math.min(1, (Date.now() - t0) / 1400);
      const deg = Math.round(((1 - Math.pow(1 - p, 3)) * 360) / 4) * 4;
      if (deg !== lastDeg) { lastDeg = deg; setTurn(deg % 360); }
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spinKey, reduced]);
  return <Model3D model={model} heading={yaw + turn} pitch={pitch} size={size} />;
}

const styles = StyleSheet.create({
  transit: { position: 'absolute', left: 0, top: 0, width: FRAME, height: FRAME },
});
