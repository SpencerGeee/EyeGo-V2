/**
 * Motion tokens — the single source of truth for animation feel.
 *
 * Design intent: snappy, critically-damped, zero-overshoot ("premium", never
 * bouncy). Duration-based Reanimated 4 springs (`duration` + `dampingRatio`)
 * are used for entrances and layout morphs so the settle time is predictable
 * across elements of different sizes; physical params are kept only for
 * press feedback where the gesture cadence matters more than settle time.
 *
 * Plain objects (no reanimated import) so this package stays dependency-free;
 * spread them into `withSpring(value, springs.snappy)` at the call site.
 */

export const springs = {
  /** Layout morphs, position/size changes that aren't a full screen transform. */
  snappy: { duration: 350, dampingRatio: 1, overshootClamping: true },
  /**
   * Container-transform ("morph") — a card expanding into a full screen and
   * back, Yango/Material style. Short (280ms) with a tiny overshoot bounce
   * (dampingRatio 0.82, no clamping) so the growth reads as one continuous
   * surface with a touch of alive tension — matching Yango's signature feel.
   * Used by MorphProvider for both forward and reverse flights.
   */
  morph: { duration: 280, dampingRatio: 0.82, overshootClamping: false },
  /** Screen/element entrances — a whisper of life, still clamped. */
  entrance: { duration: 450, dampingRatio: 0.9, overshootClamping: true },
  /** Press release back to rest. */
  press: { stiffness: 420, damping: 34, mass: 1 },
  /** Tab-bar active-indicator / icon crossfade — quick, snappy, interruptible. */
  tab: { duration: 260, dampingRatio: 1, overshootClamping: true },
} as const;

export const durations = {
  fast: 150,
  base: 250,
  slow: 400,
} as const;

/** Uniform press-down scale for touchables. */
export const pressScale = 0.97;
