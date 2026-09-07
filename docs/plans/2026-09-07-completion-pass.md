# Completion Pass — 2026-09-07

Nine items from a real two-device test (driver on iPhone 12, rider on iPhone 15 Pro Max).

## Root causes (researched before any edit)

### 1. Driver app lag — CONFIRMED, three stacked causes
- **34 `<AppBackground>` mounts in `apps/driver`, every one animated.** The prop
  defaults to `variant='animated'`; the driver app never passes it. The rider
  passes `variant="static"` on 14 sub-screens. `useShaderSlot` hands the single
  Skia canvas to the *most recently focused* background, so on the driver every
  pushed screen — profile, earnings, notifications — claims the slot and runs a
  live full-screen raymarch. On the rider those same screens claim the slot and
  render a frozen frame. This is exactly the difference the user described.
- **`usePerformanceTier` cannot return `'low'` on iOS.** It only degrades on
  Android API < 31, so an iPhone 12 (A14, 2020) gets the same shader budget as
  the newest hardware: 200k pixel budget, 30fps clock, noise 0.5, rotation 0.4.
  `AppBackground` and `LightPillarBackground` both branch on `tier === 'high'`
  for a "mid" setting that no device can ever reach.
- **Per-screen effect stacking.** `tracking/[id].tsx` = 3 BlurView + 2
  GradientGlowBorder + 2 GlassSurface + 7 Entrance over a live MapView.
  `active/[id].tsx` (the "manage trip" page) = 5 GradientGlowBorder, each an
  independently rotating Animated.View, + 10 Entrance.

### 2. Dispatch offer never pops up — NARROWER THAN IT LOOKED

The on-demand chain is complete and correct end to end, and must not be
"fixed":

    offerNext -> rememberOffer (per-driver Redis key)
              -> OFFER socket frame          -> trip.store.offer -> sheet
    GET /rides/driver/state -> getOfferForDriver -> hydrate() adopts the offer
    app/_layout.tsx polls hydrate() every 2s whenever no live trip

So even with a dead socket the sheet pops within 2s of an offer existing.

The actual gap is `trip-request.service` (scheduled + grouped requests). It
**never runs the cascade** — it broadcasts FCM to up to 12 nearby drivers, and
a driver's only surface for one is the board row (the banner). Its own comment
gives the reason, and the reason is sound *for genuinely scheduled rides*: "no
driver is going to sit on a twenty-second countdown for a ride four days out".

It is NOT sound for an immediate request, and that is the one to fix.

**The obstacle, stated plainly:** `startCascade(tripId)` needs a Trip row.
`trip-request.service` has only a `TripRequest` until a driver accepts — the
Route, the Trip and the Bookings are all created inside `acceptTripRequest`'s
transaction. So routing immediate requests through the cascade means creating
the Trip up front in `REQUESTED` with no driver (exactly as
`rides.service.requestRide` does) and reducing `acceptTripRequest` to the
cascade's accept.

Do NOT instead build a cascade that offers `TripRequest`s directly. That is a
second dispatch engine, and this codebase has already been burned by one (see
the redispatch broadcast that shipped alongside the sequential cascade).

Route the immediate path through the existing engine; leave genuinely
scheduled requests broadcasting.

### 3. Dispatch screen crowding
"Frame the ride" FAB already auto-hides on `framed` state, but the top glass
pills and the FAB share the map with the offer card. Auto-hide the chrome on
map idle, reveal on gesture.

### 4. Scan & Pay opens the booking screen
By design: the scanner accepts `/pay/<phone>` and `/ride/<id>`; a driver's trip
code routes to the ride screen. Decision: build a real pay sheet for trip codes.

### 5. Multi-seat request fails — CONFIRMED, one line
`ConfigureStage` quotes with `seatCount: seats`. `RequestStage` **re-quotes
without `seatCount`**, so `fare-quote.service` defaults it to 1. Then
`ridesApi.request` sends the real party size. `rides.service.js:350` refuses the
mismatch with 409 `FARE_EXPIRED`. Party of 1 passes; anything more fails.

### 6. Matching screen
Already mirrors the cascade's current driver onto the map store and seeds nearby
pins. Verify + polish rather than rebuild.

### 7. H3
Dispatch already ranks by road ETA (`etaMatrix`), which beats hex distance.
Decision: add H3 as the spatial index layer (k-ring candidate expansion, cell-keyed
surge/heatmap/supply-demand); keep ETA as the ranker.

### 9. Straight-line approach route
`approachLine` in `TripMap.tsx` is a 2-point LineString. `mapbox.service.getDirections`
is hardcoded to the `driving-traffic` profile with no walking option.

## Order of work
1. Item 5 (one line, confirmed)
2. Item 1 (perf — top priority)
3. Item 2 (cascade for group bookings)
4. Item 9 (walking route)
5. Item 3 (dispatch chrome auto-hide)
6. Item 6 (matching map)
7. Item 4 (scan to pay)
8. Item 7 (H3 index layer)
9. QA harness covering all of it
