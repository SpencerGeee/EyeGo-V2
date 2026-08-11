# State — Stress Sweep 2026-08-11 (23 items)

## Current Goal
23-item stress-test list. ALL 23 fixed and committed to `main`.

## Delivery — 6 commits
a600ef7 dispatch never rang + rider multistep/fare
83daa07 pay-for-everyone + ghost live-trip card + driver home
35b028f public /track and /invite pages
2e3fcf8 status discrepancy + swipe feel + polyline + glow
4fb4d5d chat badges + keyboard
fdc4524 pickup propagation + complete-screen 0 + perf

## Root causes worth not re-deriving
- **Dispatch (3)**: driver socket is `autoConnect:false`; only `watch()` ever
  dialled it, and that runs when already ON a trip. Idle driver = never
  connected. `listenForOffers()` now takes a refcounted connection.
  Offers carry no trip seq → no replay → also mirrored to redis
  `dispatch:offer:driver:<id>` and returned by `/rides/driver/state`.
  `TRIP_OFFER` push had no case in `_layout.tsx` and fell to the catch-all.
- **Fare "—" (2)**: `ridesApi.quote` returns `amountPesewas`; client read
  three names that don't exist.
- **Pay-for-everyone (9,10)**: `createRideGroup` returned early when a group
  existed (invite LINK creates it first), so `isCoverAll` was never stored;
  and settlement only covers seats that ALREADY hold a booking. Now upserts
  and claims free seats as real bookings (`isCoveredByLead`). `trip-view`
  used `find()` for the viewer's booking → summed now (`seatsPaidFor`).
- **Ghost card (5,6)**: card rendered for any non-terminal booking; with no
  `trip` relation, `String(undefined).toUpperCase()` = "UNDEFINED" passed the
  terminal filter, and every field fell to its `??` placeholder.
- **Public pages (8,16)**: `/track` endpoint sent no geometry (straight line)
  and no ETA (counted down to departureTime → 64 vs 16 min). `/invite` built
  its Map unguarded at the top of the IIFE (CDN fail = stuck spinner) and used
  a `{z}/{x}/{y}` tile template that 404s. `trip.fare` is PESEWAS → 480 vs 4.80.
- **Chat badge (13)**: counted against `useTripStore.snapshot.tripId`, which is
  null for group rides. Private messages were never subscribed at all.
- **Keyboard (13,21)**: `behavior="height"` no-ops under edge-to-edge
  adjustResize; root SafeAreaView claimed the same strip as the avoider.
- **Status (17,19)**: driver tracking defaulted `etaLeg` to `'toDropoff'`;
  IN_PROGRESS swipe was labelled "Mark Arrived" but calls `arriveTrip`
  (→ COMPLETED).
- **Perf (15)**: per-frame cost was already fine; nothing bounded the NUMBER
  of frames — 24fps for a whole shift. Added a decay duty cycle that resets on
  every navigation. Tracking screen also mounted AppBackground UNDER an opaque
  full-screen map.

## Evidence
- `tsc --noEmit` exit 0 for apps/rider and apps/driver after every commit.
- `node --check` clean on all changed backend files.
- **Nothing device-tested.**

## Carry-overs — both CLOSED 2026-08-11
- Migration `20260810120000_driver_destination_mode` **APPLIED** to the live
  Neon DB (`prisma migrate deploy`); all six `Driver.destination*` columns
  verified present, `migrate status` = "Database schema is up to date!".
- Dispatch convergence **DONE** (1fcb5f2). The two surfaces now share one
  clock and cannot both hold an offer:
  - legacy screen counted down on the DEVICE clock → now `useDriverTripStore.now()`
  - home's `trip:assigned` handler stands down while a cascade offer is live
  - socket type said `estimatedEarnings`; server sends `estimatedEarningsPesewas`
    (so the earnings card had never once rendered)
  - `ADMIN_TRIP_ASSIGNED` had no nav case → fell to the active-trip catch-all
  - copy is kind-aware (assigned vs reassignment vs request)
  The legacy screen is KEPT on purpose: admin-assigned scheduled trips
  (`admin.controller.js`) and reassignment claims (`drivers.service.js`) are
  live, genuinely different flows. Only the cascade's on-demand offers use the
  sheet. Nothing creates `TripRequest`s any more, so `kind=REQUEST` is dormant.

## Open Issues
- Perf changes need a device pass to confirm the thermal fix.
- `runOnJS` deprecation in SwipeToConfirm left alone deliberately — this repo
  has a history of SIGABRTs from gesture-callback worklet changes.
