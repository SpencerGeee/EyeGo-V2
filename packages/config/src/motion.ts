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
  /** Layout morphs, container transforms, position/size changes. */
  snappy: { duration: 350, dampingRatio: 1, overshootClamping: true },
  /** Screen/element entrances — a whisper of life, still clamped. */
  entrance: { duration: 450, dampingRatio: 0.9, overshootClamping: true },
  /** Press release back to rest. */
  press: { stiffness: 420, damping: 34, mass: 1 },
} as const;

export const durations = {
  fast: 150,
  base: 250,
  slow: 400,
} as const;

/** Uniform press-down scale for touchables. */
export const pressScale = 0.97;
