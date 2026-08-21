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
/**
 * ── WHY THESE TOKENS EXIST AND WHY NOTHING MAY INLINE A SPRING ──────────────
 *
 * BUGFIX — "all the morph animations are extremely fast and laggy so it's not
 * as fluid as it should be… they all seem to be jumpy and laggy and super fast,
 * so the animation that is sought out for is super gone and missed."
 *
 * The tokens below were never the problem. A sweep of both apps found 128 call
 * sites that bypassed them entirely with inline literals, and they clustered
 * hard:
 *
 *   69×  { stiffness: 600, damping: 34 }   ζ 0.69 · response 0.257 s
 *   23×  { stiffness: 400, damping: 30 }   ζ 0.75 · response 0.314 s
 *    9×  { stiffness: 500, damping: 30 }   ζ 0.67 · response 0.281 s
 *
 * Read those numbers against `standard` (ζ 1.00 · 0.35 s) and the report is
 * explained exactly, including the part that sounds self-contradictory. The
 * dominant spring was **27 % faster** than the system's — that is "super fast"
 * — AND **underdamped at ζ 0.69**, so it overshot roughly 5 % and rang on the
 * way back. A large surface arriving early and then wobbling is precisely what
 * "jumpy and laggy" describes; it is not dropped frames, it is the wrong
 * physics rendered perfectly.
 *
 * All 128 were mapped onto the nearest token by response time, with ζ corrected
 * to 1.0. The one exception is a deliberate pulse, which kept its bounce via
 * `accent`.
 *
 * SO: do not write `{ stiffness, damping }` inline. If no token fits, add one
 * here with its ζ and response worked out, so the next sweep can reason about
 * it. ζ = damping / (2·√(stiffness·mass)); response = 2π·√(mass/stiffness).
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
 * NAMED MOTION PROFILES — the three roles a spring plays in this product.
 *
 * READ THIS BEFORE SWITCHING A CALL SITE TO ONE OF THESE. A previous pass
 * evaluated the same three profiles and REJECTED retuning `springs` to them,
 * because the tokens above are already Apple-derived and the brief's numbers are
 * within rounding of tokens that exist (`FLUID_MORPH` ≈ `emphasized`/`morph`).
 * That decision stands: nothing above has been retuned. These are an additive,
 * role-indexed VIEW of the same physics, provided so code that wants to name the
 * role rather than the speed has a stable name to use.
 *
 * One of them deliberately breaks the system's own damping rule — see
 * TACTILE_BUTTON below — so prefer the `springs` token unless the role name is
 * genuinely what makes the call site clearer.
 *
 * `springs` above is a palette indexed by SPEED (press, micro, standard,
 * emphasized…). That is the right axis for picking a token but the wrong one for
 * enforcing consistency, because two developers reaching for "the sheet spring"
 * have to agree independently that it is `emphasized`. These three are indexed
 * by ROLE instead, and they are the only springs the continuous-morph
 * architecture uses:
 *
 *   FLUID_MORPH       — anything changing SIZE or POSITION as a surface: sheet
 *                       snap points, container transforms, stage swaps, the
 *                       panel's own height. One profile for all of them is what
 *                       makes a sheet growing and a card expanding read as the
 *                       same physical system rather than two animations that
 *                       happen to overlap.
 *   TACTILE_BUTTON    — direct-manipulation feedback. The one place a trace of
 *                       overshoot is correct: a control that springs back past
 *                       its resting size reads as sprung, and a critically
 *                       damped one reads as dead.
 *   NODE_CONVERGENCE  — map furniture. Markers scaling, pins converging, the
 *                       driver dot settling onto a new fix. Slightly OVERdamped
 *                       on purpose: a marker that overshoots looks like the
 *                       vehicle moved somewhere it never was.
 *
 * WHY THESE NUMBERS AND NOT THE ONES IN `springs`. They are the same physics —
 * `stiffness = mass·(2π/response)²`, `damping = 2ζ√(k·mass)` — solved for the
 * response and damping ratio each role wants, with mass varied rather than
 * pinned at 1:
 *
 *   FLUID_MORPH       ζ = 1.04, response ≈ 0.475 s  (≈ springs.emphasized)
 *   TACTILE_BUTTON    ζ = 0.78, response ≈ 0.328 s  (≈ springs.standard, sprung)
 *   NODE_CONVERGENCE  ζ = 1.24, response ≈ 0.599 s  (≈ springs.system, damped)
 *
 * Lower mass on the first two is not decoration: mass is what the solver treats
 * as inertia, and a lighter surface changes direction faster under the same
 * stiffness, which is the difference between a sheet that tracks a flick and one
 * that swims after it.
 *
 * `overshootClamping: false` is stated explicitly on FLUID_MORPH rather than
 * left to default, because clamping a critically damped spring is a silent
 * no-op that stops being one the moment someone retunes ζ below 1 — at which
 * point the clamp turns a spring into a hard stop and nobody remembers why the
 * morph started snapping.
 *
 * The rest thresholds are an order of magnitude tighter than Reanimated's
 * defaults (0.01 vs 0.001/2 depending on version) for one reason: these springs
 * drive LAYOUT, and a spring that declares itself finished half a pixel early
 * leaves a surface permanently half a pixel off its snap point. Over a session
 * of sheet drags that accumulates into visible drift.
 */
export const MOTION_PROFILES = {
  /** Sheets, container transforms, stage swaps — anything with size. */
  FLUID_MORPH: {
    damping: 22,
    stiffness: 140,
    mass: 0.8,
    overshootClamping: false,
    restDisplacementThreshold: 0.01,
    restSpeedThreshold: 0.01,
  },
  /**
   * Press feedback, as specified in the brief — ζ ≈ 0.78.
   *
   * NOT used by `@eyego/ui`'s Pressable, which stays on `springs.press`
   * (ζ = 1.0). This file's own rule is that everything spatial, buttons
   * included, is critically damped and that overshoot belongs only to success
   * moments; a press-scale that springs past its resting size breaks that on the
   * most-repeated interaction in either app. Kept here because the brief asks
   * for it by name and a control that genuinely wants to read as sprung — a
   * toggle, a stamp — has somewhere to reach for.
   */
  TACTILE_BUTTON: {
    damping: 18,
    stiffness: 220,
    mass: 0.6,
  },
  /** Map markers and pins. Overdamped so nothing lands where it never was. */
  NODE_CONVERGENCE: {
    damping: 26,
    stiffness: 110,
    mass: 1.0,
  },
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
