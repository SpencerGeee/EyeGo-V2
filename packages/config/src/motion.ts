/**
 * Motion tokens — the single source of truth for animation feel in both apps.
 *
 * WHY THESE EXACT NUMBERS. Since iOS 17, SwiftUI's `Animation.default` is
 * `spring(response: 0.55, dampingFraction: 1.0)` — **critically damped, zero
 * overshoot**. Reanimated 3's default `withSpring` is `damping: 10,
 * stiffness: 100`, which works out to ζ = 0.5: a **16.3 % overshoot** that
 * takes 1460 ms to settle. On a 320 px sheet that is 52 px of visible bounce
 * past the resting position. That single default is the whole "bouncy, not
 * quite native" feel — it is a config problem, not a taste problem.
 *
 * So: every token below is derived from Apple's own published spring
 * parameters, converted to Reanimated's (stiffness, damping, mass) form with
 *
 *     stiffness k = mass · (2π / response)²
 *     damping   c = 2 · ζ · √(k · mass)
 *
 * and **nine of the eleven are ζ ≥ 0.85**. Overshoot is not a style here; it
 * is reserved for exactly one semantic category — something that just
 * succeeded and wants to be noticed (payment confirmed, driver assigned).
 * Everything spatial — sheets, screens, maps, headers, lists, buttons — is
 * ζ = 1.0, the same as the platform's own default.
 *
 * Full derivation, sources and the per-interaction mapping:
 * `docs/research/2026-08-06-native-motion-system.md`.
 *
 * RULE: never call `withSpring(value)` with no config. Pass a token from here.
 *
 * Plain objects (no reanimated import) so this package stays dependency-free;
 * spread them into `withSpring(value, springs.standard)` at the call site.
 */

/**
 * Physical springs. Each is `mass: 1`; `response` is Apple's "approximate
 * duration in seconds" and ζ its damping fraction. Overshoot and settle time
 * are stated so a caller can pick by feel rather than by guessing at numbers.
 */
export const springs = {
  /** Tap/press-down scale, toggle knob. resp 0.20 · ζ 1.00 · 0 % · ~352 ms */
  press: { stiffness: 987, damping: 63, mass: 1 },
  /** Icon state, chip select, checkbox. resp 0.25 · ζ 1.00 · 0 % · ~440 ms */
  micro: { stiffness: 632, damping: 50, mass: 1 },
  /** Element enter/exit, card swap, badge. resp 0.35 · ζ 1.00 · 0 % · ~616 ms */
  standard: { stiffness: 322, damping: 36, mass: 1 },
  /** Sheet snap, panel expand/collapse. resp 0.45 · ζ 1.00 · 0 % · ~792 ms */
  emphasized: { stiffness: 195, damping: 28, mass: 1 },
  /** Matches iOS 17 `Animation.default` exactly. resp 0.55 · ζ 1.00 · 0 % */
  system: { stiffness: 131, damping: 23, mass: 1 },
  /** Full-screen / large-surface moves. resp 0.70 · ζ 1.00 · 0 % · ~1231 ms */
  gentle: { stiffness: 81, damping: 18, mass: 1 },
  /**
   * Gesture-follow and velocity hand-off — Apple's `interactiveSpring`.
   * resp 0.15 · ζ 0.86 · 0.50 % · ~192 ms. Gesture-driven motion has to be
   * roughly 4× stiffer than declarative motion or it lags the finger.
   */
  interactive: { stiffness: 1755, damping: 72, mass: 1 },
  /**
   * The ONLY place bounce is allowed: something that just succeeded — success
   * ticks, confirm stamps, the ETA reveal. resp 0.35 · ζ 0.75 · 2.84 %.
   */
  accent: { stiffness: 322, damping: 27, mass: 1 },

  // ── Aliases kept for existing call sites ───────────────────────────────
  /** @deprecated Use `springs.standard`. */
  snappy: { stiffness: 322, damping: 36, mass: 1 },
  /** @deprecated Use `springs.standard`. */
  entrance: { stiffness: 322, damping: 36, mass: 1 },
  /** @deprecated Use `springs.micro`. */
  tab: { stiffness: 632, damping: 50, mass: 1 },
  /**
   * Container-transform ("morph") — a card expanding into a full screen and
   * back. Deliberately `emphasized` rather than a looser spring: the morph is a
   * large surface changing size, and every frame of overshoot on a surface that
   * big reads as the card wobbling rather than as the card arriving.
   */
  morph: { stiffness: 195, damping: 28, mass: 1 },
} as const;

/**
 * Timing-curve durations. 350 ms is the iOS canonical figure — Apple states it
 * identically on `easeIn`, `easeOut`, `easeInOut` and `linear`, and it is the
 * same number React Navigation's native stack uses.
 */
export const durations = {
  /** Colour/opacity nudges, hover-equivalents. */
  fast: 150,
  /** The default. Apple's stated duration for every easing preset. */
  base: 250,
  /** iOS canonical easing duration. */
  standard: 350,
  /** Large surfaces, full-screen crossfades. */
  slow: 400,
} as const;

/**
 * Cubic-bezier control points, as Apple and Uber publish them. Feed to
 * `Easing.bezier(...easings.decelerate)`.
 */
export const easings = {
  /** Apple `UnitCurve.easeInOut`. */
  standard: [0.42, 0, 0.58, 1],
  /** Apple `UnitCurve.easeIn` — for elements leaving. */
  accelerate: [0.42, 0, 1, 1],
  /**
   * Uber Base `easeDecelerate` — "motion starts at top speed and comes to a
   * very gradual stop. Commonly used for entering elements." Stronger tail than
   * Apple's easeOut and the reason entering content reads as settling rather
   * than as stopping.
   */
  decelerate: [0.22, 1, 0.36, 1],
  /** Constant speed. Opacity and colour only — never position. */
  linear: [0, 0, 1, 1],
} as const;

/**
 * The default transition for declarative (Moti-style) animation. Exported as a
 * plain object so `@eyego/ui`'s MotiView wrapper can inject it without this
 * package taking a dependency on moti or reanimated.
 */
export const defaultTransition = {
  type: 'spring' as const,
  ...springs.standard,
};

/** Uniform press-down scale for touchables. */
export const pressScale = 0.97;

/**
 * Stagger step for a list of entering elements. Long enough to read as a
 * cascade, short enough that the last item is not still arriving after the
 * rider has started reading the first.
 */
export const stagger = 40;
