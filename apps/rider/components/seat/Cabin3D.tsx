import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Canvas, Picture } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
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
  quantPitch,
  quantYaw,
  seatTop,
  type CabinSeatState,
} from '@eyego/maps';
import { layoutFor, type CabinSeat } from './VehicleCabin';

/**
 * ── THE CABIN, IN 3D ────────────────────────────────────────────────────────
 *
 * ("the choose your seat page needs a redesign completely. make the 3d effect
 * appear here but make it infinitely nice"). The hero bus lands top-down on
 * this spot; the roof is already gone, and the camera tilts down into a
 * three-quarter view of the inside — at the SAME heading the bus landed at,
 * so the arrival is one tilt, never a turn. A finger orbits it a little
 * either way and it springs back. Tapping a free seat raises it, lights it,
 * rings the floor under it and leans the camera toward it.
 *
 * The picture is the shared engine's cached frames (see @eyego/maps
 * three/cabin.ts — framed by its projected extent, checked frame by frame in
 * node). Seat numbers and tap targets are plain views placed on the same
 * projection, so they are crisp, accessible and land exactly on their seats.
 */

/** The resting heading: three-quarters from the door side. Head-on reads flat. */
export const CABIN_YAW = 212;
export const CABIN_PITCH = 60;
const ORBIT = 22;
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
  arriveAfterMs = 700,
}: {
  seats: CabinSeat[];
  seatCount: number;
  selectedId: string | null;
  onSelect: (seat: CabinSeat) => void;
  /** Edge of the square stage, in points. */
  size: number;
  accent: string;
  /** The tier's paint — the livery the hero bus wore. */
  body?: string;
  dark: boolean;
  /** False = Reduce Motion / slow phone: the same cabin, still. */
  motion: boolean;
  /** Hold the tilt until the hero bus has landed on top of it. */
  arriveAfterMs?: number;
}) {
  const plan = useMemo(() => cabinPlan(layoutFor(Math.max(seatCount || 0, seats.length) || 4)), [seatCount, seats.length]);
  const byNumber = useMemo(() => new Map(seats.map((s) => [s.number, s])), [seats]);
  const states = useMemo(() => {
    const out: Record<number, CabinSeatState> = {};
    for (const spot of plan.seats) out[spot.n] = stateOf(byNumber.get(spot.n), selectedId);
    return out;
  }, [plan, byNumber, selectedId]);
  const model = useMemo(() => cabin(plan, states, { accent, dark, body }, VIEW), [plan, states, accent, dark, body]);

  // ── The camera: arrive top-down, tilt in; a finger orbits it ──────────────
  const [pitch, setPitch] = useState(motion ? 0 : CABIN_PITCH);
  const [yawOff, setYawOff] = useState(0);
  useEffect(() => {
    if (!motion) { setPitch(CABIN_PITCH); return; }
    let raf = 0;
    const timer = setTimeout(() => {
      const t0 = Date.now();
      const tick = () => {
        const k = Math.min(1, (Date.now() - t0) / 900);
        setPitch(quantPitch(CABIN_PITCH * (1 - Math.pow(1 - k, 3))));
        if (k < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, arriveAfterMs);
    return () => { clearTimeout(timer); cancelAnimationFrame(raf); };
  }, [motion, arriveAfterMs]);

  const springBack = useRef(0);
  const release = useCallback((from: number) => {
    cancelAnimationFrame(springBack.current);
    const t0 = Date.now();
    const tick = () => {
      const k = Math.min(1, (Date.now() - t0) / 520);
      // A soft overshoot past centre, then home — a spring, by hand, on cached frames.
      const e = 1 - Math.pow(1 - k, 3) * Math.cos(k * Math.PI * 1.15);
      setYawOff(from * (1 - e));
      if (k < 1) springBack.current = requestAnimationFrame(tick);
      else setYawOff(0);
    };
    springBack.current = requestAnimationFrame(tick);
  }, []);
  useEffect(() => () => cancelAnimationFrame(springBack.current), []);
  const orbit = useMemo(
    () =>
      Gesture.Pan()
        .enabled(motion)
        .activeOffsetX([-12, 12])
        .failOffsetY([-14, 14])
        .onUpdate((e) => {
          const off = Math.max(-ORBIT, Math.min(ORBIT, -e.translationX * 0.16));
          runOnJS(setYawOff)(off);
        })
        .onEnd((e) => {
          runOnJS(release)(Math.max(-ORBIT, Math.min(ORBIT, -e.translationX * 0.16)));
        }),
    [motion, release],
  );

  const yaw = quantYaw(CABIN_YAW + yawOff);
  const tilt = quantPitch(pitch);
  const picture = useMemo(() => modelPicture(model, yaw, tilt, size), [model, yaw, tilt, size]);

  // ── Leaning toward the chosen seat ────────────────────────────────────────
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
    transform: [{ translateX: lean.value.x }, { translateY: lean.value.y }, { scale: lean.value.s }],
  }));

  return (
    <GestureDetector gesture={orbit}>
      <Animated.View style={[{ width: size, height: size }, stageStyle]}>
        {picture ? (
          <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
            <Picture picture={picture} />
          </Canvas>
        ) : null}
        {plan.seats.map((spot) => {
          const st = states[spot.n];
          if (st === 'off') return null;
          const [x, y] = frameXY(model, projectPoint(seatTop(spot, st === 'selected'), yaw, tilt), size);
          const seat = byNumber.get(spot.n);
          return (
            <SeatTag
              key={spot.n}
              n={spot.n}
              x={x}
              y={y}
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
  n, x, y, state, accent, motion, onPress,
}: {
  n: number; x: number; y: number; state: CabinSeatState; accent: string; motion: boolean; onPress?: () => void;
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
  const numStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + pop.value * 0.35 }] }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: (1 - ring.value) * 0.8,
    transform: [{ scaleX: 0.6 + ring.value * 1.1 }, { scaleY: (0.6 + ring.value * 1.1) * 0.55 }],
  }));
  const light = state === 'free' || state === 'held';
  const label = `Seat ${n}, ${state === 'free' ? 'available' : state === 'selected' ? 'selected' : state === 'held' ? 'on hold' : 'taken'}`;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      haptic={onPress ? 'light' : undefined}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled: !onPress }}
      style={[styles.tag, { left: x - TAG / 2, top: y - TAG / 2 }]}
    >
      {selected ? <Animated.View pointerEvents="none" style={[styles.ring, { borderColor: accent }, ringStyle]} /> : null}
      <Animated.View style={numStyle}>
        <Text style={[styles.num, { color: selected ? '#FFFFFF' : light ? '#141820' : '#C9CFD8' }, selected && styles.numShadow]}>{n}</Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tag: { position: 'absolute', width: TAG, height: TAG, alignItems: 'center', justifyContent: 'center' },
  num: { fontFamily: fonts.displayBold, fontSize: 14, letterSpacing: -0.2 },
  numShadow: { textShadowColor: 'rgba(0,0,0,0.45)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
  ring: { position: 'absolute', width: TAG + 18, height: TAG + 18, borderRadius: (TAG + 18) / 2, borderWidth: 2 },
});
