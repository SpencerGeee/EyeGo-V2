import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
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

const TURN_MS = 680;

const Ctx = createContext<{ model: Model; spinKey: string; spinDir: 1 | -1; reduced: boolean } | null>(null);

export function HeroBusProvider({
  model,
  spinKey,
  spinDir,
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
  const value = useMemo(() => ({ model, spinKey, spinDir: spinDir ?? 1, reduced: !!reduced }), [model, spinKey, spinDir, reduced]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Draws the bus here, at rest. Without a provider it draws `model`. */
export function HeroBusSlot({
  size,
  yaw = SHOWROOM_YAW,
  pitch = SHOWROOM_PITCH,
  land = false,
  model: ownModel,
  turnKey,
  style,
}: {
  id: string;
  size: number;
  yaw?: number;
  pitch?: number;
  /** A former landing pad — draws nothing. */
  land?: boolean | 'into';
  model?: Model;
  /**
   * Turn on THIS key instead of the provider's tier key. An empty string never
   * turns — a list row passes `on ? 'on' : ''`, so only the row being picked
   * turns, and the one being let go stays still.
   */
  turnKey?: string;
  settleMs?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const ctx = useContext(Ctx);
  const model = ownModel ?? ctx?.model;
  const k = useSharedValue(1);
  const [turn, setTurn] = useState(0);
  const systemReduced = useReducedMotion();
  const first = useRef(true);
  const spinKey = turnKey ?? ctx?.spinKey ?? '';
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (turnKey !== undefined && turnKey === '') return;
    if (!ctx?.reduced) {
      k.value = withSequence(withTiming(0.94, { duration: 110 }), withSpring(1, { stiffness: 320, damping: 26, mass: 1 }));
    }
    // Gated on the SYSTEM setting only, not the depth probe (`ctx.reduced`):
    // a phone the probe rates slow lost the turn entirely — "the flat thing".
    // A handful of cached frames costs nothing a slow phone cannot afford.
    if (systemReduced) return;
    /**
     * THE TURN (G2). Picking a tier turns the bus once, in place — it never
     * flies anywhere. Driven like Model3D's `spin`: a JS-side yaw offset over
     * one revolution, ease-out, landing back on the showroom angle. The engine
     * quantises yaw, so this is a handful of cached frames, not a re-render
     * per degree.
     */
    const dir = ctx?.spinDir ?? 1;
    const t0 = Date.now();
    let raf = 0;
    const tick = () => {
      const p = Math.min(1, (Date.now() - t0) / TURN_MS);
      const eased = 1 - Math.pow(1 - p, 3);
      setTurn(p < 1 ? dir * 360 * eased : 0);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Only a tier change turns the bus; a settings flip must not replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinKey]);
  const press = useAnimatedStyle(() => ({ transform: [{ scale: k.value }] }));

  if (land || !model) return <View style={[{ width: size, height: size }, style]} pointerEvents="none" />;
  return (
    <Animated.View style={[{ width: size, height: size }, style, press]} pointerEvents="none">
      <Model3D model={model} heading={yaw + turn} pitch={pitch} size={size} />
    </Animated.View>
  );
}
