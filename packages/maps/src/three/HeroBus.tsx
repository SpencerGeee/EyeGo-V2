import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withDelay,
  withSpring,
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
 * picks the bus up at the old slot's position, glides it to the new one, and
 * hands it to the new slot on landing. A `land` slot is a destination, not a
 * home: the bus touches down there, shrinks and dissolves.
 *
 * A stage that keeps the SAME slot id keeps the bus where it is: changing
 * `spinKey` spins it in place (`spinDir` −1 going back) — the tier-pick move,
 * on every stage.
 */

/**
 * The flight layer's frame. Fixed and generous so a bus can grow into a
 * full-width cabin without being upscaled; the model is a vector picture, so a
 * large frame shrunk to a 60 pt slot costs nothing in sharpness.
 */
const FRAME = 300;
export const SHOWROOM_YAW = 228;
export const SHOWROOM_PITCH = 58;

/**
 * THE GLIDE ("extremely smooth physics"). A real spring on the UI thread:
 * retargeting mid-flight keeps the velocity it has, and the damping ratio
 * (~0.76) gives one soft overshoot before it parks. Rest thresholds are loose
 * so the hand-off is not held hostage by a sub-pixel tail.
 */
const GLIDE = { damping: 18, stiffness: 140, mass: 1, restDisplacementThreshold: 0.6, restSpeedThreshold: 6 };
/** A glide noses toward where it is going, never past this — and never a full turn. */
const MAX_LEAN = 35;
/** px/ms at which the glide reads as "full speed" (lean, bank, dip, swell all maxed). */
const FULL_SPEED = 1.6;

/**
 * How a `land` slot receives the bus.
 *  'shrink' — touches down on a point (the pickup pin) and dissolves into it.
 *  'into'   — arrives at full size over what it becomes (the seat cabin, seen
 *             from above) and fades as that is drawn underneath.
 */
type Land = false | 'shrink' | 'into';
/** full = booking flows (spins); live = live-trip stages (no spin, dimmer ring). */
export type HeroStrength = 'full' | 'live';

interface Rect { x: number; y: number }
interface SlotEntry { id: string; seq: number; at: Rect | null; size: number; yaw: number; pitch: number; land: Land; model?: Model }

/** Shortest way round from a to b, k of the way. */
const lerpAngle = (a: number, b: number, k: number) => {
  'worklet';
  return a + ((((b - a) % 360) + 540) % 360 - 180) * k;
};
const easeInOut = (k: number) => {
  'worklet';
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
};
const clamp = (v: number, lo: number, hi: number) => {
  'worklet';
  return v < lo ? lo : v > hi ? hi : v;
};

type Store = {
  slots: Map<string, SlotEntry>;
  /** The slot that currently draws the bus itself (null while in flight). */
  resting: string | null;
  /** A slot the bus just glided into — it plays the landing spin once. */
  landed: string | null;
  listeners: Set<() => void>;
  seq: number;
  version: number;
};

const Ctx = createContext<{
  store: Store;
  model: Model;
  spinKey: string;
  spinDir: 1 | -1;
  strength: HeroStrength;
  accent: string;
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
  spinDir = 1,
  strength = 'full',
  accent = '#4BE277',
  reduced = false,
  children,
}: {
  model: Model;
  /** Changing it plays one turntable revolution (the chosen tier, the stage). */
  spinKey: string;
  /** −1 when the flow went BACK: the revolution runs the other way. */
  spinDir?: 1 | -1;
  strength?: HeroStrength;
  /** The landing ring's light — the app's brand colour. */
  accent?: string;
  /** Reduce Motion / a phone measured as slow: no flight, no spin — the bus just appears. */
  reduced?: boolean;
  children: React.ReactNode;
}) {
  const store = useRef<Store>({ slots: new Map(), resting: null, landed: null, listeners: new Set(), seq: 0, version: 0 }).current;
  const value = useMemo(
    () => ({ store, model, spinKey, spinDir, strength, accent, reduced }),
    [store, model, spinKey, spinDir, strength, accent, reduced],
  );
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
 * ── A GLIDE, NOT A SPIN ─────────────────────────────────────────────────────
 *
 * BUGFIX ("when you confirm the payment and transition to the tracking page,
 * the bus spins awkwardly before the map is shown"; same on driver Create's
 * publish). Two causes, both here:
 *  1. When the resting slot unmounted (goFresh tears down payment, seat and
 *     the trip detail together), `target()` fell back to an OLDER slot on a
 *     screen that was already gone — and the bus flew there, on top of the
 *     next screen. A flight now only ever goes to a NEWER slot; an older one
 *     is a retreat, and the bus simply rests there unseen.
 *  2. Every flight turned to face its road and then turned BACK to the slot's
 *     pose — on a drive-off the slot's pose is the default showroom angle, so
 *     the bus pirouetted while leaving. A glide now only leans (±35°, scaled
 *     by speed, straightening as it slows); a literal drive faces its road and
 *     holds it to the end.
 *
 * Position and size ride springs on the UI thread; a frame callback derives
 * speed, lean, bank and the camera dip from the actual motion, so they can
 * never disagree with it. The heading reaches JS only when its quantised
 * frame changes (cached model frames, see engine.ts).
 */
function Transit({ store, model, reduced }: { store: Store; model: Model; reduced: boolean }) {
  useStore(store);
  const goal = target(store);
  const originRef = useRef<View>(null);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const sz = useSharedValue(FRAME);
  const gx = useSharedValue(0);
  const gy = useSharedValue(0);
  const d0 = useSharedValue(1);
  const px = useSharedValue(0);
  const py = useSharedValue(0);
  const speed = useSharedValue(0);
  const bank = useSharedValue(0);
  const travel = useSharedValue(0);
  const fromYaw = useSharedValue(SHOWROOM_YAW);
  const fromPitch = useSharedValue(SHOWROOM_PITCH);
  const toYaw = useSharedValue(SHOWROOM_YAW);
  const toPitch = useSharedValue(SHOWROOM_PITCH);
  const literal = useSharedValue(0);
  const yawNow = useSharedValue(SHOWROOM_YAW);
  const pitchNow = useSharedValue(SHOWROOM_PITCH);
  const poseKey = useSharedValue('');
  const shrink = useSharedValue(1);
  const opacity = useSharedValue(0);
  const last = useRef<SlotEntry | null>(null);
  const originAt = useRef({ x: 0, y: 0 });
  const flightModel = useRef<Model | undefined>(undefined);
  const [pose, setPose] = useState<{ yaw: number; pitch: number; model?: Model }>({ yaw: SHOWROOM_YAW, pitch: SHOWROOM_PITCH });

  const showPose = useCallback((yaw: number, pitch: number) => {
    setPose({ yaw, pitch, model: flightModel.current });
  }, []);

  const frame = useFrameCallback((f) => {
    'worklet';
    const dt = Math.max(1, f.timeSincePreviousFrame ?? 16);
    const vx = (x.value - px.value) / dt;
    const vy = (y.value - py.value) / dt;
    px.value = x.value;
    py.value = y.value;
    const v = Math.hypot(vx, vy);
    speed.value += (clamp(v / FULL_SPEED, 0, 1) - speed.value) * 0.25;
    bank.value += (clamp(vx / 1.2, -1, 1) - bank.value) * 0.2;
    if (v > 0.05) travel.value = (Math.atan2(vx, -vy) * 180) / Math.PI;
    const prog = clamp(1 - Math.hypot(gx.value - x.value, gy.value - y.value) / d0.value, 0, 1);
    const e = easeInOut(prog);
    let yaw: number;
    if (literal.value) {
      // A real drive: turn onto the road early, then hold it — no turning back.
      yaw = lerpAngle(fromYaw.value, travel.value, clamp(prog * 4, 0, 1));
    } else {
      const base = lerpAngle(fromYaw.value, toYaw.value, e);
      const off = ((((travel.value - base) % 360) + 540) % 360) - 180;
      yaw = base + clamp(off, -MAX_LEAN, MAX_LEAN) * speed.value;
    }
    const pitch = Math.max(0, fromPitch.value + (toPitch.value - fromPitch.value) * e - 8 * speed.value);
    yawNow.value = yaw;
    pitchNow.value = pitch;
    const key = `${Math.round(yaw / 4)}:${Math.round(pitch / 5)}`;
    if (key !== poseKey.value) {
      poseKey.value = key;
      runOnJS(showPose)(yaw, pitch);
    }
  }, false);

  const settle = useCallback((id: string) => {
    if (target(store)?.id !== id) return; // a newer slot took over mid-flight
    frame.setActive(false);
    store.resting = id;
    store.landed = id;
    emit(store);
    // Hand-off: the slot draws on the next frame, THEN this layer lets go —
    // hiding it first would blink the bus out for a frame.
    requestAnimationFrame(() => requestAnimationFrame(() => { opacity.value = 0; }));
  }, [store, opacity, frame]);

  const touchDown = useCallback((id: string, land: Land) => {
    if (target(store)?.id !== id) return;
    frame.setActive(false);
    if (land === 'shrink') {
      // Touch down on the point, then sink into it and dissolve.
      shrink.value = withTiming(0.2, { duration: 420, easing: Easing.in(Easing.cubic) });
      opacity.value = withDelay(120, withTiming(0, { duration: 340 }));
    } else {
      // Arrived full size over what it becomes — give way to it.
      opacity.value = withTiming(0, { duration: 340 });
    }
  }, [store, frame, shrink, opacity]);

  useEffect(() => {
    const from = last.current;
    if (!goal || !goal.at) {
      last.current = goal;
      // Every slot is gone (the screen closed): nothing may keep flying over the next one.
      if (!goal) { frame.setActive(false); opacity.value = 0; }
      return;
    }
    if (from && from.id === goal.id && from.at && goal.at.x === from.at.x && goal.at.y === from.at.y) return;
    last.current = goal;
    const flying = opacity.value > 0 && frame.isActive;
    // The slot was re-measured while the bus is still gliding to it: the spring
    // takes the corrected target and keeps its velocity.
    if (from && from.id === goal.id && flying) {
      gx.value = goal.at.x - originAt.current.x;
      gy.value = goal.at.y - originAt.current.y;
      x.value = withSpring(gx.value, GLIDE);
      y.value = withSpring(gy.value, GLIDE);
      return;
    }
    // Nowhere to fly from, flights off, or a RETREAT to an older slot (its
    // screen is underneath, or already gone): rest in place, unseen.
    if (!from || !from.at || reduced || from.id === goal.id || goal.seq < from.seq) {
      frame.setActive(false);
      opacity.value = 0;
      store.landed = null;
      if (goal.land) { store.resting = null; emit(store); return; }
      if (store.resting !== goal.id) { store.resting = goal.id; emit(store); }
      return;
    }

    const start = flying
      ? { x: x.value + originAt.current.x, y: y.value + originAt.current.y, size: sz.value, yaw: yawNow.value, pitch: pitchNow.value }
      : { x: from.at.x, y: from.at.y, size: from.size, yaw: from.yaw, pitch: from.pitch };
    const to = goal.at;
    const dist = Math.max(1, Math.hypot(to.x - start.x, to.y - start.y));
    flightModel.current = goal.model ?? from.model;

    store.resting = null;
    store.landed = null;
    emit(store);

    const begin = (ox: number, oy: number) => {
      originAt.current = { x: ox, y: oy };
      if (!flying) {
        x.value = start.x - ox;
        y.value = start.y - oy;
        sz.value = start.size;
        px.value = x.value;
        py.value = y.value;
        speed.value = 0;
        bank.value = 0;
      }
      gx.value = to.x - ox;
      gy.value = to.y - oy;
      d0.value = dist;
      fromYaw.value = start.yaw;
      fromPitch.value = start.pitch;
      toYaw.value = goal.yaw;
      toPitch.value = goal.pitch;
      literal.value = goal.land === 'shrink' ? 1 : 0;
      travel.value = (Math.atan2(to.x - start.x, -(to.y - start.y)) * 180) / Math.PI;
      shrink.value = 1;
      opacity.value = 1;
      setPose({ yaw: start.yaw, pitch: start.pitch, model: flightModel.current });
      frame.setActive(true);
      const id = goal.id;
      const land = goal.land;
      sz.value = withSpring(goal.size, GLIDE);
      y.value = withSpring(gy.value, GLIDE);
      x.value = withSpring(gx.value, GLIDE, (done) => {
        'worklet';
        if (!done) return;
        if (land) runOnJS(touchDown)(id, land);
        else runOnJS(settle)(id);
      });
    };

    const node = originRef.current;
    if (node && !flying) {
      node.measureInWindow((ox, oy) => begin(Number.isFinite(ox) ? ox : 0, Number.isFinite(oy) ? oy : 0));
    } else {
      begin(originAt.current.x, originAt.current.y);
    }
  }, [goal, reduced, store, settle, touchDown, frame, x, y, sz, gx, gy, d0, px, py, speed, bank, travel, fromYaw, fromPitch, toYaw, toPitch, literal, yawNow, pitchNow, shrink, opacity]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: x.value - FRAME / 2 },
      { translateY: y.value - FRAME / 2 },
      // Banks into the curve, swells toward the camera at speed.
      { rotateZ: `${bank.value * 8 * speed.value}deg` },
      { scale: (sz.value / FRAME) * (1 + 0.12 * speed.value) * shrink.value },
    ],
  }));

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
  const [ring, setRing] = useState(0);

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
  const landed = !!store && store.landed === id;
  const live = ctx?.strength === 'live';
  const pulse = useCallback(() => setRing((r) => r + 1), []);
  return (
    <View ref={ref} collapsable={false} onLayout={measure} style={[{ width: size, height: size }, style]} pointerEvents="none">
      {ring > 0 && ctx && !ctx.reduced ? (
        <LandingRing key={ring} size={size} color={ctx.accent} dim={live} />
      ) : null}
      {model && resting && !land ? (
        <Turntable
          model={model}
          size={size}
          yaw={yaw}
          pitch={pitch}
          spinKey={ctx?.spinKey ?? ''}
          dir={ctx?.spinDir ?? 1}
          spins={!live}
          landed={landed}
          reduced={ctx?.reduced ?? false}
          onTurn={pulse}
          onLandSeen={() => { if (store && store.landed === id) store.landed = null; }}
        />
      ) : null}
    </View>
  );
}

/**
 * One full revolution, easing out, each time `spinKey` changes — and once on
 * arriving from a glide — then rest at the slot's angle. Once, not forever: an
 * idle spin is a loop on a screen a rider may sit on for a minute. Frames come
 * from the engine's cache. `spins: false` (live stages) keeps only the ring.
 */
function Turntable({
  model, size, yaw, pitch, spinKey, dir, spins, landed, reduced, onTurn, onLandSeen,
}: {
  model: Model; size: number; yaw: number; pitch: number; spinKey: string; dir: 1 | -1;
  spins: boolean; landed: boolean; reduced: boolean; onTurn: () => void; onLandSeen: () => void;
}) {
  const [turn, setTurn] = useState(0);
  const first = useRef(true);
  useEffect(() => {
    const arriving = first.current;
    first.current = false;
    if (arriving) onLandSeen();
    // Arriving without a glide (first paint, a retreat) is not a change.
    if (reduced || (arriving && !landed)) return;
    onTurn();
    if (!spins) return;
    let raf = 0;
    let lastDeg = -1;
    const t0 = Date.now();
    const ms = arriving ? 1100 : 1400;
    const tick = () => {
      const p = Math.min(1, (Date.now() - t0) / ms);
      const deg = Math.round(((1 - Math.pow(1 - p, 3)) * 360) / 4) * 4;
      if (deg !== lastDeg) { lastDeg = deg; setTurn((dir * deg) % 360); }
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinKey, reduced]);
  return <Model3D model={model} heading={yaw + turn} pitch={pitch} size={size} />;
}

/**
 * Light on the floor where the bus lands or turns: one ripple, drawn flat in
 * perspective (an ellipse) so it reads as the ground, then gone. Never loops.
 */
function LandingRing({ size, color, dim }: { size: number; color: string; dim: boolean }) {
  const k = useSharedValue(0);
  useEffect(() => {
    k.value = withTiming(1, { duration: 760, easing: Easing.out(Easing.cubic) });
  }, [k]);
  const s = useAnimatedStyle(() => ({
    opacity: (1 - k.value) * (dim ? 0.35 : 0.7),
    transform: [{ scale: 0.55 + k.value * 0.85 }],
  }));
  const w = size * 0.92;
  const h = w * 0.3;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', left: (size - w) / 2, top: size * 0.7 - h / 2, width: w, height: h, borderRadius: w / 2, borderWidth: 1.5, borderColor: color, backgroundColor: `${color}1F` },
        s,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  transit: { position: 'absolute', left: 0, top: 0, width: FRAME, height: FRAME },
});
