# Native Motion System for Expo / React Native (Reanimated 3+)

**Date:** 2026-08-06
**Goal:** Rebuild the EyeGo rider/driver apps so they read as native iOS, not as a bouncy half-finished RN app.
**Method:** Primary-source extraction of numeric motion specs from Apple's SwiftUI/UIKit docs, Uber's Base design system source, Reanimated docs/source, gorhom bottom-sheet source, React Navigation native-stack docs, and Mapbox GL camera source. Everything inferred is labelled **INFERRED**.

---

## 0. The single most important finding — read this first

Since iOS 17, **`Animation.default` in SwiftUI is a spring with `dampingFraction = 1.0`.** Not 0.825. Not 0.7. Exactly 1.0 — critically damped, **zero overshoot**.

> "The `default` animation is `spring(response:dampingFraction:blendDuration:)` with: `response` equal to `0.55`, `dampingFraction` equal to `1.0`, `blendDuration` equal to `0.0`. Prior to iOS 17, macOS 14, tvOS 17, and watchOS 10, the `default` animation is `easeInOut`."
> — Apple, [`Animation.default`](https://developer.apple.com/documentation/swiftui/animation/default)

Meanwhile, **Reanimated 3's default `withSpring` is `damping: 10, stiffness: 100, mass: 1`** ([Reanimated 3.x withSpring docs](https://docs.swmansion.com/react-native-reanimated/docs/3.x/animations/withSpring/)). Run the physics:

```
ζ = damping / (2 · √(stiffness · mass)) = 10 / (2 · √100) = 0.5
overshoot % = e^(−πζ / √(1−ζ²)) = e^(−1.814) = 16.3 %
response    = 2π · √(mass/stiffness) = 0.628 s
```

**Reanimated 3's out-of-the-box spring overshoots its target by 16.3 % and takes 628 ms to get there.** On a 320 px sheet travel that is **52 px of visible bounce past the resting position**. Reanimated 3's duration-based default is even worse: `duration: 2000, dampingRatio: 0.5` — same 16.3 % overshoot stretched over two seconds.

That is the entire "bouncy toy" feel. It is not a taste problem; it is a default-config problem. Every `withSpring(x)` in the codebase without an explicit config is producing motion Apple's system would never produce.

(Reanimated 4 fixed this: defaults moved to `damping: 120, stiffness: 900` → ζ = 2.0, overdamped, and `dampingRatio: 1` for the duration-based form. Source: [Reanimated 4.x withSpring](https://docs.swmansion.com/react-native-reanimated/docs/animations/withSpring/). If you are on Reanimated 3, you must set configs explicitly everywhere.)

**Rule #1: never call `withSpring(value)` with no second argument. Ever.** Add a lint rule.

---

## 1. The numeric token set

### 1.1 Spring math you need (all formulas, mass = 1 throughout)

Apple describes springs as `(response, dampingFraction)` or `(duration, bounce)`. Reanimated 3 wants `(stiffness, damping, mass)`. The conversions:

```
stiffness  k  = mass · (2π / response)²
damping    c  = 2 · ζ · √(k · mass)
dampingRatio ζ = c / (2 · √(k · mass))
bounce        = 1 − ζ            (for ζ ≤ 1)     [Apple's bounce parameter]
overshoot %   = e^(−πζ / √(1−ζ²)) · 100          (0 when ζ ≥ 1)
settle (ε=0.001) ≈ ln(1000) / (ζ · ωn),  ωn = 2π / response
```

Apple's semantics, quoted:

- `response` — "The stiffness of the spring, defined as an approximate duration in seconds." ([`spring(response:dampingFraction:blendDuration:)`](https://developer.apple.com/documentation/swiftui/animation/spring(response:dampingfraction:blendduration:)))
- `duration` (in `Spring(duration:bounce:)`) — "The perceptual duration, which defines the pace of the spring. This is approximately equal to the settling duration, but for springs with very large bounce values, will be the duration of the period of oscillation."
- `bounce` — "A value of 0 indicates no bounces (a critically damped spring), positive values indicate increasing amounts of bounciness up to a maximum of 1.0 (corresponding to undamped oscillation), and negative values indicate overdamped springs with a minimum value of −1.0."
- `dampingRatio` — "When `dampingRatio` is 1, the spring will smoothly decelerate to its final position without oscillating."
- `mass` — "The default mass is 1."
- `settlingDuration` — "This uses a `target` of 1.0, an `initialVelocity` of 0, and an `epsilon` of 0.001."

`bounce = 1 − ζ` for ζ ≤ 1 is **INFERRED** by composing the two definitions above (bounce 0 ⇒ critically damped ⇒ ζ = 1; bounce 1.0 ⇒ undamped ⇒ ζ = 0; Apple states both endpoints, linear interpolation between them is the documented-consistent reading and is what the community-reverse-engineered `Spring` type does). It checks out against the presets in §1.3.

### 1.2 THE TABLE — paste-ready motion tokens

Every row is `mass: 1`. `stiffness`/`damping` rounded to integers — the perceptual difference from the exact float is below one frame.

| Token | Use for | Apple equivalent | resp (s) | ζ | **stiffness** | **damping** | Overshoot | Settle (ε .001) |
|---|---|---|---|---|---|---|---|---|
| `press` | tap/press-down scale, toggle knob | — | 0.20 | 1.00 | **987** | **63** | 0 % | ~352 ms |
| `micro` | icon state, chip select, checkbox | — | 0.25 | 1.00 | **632** | **50** | 0 % | ~440 ms |
| `standard` | element enter/exit, card swap, badge | — | 0.35 | 1.00 | **322** | **36** | 0 % | ~616 ms |
| `emphasized` | sheet snap, panel expand/collapse | — | 0.45 | 1.00 | **195** | **28** | 0 % | ~792 ms |
| `system` | matches iOS 17 `Animation.default` exactly | `spring(0.55, 1.0)` | 0.55 | 1.00 | **131** | **23** | 0 % | ~967 ms |
| `gentle` | full-screen / large-surface moves | — | 0.70 | 1.00 | **81** | **18** | 0 % | ~1231 ms |
| `interactive` | gesture-follow, velocity handoff | `interactiveSpring(0.15, 0.86)` | 0.15 | 0.86 | **1755** | **72** | 0.50 % | ~192 ms |
| `snappy` | Apple `.snappy` preset (bounce 0.15) | `spring(0.5, bounce 0.15)` | 0.50 | 0.85 | **158** | **21** | 0.63 % | ~647 ms |
| `accent` | **the only place bounce is allowed** — success ticks, confirm stamp, ETA reveal | — | 0.35 | 0.75 | **322** | **27** | 2.84 % | ~513 ms |
| `bouncy` | Apple `.bouncy` preset — **do not use in a ride-hailing app** | `spring(0.5, bounce 0.3)` | 0.50 | 0.70 | **158** | **18** | 4.60 % | ~785 ms |
| ~~`RN3 default`~~ | **what you have now — delete on sight** | — | 0.628 | 0.50 | ~~100~~ | ~~10~~ | **16.3 %** | ~1460 ms |

**Zero-overshoot vs slight-overshoot rule.** Nine of the eleven rows above are ζ ≥ 0.85. That ratio is the answer to "which interactions get overshoot": **essentially none of them.** Overshoot is reserved for one semantic category — *a thing that just succeeded and wants to be noticed* (payment confirmed, driver assigned, rating submitted). Everything spatial — sheets, screens, maps, headers, lists, buttons — is ζ = 1.0. Apple's own system default is ζ = 1.0; their "small amount of bounce" preset `.snappy` produces **0.63 %** overshoot, which on a 320 px travel is **2 pixels**. That is what "a little bouncy" means in native iOS. It does not mean 52 px.

### 1.3 Apple's exact preset values (all verbatim from Apple's docs)

| API | Declared default signature |
|---|---|
| `Animation.default` (iOS 17+) | `spring(response: 0.55, dampingFraction: 1.0, blendDuration: 0.0)` |
| `Animation.default` (pre-iOS 17) | `easeInOut` |
| `Animation.spring(response:dampingFraction:blendDuration:)` | `response: 0.5, dampingFraction: 0.825, blendDuration: 0` |
| `Animation.spring(duration:bounce:blendDuration:)` | `duration: 0.5, bounce: 0.0, blendDuration: 0` |
| `Animation.interactiveSpring(response:dampingFraction:blendDuration:)` | `response: 0.15, dampingFraction: 0.86, blendDuration: 0.25` |
| `Animation.smooth(duration:extraBounce:)` | `duration: 0.5, extraBounce: 0.0` — "base bounce of **0**" |
| `Animation.snappy(duration:extraBounce:)` | `duration: 0.5, extraBounce: 0.0` — "base bounce of **0.15**" |
| `Animation.bouncy(duration:extraBounce:)` | `duration: 0.5, extraBounce: 0.0` — "base bounce of **0.3**" |
| `Spring.mass` | `1` |

`interactiveSpring`: "A convenience for a `spring` animation with a lower `response` value, intended for driving interactive animations." That is the gesture-tracking spring — response 0.15 s, ζ 0.86. It exists specifically because gesture-driven motion must be ~4× stiffer than declarative motion.

### 1.4 Easing curves — exact cubic-beziers

**Apple `UnitCurve` control points (verbatim from Apple docs):**

| Curve | cubic-bezier | Apple's wording |
|---|---|---|
| `UnitCurve.easeInOut` | `cubic-bezier(0.42, 0, 0.58, 1)` | "The start and end control points are located at (x: 0.42, y: 0) and (x: 0.58, y: 1)." |
| `UnitCurve.easeIn` | `cubic-bezier(0.42, 0, 1, 1)` | "…located at (x: 0.42, y: 0) and (x: 1, y: 1)." |
| `UnitCurve.easeOut` | `cubic-bezier(0, 0, 0.58, 1)` | "…located at (x: 0, y: 0) and (x: 0.58, y: 1)." |

**Apple's default easing duration is 0.35 s**, stated identically on all four presets: *"The `easeInOut` animation has a default duration of 0.35 seconds."* Same sentence appears on `easeIn`, `easeOut`, and `linear`. So **350 ms is the iOS canonical timing-curve duration** — and it is exactly the number React Navigation's native-stack uses (§1.6). That is not a coincidence; that is the platform.

**Uber Base design system — extracted directly from source** (`uber/baseweb`, `src/themes/shared/animation.ts`, MIT). These are the real production tokens, with Uber's own comments:

```ts
timing0: '0',        timing100: '100ms',   timing150: '150ms',  timing200: '200ms',
timing250: '250ms',  timing300: '300ms',   timing400: '400ms',  timing500: '500ms',
timing600: '600ms',  timing700: '700ms',   timing800: '800ms',  timing900: '900ms',
timing1000: '1000ms', timing1500: '1500ms', timing3000: '3000ms',
timing5000: '5000ms', timing7000: '7000ms',

// "Moves at constant speed. Commonly used for opacity and color changes."
easeLinear:  'cubic-bezier(0, 0, 1, 1)',
// "Motion starts at top speed and comes to a very gradual stop. Commonly used for entering elements."
easeDecelerate: 'cubic-bezier(0.22, 1, 0.36, 1)',   // === easeOutQuinticCurve
easeOutCurve:   'cubic-bezier(.2, .8, .4, 1)',
// "Motion begins very gradually and ends at top speed. Commonly used for exiting elements."
easeAccelerate: 'cubic-bezier(0.64, 0, 0.78, 0)',   // === easeInQuinticCurve
easeInCurve:    'cubic-bezier(.8, .2, .6, 1)',
// "Motion begins and ends very gradually with high velocity movement in the middle.
//  A good default for most motion."
easeAccelerateDecelerate: 'cubic-bezier(0.83, 0, 0.17, 1)',  // === easeInOutQuinticCurve
easeInOutCurve: 'cubic-bezier(0.4, 0, 0.2, 1)',
// "Motion begins naturally and speeds up slightly. Good for feeling of responsiveness
//  when paired with short durations."
easeResponsiveAccelerate: 'cubic-bezier(0.11, 0, 0.5, 0)',
```

And how Uber actually pairs them in shipped components (grepped from `baseweb` source):

| Component | Duration token | Curve | Properties |
|---|---|---|---|
| `Modal` backdrop | `timing400` (400 ms) | `easeOutCurve` | `opacity` |
| `Modal` dialog | `timing400` (400 ms) | `easeOutCurve` | `opacity, transform` |
| `Drawer` scrim + panel | `timing400` (400 ms) | `easeOutCurve` | `opacity, transform` |
| `Checkbox` mark/border | `timing200` (200 ms) | `easeOutCurve` | `background-image, border-color, background-color` |
| `Checkbox` knob | `timing200` (200 ms) | — | `transform` |
| `Button` background | `timing200` (200 ms) | `linearCurve` | `background` |
| `Button` loading spinner | `timing700` (700 ms) | `linear`, infinite | rotation |
| `Spinner` | `timing1000` (1000 ms) | `linear`, infinite | rotation |
| Icon `fill`/`border-color` | `timing200` (200 ms) | — | color |

Note the discipline: **two durations do 90 % of the work — 200 ms for state, 400 ms for surfaces.** Colours and opacity use `linear`. That is the whole system.

### 1.5 The complete motion-token file (drop this in)

```ts
// src/design/motion.ts
import { Easing, withSpring, withTiming, ReduceMotion } from 'react-native-reanimated';
import type { WithSpringConfig, WithTimingConfig } from 'react-native-reanimated';

/**
 * Springs. mass:1 everywhere. ζ (damping ratio) = damping / (2·√stiffness).
 * ζ = 1.0 → critically damped → ZERO overshoot. This is iOS's system default.
 * Never use withSpring() without one of these.
 */
export const SPRING = {
  /** press-down / release. resp 0.20s, ζ 1.00 */
  press:       { mass: 1, stiffness: 987,  damping: 63, overshootClamping: false },
  /** icon + control state. resp 0.25s, ζ 1.00 */
  micro:       { mass: 1, stiffness: 632,  damping: 50, overshootClamping: false },
  /** element enter/exit, card swap. resp 0.35s, ζ 1.00 */
  standard:    { mass: 1, stiffness: 322,  damping: 36, overshootClamping: false },
  /** sheet snap, panel expand/collapse. resp 0.45s, ζ 1.00 */
  emphasized:  { mass: 1, stiffness: 195,  damping: 28, overshootClamping: false },
  /** exact iOS 17 Animation.default. resp 0.55s, ζ 1.00 */
  system:      { mass: 1, stiffness: 131,  damping: 23, overshootClamping: false },
  /** large surfaces / full-screen. resp 0.70s, ζ 1.00 */
  gentle:      { mass: 1, stiffness: 81,   damping: 18, overshootClamping: false },
  /** gesture release + velocity handoff. Apple interactiveSpring(0.15, 0.86) */
  interactive: { mass: 1, stiffness: 1755, damping: 72, overshootClamping: false },
  /** THE ONLY BOUNCE. success/confirm moments only. ζ 0.75 → 2.8% overshoot */
  accent:      { mass: 1, stiffness: 322,  damping: 27, overshootClamping: false },
} satisfies Record<string, WithSpringConfig>;

/** Durations, ms. Uber Base's timing scale, trimmed to what a ride app needs. */
export const DUR = {
  instant: 0,
  micro:   100,   // reduced-motion crossfade; hover/press colour
  fast:    200,   // Base timing200 — control state changes
  base:    300,   // Reanimated withTiming default
  screen:  350,   // Apple's easing default AND react-navigation native-stack default
  surface: 400,   // Base timing400 — modal/drawer/sheet fades
  map:     500,   // Mapbox easeTo default
  slow:    700,
} as const;

/** Easing curves. Reanimated's Easing.bezier(x1,y1,x2,y2). */
export const EASE = {
  /** Apple UnitCurve.easeInOut — the iOS timing curve */
  iosInOut:    Easing.bezier(0.42, 0.0, 0.58, 1.0),
  iosIn:       Easing.bezier(0.42, 0.0, 1.00, 1.0),
  iosOut:      Easing.bezier(0.00, 0.0, 0.58, 1.0),
  /** Uber Base easeDecelerate — entering elements */
  decelerate:  Easing.bezier(0.22, 1.0, 0.36, 1.0),
  /** Uber Base easeAccelerate — exiting elements */
  accelerate:  Easing.bezier(0.64, 0.0, 0.78, 0.0),
  /** Uber Base easeAccelerateDecelerate — "a good default for most motion" */
  inOut:       Easing.bezier(0.83, 0.0, 0.17, 1.0),
  /** Uber Base easeInOutCurve — the softer inOut, matches Material's standard */
  inOutSoft:   Easing.bezier(0.40, 0.0, 0.20, 1.0),
  /** Uber Base easeResponsiveAccelerate — pair with DUR.fast for responsiveness */
  responsive:  Easing.bezier(0.11, 0.0, 0.50, 0.0),
  /** Mapbox GL default camera easing (= CSS `ease`) */
  camera:      Easing.bezier(0.25, 0.1, 0.25, 1.0),
  linear:      Easing.linear,
} as const;

/** Timing presets. Opacity and colour ALWAYS use linear or a *Out curve — never inOut. */
export const TIMING = {
  fade:      { duration: DUR.fast,    easing: EASE.linear }     satisfies WithTimingConfig,
  enter:     { duration: DUR.base,    easing: EASE.decelerate } satisfies WithTimingConfig,
  exit:      { duration: DUR.fast,    easing: EASE.accelerate } satisfies WithTimingConfig,
  surface:   { duration: DUR.surface, easing: EASE.iosOut }     satisfies WithTimingConfig,
  screen:    { duration: DUR.screen,  easing: EASE.iosInOut }   satisfies WithTimingConfig,
  camera:    { duration: DUR.map,     easing: EASE.camera }     satisfies WithTimingConfig,
  reduced:   { duration: DUR.micro,   easing: EASE.linear }     satisfies WithTimingConfig,
} as const;

/** Stagger. See §2.4. */
export const STAGGER = { step: 40, max: 6, cap: 240 } as const; // ms

/** Convenience wrappers so `withSpring(x)` naked never appears in the codebase. */
export const spring = (to: number, k: keyof typeof SPRING = 'standard', extra?: Partial<WithSpringConfig>) => {
  'worklet';
  return withSpring(to, { ...SPRING[k], ...extra });
};
export const timing = (to: number, k: keyof typeof TIMING = 'enter', extra?: Partial<WithTimingConfig>) => {
  'worklet';
  return withTiming(to, { ...TIMING[k], ...extra });
};
```

### 1.6 Screen transitions — hand these to the platform, don't animate them

React Navigation's native-stack, verbatim:

> "The Native Stack navigator uses the native APIs `UINavigationController` on iOS and `Fragment` on Android. This means animations and gestures are handled by the platform, resulting in smoother transitions and better performance compared to the JavaScript-based Stack Navigator."

> `animationDuration` — "Changes the duration (in milliseconds) of `slide_from_bottom`, `fade_from_bottom`, `fade` and `simple_push` transitions on iOS. **Defaults to `350`.** For screens with `default` and `flip` transitions, and, as of now, for screens with `presentation` set to `modal`, `formSheet`, `pageSheet` (regardless of transition), **the duration isn't customizable.**"

Read that last clause as a feature. The system push/modal curve is not exposed *because you should not be changing it*. 350 ms is Apple's number (§1.4) and it is already correct.

```ts
// app/_layout.tsx — expo-router
<Stack
  screenOptions={{
    animation: 'default',        // == UINavigationController push. Do not override on iOS.
    animationDuration: 350,      // only affects the slide/fade variants; matches Apple's 0.35s
    gestureEnabled: true,
    freezeOnBlur: true,          // see §4.2
    animationMatchesGesture: true,
    contentStyle: { backgroundColor: theme.bg }, // kills the white flash mid-push
  }}
/>
```

Only override `animation` when you need a *semantic* difference the platform lacks:
- `slide_from_bottom` (350 ms) — a task that interrupts the flow (SOS, dispute)
- `fade` (200 ms) — a lateral swap where "back" is meaningless (tab-like)
- `none` — anything under a persistent surface (§2.1)

### 1.7 Map camera

Mapbox GL's camera source (`mapbox-gl-js/src/ui/camera.ts`, `src/util/util.ts`) — the native SDKs mirror these:

```js
// easeTo defaults
options = { offset: [0, 0], duration: 500, easing: defaultEasing, ...options };
// util.ts
export const ease = bezier(0.25, 0.1, 0.25, 1);   // == CSS `ease`
// flyTo defaults
{ curve: 1.42, speed: 1.2, easing: defaultEasing }
```

So: **camera ease = 500 ms, `cubic-bezier(0.25, 0.1, 0.25, 1)`.** `flyTo` (the zoom-out-arc) uses `curve: 1.42`, `speed: 1.2`.

⚠️ `@maplibre/maplibre-react-native` and `rnmapbox/maps` `<Camera>` default `animationDuration` to **2000 ms** — four times Mapbox's own number, and it is the reason map moves feel like a slideshow. Set it explicitly on every camera command.

| Camera event | Duration | Mode |
|---|---|---|
| Follow user (continuous) | `0` (`animationMode: 'none'`) + interpolate the *marker*, not the camera | — |
| Recentre button | **500 ms** | `easeTo` |
| Sheet detent change → padding shift | **matches the sheet spring, driven by the same shared value** (§2.2) | manual `setPadding` |
| Pickup → route overview `fitBounds` | **600 ms** | `easeTo` |
| Big context jump (city change) | **900–1200 ms** | `flyTo`, `curve: 1.42` |
| Driver assigned → zoom to driver | **700 ms** | `easeTo` |

**INFERRED** (durations above 500 ms): Mapbox only documents 500 ms for `easeTo`; longer values are scaled to travel distance, which is the standard behaviour `flyTo` implements analytically. Rationale: a `fitBounds` covers more screen-space than a nudge, and Apple's guidance that transitions stay under ~500 ms applies to *UI* chrome, not to a camera flight the user asked for.

### 1.8 Shared-element / morph

There is no Apple-published number for shared-element transitions; SwiftUI's `matchedGeometryEffect` inherits whatever `Animation` is in scope, which since iOS 17 means **`spring(0.55, ζ 1.0)`** — i.e. the `system` token. **INFERRED**, but well-grounded: a morph is a *spatial* transition, and every spatial default in the platform is ζ = 1.0. A morph with overshoot looks catastrophically wrong because both the source and destination frames are on screen simultaneously and the overshoot reads as a mis-registration.

| Morph | Spring | Notes |
|---|---|---|
| Card → detail (small travel) | `standard` (322/36) | |
| Where-to field → search screen | `emphasized` (195/28) | |
| Avatar → profile | `system` (131/23) | |
| Any morph | **`overshootClamping: true`** | Belt-and-braces; a morph must never pass its target |

Cross-fade the *contents* on a shorter timing than the frame morph: frame moves on the spring, inner content does `withTiming(1, { duration: 200, easing: EASE.linear })` starting at ~40 % of the morph. This is what hides the fact that the two views aren't really the same view.

---

## 2. Choreography — why Yango reads as one app instead of six pages

> **Sourcing note.** Yango/Yandex Go and Bolt publish no motion specs. Bolt's ["Building a cross-platform design system"](https://bolt.eu/en/blog/building-a-cross-platform-design-system/) (Nov 2025) confirms a unified token layer across Android/iOS/React Native/web but publishes no numbers. Uber's Base motion tokens (§1.4) *are* primary-source. Everything in §2 that is not a quoted Uber/Apple number is **INFERRED from observable app behaviour** — but each rule below is stated as an implementable constraint with numbers, not as vibes.

### 2.1 Persistence: the map and the sheet are not on any screen

This is the whole trick, and it is an **architecture** decision, not an animation one. No easing curve will fix a layout where the map unmounts.

**Persist (never unmount, never animated by navigation):**
- The `MapView` — one instance for the entire app session.
- The bottom-sheet container (the surface itself, not its contents).
- The status/safe-area gradient and the floating top-left/top-right map buttons.

**Animate:**
- Only the *contents* of the sheet.
- Only modal/full-screen surfaces that genuinely leave the map behind (profile, wallet, settings, chat).

Implementation with expo-router:

```
app/
  _layout.tsx              ← Stack, and the persistent <MapSurface/> + <TripSheet/> live HERE,
                             rendered as siblings of <Slot/>, outside the navigator
  (trip)/
    _layout.tsx            ← a group whose screens render `null` content and only
                             push a *sheet state* + *camera intent* into a store
    where-to.tsx
    choose-ride.tsx
    confirm.tsx
    searching.tsx
    en-route.tsx
  profile.tsx              ← real screen, presentation: 'card', animation: 'default'
  wallet.tsx               ← real screen
```

Each `(trip)` route is a *state declaration*, not a page:

```tsx
export default function ChooseRide() {
  useSheetStage({ detent: 0.42, content: <RideOptions/>, handle: true });
  useCameraIntent({ fit: 'route', padding: { bottom: SHEET_H * 0.42 }, duration: 600 });
  return null; // the persistent surfaces render everything
}
```

Route changes inside `(trip)` use `animation: 'none'`. Nothing slides. What the user perceives as "the app moved" is the sheet resizing and the camera reframing — one continuous motion — while the URL/back-stack quietly advances. **That is why it never feels like separate pages: it isn't.**

### 2.2 Sheet + camera are ONE motion, driven by ONE shared value

The single most common failure: `sheet.animateTo(detent)` and `camera.easeTo(...)` fired as two independent animations. They start together and drift apart within 100 ms because a 500 ms bezier and a 450 ms spring do not share a position curve. The result reads as two apps arguing.

Correct: the sheet's translation is the **clock**. The camera's bottom padding is a derived value read on the UI thread, and only the *residual* camera work (centre/zoom) is handed to the map.

```tsx
// One shared value owns the entire trip surface.
const sheetY = useSharedValue(DETENTS.peek);   // px from bottom, 0 = collapsed

// Sheet drag / snap
const snapTo = (detent: number, velocity = 0) => {
  'worklet';
  sheetY.value = withSpring(detent, { ...SPRING.emphasized, velocity });
};

// Camera padding derives from the SAME value — no second animation exists.
useAnimatedReaction(
  () => sheetY.value,
  (y) => {
    // throttle to ~30 Hz: map padding at 60 Hz is wasted work and costs a commit each frame
    scheduleOnRN(setMapPadding, { bottom: Math.round(y / 4) * 4 });
  },
  []
);

// Anything else that must move with the sheet reads sheetY directly on the UI thread:
const mapButtonsStyle = useAnimatedStyle(() => ({
  transform: [{ translateY: -sheetY.value }],
  opacity: interpolate(sheetY.value, [DETENTS.peek, DETENTS.full], [1, 0], Extrapolation.CLAMP),
}));
```

Rules that fall out of this:
1. **One spring per gesture, not per element.** Map padding, floating buttons, the map attribution, the sheet's own header opacity, and the handle's width all read `sheetY`. They are the same animation.
2. **The camera's `centre`/`zoom` change is the only thing that gets its own duration**, and it gets `DUR.map` (500 ms) with `EASE.camera` — because it is a *different* semantic event (reframing content) from the sheet move (revealing content).
3. When both must happen (e.g. "driver assigned" → sheet grows *and* camera zooms to driver): **fire the camera first, delay the sheet by 80–120 ms.** The eye tracks the map, then the sheet arrives under it. Reversing the order makes the sheet look like it shoved the map. **INFERRED**, but consistent with Apple's guidance that motion should "help people visualize the results of their actions" — the causal order must match the narrative order.

### 2.3 Never animate `height`

Reanimated's own performance guide:

> "Animating non-layout properties (like `transform`, `opacity` or `backgroundColor`) is generally more performant than animating styles that affect layout (like `top`/`left`, `width`/`height`, `margin` or `padding`). That's because the latter group requires an additional step of layout recalculation on each animation frame."

For the sheet: render it at **full height** once, and move it with `translateY`. Detents are translateY targets, not heights. This is exactly what gorhom's bottom-sheet does and it is why it holds 60 fps while hand-rolled sheets do not.

### 2.4 Stagger

| Property | Value | Rationale |
|---|---|---|
| Per-item delay | **40 ms** | 40 ms ≈ 2.4 frames at 60 Hz — perceptible as sequence, not as lag |
| Max staggered items | **6** | items 7+ all use the item-6 delay |
| Total stagger cap | **240 ms** | 6 × 40; beyond this the last item feels broken |
| Item animation | `TIMING.enter` (300 ms, `EASE.decelerate`) + `translateY: 8 → 0` | matches Uber's "entering elements" curve |
| Translate distance | **8 px** (never more than 12) | large offsets read as a slide-in, not a settle |

```tsx
// Ride-option rows, driver list, receipt lines
<Animated.View
  entering={FadeInDown
    .delay(Math.min(index, STAGGER.max - 1) * STAGGER.step)
    .duration(DUR.base)
    .easing(EASE.decelerate.factory ? undefined : undefined) // layout anims use .easing(fn)
    .withInitialValues({ transform: [{ translateY: 8 }], opacity: 0 })}
/>
```

**Do not stagger:** anything above the fold on first paint (it delays perceived load), sheet contents on a *detent* change (the sheet is already the motion), or list items on scroll-in (that's a scroll, not an entrance).

### 2.5 What must NOT animate

| Thing | Why |
|---|---|
| Fare / ETA numeric values | Animate the *digit roll*, never the layout. Use an animated `TextInput` fed by a shared value — Reanimated's guide: "don't use React state to periodically update the counter. Instead, store the number in a shared value and use an animated `TextInput`." |
| Anything on cold start before first meaningful paint | Motion at t=0 is indistinguishable from jank |
| Error/validation states | Instant. A shake or a fade delays the user's understanding that they were wrong |
| Map marker positions during live tracking | Interpolate the marker with `withTiming(duration: <serverInterval>, easing: Easing.linear)` — a spring here makes vehicles wobble like they're on ice |

### 2.6 The "searching for driver" state — replacing the green orb

A spinner says *"I am busy."* Premium ride-hailing loading states say *"here is the specific work happening, and here is how long it will take."* That is the whole difference, and it is why the orb reads as cheap regardless of how well it is animated.

**Diagnosis of the green-orb failure mode:** an indeterminate spinner is a *generic* signifier. It could be loading anything. During a 20–45 s driver search — the highest-anxiety moment in the entire product — it communicates nothing about progress, nothing about the map, and nothing about the user's specific request. Worse, it occupies the sheet where the *information* should be.

**The replacement — three layers, all on the map, none of them a spinner:**

**Layer 1 — the pickup pin radar (INFERRED from observed Uber/Yango/Bolt behaviour; specs are mine and implementable):**

A pulse ring emitted from the pickup pin. Not a spinner, because it is *spatially anchored to the thing being searched around*, which makes it read as "scanning here."

```ts
// 3 concentric rings, each offset by 1/3 of the period
const PULSE_PERIOD = 2400;          // ms — slow. A fast pulse reads as urgency/error.
const RING_COUNT   = 3;
const RING_DELAY   = PULSE_PERIOD / RING_COUNT;   // 800ms

// per ring i:
progress.value = withDelay(i * RING_DELAY,
  withRepeat(
    withTiming(1, { duration: PULSE_PERIOD, easing: Easing.out(Easing.quad) }),
    -1, false
  )
);
// scale:   interpolate(progress, [0, 1], [0.25, 2.6])
// opacity: interpolate(progress, [0, 0.15, 1], [0, 0.28, 0])
// stroke:  1.5px, brand colour at 28% peak — NEVER a filled disc
```

`Easing.out(Easing.quad)` matters: the ring must leave fast and decay slowly, which reads as a wave propagating. `Easing.linear` reads as a mechanical loop. `Easing.inOut` reads as breathing (wrong metaphor — that's a heartbeat, not a search).

**Layer 2 — the camera is doing something.** During search, the camera performs a slow continuous orbit/drift, **not** a static hold: `zoom` oscillates ±0.15 over a 12 s period, or bearing drifts 0.4°/s. Cost is near-zero and it removes the "frozen app" reading entirely. **INFERRED.**

**Layer 3 — the sheet shows real state, and this is what actually makes it premium.** The sheet is 30–40 % height and contains:
1. A **determinate** progress bar — but bound to the *timeout*, not to fake progress: `withTiming(1, { duration: DISPATCH_TIMEOUT_MS, easing: Easing.linear })`. You know your dispatch timeout. Show it. A determinate bar over a known window is honest and reads as engineered.
2. **Live text that changes** — "Contacting nearby drivers" → "3 drivers notified" → "Confirming with driver". Each swap: `exiting={FadeOut.duration(150)}` / `entering={FadeInDown.duration(200).delay(150)}` on a `key`ed `<Animated.Text>`. Text that changes proves the backend is alive in a way no animation can.
3. Skeleton for the driver card that will appear — **same dimensions as the real card**, so the fill is a cross-fade rather than a layout jump. Shimmer sweep: `2000 ms`, `Easing.linear`, `withRepeat(-1)`, `translateX` from `-1.5×w` to `1.5×w`, gradient alpha peak `0.06`.

**Transition into "driver found"** — this is the one moment that earns the `accent` spring:
```
t=0     driver card content cross-fades in over the skeleton   (TIMING.fade, 200ms linear)
t=0     camera easeTo driver location                          (700ms, EASE.camera)
t=120   sheet grows to the driver detent                       (SPRING.emphasized)
t=120   pulse rings stop: opacity → 0 over 200ms (do NOT let them finish their cycle)
t=250   avatar + vehicle plate scale 0.92 → 1.0                (SPRING.accent — 2.8% overshoot)
        + one haptic: Haptics.notificationAsync(Success)
```
That is a 900 ms choreographed sequence with exactly **one** bouncy element in it. That ratio — one accent in a whole sequence — is the tuning.

---

## 3. Gesture feel

### 3.1 Interruptibility — the non-negotiable rule

Reanimated, verbatim:

> "Whenever you make animated updates of Shared Values, those animations are fully interruptible — when you make an update to a Shared Value that is being animated, the framework won't wait for the previous animation to finish, but will immediately initiate a new transition starting from the current position of the previous animation."

Apple says the same about springs:

> "When mixed with other `spring()` or `interactiveSpring()` animations on the same property, each animation will be replaced by their successor, **preserving velocity from one animation to the next**."
> — [`Animation.spring(response:dampingFraction:blendDuration:)`](https://developer.apple.com/documentation/swiftui/animation/spring(response:dampingfraction:blendduration:))

**The gap:** Reanimated preserves *position* automatically but **not velocity**. Apple preserves both. You must close that gap by hand, or every re-grab of a sheet mid-flight will feel like it hit a wall.

```ts
// ❌ dead stop on re-grab
.onBegin(() => { start.value = sheetY.value; })

// ✅ carry the in-flight velocity into the gesture, and back out again
const vel = useSharedValue(0);

const pan = Gesture.Pan()
  .onBegin(() => {
    cancelAnimation(sheetY);          // freeze in place, keep position
    start.value = sheetY.value;
  })
  .onUpdate((e) => {
    sheetY.value = rubberBand(start.value + e.translationY);
    vel.value = e.velocityY;
  })
  .onEnd((e) => {
    const target = pickDetent(sheetY.value, e.velocityY);
    sheetY.value = withSpring(target, { ...SPRING.emphasized, velocity: e.velocityY });
  });
```

Three hard rules:
1. **Never queue.** No `withSequence` for anything a gesture can touch. No `runOnJS` → `setState` → re-render → animate. The state machine writes to the shared value; the shared value is the truth.
2. **Always pass `velocity`** from `event.velocityY/X` into the settling `withSpring`. This one line is 80 % of "feels native."
3. **`cancelAnimation()` on `onBegin`**, not on `onStart`. `onBegin` fires the moment the finger lands, before the pan is recognised — that is the frame where the user expects the sheet to stop.

### 3.2 Sheet drag: rubber-banding

Apple's UIScrollView rubber-band function, reverse-engineered and widely confirmed:

```
f(x, d, c) = (x · d · c) / (d + c · x)
  x = raw overscroll distance
  d = the dimension (view height/width)
  c = 0.55   ← UIScrollView's constant
```

The function asymptotically approaches `d` as `x → ∞`, i.e. there is a hard ceiling on how far the sheet can be dragged past its limit no matter how hard you pull. That asymptote is what makes iOS overscroll feel like a physical material rather than a linear divide-by-3.

```ts
export function rubberBand(x: number, limit: number, dim: number, c = 0.55) {
  'worklet';
  if (x <= limit) return x;
  const over = x - limit;
  return limit + (over * dim * c) / (dim + c * over);
}
```

For comparison, gorhom's bottom-sheet uses a simpler constant divisor: `DEFAULT_OVER_DRAG_RESISTANCE_FACTOR = 2.5` (source: `src/components/bottomSheet/constants.ts`). That is `over / 2.5` — linear, no asymptote. **Use the 0.55 asymptotic form**; it is what iOS actually does and the difference is felt immediately at large drags.

### 3.3 Detent selection: velocity beats position

```ts
const VELOCITY_THRESHOLD = 500;   // px/s — the widely-used RN convention
const PROJECTION_DECEL    = 0.998; // iOS UIScrollView DecelerationRate.normal

// iOS's own "where would this have landed" projection
function project(position: number, velocity: number, decel = PROJECTION_DECEL) {
  'worklet';
  return position + (velocity * decel) / (1 - decel);   // == position + velocity * 499
}

function pickDetent(y: number, vy: number, detents: number[]) {
  'worklet';
  // A flick decides direction regardless of how far you actually dragged.
  const target = Math.abs(vy) > VELOCITY_THRESHOLD ? project(y, vy * 0.05) : y;
  return detents.reduce((a, b) => Math.abs(b - target) < Math.abs(a - target) ? b : a);
}
```

`decelerationRate` values, from Apple: **`.normal = 0.998`, `.fast = 0.99`.** With `.normal`, velocity after `k` seconds is `0.998^(1000k) · v₀`; the projection multiplier is `0.998 / (1 − 0.998) = 499`. gorhom scales its scrollable deceleration to `ios: 0.998, android: 0.985` — note Android is deliberately faster-stopping.

Reference numbers from gorhom's shipped iOS sheet (`src/constants.ts`) — a good sanity check that heavy overdamping is the professional choice:

```ts
default: {   // iOS
  damping: 500, stiffness: 1000, mass: 3,
  overshootClamping: true,
  restDisplacementThreshold: 10, restSpeedThreshold: 10,
},
android: { duration: 250, easing: Easing.out(Easing.exp) },
```
ζ = 500 / (2·√(1000·3)) = **4.56** — massively overdamped, *plus* `overshootClamping: true`. Response = 2π·√(3/1000) = **0.344 s**. The most-used sheet library in the RN ecosystem ships zero bounce and belt-and-braces clamping. That is not conservatism; that is what sheets feel like.

### 3.4 Swipe-to-confirm / slide-to-start

The physics that makes a slide-to-confirm feel like hardware rather than a toy:

| Parameter | Value | Why |
|---|---|---|
| Track travel | `trackWidth − knobWidth − 2·pad` | |
| Commit threshold | **0.75** of travel | 0.5 fires accidentally; 0.9 feels unreachable |
| Velocity override | `velocityX > 800 px/s` commits from ≥ 0.45 | rewards a confident flick |
| Follow phase | **1:1, no spring, no lag** | `x.value = clamp(start + e.translationX, 0, travel)` — any smoothing here reads as latency |
| Overdrag past 100 % | `rubberBand(x, travel, travel * 0.25, 0.55)` | tiny, ~10 px max |
| Snap-back (failed) | `SPRING.interactive` + `velocity: e.velocityX` | 1755/72 — must feel *rejected*, i.e. fast |
| Snap-forward (committed) | `withTiming(travel, { duration: 120, easing: EASE.accelerate })` | **timing, not spring** — a commit must not wobble |
| Knob press-down | `scale → 1.06`, `SPRING.press` (987/63) | |
| Haptics | `Selection` at 0.25/0.5/0.75; `Success` on commit; `Warning` on snap-back | |
| Label | `opacity: interpolate(progress, [0, 0.6], [1, 0])` | text clears before the knob reaches it |
| Shimmer hint | `translateX` sweep, 1800 ms, `Easing.linear`, `withRepeat(-1)`, **pauses on touch** | |
| Disable during commit | `.enabled(!committed)` | prevents double-fire |

```tsx
const x = useSharedValue(0);
const committed = useSharedValue(false);

const pan = Gesture.Pan()
  .onBegin(() => { cancelAnimation(x); start.value = x.value; })
  .onUpdate((e) => {
    const raw = start.value + e.translationX;
    x.value = raw > TRAVEL
      ? rubberBand(raw, TRAVEL, TRAVEL * 0.25)     // asymptotic, ~10px max
      : Math.max(0, raw);
  })
  .onEnd((e) => {
    const p = x.value / TRAVEL;
    const commit = p >= 0.75 || (p >= 0.45 && e.velocityX > 800);
    if (commit) {
      committed.value = true;
      x.value = withTiming(TRAVEL, { duration: 120, easing: EASE.accelerate });
      scheduleOnRN(onConfirm);
    } else {
      x.value = withSpring(0, { ...SPRING.interactive, velocity: e.velocityX });
      scheduleOnRN(Haptics.notificationAsync, Haptics.NotificationFeedbackType.Warning);
    }
  });
```

### 3.5 Press feedback

| Element | Down | Up | Spring | Duration |
|---|---|---|---|---|
| Primary CTA | `scale 0.97`, `opacity 1.0` | `scale 1.0` | `SPRING.press` (987/63) | ~350 ms settle |
| List row | `backgroundColor` → pressed | → base | `TIMING.fade` (200 ms **linear**) | 200 ms |
| Icon button | `scale 0.90` | `scale 1.0` | `SPRING.press` | |
| Map FAB | `scale 0.94` + shadow radius −2 | | `SPRING.press` | |

Scale-down must be **immediate** (`onPressIn` writes the shared value in the same frame). The spring is only for the release. `scale: 0.97` not `0.9` — Uber uses `timing200` for control state changes and RN scales about the *centre*, so a 0.9 on a full-width button is a very visible 10 % shrink.

Colour and opacity use **linear** easing, per Uber Base's comment on `easeLinear`: *"Moves at constant speed. Commonly used for opacity and color changes."*

---

## 4. React Native performance rules

### 4.1 What must run on the UI thread

Reanimated's docs: *"Worklet is a short-running JavaScript function that can be moved and executed across different Javascript Runtimes. Reanimated uses worklets to calculate view styles and react to events on the UI thread."*

| Must be on UI thread | Mechanism |
|---|---|
| All style interpolation | `useAnimatedStyle` (auto-workletized) |
| All gesture handlers | `Gesture.Pan().onUpdate()` etc. — auto-workletized |
| Scroll-linked motion | `useAnimatedScrollHandler` |
| Sheet↔camera coupling | `useAnimatedReaction` |
| Detent selection / rubber band / projection math | plain `'worklet'` functions |

| Must NOT be on UI thread | Why |
|---|---|
| Navigation calls | `scheduleOnRN(router.push, ...)` |
| Network / store writes | `scheduleOnRN(...)` |
| Haptics | `scheduleOnRN(Haptics.impactAsync, ...)` |
| Anything per-frame that crosses runtimes | it's a bridge hop per frame |

**Reading shared values from JS is a documented footgun:**

> "Reading shared values is allowed only from worklets running on the UI thread. You should avoid reading shared values in the React Native runtime on the JavaScript thread… When you read the `sv.value` in the React Native runtime, the JS thread will get blocked until the value is fetched from the UI thread."

So: `console.log(sv.value)` in a `useEffect` synchronously blocks the JS thread. Delete every one of them.

Also: **memoize frame callbacks.**
> "If you are using `useFrameCallback`, you should wrap the frame callback worklet inside `useCallback` in order to memoize it. This way, the frame callback won't need to be recreated and thus registered on every render."

### 4.2 What causes jank on mid-range Android / older iPhones

**Layout-affecting properties.** Reanimated's guide is explicit: `top/left/width/height/margin/padding` "requires an additional step of layout recalculation on each animation frame." Use `transform` + `opacity`. If you are animating `height` anywhere in the sheet, that is a bug.

**New Architecture regressions — these are real and documented by Software Mansion, with named fixes:**

| Symptom | Fix (from Reanimated's performance guide) |
|---|---|
| Flickering/jittering while scrolling with `useAnimatedScrollHandler` | RN ≥ 0.81 + `preventShadowTreeCommitExhaustion` RN feature flag + `DISABLE_COMMIT_PAUSING_MECHANISM` Reanimated static flag |
| Lower FPS while scrolling with many animated components | RN ≥ 0.80 + Reanimated ≥ 4.2.0 + `USE_COMMIT_HOOK_ONLY_FOR_REACT_COMMITS` |
| Low FPS with many simultaneous animations | `ANDROID_SYNCHRONOUSLY_UPDATE_UI_PROPS` (≥ 4.0.0) / `IOS_SYNCHRONOUSLY_UPDATE_UI_PROPS` (≥ 4.2.0) — *"enable a fast code path for applying updates of non-layout styles like `opacity` or `transform` via platform-specific mechanisms rather than cloning `ShadowNode` instances and calling `ShadowTree::commit`"* |

⚠️ Caveat quoted directly: *"these flags affect the touch detection system for components with animated transforms so you might want to consider using `Pressable` from `react-native-gesture-handler` instead of the built-in one from `react-native`."* If you enable the sync-props flags, migrate every `Pressable` on an animated-transform surface to RNGH's.

Software Mansion's own upgrade guidance: *"Reanimated 3 is no longer maintained and will not receive updates to support upcoming releases of React Native. Please upgrade to the latest version of Reanimated 4."* Reanimated 4 also gives you the correct spring defaults for free (§0).

**Other known jank sources, in rough order of cost on a mid-range Android:**
1. `BlurView` / `expo-blur` over animating content — the blur re-samples every frame. Budget **at most one** live blur surface; use a static semi-transparent fill (`rgba` + a pre-rendered gradient PNG) for the rest. A blurred sheet handle over a moving map is the single most expensive thing you can build.
2. Shadows on Android. RN only exposes `elevation` on Android (`shadowOffset/Opacity/Radius` are iOS-only per the RN docs), and third-party bitmap-blur shadow libs *"can make your app slower or significantly increase its memory consumption when used on many views."* Rule: **≤ 3 shadowed views on screen; never a shadow on a list item; never animate `shadowRadius`.**
3. Large `borderRadius` + `overflow: hidden` + transform — forces offscreen compositing.
4. Non-memoized `useAnimatedStyle` dependencies causing worklet re-registration each render.
5. `react-native-svg` animated paths — move to Skia or a pre-baked Lottie/frame sequence.

### 4.3 FlashList vs FlatList

Use **FlashList v2** for every list over ~15 items (ride options, trip history, chat, driver earnings, address results).

FlashList *"uses a cell recycling strategy instead of virtualization, working by keeping a fixed pool of component instances in memory, and reusing the same component with new data instead of destroying and re-creating it when an item scrolls out of view."* Reported figures from the ecosystem: unoptimized FlatList drops to **20–30 fps** during fast scrolling and tops out at **40–50 fps** even fully optimized, while FlashList holds **58–60 fps** on the same device; one widely-cited production migration reported JS-thread CPU dropping from **>90 % to <10 %**.

⚠️ Caveat: these are community/vendor numbers, not an independently reproduced benchmark. Treat the direction as solid and the exact multiples as marketing.

Also note Reanimated's performance guide has a dedicated section titled *"⚠️ Blink of incorrect layout of FlashList"* — if you combine FlashList with Reanimated layout animations, check that section before shipping.

Keep FlatList only where the list is short and static (a 4-row settings menu) — FlashList's recycling has a fixed setup cost that isn't worth it there.

### 4.4 When to use native-screens transitions instead of JS animation

**Always, for anything that is genuinely a screen.** Quoted above: native-stack *"uses the native APIs `UINavigationController` on iOS and `Fragment` on Android… resulting in smoother transitions and better performance."*

| Situation | Use |
|---|---|
| Push/pop a real screen | native-stack `animation: 'default'`. Zero JS involvement. |
| Modal / sheet-style screen | native-stack `presentation: 'formSheet'` + `sheetAllowedDetents: [0.35, 0.9]`. This is a **real `UISheetPresentationController`** — free rubber-banding, free velocity, free grabber, free scroll handoff, at zero JS cost. |
| Bottom sheet that must coexist with a persistent map | Reanimated + RNGH. `formSheet` can't do this because it darkens/blocks the content behind it. |
| Shared-element morph | Reanimated (`react-native-reanimated`'s shared element transitions, or manual measure + absolute overlay). |
| Anything driven by a finger | Reanimated + RNGH. |

`sheetAllowedDetents` accepts fractions (`[0.25, 0.75]`), must be ascending, and **"On Android, only up to 3 detents are supported — any additional values are ignored."** Design for 3.

Also set `freezeOnBlur: true` — *"Boolean indicating whether to prevent inactive screens from re-rendering"* — or call `enableFreeze()` from `react-native-screens` at app entry, which flips the default to `true`. With a persistent map this matters a lot: without it, every off-screen route keeps re-rendering behind the one you're looking at.

### 4.5 Reduced motion

Apple's HIG: make animations optional; when Reduce Motion is enabled, minimize or eliminate app animations. Uber Base's own rule is concrete: **a 100 ms crossfade replaces a drill transition when reduced-motion is enabled.**

Reanimated has this built in — every animation config takes `reduceMotion: ReduceMotion.System` (the default). For anything you construct manually, fall back to `TIMING.reduced` (100 ms, linear). Do **not** set duration to 0: an instant swap is disorienting; a 100 ms crossfade is not.

---

## 5. Migration checklist for this codebase

1. **Add `src/design/motion.ts`** (§1.5) and an ESLint rule banning bare `withSpring(x)` / `withTiming(x)` with no config.
2. **Grep for `withSpring(` with a single argument.** Every hit is a 16.3 %-overshoot bug. Replace with `spring(x, 'standard')`.
3. **Grep for animated `height` / `width` / `top` / `left`.** Convert to `transform`.
4. **Delete the green orb.** Replace with the three-layer search state (§2.6).
5. **Hoist the `MapView` and the sheet container into `app/_layout.tsx`** as siblings of `<Slot/>`; make `(trip)` routes state-only with `animation: 'none'` (§2.1).
6. **Collapse sheet + camera onto one shared value** (§2.2).
7. **Add `velocity: e.velocityY` to every gesture-terminating `withSpring`** and `cancelAnimation()` to every `onBegin` (§3.1).
8. **Swap the linear over-drag divisor for the 0.55 asymptotic rubber band** (§3.2).
9. **Set `animationDuration` explicitly on every camera command** — the RN map libraries default to 2000 ms (§1.7).
10. **Set `freezeOnBlur: true`** / call `enableFreeze()`.
11. **Audit blur and shadow counts** — ≤ 1 live blur, ≤ 3 shadows on screen (§4.2).
12. **Plan the Reanimated 4 upgrade** — it fixes the defaults and unlocks the sync-UI-props feature flags.

---

## 6. Sources

**Apple (primary — all values quoted from the live documentation JSON):**
- [`Animation.default`](https://developer.apple.com/documentation/swiftui/animation/default) — the `spring(0.55, 1.0, 0.0)` finding
- [`Animation.easeInOut`](https://developer.apple.com/documentation/swiftui/animation/easeinout) / `easeIn` / `easeOut` / `linear` — the 0.35 s default duration
- [`UnitCurve.easeInOut`](https://developer.apple.com/documentation/swiftui/unitcurve/easeinout) / `easeIn` / `easeOut` — exact bezier control points
- [`Animation.spring(response:dampingFraction:blendDuration:)`](https://developer.apple.com/documentation/swiftui/animation/spring(response:dampingfraction:blendduration:)) — defaults + velocity preservation
- [`Animation.interactiveSpring(...)`](https://developer.apple.com/documentation/swiftui/animation/interactivespring(response:dampingfraction:blendduration:)) — response 0.15 / ζ 0.86 / blend 0.25
- [`Animation.smooth`/`snappy`/`bouncy`](https://developer.apple.com/documentation/swiftui/animation/snappy(duration:extrabounce:)) — base bounce 0 / 0.15 / 0.3, duration 0.5
- [`Spring.bounce`](https://developer.apple.com/documentation/swiftui/spring/bounce), [`Spring.dampingRatio`](https://developer.apple.com/documentation/swiftui/spring/dampingratio), [`Spring.mass`](https://developer.apple.com/documentation/swiftui/spring/mass), [`Spring.settlingDuration`](https://developer.apple.com/documentation/swiftui/spring/settlingduration)
- [HIG — Motion](https://developer.apple.com/design/human-interface-guidelines/motion) — reduce-motion and "avoid gratuitous motion" guidance
- [`UIScrollView.DecelerationRate`](https://developer.apple.com/documentation/uikit/uiscrollview/decelerationrate) — 0.998 / 0.99
- [`CAMediaTimingFunction`](https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/Animation_Types_Timing/Articles/Timing.html) — bezier endpoint convention

**Uber (primary — MIT-licensed source):**
- [`uber/baseweb` `src/themes/shared/animation.ts`](https://github.com/uber/baseweb/blob/main/src/themes/shared/animation.ts) — full token set with Uber's own comments
- `uber/baseweb` `src/{modal,drawer,checkbox,button,spinner}/styled-components.ts` — duration↔curve pairings
- [Base design system — Timing](https://base.uber.com/6d2425e9f/p/77fcaf-timing) / [Motion](https://base.uber.com/6d2425e9f/v/0/p/116184-motion) — quintic-easing rationale, 100 ms reduced-motion crossfade

**Reanimated / React Navigation / ecosystem:**
- [Reanimated 4.x `withSpring`](https://docs.swmansion.com/react-native-reanimated/docs/animations/withSpring/) — damping 120 / stiffness 900 / duration 550 / dampingRatio 1
- [Reanimated 3.x `withSpring`](https://docs.swmansion.com/react-native-reanimated/docs/3.x/animations/withSpring/) — mass 1 / damping 10 / stiffness 100, duration 2000 / dampingRatio 0.5
- [Reanimated `withTiming`](https://docs.swmansion.com/react-native-reanimated/docs/animations/withTiming/) — duration 300, `Easing.inOut(Easing.quad)`
- [Reanimated Performance guide](https://docs.swmansion.com/react-native-reanimated/docs/guides/performance/) — New-Arch feature flags, non-layout-property rule, shared-value-read warning
- [Reanimated Worklets guide](https://docs.swmansion.com/react-native-reanimated/docs/guides/worklets/)
- [React Navigation — Native Stack Navigator](https://reactnavigation.org/docs/native-stack-navigator/) — 350 ms default, non-customizable system transitions, `sheetAllowedDetents`, `freezeOnBlur`
- [`gorhom/react-native-bottom-sheet` `src/constants.ts`](https://github.com/gorhom/react-native-bottom-sheet/blob/master/src/constants.ts) — the shipped iOS spring, Android timing, deceleration rates
- [`mapbox/mapbox-gl-js` `src/ui/camera.ts` + `src/util/util.ts`](https://github.com/mapbox/mapbox-gl-js) — `easeTo` 500 ms, `ease = bezier(0.25, 0.1, 0.25, 1)`, `flyTo` curve 1.42 / speed 1.2
- [Shopify FlashList](https://shopify.github.io/flash-list/docs/) — v2 / New Architecture
- [Bolt — Building a cross-platform design system](https://bolt.eu/en/blog/building-a-cross-platform-design-system/) — token-layer confirmation only, no numbers published
- [UIScrollView deceleration mechanics — Ilya Lobanov](https://medium.com/@esskeetit/scrolling-mechanics-of-uiscrollview-142adee1142c) and [How UIScrollView works](https://medium.com/@esskeetit/how-uiscrollview-works-e418adc47060) — rubber-band constant 0.55, `f(x,d,c) = (x·d·c)/(d + c·x)`
- [Callstack — How to Achieve 60FPS Animations in React Native](https://www.callstack.com/blog/60fps-animations-in-react-native)
- [SwiftUI animation timing — Natalia Panferova](https://nilcoalescing.com/blog/AnimationTimingInSwiftUI/) — corroborates Apple's bezier control points and spring preset semantics

**Explicitly not sourced:** Yango/Yandex Go and Bolt publish no motion specifications. All §2 choreography and the §2.6 loading-state spec are labelled INFERRED and are derived from observable behaviour plus the Apple/Uber primitives above — but every one is stated with implementable numbers so it can be built and judged on device.
