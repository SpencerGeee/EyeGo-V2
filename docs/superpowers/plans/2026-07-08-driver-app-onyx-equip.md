# Driver App Onyx Equip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development or superpowers:executing-plans to work this task-by-task. `- [ ]` = tracked step. This plan is intentionally sequenced as phases even though the user approved "all screens, one pass" — phases exist to de-risk the foundation before touching 34 screens, not to gate delivery.

**Goal:** Bring `apps/driver` up to the same visual/motion/architecture standard as the redesigned `apps/rider` — same `@eyego/ui` primitives (GlassSurface, AppBackground, Entrance/AnimatedList, morph system, panel system, glow/premium effects) — with an **electric blue** theme instead of rider's green, so the driver app is ready for native build + end-to-end booking-flow testing.

**Non-goals:** Do not change rider code except where a component needs a prop/generalization to serve both apps, or where Phase M (below) requires migrating rider's map layer. Do not stand up EAS build config (separate task once Phase 0 lands).

**Amendment 2026-07-08 (map system):** Originally scoped as a non-goal ("keep MapLibre, don't unify with rider's react-native-maps"). User overrode this after a cost/architecture review — see Phase M. Both apps will standardize on MapLibre v11 + OpenFreeMap (free/keyless on both platforms), including a 3D tilted nav-style camera for the driver's active-trip screen (Uber/Bolt/Yango-style). This is real scope, not a small addition — see Phase M for the full breakdown.

---

## Current State (verified 2026-07-08)

- **apps/driver** already runs expo-router (same route-group structure as rider), Reanimated 4.1, Moti, NativeWind, Zustand, React 19 — **not legacy**, just missing the newer effects/animation deps rider picked up during its redesign.
- **apps/driver imports `@eyego/ui` in 40 files but shallow**: only `Text`(40), `Button`(21), `EmptyState`(2), `Skeleton`(1), `Avatar`(1). Missing the whole surface/motion/effects layer rider now leans on: `GlassSurface`(14), `AppBackground`(9), `useMorph`(7), `Entrance`(7), `GradientGlowBorder`(6), `AnimatedFareText`(5), `GlowSearchInput`(3), `Input`(3), `Radio`(2), plus `panel/InlayPanel`, `panel/PanelSheet`, `animations/AnimatedList`, `animations/StaggerList`.
- **34 driver screens** across `(auth)`, `(onboarding)`, `(tabs)`, `(trip)`, `(profile)` — styled with a StyleSheet/NativeWind mix and hardcoded hex, not fully token-driven.
- **Blue tokens already exist, duplicated**: `packages/config/src/tokens.ts:147-185` (`driverColors`) and `apps/driver/utils/useColors.ts:36-67` (identical values, plus a `driverLightColors` variant and a `useColors()` hook keyed to `driver.store`'s `theme`). User approved consolidating to one source (`packages/config`).
- **No literal "green video" to re-tint.** Rider's hero background (`packages/ui/src/effects/AppBackground.tsx`) is a themed Reanimated/SVG blob field + Skia `LightPillarBackground` shader, driven by `useThemedColors()` → `ColorsContext`. Any consumer that doesn't wrap a `ColorsProvider` (driver, today) silently falls back to rider's green `colors` object (`ColorsContext.tsx:7-14`). Wiring driver's own `ColorsProvider` with `driverColors` makes the same component render blue automatically — no shader/video asset work needed.
- **Design source**: `design system v3/` has 26 rider-only mockups + `eyego_onyx/DESIGN.md` (the "Midnight Tech-Luxury" spec — dark glassmorphism, Geist + JetBrains Mono type, tight kerning, service-tier color coding). No driver mockups exist in v3. `design system v2/` has 5 driver-specific mockups (`driver_home_offline`, `driver_wallet_earnings`, `driver_management`, `new_trip_request`, `live_tracking`, `boarding_verification`, `choose_your_seat`, `active_trip_seat_map`) — use these for **layout/content structure only**, not visual style (v2 predates the Onyx system).
- **Dependency gap** (rider has, driver missing): `@shopify/react-native-skia`, `expo-linear-gradient`, `lottie-react-native`, `react-native-keyboard-controller`, `@react-navigation/native`, `@react-native-masked-view/masked-view`, `expo-clipboard`, `expo-battery`, `expo-localization`, `expo-sharing`, `expo-web-browser`. `expo-apple-authentication` is rider-only (Apple Sign In) — skip, driver auth is phone/OTP only.
- **Bug spotted in passing**: `apps/driver/package.json:43` pins `expo-location: "^55.1.10"` — inconsistent with every other Expo-SDK-54-pinned package (rider uses `~19.0.8`). Fix during Phase 0 dep pass.

## Flagged decisions (proceeding with the recommended default — flag if you want otherwise)

1. **Typography**: driver currently loads Inter + Space Grotesk; rider (and the Onyx spec) use Geist + JetBrains Mono. Recommendation: **switch driver to Geist + JetBrains Mono** for true visual consistency ("same components, uniform" was explicit). Proceeding on this basis. **DONE.**
2. **Light mode**: `driverLightColors` exists but rider's `ColorsContext` has no light-mode consumer today (rider is dark-only). Recommendation: **carry `driverLightColors` forward as-is but don't wire a light/dark toggle UI** unless one already exists in driver settings — keep scope to dark-mode parity with rider first.
3. ~~Map chrome: keep MapLibre, don't unify with rider.~~ **Superseded — see Phase M.**
4. **Sequencing rider's map swap**: Phase M migrates driver fully (driver needs a native rebuild anyway and isn't the app currently being tested on-device). Rider's swap from `react-native-maps` → MapLibre v11 is scoped in Phase M but should land as its own verified pass rather than in the same sweep as driver — rider is the app currently confirmed working on the user's phone; a map-engine swap there is exactly the kind of change that needs its own build+test cycle, not a drive-by edit alongside 34 unrelated driver screens. Flagging this call rather than asking again — say so if you want it done together instead.

---

## Phase M — Map Engine Unification (MapLibre v11) + 3D Active-Trip Camera

**Why this exists:** originally scoped as a non-goal (see Amendment above). Investigation surfaced a real tradeoff: rider runs `react-native-maps` (Fabric-safe, but Android needs a Google Maps API key + Cloud Billing account — and rider currently has **no key configured, so rider's Android maps are likely rendering blank tiles right now**, a pre-existing bug this migration incidentally fixes). Driver runs `@maplibre/maplibre-react-native` v9 + OpenFreeMap (free/keyless everywhere, but v9 predates Fabric/new-architecture support — the exact crash class that made rider abandon MapLibre originally, and both apps run `newArchEnabled:true`). User chose: upgrade both to MapLibre v11 (first release that is new-architecture-only — a clean match, not a compromise) + OpenFreeMap. Verified 11.3.2 is current (released April 2026).

### M.1 — v11 API surface (verified via official migration guide, 2026-07-08)

| Old (v9, current driver code) | New (v11) |
|---|---|
| `MapView` | `Map` (Android now defaults to `GLSurfaceView`; `androidView="texture"` to opt back to old default) |
| `centerCoordinate` | `center` |
| `zoomLevel` | `zoom` |
| `heading` (Camera) | `bearing` |
| `animationDuration` | `duration` |
| `animationMode="flyTo"/"linearTo"/"easeTo"` | `easing="fly"/"linear"/"ease"` (undefined = instant) |
| `followUserLocation` + `followUserMode` + `followZoomLevel/Heading/Pitch` | unified `trackUserLocation="default"\|"heading"\|"course"` + plain `zoom`/`bearing`/`pitch` props. **`"course"` is the one that matters for the nav camera** — it rotates the camera to match direction of travel, not device compass. |
| `Camera.setCamera()` | `Camera.setStop()` (imperative ref) |
| `PointAnnotation`/`MarkerView` + `coordinate` | `ViewAnnotation` + `lngLat` |
| `ShapeSource` + `LineLayer`/`CircleLayer`/`FillLayer` (separate components) | `ShapeSource` (mostly unchanged) + single `Layer` component with `type="line"/"circle"/"fill"` prop; style via `paint`/`layout` (kebab-case, style-spec compliant) instead of `style` (deprecated, still works until v12) |
| `sourceID`/`belowLayerID`/`aboveLayerID`/`minZoomLevel`/`maxZoomLevel` (Layer) | `source`/`beforeId`/`afterId`/`minzoom`/`maxzoom` |
| `scrollEnabled`/`zoomEnabled`/`rotateEnabled`/`pitchEnabled` (Map) | `dragPan`/`touchZoom`/`touchRotate`/`touchPitch` |
| `contentInset={[t,r,b,l]}` | `contentInset={{ top, right, bottom, left }}` |
| `requestAndroidPermissions()` | `LocationManager.requestPermissions()` |
| Custom headers: `addCustomHeader()` | `TransformRequestManager.addHeader({ id, name, value })` |

Not usable in Expo Go (native module) — needs a dev-client/EAS build, which the plan already requires from Task 0.4. Requires the config plugin: `"plugins": ["@maplibre/maplibre-react-native"]` in `app.json`/`app.config.js` (installs the CocoaPods post_install hook on iOS; Android autolinks). **Neither driver's nor rider's app.json currently registers this plugin** — add it as part of this phase.

### M.2 — Shared adapter package

**Files:**
- Create: `packages/maps/src/index.tsx` — wraps real `@maplibre/maplibre-react-native` v11 primitives (`Map`, `Camera`, `ViewAnnotation`, `ShapeSource`, `Layer`, `UserLocation`, `LocationManager`) behind the **same Mapbox-style component names/props both apps' screens already call** (`MapView`, `Camera` with `centerCoordinate`/`zoomLevel`/`heading`, `MarkerView`/`PointAnnotation` with `coordinate`, `ShapeSource`+`LineLayer` with `style.lineColor`) — this is a deliberate choice to avoid rewriting every consumer screen's JSX; only the shim's internals change from "translate to react-native-maps" (driver's old `utils/mapbox.ts`) or "be react-native-maps directly" (rider's `utils/mapbox.ts`) to "translate to real MapLibre v11."
- New export: `NavCamera` — the 3D active-trip follow camera (see M.3).
- This package becomes the **single source of truth** for map behavior in both apps — literally addresses "map system used in rider app is the same as driver app."

- [x] Step 1: Added `@maplibre/maplibre-react-native` as a peer dep of `packages/maps`; apps depend on `@eyego/maps` + the real `@maplibre/maplibre-react-native@^11.3.2` directly (bumped in both driver's and the root `package.json`, since the root pin was the repo-wide hoisting anchor at v9).
- [x] Step 2: Built the adapter — `MapView`, `Camera` (imperative `setCamera`/`fitBounds` matching the OLD signature consumers already call), `MarkerView`/`PointAnnotation`, `AnimatedMarkerView` (JS-rAF glide — v11's `ViewAnnotation` position isn't natively animatable like `react-native-maps`' `AnimatedRegion`, documented as a known perf tradeoff in the file), `ShapeSource`/`LineLayer` (now REAL vector rendering via native `Layer`, not the old `Polyline`-emulation hack the react-native-maps-backed adapters needed), `UserLocation`.
- [x] Step 3: Added `NavCamera` (M.3).
- [x] Step 4: Added fallback path (`MapAvailable` flag + `buildFallback()`) — last-resort plain-view placeholder if the native module fails to load, matching both apps' existing pattern.

### M.3 — 3D active-trip nav camera (Uber/Bolt/Yango-style)

The actual new feature requested, not just infra. When a driver's trip status becomes active/en-route, the camera should behave like turn-by-turn nav apps: tilted (pitched), rotated to match direction of travel, tightly zoomed, positioned so the road ahead is visible.

```tsx
// packages/maps/src/NavCamera.tsx
export function NavCamera({ active, pitch = 55, zoom = 17.5, duration = 800 }: {
  active: boolean;   // true once trip status is 'active'/'en_route'
  pitch?: number;
  zoom?: number;
  duration?: number;
}) {
  return (
    <Camera
      trackUserLocation={active ? 'course' : 'default'}  // 'course' = rotate to travel heading, not compass
      pitch={active ? pitch : 0}
      zoom={active ? zoom : 14}
      duration={duration}
      easing="ease"
    />
  );
}
```

- [x] Step 1: Built `NavCamera` in the shared adapter.
- [x] Step 2: Wired in — `(trip)/active/[id].tsx` swaps its `MapboxGL.Camera` for `MapboxGL.NavCamera`, active when `trip.status` is `DRIVER_EN_ROUTE`/`IN_PROGRESS`. `(trip)/tracking/[id].tsx` keeps its existing imperative `cameraRef`-driven follow effect (it already had one, plus route-target logic this reuses) and enriches the same `setCamera()` call with `heading` (via a new `bearingBetween()` great-circle helper) + `pitch: 55` + tighter `zoom: 17.5` while driving — less invasive than swapping the whole component, since that ref is the file's single camera-follow mechanism already.
- [x] Step 3: `expo-location` was already a driver dependency with foreground permission already requested elsewhere — `trackUserLocation="course"` needs no additional sensor wiring.

### M.4 — Driver migration (this phase's actual code changes)

**Files — all done:**
- `apps/driver/package.json` — bumped `@maplibre/maplibre-react-native` to `^11.3.2`, added `@eyego/maps`. Kept `react-native-maps` — `DemandOverlay.tsx` still imports `Circle`/`Polygon` from it directly (see below), not safe to drop yet.
- `package.json` (root) — bumped the same dep (it's the repo-wide hoisting anchor, was pinned at `^9.0.0`).
- `apps/driver/app.json` — added `"@maplibre/maplibre-react-native"` to `plugins`.
- `apps/driver/app.config.js` — removed the now-dead Google Maps API key conditional block.
- `apps/driver/utils/mapbox.ts` — now a thin re-export of `@eyego/maps`.
- `apps/driver/app/(trip)/active/[id].tsx`, `(trip)/tracking/[id].tsx` — adopted the 3D nav camera per M.3.
- Typechecks clean (`tsc --noEmit` on `apps/driver`) after each step.

**Not done — flagged, separate follow-up:**
- `apps/driver/components/DemandOverlay.tsx` imports `Circle`/`Polygon` directly from `react-native-maps`, assuming a `react-native-maps` `MapView` parent — it does NOT go through the `MapboxGL`/`@eyego/maps` adapter at all. Since driver's real native build path never actually used `react-native-maps` as the mounted map (v9 MapLibre loaded directly when not Expo Go), this component was likely already non-functional in production before this migration, not something this migration broke. Needs its own rewrite onto `@eyego/maps`' `Layer type="circle"`/`type="fill"` — not attempted here, flagging rather than guessing at a fix for a component whose current working state is unconfirmed.
- **This migration cannot be verified beyond typecheck** — `@maplibre/maplibre-react-native` v11 is a native module; the Podfile/Gradle changes from the config plugin and actual map rendering only surface in a real dev-client/EAS build, which hasn't happened yet. Treat this as implemented-but-unverified until that build runs.

**Correction after reading the actual installed v11 package source (not just the migration-guide docs):** the migration guide's own examples were slightly incomplete — there is no `ShapeSource` export at all; the real GeoJSON source component is `GeoJSONSource` with a `data` prop (accepts an object, JSON.stringifies internally). It auto-injects a `source` prop into its children via `cloneReactChildrenWithProps`, so `Layer`/our `LineLayer` wrapper never needs manual source-id plumbing — simpler than first designed. Also, `ViewAnnotation`'s `anchor` is a string enum (`'center'`, `'top-left'`, etc.), not an `{x,y}` fraction like `react-native-maps`' marker anchor — the adapter's `MarkerView`/`AnimatedMarkerView` were corrected to pass it through as-is rather than converting a tuple. `Camera`'s `setStop()` ref method and declarative `center`/`zoom`/`bearing`/`pitch`/`duration`/`easing`/`trackUserLocation` props were verified correct as originally designed. This is the kind of gap that's invisible from documentation alone — worth remembering that MapLibre's own migration guide is not a complete API reference.

### M.5 — Rider migration (deferred, own pass — see flagged decision #4)

- Swap `apps/rider/utils/mapbox.ts` from its `react-native-maps` adapter to `@eyego/maps` (same shared package).
- Rewire `apps/rider/components/trip/TripMap.tsx` and `useTripCamera.ts` — these are mid-flight from the Fluid UI Overhaul project (see memory `project_fluid_ui_overhaul.md`, P3a done, P3b in progress) — coordinate with that work rather than colliding with it.
- This also fixes rider's currently-blank Android maps (no Google Maps key configured) as a side effect.
- **Do not start this until Phase M lands cleanly on driver and gets a real native-build test pass.**

---

## Phase 0 — Foundation (blocks everything else)

### Task 0.1: Consolidate driver color tokens into `@eyego/config`

**Files:**
- Modify: `packages/config/src/tokens.ts` — add `driverLightColors` (currently only in `apps/driver/utils/useColors.ts:69-100`) next to existing `driverColors`, export a `DriverColorTokens` type.
- Modify: `apps/driver/utils/useColors.ts` — delete the inline palettes, re-export from `@eyego/config`, keep only the `useColors()` hook (theme-store lookup) as the app-local piece.
- Export `driverColors`/`driverLightColors`/`DriverColorTokens` from `packages/config`'s index if not already re-exported.

- [ ] Step 1: Move `driverLightColors` into `tokens.ts`, add type export.
- [ ] Step 2: Slim `apps/driver/utils/useColors.ts` to import + re-export + hook only.
- [ ] Step 3: Verify no other file references the deleted inline copies (`grep driverColors apps/driver`).
- [ ] Step 4: Commit.

### Task 0.2: Wire `ColorsProvider` in driver root layout

**Files:**
- Modify: `apps/driver/app/_layout.tsx` — wrap the tree in `packages/ui`'s `ColorsProvider` with `driverColors` (mirror however rider's `_layout.tsx` does it, but confirm rider's actual wiring first since `ColorsContext.tsx`'s own comment says driver is "unchanged" today — that comment goes stale the moment this task lands).
- This single change is what flips `AppBackground`, `GlassSurface`, `GradientGlowBorder`, `GlowSearchInput`, etc. from green to blue app-wide with zero per-component edits.

- [ ] Step 1: Read rider's `_layout.tsx` ColorsProvider wiring as the pattern to mirror.
- [ ] Step 2: Add `ColorsProvider value={driverColors}` around driver's root stack.
- [ ] Step 3: Manually sanity-check one screen (home) renders blue ambient background, not green.
- [ ] Step 4: Commit.

### Task 0.3: Font swap — Geist + JetBrains Mono

**Files:**
- Modify: `apps/driver/package.json` — swap `@expo-google-fonts/inter` + `@expo-google-fonts/space-grotesk` for `@expo-google-fonts/geist` + `@expo-google-fonts/jetbrains-mono`.
- Modify: wherever driver loads fonts (likely `app/_layout.tsx` `useFonts`) — mirror rider's font-loading call exactly.
- Grep driver for any hardcoded `fontFamily: 'Inter'` / `'SpaceGrotesk'` usages and swap.

- [ ] Step 1: Update package.json deps, install.
- [ ] Step 2: Update font loading in root layout.
- [ ] Step 3: Sweep hardcoded font-family references.
- [ ] Step 4: Commit.

### Task 0.4: Dependency parity pass

**Files:**
- Modify: `apps/driver/package.json` — add `@shopify/react-native-skia`, `expo-linear-gradient`, `lottie-react-native`, `react-native-keyboard-controller`, `@react-navigation/native`, `@react-native-masked-view/masked-view`, `expo-clipboard`, `expo-battery`, `expo-localization`, `expo-sharing`, `expo-web-browser`. Fix `expo-location` version to match rider's `~19.0.8`.
- These are native modules — **this task is what triggers the "driver needs a new native build" requirement** the user already anticipated. Flag clearly when done: JS-only reload will not pick these up.

- [ ] Step 1: Add/fix deps at rider's exact pinned versions.
- [ ] Step 2: Install, run `expo-doctor` or equivalent config check.
- [ ] Step 3: Note in handoff: driver needs `eas build --profile development` (or local prebuild) before Phase 3 (trip flow / Skia-heavy screens) can be tested on-device.
- [ ] Step 4: Commit.

---

## Phase 1 — Auth + Onboarding (small surface, validates the approach)

| Driver screen | Reference | Key components |
|---|---|---|
| `(onboarding)/index.tsx` | v3 `splash_eyego_rider`, `onboarding_eyego_rider` | `AppBackground`, `Entrance` |
| `(auth)/phone.tsx` | v2 `sign_in` / v3 onboarding phone step | `Input`, `Button`, `AppBackground` |
| `(auth)/otp.tsx` | v3 `otp_verification_eyego_rider` | `OTPInput` (packages/ui, direct reuse) |
| `(auth)/register.tsx` | v3 `profile_setup_eyego_rider_refined` | `Input`, `Avatar`, `StepIndicator` (existing driver component, restyle to tokens) |
| `(auth)/_layout.tsx` | — | ensure `AppBackground` mounted once, not per-screen |

- [ ] Rebuild each screen against its reference using token-driven styling (`useThemedColors()`, no hardcoded hex).
- [ ] Commit per screen or small batch.

## Phase 2 — Tabs (daily-driver surface)

| Driver screen | Reference | Key components |
|---|---|---|
| `(tabs)/home.tsx` | rider `home.tsx` (post-redesign) + v2 `driver_home_offline` for layout | `AppBackground`, `GlassSurface`, `OnlineToggle` (existing, restyle), `RollingDigits`, `Entrance` |
| `(tabs)/earnings.tsx` | v2 `driver_wallet_earnings` + rider `profile/wallet.tsx` | `AnimatedFareText`, `RollingDigits`, `GlassCard`, `EarningsChart` (existing, restyle) |
| `(tabs)/trips.tsx` | rider `trips.tsx` | `AnimatedList`, `RideCard`/`TripCard`, `EmptyState`, `Skeleton` |
| `(tabs)/quests.tsx` | v2 `driver_management` | `QuestCard` (existing, restyle) |
| `(tabs)/notifications.tsx` | generic list pattern | `AnimatedList`, `Card`, `EmptyState` |
| `(tabs)/profile.tsx` | v3 `my_profile_eyego_rider` | `DriverInfoCard` (existing), `Avatar` |
| `(tabs)/_layout.tsx` | rider tab bar | match blur/icon treatment |

## Phase 3 — Trip flow (the booking-flow-testing critical path)

| Driver screen | Reference | Key components |
|---|---|---|
| `create.tsx` | v2 `new_trip_request` | `InlayPanel` |
| `dispatch/[id].tsx` | v2 `live_tracking`, v3 `available_trips_eyego_rider` | `MorphSource`/`MorphTarget`, countdown via `RollingDigits` |
| `active/[id].tsx` | rider `ride/[id]/tracking.tsx` (UX pattern only — MapLibre not Mapbox), v3 `live_ride_detail_eyego_rider` | `InlayPanel`, `PulseRing` |
| `tracking/[id].tsx` | rider tracking pattern | `InlayPanel` |
| `add-passenger.tsx` | v2 `add_offline_passenger` | `Input`, `SeatBadge` |
| `chat/[id].tsx` | v3 `in_ride_chat_eyego_rider` (rider chat already shipped — direct pattern source) | mirror rider's chat component |
| `complete/[id].tsx` | v3 `trip_complete_eyego_rider`, v2 `trip_summary` | `AnimatedCheckmark`, `AnimatedFareText`, `RollingDigits` |
| `cancel/[id].tsx` | v3 `cancel_ride_eyego_rider_refined` | `Button`, `Card` |
| `rate-passengers/[id].tsx` | v3 `rate_driver_eyego_rider` (mirrored) | `Avatar`, `Radio` |
| `report/[id].tsx` | v3 `dispute_report_eyego_rider` (rider dispute already shipped — direct pattern source) | mirror rider's dispute component |
| `detail/[id].tsx` | v3 `live_ride_detail_eyego_rider` / v2 `trip_summary` | `Card`, `SeatMap` (existing) |

Morph transitions (dispatch → active, active → complete) should use `packages/ui/src/morph` (`MorphProvider`/`MorphSource`/`MorphTarget`/`MorphBackSwipeDetector`) the same way rider's ride flow does — check rider's `ride/request.tsx` → `ride/select.tsx` → `ride/[id]/tracking.tsx` chain as the concrete pattern before implementing.

## Phase 4 — Profile subpages (10 screens, lower complexity, batchable)

`edit.tsx` (near 1:1 with rider's `profile/edit.tsx`), `safety.tsx` (mirrors `safety_eyego_rider`), `account-deletion.tsx` (mirrors `account_deletion_eyego_rider`), `settings.tsx` (mirrors `notification_preferences_eyego_rider` + `Toggle` rows), `ratings.tsx` (mirrors `activity_history_eyego_rider`), `payout-account.tsx` (adapt `add_payment_card_eyego_rider`/`wallet_eyego_rider` for payout instead of payment-in), `vehicle.tsx` + `documents.tsx` + `performance.tsx` (driver-only, no rider mockup — compose from `Card`/`Input`/`Button`/`StatusBadge` following Onyx spacing/type rules), `privacy.tsx` + `terms.tsx` + `help.tsx` (low-effort static/list screens, `Card`/`Text`/`EmptyState`).

## Phase 5 — Polish + verification

- [ ] Motion-contract check: all new transitions respect `animation.premiumSpring`/`premiumEase` from `tokens.ts` (≤200ms micro-interactions, ≤350ms full-screen reveals).
- [ ] Performance-tier check: `AppBackground`/`LightPillarBackground` degrade correctly on low-tier devices via `usePerformanceTier()` (already generic, should just work once wired).
- [ ] Visual QA pass: driver screens side-by-side with rider equivalents — same corner radii, spacing scale, glass treatment, only the hue differs.
- [ ] EAS dev-client build for driver (new native deps from Task 0.4 require it) — this is the point where on-device booking-flow testing becomes possible.

---

## Acceptance criteria

- No hardcoded hex colors remain in touched driver screens — all pull from `useThemedColors()`/`driverColors`.
- `apps/driver` background/glass/motion primitives are visually blue, not green, with zero manual per-screen tinting (proven by Task 0.2 alone).
- Driver screen count, route structure unchanged (34 screens, same route groups) — this is a re-skin/re-architect pass, not a navigation rewrite.
- Trip flow (Phase 3) is testable end-to-end on a native dev-client build.
