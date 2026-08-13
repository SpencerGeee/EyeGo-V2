import React, { createContext, useContext, useMemo } from 'react';
import { makeMutable, type SharedValue } from 'react-native-reanimated';

/**
 * THE SHEET↔MAP CHANNEL.
 *
 * One number, published on the UI thread: `top` — the y coordinate, in screen
 * px, of the bottom sheet's top edge. Everything that has to stay visually
 * balanced against the sheet reads it from here.
 *
 * Why a channel and not a prop.
 *
 * The map and the sheet are siblings under the trip surface, and the sheet's
 * height is only known after its content has laid out. Prop-drilling a measured
 * height back up to a common parent means a `setState` per height change — a
 * React render on the JS thread in the middle of a spring, which is exactly the
 * stutter this whole architecture exists to remove. A shared value crosses the
 * same distance with no render at all: the sheet writes it inside a spring on
 * the UI thread, and the map's existing 60 Hz camera loop reads `.value`
 * synchronously on the JS thread each tick (a shared value is readable from
 * either side; only *animating* it is UI-thread-exclusive).
 *
 * The default instance exists so a consumer mounted outside a provider — a
 * screen that has a map but no morphing sheet — still gets a valid, inert
 * channel instead of crashing on `undefined.value`.
 */
export interface SheetMetrics {
  /**
   * Top edge of the sheet, in px from the top of the screen. Equals
   * `screenHeight` when nothing is showing, so consumers can treat "no sheet"
   * and "sheet fully closed" identically.
   */
  top: SharedValue<number>;
  /** Screen height the `top` value is expressed against. */
  screenHeight: SharedValue<number>;
  /**
   * Set true while the surface is being torn down. The camera loop uses it to
   * stop chasing a sheet that is on its way out, which otherwise produces one
   * last re-frame against a half-dismissed panel.
   */
  retired: SharedValue<boolean>;
}

export function createSheetMetrics(screenHeight = 0): SheetMetrics {
  return {
    top: makeMutable(screenHeight),
    screenHeight: makeMutable(screenHeight),
    retired: makeMutable(false),
  };
}

/**
 * Created lazily rather than at module scope. Module-scope `makeMutable` runs
 * during bundle evaluation, before the Reanimated native module is guaranteed
 * to be installed — the same class of startup crash the Skia runtime effects
 * hit. A getter defers it to first use, by which point the app is running.
 */
let fallback: SheetMetrics | null = null;
function fallbackMetrics(): SheetMetrics {
  if (!fallback) fallback = createSheetMetrics(0);
  return fallback;
}

const SheetMetricsContext = createContext<SheetMetrics | null>(null);

export function SheetMetricsProvider({
  value,
  children,
}: {
  value: SheetMetrics;
  children: React.ReactNode;
}) {
  return <SheetMetricsContext.Provider value={value}>{children}</SheetMetricsContext.Provider>;
}

export function useSheetMetrics(): SheetMetrics {
  const ctx = useContext(SheetMetricsContext);
  return ctx ?? fallbackMetrics();
}

/**
 * Create a channel scoped to one surface. Each trip surface gets its own, so a
 * rider map and (in the driver app) a job map can never publish into the same
 * numbers — the bug module-level singletons invite.
 */
export function useCreateSheetMetrics(screenHeight: number): SheetMetrics {
  const metrics = useMemo(() => createSheetMetrics(screenHeight), []);
  // Rotation and split-screen change the screen height under a mounted sheet;
  // without this the map keeps padding for the old one.
  metrics.screenHeight.value = screenHeight;
  return metrics;
}
