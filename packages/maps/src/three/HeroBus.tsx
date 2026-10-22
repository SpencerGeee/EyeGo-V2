import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { Model3D } from './Model3D';
import type { Model } from './engine';

/**
 * ── THE HERO BUS — CONTENT, NOT A FLIGHT ────────────────────────────────────
 *
 * It used to be a protagonist that FLEW between screens: a transit layer
 * picked the bus up at one slot and glided it, leaning and spinning, to the
 * next — over pushes, over modals, onto the pickup pin and down onto the seat
 * cabin. That is the morph the user rejected ("it morphs and goes out of the
 * screen", "the bus sits on the middle of the pick-your-seat screen viewed
 * from the rooftop, overlapping the 3D cabin"). Every flagship app studied for
 * this (App Store, Material's container transform, Airbnb, Uber, Bolt) keeps
 * the persistent element IN PLACE; nothing crosses or leaves the screen.
 *
 * So a slot now simply draws the bus where it is, at rest, and a tier change
 * is a small press-and-settle on the spot. A `land` slot was only ever a
 * landing pad for a flight; with no flight it draws nothing. The API is
 * unchanged so every caller keeps compiling.
 */

export const SHOWROOM_YAW = 228;
export const SHOWROOM_PITCH = 58;
/** full = booking flows; live = live-trip stages. Kept for callers. */
export type HeroStrength = 'full' | 'live';

const Ctx = createContext<{ model: Model; spinKey: string; reduced: boolean } | null>(null);

export function HeroBusProvider({
  model,
  spinKey,
  reduced = false,
  children,
}: {
  model: Model;
  /** Changing it plays one small settle on the bus (the chosen tier). */
  spinKey: string;
  spinDir?: 1 | -1;
  strength?: HeroStrength;
  accent?: string;
  reduced?: boolean;
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ model, spinKey, reduced }), [model, spinKey, reduced]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Draws the bus here, at rest. Without a provider it draws `model`. */
export function HeroBusSlot({
  size,
  yaw = SHOWROOM_YAW,
  pitch = SHOWROOM_PITCH,
  land = false,
  model: ownModel,
  style,
}: {
  id: string;
  size: number;
  yaw?: number;
  pitch?: number;
  /** A former landing pad — draws nothing. */
  land?: boolean | 'into';
  model?: Model;
  settleMs?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const ctx = useContext(Ctx);
  const model = ownModel ?? ctx?.model;
  const k = useSharedValue(1);
  const first = useRef(true);
  const spinKey = ctx?.spinKey ?? '';
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (ctx?.reduced) return;
    k.value = withSequence(withTiming(0.94, { duration: 110 }), withSpring(1, { stiffness: 320, damping: 26, mass: 1 }));
  }, [spinKey, ctx?.reduced, k]);
  const press = useAnimatedStyle(() => ({ transform: [{ scale: k.value }] }));

  if (land || !model) return <View style={[{ width: size, height: size }, style]} pointerEvents="none" />;
  return (
    <Animated.View style={[{ width: size, height: size }, style, press]} pointerEvents="none">
      <Model3D model={model} heading={yaw} pitch={pitch} size={size} />
    </Animated.View>
  );
}
