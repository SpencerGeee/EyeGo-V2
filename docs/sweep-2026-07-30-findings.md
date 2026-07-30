# Sweep 2026-07-30 — 19 device-reported defects: root causes + plan

Verified statically. Do not re-derive; re-verify only if a path no longer exists.

## Root causes

- **item 17 crash (FIX APPLIED)**: `packages/ui/src/morph/MorphBackSwipeDetector.tsx` Pan callbacks
  are auto-workletized by `react-native-reanimated/plugin`, but they call JS-thread closures
  (`canSwipeBack`, `morph.startMorphBackGesture`, ref writes, provider `setState`) → uncaught JS
  error on the UI runtime → SIGABRT. Proof — `ios crash logs/EyeGo-2026-07-29-232912.ips`:
  `RNGestureHandlerManager sendEventForReanimated → REANodesManager dispatchEvent →
  worklets::WorkletEventHandler::process → HermesRuntimeImpl::throwPendingError → abort()`.
  Fix: `.runOnJS(true)` + `useMemo` + `failOffsetX([-24,24])` + 14px activation.
  `packages/ui/src/panel/usePanelMotion.ts` is CLEAN (real worklets + runOnJS) — do not touch.

- **item 1 where-to**: `/where-to` is a redirect stub; the real screen is
  `apps/rider/components/trip/stages/SearchStage.tsx`, a stage of `apps/rider/app/trip.tsx`.
  Both rows exist but are map-picker-only Pressables. `MorphTarget` holds content at `opacity 0`
  for the whole flight and reveals only from `morphProgress`; `MorphProvider.settle()` never clears
  `flightRef`/`activeId`, so a stale flight makes the next `morphTo` early-return
  (`if (flightRef.current) navigate()`) — leaving a stranded clone (which looks like ONE field at
  the top) over an invisible card. `/trip` is `presentation:'transparentModal'`, so home shows
  through whenever the surface renders transparent.
  Plan: real inline TextInput search per field (POI autocomplete) + keep a "choose on map"
  affordance; make MorphTarget visibility fail-safe (watchdog → opacity 1); clear
  `flightRef`/`activeId` in `settle()`; force-cleanup a stale flight in `morphTo` instead of
  early-returning; scope `MorphBackSwipeDetector` to the card, not `flex:1` (it covers the map today).

- **item 6 map roads (dark DONE, light + dark-driver TODO)**: `packages/map-styles/*.json` road
  `line-width` ramps were 0.5–4px and stopped growing at z16. New ramps:
  path `13:1,16:3,18:5,20:8` · minor `12:1,14:2.5,16:6,18:12,20:26` plus a new `road-minor-case`
  `12:2,14:4,16:8,18:15,20:30` · major-case `10:3,13:6,16:12,18:20,20:40` · major
  `10:1.6,13:4,16:9,18:16,20:34` · highway-case `8:3,12:8,16:16,18:24,20:46` · highway
  `8:2,12:5.5,16:12,18:19,20:38`. Keep each file's own colors; dark minor lightened to `#333B4B`.
  Light palette: path `#DDD6C7`, minor `#FBFAF6` / case `#CFC5AE`, major `#FDFCFA` / case
  `#CFC5AE`, hw-case `#B7ACC1`, highway ramp `6:#8E8875,11:#3D6FE0,15:#2F6FED`.
  Driver-dark = dark palette, highway ramp `6:#4C5872,11:#2F6FED,15:#4C8CFF`.

- **item 8 POI search**: `eyego-api/src/modules/geo/geo.service.js` calls
  `https://api.mapbox.com/search/geocode/v6/forward`. Geocoding v6 has **no POI index** — the code
  comment claiming it shares Search Box's POI data is wrong, which is why "IPMC showroom" returns
  nothing. Use `https://api.mapbox.com/search/searchbox/v1/forward` (one-shot, POI-capable) and keep
  geocode v6 + Photon as fallbacks. Clients (`apps/{rider,driver}/utils/geocoding.ts`) already
  prefer `/geo/search`, so no client change is needed for coverage.

- **item 9 ETA**: backend already uses `driving-traffic` with a 22 km/h × 1.35-circuity fallback and
  exposes `/v1/geo/route`; both apps have `utils/routing.ts` (`fetchRoute`, `fetchEtaMinutes`).
  Hardcoded free-flow math still to replace: `apps/rider/app/ride/[id].tsx:96` (`distanceKm * 1.8`),
  `apps/driver/app/(trip)/create.tsx:268,402` and `apps/driver/app/(trip)/complete/[id].tsx:134`
  (`distanceKm / 40 * 60`).

- **item 3 straight route line**: `apps/rider/app/ride/[id].tsx:224-243` draws a 2-point
  LineString. Same pattern at `apps/rider/app/ride/[id]/tracking.tsx:780`,
  `apps/rider/components/trip/TripMap.tsx:65`, `apps/driver/app/(trip)/active/[id].tsx:453`,
  `apps/driver/app/(trip)/tracking/[id].tsx:499`. Replace with `fetchRoute()` coordinates.

## Root causes — second pass (items 4, 5, 7, 11, 12, 13, 14, 18)

- **items 4 + 12 + 13, one shared cause**: `getActiveBooking` in
  `eyego-api/src/modules/bookings/bookings.service.js` filtered trips to
  `['SCHEDULED','FILLING','DRIVER_EN_ROUTE','IN_PROGRESS']` — omitting
  **`ARRIVED_AT_PICKUP`** and **`CONFIRMED`** (the latter set by `confirmPayment` at
  min occupancy). So from the instant the driver tapped "I've arrived", the rider had
  "no active booking": the home live-trip card lost its data, and the rider's tracking
  screen — which *inferred completion from a missing active booking* and hard-replaced
  to the rate flow — pushed them into "arrived safely + rate" mid-ride. Now derived by
  exclusion from `TERMINAL_TRIP_STATUSES` so a new mid-trip status can't fall out again.
  Two supporting fixes: the tracking screen's foreground resync now reads the trip's own
  status (COMPLETED / CANCELLED / still-live) and never ends a trip on an unverifiable
  state; and `driver.socket.js` gained `authorizeStatusEvent`, so socket status
  broadcasts (especially `driver:arrived`, which *completes* the trip) require a legal
  predecessor status — previously they checked ownership only.

- **item 4, second half**: `/payments/initiate` is wrapped in the `idempotency`
  middleware and the payment screen deliberately sends a STABLE key
  (`pay_<bookingId>_<method>`). A duplicate/in-flight submit returned
  **409 IDEMPOTENCY_IN_PROGRESS**, which the client reported as "Payment Failed" and
  then called `releaseHeldSeat()` — cancelling a booking the other request had already
  confirmed. Middleware now caches only 2xx responses and releases its reservation row
  on any non-success; the client re-reads the booking before declaring failure.

- **item 14**: cash trips intentionally create **no** `EARNINGS_CREDIT` (driver keeps
  the cash, only commission is debited) — but every earnings surface read that one type,
  so a cash-working driver saw GHS 0 and a flat chart with a `COMMISSION_DEDUCTION`
  sitting in the ledger. Also `trips.service.completeTrip` writes `TRIP_EARNING`, which
  the summary never counted either — so *which completion path ran* decided whether a
  trip appeared in earnings. Added a ledger-only `CASH_EARNING` row
  (`balanceBefore === balanceAfter`, no wallet movement) plus `EARNING_TYPES =
  ['EARNINGS_CREDIT','TRIP_EARNING','CASH_EARNING']` on every reporting query.

- **item 11**: `packages/maps/src/index.tsx` published the map bearing only from
  `onRegionDidChange`, which fires when the gesture ENDS. During a rotate the marker
  compensation used a stale bearing (marker turned with the map) and snapped on release.
  Now also handled in `onRegionIsChanging` (bearing only, 1.5° dead-band to avoid a
  60 fps React render storm).

- **item 7**: the live scheduled card's `onPress` was
  `liveIntent.matchedTripId ? push(tracking) : null` — literally nothing before a driver
  matched. Falls back to `/scheduled/[id]` like the home card. The detail screen's
  clipping was a `fontSize` + negative `letterSpacing` with no `lineHeight` (the same
  class fixed app-wide in acdda37; this screen was written after).

- **item 5**: the vehicle marker was already gated on a real fix, but the trip payload
  omitted `currentHeading`, so the car pointed due north until a second live fix let the
  client derive a bearing. Added `currentHeading` to the rider-facing driver select and a
  "Locating your driver…" pill for the genuinely-no-position case.

- **item 18**: `apps/driver/hooks/useDriverLocation.ts` called
  `requestBackgroundPermissionsAsync()` unconditionally on mount and started the
  background task for any `enabled` session — including an idle online driver, which is
  why the location indicator showed with the app closed. Background permission is now
  requested only when `isOnTrip` (and never re-prompted once decided), the background
  task only runs during a trip, and the permission strings say so.

## Key file map
- rider trip surface: `app/trip.tsx` + `components/trip/{TripMap.tsx,useTripCamera.ts,stages/*}`
- morph engine: `packages/ui/src/morph/{MorphProvider,MorphTarget,MorphSource,MorphBackSwipeDetector}.tsx`
- map styles: `packages/map-styles/*.json` (OpenFreeMap vector tiles, `transportation` source-layer)
- geo backend: `eyego-api/src/modules/geo/*`, `eyego-api/src/services/mapbox.service.js`
- versions: expo 54, RN 0.81.5, reanimated 4.1.7 (worklets 0.5.1), RNGH 2.28, maplibre-react-native 11.3.2

## Constraints
- No device access this session — every fix is static-analysis based and needs on-device retest.
- `npx` is broken in this repo; typecheck with `node node_modules/typescript/lib/tsc.js`.
