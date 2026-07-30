# State — 14-item stress-test sweep (2026-07-30, second pass)

## Current Goal
All 14 reported items fixed. `tsc` green both apps, `node --check` green. NOT device-tested.

## Root causes worth remembering

1. **Where-to card collapsed to one empty pill (#6).** `inputsSection` resolved to a
   DEFINITE height of 0, and its `alignItems: 'stretch'` then forced all three
   children to 0 — so the card shrank to its 24pt padding, both field rows
   vanished, and the timeline's dots spilled below the card (a border-box height
   of 0 makes padding overflow). Proof from the screenshot: card exactly 48pt,
   dot 1 exactly `paddingTop: 16` below the collapsed line, swap button 38pt
   centred on it. Cause: **React Native's `flex` shorthand sets `flexBasis: 0`**
   (`flex: 1` AND `flex: 0`), and a basis-0 child of an auto-height column
   contributes 0 to its parent's content height with no free space to grow back
   into. Both `MorphTarget`'s inner wrapper (`flex: 1`) and the swipe zone
   (`flex: 0`) were in that chain. Fixed at the source (`flexBasis: 'auto'`) and
   belt-and-braces: every height in the card is now explicit.

2. **Cash payment "validation failed" (#7) was an envelope-unwrap bug.**
   `POST /bookings` answers `created(res, { booking, fareData, holdExpiry })`, but
   `bookings.api.ts` typed it `ApiResponse<Booking>` and the payment screen read
   `res.data.data.id` → `undefined` → it sent `bookingId: ''` → the route's
   `body('bookingId').notEmpty()` rejected it. That is literally where
   "Validation failed" / "Payment initialization failed" came from. It also stored
   the WRAPPER as `activeBooking` (so `.id`/`.tripId` were undefined → the next
   attempt held ANOTHER seat: the "seat held but payment failed" pair) and dropped
   the server fare (which lives on `fareData`). Same class as last pass's tracking
   bug — the API types were lying about the wire format.

3. **Trips never died (#1).** The sweep in server.js ran every SIX HOURS with
   24h/48h windows and only flipped `Trip.status` — bookings stayed live and seats
   stayed spent. `getActiveTrip` also matched in-flight statuses with NO time bound
   at all, on the comment "a started trip stays resumable forever". That is why a
   midnight trip was live and resumable at 13:00. Now
   `services/trip-lifecycle.service.js`: 5-min sweep + a lazy `isPastDeadline`
   guard, 3h pre-trip / 6h idle / 18h hard windows, status `EXPIRED` (NOT
   `CANCELLED` — housekeeping must not count against drivers' cancellation rates),
   bookings released, seat counter recomputed, sockets notified, idempotent.

4. **Cancelled ride still live (#5).** Query invalidation was never enough: the
   live surfaces also read the PERSISTED Zustand ride store, which survives a
   cancel and an app restart. `clearRideState()` on cancel is the real fix; home
   now also filters terminal statuses and tracking bounces out of a dead trip.

5. **Straight line to pickup (#2).** `routeFetchedRef` latched to `true` BEFORE the
   request, so ONE failure was terminal for the life of the screen and the 900ms
   grace timer drew the straight-line fallback permanently. Now retried
   (2/4/8/15s), the pre-trip leg routes DRIVER→pickup (not rider→pickup, which on
   a driver-created trip is a metres-long stub), and the fallback is DASHED so it
   can never pass for road geometry.

6. **Share link stuck on "Loading trip" (#14).** The page is one IIFE and
   `new maplibregl.Map()` ran BEFORE the fetch. `maplibregl` comes from unpkg over
   the recipient's connection — if that fails (or WebGL is absent), the
   constructor threw, the IIFE aborted, and nothing below it ever ran: no fetch,
   no error state, just the spinner. The map is now optional and guarded. Second
   bug found: the tile URL was a hand-written `{z}/{x}/{y}.pbf` template that
   returns **403** — verified with curl; OpenFreeMap publishes TileJSON at
   `/planet` (200), which is what the native styles already use.

7. **Route line colours (#8, #10).** The driver app used `statusCfg.color` — the
   STATUS PILL's colour — for the line the driver must follow, so it was grey,
   then blue, then violet ("a purple thing") as the trip advanced, and blue
   vanished into the driver style's blue roads. Now fixed per app, casing + core
   (the two-layer arrangement every nav renderer uses; a blurred 18% black
   underlay gives no edge): driver amber `#FFB020`/`#4A2B00`, rider azure
   `#5BB0FF`/`#123A66` (its map's roads are green).

8. **Map "capped to Accra" (#3).** Nothing was actually clamped — tiles are the
   global OpenFreeMap planet set. The style has no low-zoom land layer, so outside
   the metro area's z12+ road layers there was nothing to draw but the background
   colour, which reads as missing tiles. Now explicitly capped to
   `GHANA_BOUNDS` + `minZoom 6` in the shared adapter, so every map in both apps
   is country-wide and deterministic.

9. **Reported heading was GPS course only (#9).** `pos.coords.heading` is course
   over GROUND — -1/0 when stopped. A driver waiting AT the pickup reported "due
   north" forever, so the rider's car sat frozen. Now course-while-moving → last
   good course → compass (last, because a cradled handset reads the cradle).

## New surface area
- `packages/ui/src/SwipeToConfirm.tsx` — slide-to-confirm; the driver's primary
  CTA (arrive / start ride / end trip) is now a swipe, not a tap (#13).
- `apps/driver/utils/externalNav.ts` — Google/Apple/Waze hand-off with a
  remembered preference (long-press Navigate to change it); targets the PICKUP
  while en-route, not always the destination (#12).
- `eyego-api/src/services/trip-lifecycle.service.js` (#1).
- `CarMarker` redesigned: shaded low-detail top-down model, light outline, tight
  contact shadow, mirrors, head/tail lights (#4). Pickup marker is now a PIN, so
  place / vehicle / self are three distinct shapes when they overlap.
- Re-center now returns to the DEFAULT camera (north-up) on both apps (#11);
  driver tracking gained a re-center FAB.

## Verification
- `tsc --noEmit` green: apps/rider, apps/driver. `node --check` green on all
  touched backend files. Share-page script parses. OpenFreeMap endpoints curl'd.
- **Nothing device-tested.** Native rebuild needed (markers/gestures) + API redeploy.

## Open Issues
- Item 3's "tiles stop at the outskirts" was diagnosed by elimination, not
  reproduced: no code capped anything. If it persists inside Ghana after the
  rebuild, suspect high camera pitch culling distant tiles, not the bounds.
- Research (see scratchpad `marker-research.md`) says Uber uses a raster sprite in
  a `SymbolLayer`, not a view marker; MLRN maintainers recommend the same. The
  marker is still `MarkerView` + SVG. Worth migrating if drift/perf shows up.
- `SwipeToConfirm` uses the deprecated `runOnJS` (as does the rest of this repo);
  Reanimated 4 prefers `scheduleOnRN`. Cosmetic for now.
