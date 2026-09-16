# State — 2026-09-16

## Current Goal
8-item device report (2026-09-16). ALL ITEMS ADDRESSED IN CODE. Both apps tsc green,
maps tests 34/34, conditional-hooks + button-wiring static suites green. NOT device-tested.
Harness 466/466. NOT committed.

## What changed per item
1. Where-to morph BACK laggy: `morphBack(nav, { popAfterFlight: true })` (MorphProvider). For the
   transparentModal trip surface the pop is the cost (MapLibre + Skia teardown on the UI thread),
   so the reverse flight now runs FIRST over a live home, and `goBack()` fires only after the
   clone lands. `morphSurfaceHidden` (module-level shared value) drives `opacity: 1 - v` on
   trip.tsx's root; reset in `morphTo` and on trip mount. Only SearchStage opts in.
2. "Rendered more hooks…" after publishing a trip: two `React.useEffect`s in
   `(trip)/active/[id].tsx` sat BELOW the `if (isLoading || !trip) return` skeleton (6e774ea).
   Hoisted above it. `scripts/e2e/conditional-hooks.mjs` catches exactly this — run it before push.
3/5. Rider "backend not connecting" / dashes: `apps/rider/app/_layout.tsx` called
   `resolveApiUrl()` which fell through to `http://localhost:5020/v1` when nothing was stored and
   OVERWROTE the base URL @eyego/api had resolved (Metro host in dev, EXPO_PUBLIC_API_URL in a
   sideload). Driver never had that override. Now only a SecureStore-saved URL overrides.
   `resolveApiUrl` deleted. Note: `eyego-api/.env` PORT=5020 but dev clients default to :3000
   (`EXPO_PUBLIC_API_PORT` unset) — set it or run the API on 3000 when using Metro.
4. Keyboard: `PanelSheet` now pads its body by the keyboard height (RN `Keyboard` events; the
   measured contentH grows → existing expanded-snap spring lifts the sheet). Input-bearing
   `ScrollView`s → `KeyboardAwareScrollView bottomOffset={24}` in: driver safety,
   account-deletion, rate-passengers; rider account-deletion, emergency-contacts, wallet,
   guest-selection. Driver help ticket-thread Modal wrapped in `KeyboardAvoidingView`.
6. Rider profile: `bounces={false}` + `overScrollMode="never"` removed.
7. Driver map feel: `useMapCamera` tick sent `setCamera({animationDuration:0})` EVERY FRAME even
   for a parked vehicle (cancels flings/pitch settles/first drag frames) and republished the same
   puck every 400ms. Now deduped via `setCameraKey(plan)`; auto-resume and recenter glide
   (`RESUME_GLIDE_MS` 600) instead of snapping.
8. Nav app: settings wrote `google_maps|waze|apple_maps` under `eyego_driver_nav_app`; the trip
   page's `openExternalNavigation` read `google|apple|waze` under `@eyego_driver_nav_app`. Settings
   now uses `get/setPreferredNavApp` from utils/externalNav; server still gets the long names via
   `SERVER_NAV`; getMe seeds the local pref on reinstall.

## Evidence
- tsc: `node node_modules/typescript/lib/tsc.js -p apps/<app> --noEmit` → both exit 0.
- `node --experimental-strip-types --test "packages/maps/src/__tests__/*.test.ts"` → 34 pass.
- `node scripts/e2e/conditional-hooks.mjs` → green now; against the pre-fix file it names both lines.
- Harness `node scripts/e2e/run-all.mjs` → 466/466 after updating two suites to the withheld
  drop-off contract (8d8f2be made it deliberate; dispatch-payload + driver-happy-path still
  asserted dropoffLat/Lng/Address). "7 · quotes and prices" green → rider dashes were the client URL.
- Docker Desktop was NOT running at session start (`Docker Desktop.exe` lives in
  `%LOCALAPPDATA%\Programs\DockerDesktop`); launched it, stack + API started in background.

## Open Issues
- Nothing device-tested. Working tree NOT committed (user did not ask).
- Local API left running on :5020 (eyego-api/.env) — Metro clients need EXPO_PUBLIC_API_PORT=5020.
- `scan-pay` amount input and the driver PIN keypad are centred modals — not converted; check on
  a small phone.
