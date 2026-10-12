import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
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

/**
 * The flight layer's frame. Fixed and generous so a bus can grow into a
 * full-width cabin without being upscaled; the model is a vector picture, so a
 * large frame shrunk to a 60 pt slot costs nothing in sharpness.
 */
const FRAME = 300;
/** One flight, wall clock. Long enough to read as a drive, short enough not to wait on. */
const FLIGHT_MS = 780;
export const SHOWROOM_YAW = 228;
export const SHOWROOM_PITCH = 58;

/**
 * How a `land` slot receives the bus.
 *  'shrink' — touches down on a point (the pickup pin) and dissolves into it.
 *  'into'   — arrives at full size over what it becomes (the seat cabin, seen
 *             from above) and fades as that is drawn underneath.
 */
type Land = false | 'shrink' | 'into';

interface Rect { x: number; y: number }
interface SlotEntry { id: string; seq: number; at: Rect | null; size: number; yaw: number; pitch: number; land: Land; model?: Model }

/** Shortest way round from a to b, k of the way. */
const lerpAngle = (a: number, b: number, k: number) => a + ((((b - a) % 360) + 540) % 360 - 180) * k;
const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

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
  reduced = false,
  children,
}: {
  model: Model;
  /** Changing it plays one turntable revolution (e.g. the chosen tier). */
  spinKey: string;
  /** Reduce Motion / a phone measured as slow: no flight, no spin — the bus just appears. */
  reduced?: boolean;
  children: React.ReactNode;
}) {
  const store = useRef<Store>({ slots: new Map(), resting: null, listeners: new Set(), seq: 0, version: 0 }).current;
  const value = useMemo(() => ({ store, model, spinKey, reduced }), [store, model, spinKey, reduced]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <Transit store={store} model={model} reduced={reduced} />
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

/**
 * The one layer that carries the bus between slots.
 *
 * ── A DRIVE, NOT A SLIDE ────────────────────────────────────────────────────
 *
 * BUGFIX ("the bus morphs and comes at the top very wrong and that's not even
 * the 3D immersive feel I was talking about"). The flight was a flat sprite
 * translated and scaled on a spring, holding the DESTINATION's pose from the
 * first frame — so it snapped to its final angle and slid there. And it was
 * positioned in window coordinates inside a layer that is not at the window's
 * origin (driver Create is an iOS sheet), so it flew to the wrong place.
 *
 * Now the bus behaves like a vehicle: it pulls away from its old pose, turns
 * to face where it is going, travels on a lifted arc while swelling toward
 * the camera and banking into the turn, then turns into its new pose as it
 * parks. Position, arc, swell and bank run on the UI thread off one progress
 * value; the heading and tilt are a JS tween over cached model frames. The
 * layer measures its own origin before every flight.
 */
function Transit({ store, model, reduced }: { store: Store; model: Model; reduced: boolean }) {
  useStore(store);
  const goal = target(store);
  const originRef = useRef<View>(null);
  const t = useSharedValue(1);
  const fx = useSharedValue(0);
  const fy = useSharedValue(0);
  const fsz = useSharedValue(FRAME);
  const gx = useSharedValue(0);
  const gy = useSharedValue(0);
  const gsz = useSharedValue(FRAME);
  const arc = useSharedValue(0);
  const bank = useSharedValue(0);
  const shrink = useSharedValue(1);
  const opacity = useSharedValue(0);
  const last = useRef<SlotEntry | null>(null);
  const tween = useRef(0);
  const poseNow = useRef({ yaw: SHOWROOM_YAW, pitch: SHOWROOM_PITCH });
  const originAt = useRef({ x: 0, y: 0 });
  const [pose, setPose] = useState<{ yaw: number; pitch: number; model?: Model }>({ yaw: SHOWROOM_YAW, pitch: SHOWROOM_PITCH });
  useEffect(() => () => cancelAnimationFrame(tween.current), []);

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
    // The slot was re-measured while the bus is still flying to it (its second
    // measure lands mid-flight): steer to the corrected spot, don't cut the flight.
    if (from && from.id === goal.id && opacity.value > 0 && t.value < 1) {
      gx.value = goal.at.x - originAt.current.x;
      gy.value = goal.at.y - originAt.current.y;
      return;
    }
    // Nowhere to fly from (first slot), or flights are off: rest in place.
    if (!from || !from.at || reduced || from.id === goal.id) {
      opacity.value = 0;
      if (goal.land) { store.resting = null; emit(store); return; }
      if (store.resting !== goal.id) { store.resting = goal.id; emit(store); }
      return;
    }

    // Retargeted mid-flight: pick it up where it IS, not where it set off from.
    const p0 = t.value;
    const flying = opacity.value > 0 && p0 < 1;
    const start = flying
      ? {
          x: fx.value + (gx.value - fx.value) * p0 + originAt.current.x,
          y: fy.value + (gy.value - fy.value) * p0 - Math.sin(Math.PI * p0) * arc.value + originAt.current.y,
          size: fsz.value + (gsz.value - fsz.value) * p0,
          yaw: poseNow.current.yaw,
          pitch: poseNow.current.pitch,
        }
      : { x: from.at.x, y: from.at.y, size: from.size, yaw: from.yaw, pitch: from.pitch };
    const to = goal.at;
    const dx = to.x - start.x;
    const dy = to.y - start.y;
    const dist = Math.hypot(dx, dy);
    // Model heading 0 is nose-up the screen, clockwise.
    const travel = (Math.atan2(dx, -dy) * 180) / Math.PI;
    const turns = dist > 48;

    store.resting = null;
    emit(store);

    const begin = (ox: number, oy: number) => {
      originAt.current = { x: ox, y: oy };
      fx.value = start.x - ox;
      fy.value = start.y - oy;
      fsz.value = start.size;
      gx.value = to.x - ox;
      gy.value = to.y - oy;
      gsz.value = goal.size;
      arc.value = Math.min(110, Math.max(28, dist * 0.22));
      bank.value = Math.max(-1, Math.min(1, dx / 140));
      shrink.value = 1;
      opacity.value = 1;
      t.value = 0;
      t.value = withTiming(1, { duration: FLIGHT_MS, easing: Easing.inOut(Easing.cubic) }, (done) => {
        'worklet';
        if (done && !goal.land) runOnJS(settle)(goal.id);
      });
      if (goal.land === 'shrink') {
        // Touch down on the point, then sink into it and dissolve.
        shrink.value = withDelay(FLIGHT_MS, withTiming(0.2, { duration: 420, easing: Easing.in(Easing.cubic) }));
        opacity.value = withDelay(FLIGHT_MS + 120, withTiming(0, { duration: 340 }));
      } else if (goal.land === 'into') {
        // Arrive full size over what it becomes, and give way to it.
        opacity.value = withDelay(FLIGHT_MS - 80, withTiming(0, { duration: 340 }));
      }

      // The heading: pull away turning toward the road, hold it, turn into the slot's pose.
      cancelAnimationFrame(tween.current);
      const t0 = Date.now();
      let shown = '';
      const step = () => {
        const k = Math.min(1, (Date.now() - t0) / FLIGHT_MS);
        const yaw = !turns
          ? lerpAngle(start.yaw, goal.yaw, easeInOut(k))
          : k < 0.38
            ? lerpAngle(start.yaw, travel, easeInOut(k / 0.38))
            : k > 0.62
              ? lerpAngle(travel, goal.yaw, easeInOut((k - 0.62) / 0.38))
              : travel;
        // Mid-flight the camera drops a little lower — the bus is seen moving, not posed.
        const pitch = start.pitch + (goal.pitch - start.pitch) * easeInOut(k) - Math.sin(Math.PI * k) * (turns ? 10 : 0);
        poseNow.current = { yaw, pitch };
        const key = `${Math.round(yaw / 3)}:${Math.round(pitch / 2)}`;
        if (key !== shown) {
          shown = key;
          setPose({ yaw, pitch: Math.max(0, pitch), model: goal.model ?? from.model });
        }
        if (k < 1) tween.current = requestAnimationFrame(step);
      };
      tween.current = requestAnimationFrame(step);
    };

    const node = originRef.current;
    if (node) {
      node.measureInWindow((ox, oy) => begin(Number.isFinite(ox) ? ox : 0, Number.isFinite(oy) ? oy : 0));
    } else {
      begin(0, 0);
    }
  }, [goal, reduced, store, settle, t, fx, fy, fsz, gx, gy, gsz, arc, bank, shrink, opacity]);

  const style = useAnimatedStyle(() => {
    const p = t.value;
    const lift = Math.sin(Math.PI * p);
    const x = fx.value + (gx.value - fx.value) * p;
    const y = fy.value + (gy.value - fy.value) * p - lift * arc.value;
    const size = fsz.value + (gsz.value - fsz.value) * p;
    return {
      opacity: opacity.value,
      transform: [
        { translateX: x - FRAME / 2 },
        { translateY: y - FRAME / 2 },
        { rotateZ: `${bank.value * 9 * lift}deg` },
        // Swells toward the camera at the top of the arc.
        { scale: (size / FRAME) * (1 + 0.18 * lift) * shrink.value },
      ],
    };
  });

  return (
    <View ref={originRef} collapsable={false} pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[styles.transit, style]}>
        <Model3D model={pose.model ?? model} heading={pose.yaw} pitch={pose.pitch} size={FRAME} />
      </Animated.View>
    </View>
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
  land: landProp = false,
  model: ownModel,
  settleMs = 0,
  style,
}: {
  id: string;
  size: number;
  yaw?: number;
  pitch?: number;
  /**
   * A destination, not a home. `true` — the bus touches down on this point and
   * dissolves into it. `'into'` — it arrives full size over this spot and gives
   * way to what is drawn there (the seat cabin is the same bus from above).
   */
  land?: boolean | 'into';
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
  const land: Land = landProp === true ? 'shrink' : landProp || false;
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
