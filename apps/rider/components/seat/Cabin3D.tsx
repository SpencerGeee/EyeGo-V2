import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Canvas, Picture } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { fonts, springs } from '@eyego/config';
import { Text, Pressable } from '@eyego/ui';
import {
  cabin,
  cabinPlan,
  frameXY,
  modelPicture,
  projectPoint,
  seatTop,
  type CabinSeatState,
} from '@eyego/maps';
import { layoutFor, type CabinSeat } from './VehicleCabin';

/**
 * ── THE CABIN, IN 3D ────────────────────────────────────────────────────────
 *
 * A three-quarter view of the inside of the vehicle, roof off. A finger orbits
 * it a little either way and it springs back; tapping a free seat raises it,
 * lights it, rings the floor under it and leans the camera toward it.
 *
 * BUGFIX ("when you're swiping the screen to move the 3D bus, it's super
 * laggy"). Every frame of the orbit did `runOnJS(setYawOff)` — a React render
 * of this component and every seat tag, plus a freshly painter-sorted Skia
 * picture recorded on the JS thread. Now the orbit's frames are BAKED ONCE
 * (one picture per 4° step, the engine's own quantum) and the finger only moves
 * a shared value: the frame and every tag's position are picked on the UI
 * thread. Swiping renders nothing.
 *
 * And it no longer arrives top-down. The tilt-in from 0° was the "watching
 * from the rooftop" the hero bus landing produced; the cabin opens on its
 * three-quarter view and simply rises into place.
 */

/** The resting heading: three-quarters from the door side. Head-on reads flat. */
export const CABIN_YAW = 212;
export const CABIN_PITCH = 60;
/** The engine's yaw quantum — a finer step would only re-bake identical frames. */
const STEP = 4;
const ORBIT = 20;
const OFFSETS = Array.from({ length: (ORBIT * 2) / STEP + 1 }, (_, i) => -ORBIT + i * STEP);
const CENTRE = OFFSETS.indexOf(0);
const VIEW = { pitch: CABIN_PITCH, yaws: [CABIN_YAW - ORBIT, CABIN_YAW, CABIN_YAW + ORBIT] };

const stateOf = (s: CabinSeat | undefined, selectedId: string | null): CabinSeatState => {
  if (!s) return 'off';
  if (s.id === selectedId || s.status === 'SELECTED') return 'selected';
  if (s.status === 'AVAILABLE') return 'free';
  if (s.status === 'PENDING') return 'held';
  return 'taken';
};

export function Cabin3D({
  seats,
  seatCount,
  selectedId,
  onSelect,
  size,
  accent,
  body,
  dark,
  motion,
}: {
  seats: CabinSeat[];
  seatCount: number;
  selectedId: string | null;
  onSelect: (seat: CabinSeat) => void;
  /** Edge of the square stage, in points. */
  size: number;
  accent: string;
  /** The tier's paint. */
  body?: string;
  dark: boolean;
  /** False = Reduce Motion / slow phone: the same cabin, still. */
  motion: boolean;
}) {
  const plan = useMemo(() => cabinPlan(layoutFor(Math.max(seatCount || 0, seats.length) || 4)), [seatCount, seats.length]);
  const byNumber = useMemo(() => new Map(seats.map((s) => [s.number, s])), [seats]);
  const states = useMemo(() => {
    const out: Record<number, CabinSeatState> = {};
    for (const spot of plan.seats) out[spot.n] = stateOf(byNumber.get(spot.n), selectedId);
    return out;
  }, [plan, byNumber, selectedId]);
  const model = useMemo(() => cabin(plan, states, { accent, dark, body }, VIEW), [plan, states, accent, dark, body]);
  const visible = useMemo(() => plan.seats.filter((s) => states[s.n] !== 'off'), [plan, states]);

  /**
   * THE FRAMES. The centre one synchronously (it is what the rider sees first),
   * the rest a tick later so a seat tap never waits on eleven recordings.
   * A frame not baked yet falls back to the centre one.
   */
  const [frames, setFrames] = useState<unknown[]>([]);
  useEffect(() => {
    const centre = modelPicture(model, CABIN_YAW, CABIN_PITCH, size);
    setFrames(OFFSETS.map((o) => (o === 0 ? centre : null)));
    if (!motion) return;
    const t = setTimeout(() => {
      setFrames(OFFSETS.map((o) => modelPicture(model, CABIN_YAW + o, CABIN_PITCH, size)));
    }, 16);
    return () => clearTimeout(t);
  }, [model, size, motion]);

  /** Where each visible seat's tag stands, per frame — plain numbers for the UI thread. */
  const tagXY = useMemo(
    () =>
      OFFSETS.map((o) =>
        visible.map((spot) => frameXY(model, projectPoint(seatTop(spot, states[spot.n] === 'selected'), CABIN_YAW + o, CABIN_PITCH), size)),
      ),
    [visible, model, states, size],
  );

  // ── The orbit: a shared value, never a render ────────────────────────────
  const off = useSharedValue(0);
  const frame = useDerivedValue(() => {
    const i = Math.round((off.value + ORBIT) / STEP);
    return Math.max(0, Math.min(OFFSETS.length - 1, i));
  });
  const picture = useDerivedValue(() => (frames[frame.value] ?? frames[CENTRE] ?? null) as never, [frames]);
  const orbit = useMemo(
    () =>
      Gesture.Pan()
        .enabled(motion)
        .activeOffsetX([-12, 12])
        .failOffsetY([-14, 14])
        .onUpdate((e) => {
          off.value = Math.max(-ORBIT, Math.min(ORBIT, -e.translationX * 0.16));
        })
        .onEnd(() => {
          off.value = withSpring(0, springs.standard);
        }),
    [motion, off],
  );

  // ── Arrival and leaning toward the chosen seat ────────────────────────────
  const rise = useSharedValue(motion ? 0 : 1);
  useEffect(() => {
    if (motion) rise.value = withSpring(1, springs.standard);
  }, [motion, rise]);
  const lean = useSharedValue({ x: 0, y: 0, s: 1 });
  const selectedSpot = plan.seats.find((s) => states[s.n] === 'selected') ?? null;
  const leanTarget = selectedSpot ? frameXY(model, projectPoint(seatTop(selectedSpot, true), CABIN_YAW, CABIN_PITCH), size) : null;
  useEffect(() => {
    if (!motion) return;
    const to = leanTarget
      ? { x: (size / 2 - leanTarget[0]) * 0.08, y: (size / 2 - leanTarget[1]) * 0.08, s: 1.04 }
      : { x: 0, y: 0, s: 1 };
    lean.value = withSpring(to, springs.standard);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leanTarget?.[0], leanTarget?.[1], motion, size]);
  const stageStyle = useAnimatedStyle(() => ({
    opacity: rise.value,
    transform: [
      { translateX: lean.value.x },
      { translateY: lean.value.y + (1 - rise.value) * 24 },
      { scale: lean.value.s * (0.96 + rise.value * 0.04) },
    ],
  }));

  return (
    <GestureDetector gesture={orbit}>
      <Animated.View style={[{ width: size, height: size }, stageStyle]}>
        <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
          <Picture picture={picture} />
        </Canvas>
        {visible.map((spot, i) => {
          const st = states[spot.n];
          const seat = byNumber.get(spot.n);
          return (
            <SeatTag
              key={spot.n}
              n={spot.n}
              index={i}
              tagXY={tagXY}
              frame={frame}
              state={st}
              accent={accent}
              motion={motion}
              onPress={seat && (st === 'free' || st === 'selected') ? () => onSelect(seat) : undefined}
            />
          );
        })}
      </Animated.View>
    </GestureDetector>
  );
}

const TAG = 44;

/** A seat's number and its tap target, standing on its cushion. */
function SeatTag({
  n, index, tagXY, frame, state, accent, motion, onPress,
}: {
  n: number;
  index: number;
  tagXY: [number, number][][];
  frame: SharedValue<number>;
  state: CabinSeatState;
  accent: string;
  motion: boolean;
  onPress?: () => void;
}) {
  const pop = useSharedValue(0);
  const ring = useSharedValue(1);
  const selected = state === 'selected';
  useEffect(() => {
    if (!selected) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    if (!motion) return;
    pop.value = withSequence(withSpring(1, springs.accent), withSpring(0, springs.standard));
    ring.value = 0;
    ring.value = withTiming(1, { duration: 760, easing: Easing.out(Easing.cubic) });
  }, [selected, motion, pop, ring]);
  const placeStyle = useAnimatedStyle(() => {
    const p = tagXY[frame.value]?.[index] ?? [0, 0];
    return { transform: [{ translateX: p[0] - TAG / 2 }, { translateY: p[1] - TAG / 2 }] };
  }, [tagXY, index]);
  const numStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + pop.value * 0.35 }] }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: (1 - ring.value) * 0.8,
    transform: [{ scaleX: 0.6 + ring.value * 1.1 }, { scaleY: (0.6 + ring.value * 1.1) * 0.55 }],
  }));
  const light = state === 'free' || state === 'held';
  const label = `Seat ${n}, ${state === 'free' ? 'available' : state === 'selected' ? 'selected' : state === 'held' ? 'on hold' : 'taken'}`;
  return (
    <Animated.View style={[styles.tag, placeStyle]}>
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        haptic={onPress ? 'light' : undefined}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected, disabled: !onPress }}
        style={styles.hit}
      >
        {selected ? <Animated.View pointerEvents="none" style={[styles.ring, { borderColor: accent }, ringStyle]} /> : null}
        <Animated.View style={numStyle}>
          <Text style={[styles.num, { color: selected ? '#FFFFFF' : light ? '#141820' : '#C9CFD8' }, selected && styles.numShadow]}>{n}</Text>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  tag: { position: 'absolute', left: 0, top: 0, width: TAG, height: TAG },
  hit: { width: TAG, height: TAG, alignItems: 'center', justifyContent: 'center' },
  num: { fontFamily: fonts.displayBold, fontSize: 14, letterSpacing: -0.2 },
  numShadow: { textShadowColor: 'rgba(0,0,0,0.45)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
  ring: { position: 'absolute', width: TAG + 18, height: TAG + 18, borderRadius: (TAG + 18) / 2, borderWidth: 2 },
});
