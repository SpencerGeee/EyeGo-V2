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

## Plan status
[ ] 1/12 Text guard  [ ] 11 adapter keys  [ ] 8 zIndex  [ ] 13 server window + client open-my-ride
[ ] 3/4 browse seed + rebase  [ ] 6 payment  [ ] 9 away outcomes  [ ] 7 3D engine+models
[ ] 10 rider immersion  [ ] 11b driver offer immersion  [ ] verify (tsc, e2e static)  [ ] docs/memory
