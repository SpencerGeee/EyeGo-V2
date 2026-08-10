# State — Stress Sweep 2026-08-10c (26 items)

## Current Goal
Fix the 26-item stress-test list. Phase 1 (backend + blockers) in progress.

## Decisions (confirmed with user)
- Rider "Where to" becomes a 5-step paged flow mirroring driver `create.tsx`:
  Pickup → Dropoff → Ride type → Seats/extras → Review & Confirm.
- Driver destination filter (item 25): Uber-style, **limited** — 2 uses/day,
  expires after 1 matched trip or 2h, bearing-cone + detour-cap matching.
- Loader (item 5): **Reanimated** port of the luma-spin 8-position inset
  keyframes; replaces every loader/ActivityIndicator in BOTH apps.
- Delivery: backend + blockers → perf → UI → features. One push at the end,
  only once both apps' `tsc` is green.

## Plan Status

### DONE (Phase 1)
- **#2 dispatch never reaches the driver** — TWO root causes, both fixed:
  1. `eyego-api/src/modules/rides/rides.routes.js` read `req.user.id` (rider)
     and `req.driver.id` (driver). Neither exists: both auth middlewares set
     `req.user = decoded`, and the JWT payload's id field is `userId`. 14 call
     sites replaced with an `actorId(req)` helper. The whole `/v1/rides` module
     was dead — driver endpoints threw, rider endpoints ran as `undefined`.
  2. `apps/driver/stores/trip.store.ts` stored the incoming OFFER and **nothing
     in the app ever rendered it**. New `apps/driver/components/
     DispatchOfferSheet.tsx`, root-mounted in `apps/driver/app/_layout.tsx`.
  - Offer payload enriched in `dispatch-cascade.service.js` with
    pickup/dropoff addresses + `farePesewas` / `driverEarningsPesewas`;
    matching fields added to `DispatchOffer` in `trip.store.ts`.
- **#1 Neon "Can't reach database server"** — `eyego-api/src/config/database.js`
  rewritten: `$extends` retry (3 attempts, 150/600ms backoff) on transient
  codes P1001/P1002/P1008/P1017/P2024, explicitly NOT retried inside
  interactive transactions; boot warm-up `$connect()`. `errorHandler.js` maps
  those codes to 503 `DB_UNAVAILABLE` instead of an unhandled 500.
- **#21 "Transaction already closed" on Mark-as-arrived** — quest progress
  moved OUT of the trip transaction in both `drivers.service.arriveTrip` and
  `trips.service.completeTrip` (now `setImmediate` post-commit); the per-quest
  loop in `quests.service.incrementProgress` is now concurrent and `tx`
  defaults to `prisma`. Global `transactionOptions: { timeout: 20s, maxWait: 10s }`.
- Sentry `user.id` in errorHandler was reading the non-existent `req.user.id`.

### TODO — remaining 22 items, in delivery order
Blockers: #6 share-link stuck + dynamic Expo domain, #7 pay-for-everyone cash
"validation failed" + heavy cargo, #8 no way to cancel a requested ride (rider),
#16 rider shows destination route while driver is en route to PICKUP,
#17 driver tracking stuck on "calculating ETA", no polyline until trip starts.
Perf: #14 latency (offline-passenger earnings recompute), #20 booking-flow lag,
#23 laggy swipeables, #24 iPhone 15 Pro Max thermal, #9 straight-line-before-
route everywhere (must be instant, Uber/Bolt-style).
UI: #4 suggested-card missing destination + wrong seats-left, #10 tracking top
scrim too tall, #11 rider chat badge, #12 rider chat starts midway, #13
add-passenger line-height clipping, #15 grey out booked seats, #18 route
polyline blends with motorway (outline/colour), #19 no destination marker,
#22 reset-camera button overlaps "1/2 boarded", #5 loader.
Features: #3 rider multistep where-to, #25 driver destination filter.

## Evidence
- `node --check` passes on all 7 changed backend files.
- `driverAuth.js:38` sets `req.user = { ...decoded, status }`; `auth.service.js:16`
  signs `{ userId, role, type, tokenId }` — confirms the `userId` field name.
- `grep listenForOffers|useDriverTripStore apps/driver` returned only
  `_layout.tsx` — proof nothing consumed the offer.

## Open Issues
- Neither app's `tsc` has been run since these edits.
- `(trip)/dispatch/[id].tsx` is the LEGACY offer screen (driverApi.acceptDispatch,
  scheduled/route trips). Left in place; the new sheet handles on-demand rides.
  Decide later whether to converge them.
- Nothing has been committed or pushed yet.
