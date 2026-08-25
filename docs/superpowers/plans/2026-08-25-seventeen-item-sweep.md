# Sweep 2026-08-25 — seventeen items

Root causes found, grouped by the defect that produces them.

## A. "Every address is Accra" (item 1)

Two independent causes, both upstream of the driver's screen.

1. `geo.service.mapboxToResult` sets `fullAddress = full_address || place_formatted || name`.
   Mapbox's `place_formatted` is the *administrative context* — literally
   "Accra, Greater Accra, Ghana". A POI feature usually carries `place_formatted`
   and no `full_address`, so the composed label lost the specific half.
   The rider stores `address: place.fullAddress` and the server persists it as
   `Trip.pickupAddress`, so the driver reads the city.
2. `SearchStage` sets the GPS origin's address to the literal string
   `'Current Location'` and never reverse-geocodes it.

Fix: compose `name, place_formatted` in the mapper; add a shared `placeLabel()`
so both apps store the specific name plus its context; reverse-geocode the GPS
origin on acquisition.

## B. "— → —" and wrong seat counts (items 2, 3, 4, 5)

- `buildTripSnapshot` projects `route: {id, name, distanceKm}` — no
  `originName`/`destinationName`. `drivers.service.getTripById` returns the RAW
  trip, where `route` is **null** for an on-demand ride. Every driver screen
  reads `trip.route?.originName ?? '—'`. Both shapes carry the answer under
  different keys (`pickup.address` / `pickupAddress`).
- `requestRide` writes `maxSeats: partySize` but creates **one** `Booking` row.
  The driver counts `bookings.length`, so a 3-seat ride reads as 1 passenger.

Fix: `Booking.seats` column (default 1, set to `partySize`); a shared
`tripEndpoints`/`seat` helper in `@eyego/utils`; every driver read site moved
onto it.

## C. Lifecycle (items 15, 16)

- `acceptRide` lands at `DRIVER_ASSIGNED`. The driver then has to swipe "Head to
  Pickup" to reach `DRIVER_EN_ROUTE`, while they are already driving. Rider sees
  "Driver confirmed" throughout.
- Nothing warms the pickup leg on accept, so the map has no road geometry until
  the driver's next ping — the only line on screen is the rider's dashed
  approach hint, read as "a straight-line route".
- `startTrip` has no boarding-PIN gate. A rider with Verify My Ride on can be
  driven off without the code ever being entered.

Fix: accept → `DRIVER_EN_ROUTE` in the same call (unless auto-arrive fires),
warm the route on accept, and refuse `IN_PROGRESS` while any seat-occupying
booking has `boardingPin && !pinVerifiedAt`.

## D. Surfaces

| # | Where | Fix |
|---|---|---|
| 1 | Driver home dispatch board | first-hydration skeleton instead of the empty state |
| 6 | Driver receipt | `Rate Passengers` locks once every passenger is rated (server returns `ratedUserIds`) |
| 7 | Rider receipt + rate-tip | read the real trip via `ridesApi.events`, not the stale `selectedTrip` store slice |
| 8 | Driver dispatch rows/card | ring palette from `getTierTheme(tier).ringPalette` |
| 9 | Dispatch offer card | full redesign pass |
| 10 | `public/tracking` | highway stroke was `#2C3A2E` — green. Neutralised; route line strengthened |
| 11 | `eyego://track/<shortId>` | new `app/track/[shortId].tsx` resolver + `_layout` link handler |
| 12 | Rider map | recentre falls back to "follow me"; idle fit prefers the rider's own fix |
| 13 | `DispatchBlockedBanner` | glass + glow ring, high-contrast CTA |
| 14 | Driver home → dispatch | `MorphSource`/`MorphTarget` container transform |
