# State — 2026-10-09b (13-item device sweep)

## Current Goal
Fix user's 13-item device list (rider + driver) with root-cause fixes; 3D models; immersive search/offer.

## Decisions (grilled with user)
- Scheduled booking blocks other bookings only from 60 min before departure (or once the trip moves).
- Live chapter rebase: once a request is sent / seat paid, the stack behind is erased; exits land on Home.
  Browse "Request a ride now" seeds pickup+place and opens ride options directly.
- 3D: live Skia-projected low-poly models (no new native deps). Minibus everywhere (tier livery),
  pickup/drop-off pins, bus-stop posts, rider puck, + hero turntable uses.
- "While you were away": both apps, rider endings + scheduled/seat + driver endings + money, 48 h, once each.
- Immersion: full-bleed map + floating card for rider search AND driver offer.
- Item 6: drop the 1.5 s success page; go straight to the ride with a success toast (my call).

## Root causes (verified)
- 1/12: Fabric iOS adjustsFontSizeToFit ignores minimumFontScale (min 4pt) + fixed lineHeight never shrinks → collapse.
- 8: MorphSheet overlay zIndex 100 (opaque) covers the pinned swipe bar (zIndex 20) in active/[id].tsx.
- 11 crash: MLRN cloneReactChildrenWithProps filters nulls before Children.map → DispatchMiniMap casing
  insert shifts keys → Layer id changes → useFrozenId throws.
- 13: SCHEDULED-trip bookings count as live in bookSeat / requestRide / rides/active; "Open my ride" ignores details.activeTripId;
  RequestStage re-POSTs when the surface projects 'request' for an existing trip.
- 9: home ended-check reads TRIP status (booking NO_SHOW invisible); non-COMPLETED endings dropped silently.

## Plan status — ALL DONE, committed locally, NOT pushed (ask user)
[x] 1/12 Text guard  [x] 11 adapter keys  [x] 8 zIndex  [x] 13 server window + client open-my-ride  (1091793)
[x] 3/4 browse seed + rebase  [x] 6 payment  (1091793)   [x] 9 away outcomes (5a388c3)
[x] 7 3D engine+models (3aba6f7)  [x] 10 rider immersion (d572eeb)  [x] 11b driver offer (7f559ba)
[x] verify: tsc rider/driver/admin, prisma-fields, conditional-hooks, ui/ux/motion invariants, button-wiring,
    formatters, maestro, shader-compile all green; jest away-outcomes + rider-live-window 9/9.
    Server-dependent e2e suites not run (no local API up).

## Device-test watch list
- Search orbit (TripMap `searchOrbit`): linear setCamera legs; verify smooth turn + pan stops it + recentre resumes.
- Overview fits now pass bearing 0 / pitch 0 — confirm post-orbit refit lands flat.
- 3D markers: Model3D = one Skia canvas per marker; watch frame rate with many nearby buses.
- Driver native puck = modelDataUri PNG per 4°/5° step (Images swap) — watch for flicker in course mode.
