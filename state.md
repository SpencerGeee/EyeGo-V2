# State — 12-item sideload sweep (2026-07-30)

## Current Goal
All 11 reported defects fixed; `tsc` green both apps. Needs a NEW native build + API deploy, then device testing.

## Root causes worth remembering

1. **Rider tracking read the response ENVELOPE, not the trip.** `/trips/:id` responds
   `ok(res, { trip })`, so the payload is `res.data.data.trip`. `tracking.tsx` used
   `res.data.data` — a truthy `{ trip: {...} }` with no `route`, `driver` or `status`.
   That single expression caused the "random" camera (fell back to the Accra viewport
   default), the permanent "Locating your driver…" pill, the missing markers AND the
   missing ride details. `ride/[id].tsx` and `chat.tsx` were always correct.

2. **`expo-camera` was pinned to `^57.0.1` on Expo SDK 54** (which ships 17.0.x).
   Its native side is built against a newer expo-modules-core, so mounting the
   scanner aborted the process. Same class of bug as the expo-updates 56-vs-29 crash.
   Now `~17.0.10`.

3. **Two different fare denominators.** `drivers.service.attachFarePerSeat` divided by
   `clamp(trip.availableSeats ?? confirmedSeats ?? maxSeats, min 4, max maxSeats)`.
   `availableSeats` is not a Trip column → undefined → `confirmedSeats` = 0 → the
   `Math.max(_, 4)` made it **4**, while every rider path divides by `maxSeats`.

4. **Two different distances.** The driver's create-trip preview priced the ROAD
   distance it had already fetched for the route line; `createTrip` stored the
   HAVERSINE distance. Road ≈ 1.3–2× straight, so preview ≠ charge. `mapbox.service
   .roadDistanceKm()` is now the single answer, used by createTrip, the on-demand
   accept path, and the preview endpoint (which takes the endpoints, not a
   client-supplied km — that would be a rider-editable fare).

5. **The rider fare breakdown was invented client-side** — a fabricated "base fare"
   plus a "Platform fee (5%)" that exists nowhere. Commission is 15% and comes out of
   the DRIVER's earnings, not the rider's fare.

6. **Cash false failure:** the payment screen's `onError` read `activeBooking?.id`,
   which is React state — a booking created inside the same mutation is invisible to
   that closure, so the "did it actually go through?" re-read was skipped entirely and
   the rider got "Payment Failed" over a live booking. Fixed with a ref written
   synchronously in the mutation, plus success now means CONFIRMED/BOARDED/PAID (cash
   settles as CONFIRMED + paymentStatus PENDING), and the server re-reads the booking
   before letting a sync-method error escape.

7. **The driver puck rotated by the COMPASS** (`deviceHeading || location.heading`).
   A handset in a metal cradle reads the cradle, not the road — that is the
   over-rotation. `useVehicleHeading` (@eyego/maps) now prefers GPS course while
   moving, derives a bearing from consecutive fixes otherwise, holds the last heading
   when stopped, uses the compass only as a cold-start hint, then low-passes along the
   shortest arc with a rate limit and a 2° deadband. Rider tracking uses the same hook.

8. **Glow cards need room for their own glow.** `GradientGlowBorder` draws its bloom as
   a shadow OUTSIDE the box (deliberately un-clipped, or iOS erases it). As the first
   child of a ScrollView with no `paddingTop` the halo was cut at y=0.

## Follow-up pass (same day, user feedback)

9. **"IPMC showroom" returned nothing because the PHRASE finds nothing anywhere.**
   Measured against the live APIs with the real token: Mapbox Search Box
   `/forward` AND `/suggest`, Geocoding v5 `mapbox.places` and v6 `/forward` all
   return **0 features** for "IPMC showroom" — and Search Box returns 0 for plain
   "IPMC" and even "accra mall" in Ghana. Nominatim and Photon have both ("IPMC",
   "IPMC Main Campus", "Accra Mall"). So: Nominatim is now a first-class server-side
   source, and a query-relaxation ladder drops generic venue nouns
   ("showroom/shop/branch/office/…", never "junction/circle/market/station") then
   falls back to the longest distinctive token. Results are Ghana-bounded and
   sorted nearest-first. Verified: "IPMC showroom" → 4 results (relaxed to "IPMC"),
   "zzzqqq nonexistent place" → 0. The same relaxation is duplicated client-side so
   it works against an un-redeployed API.
10. **Where-to rows open the map picker on tap again** (both fields), per the user's
    preference for that flow — the inline type-to-search experiment is reverted. The
    picker now says "No places match X" instead of rendering nothing.
11. **Fare = distance ÷ seats, and nothing else.** The floor was `tierBaseFare`,
    which on a 14-seater outranked the distance term on almost every urban trip, so
    trips of very different lengths cost the same. Now `MIN_FARE_PER_SEAT` (₵3)
    scaled by the tier's position in the rate table (ECO ₵3 / COMFORT ₵4.80 /
    PREMIUM ₵7.20) — tier order preserved, distance back in charge. 231 km over
    8 seats = ₵87.25/seat, ₵698 total, on every screen.
12. **"Platform fee (30%)"** on the driver's active-trip card was a hardcoded label
    over a 15%-derived amount. Both the label and the create-trip "after X%
    commission" line now read `commissionRate` from the server.

## New surface area
- `packages/ui/src/CarMarker.tsx` — top-down saloon/minibus SVG, nose-up, for map markers.
- `packages/maps` → `useVehicleHeading`.
- `eyego-api/src/services/rating-integrity.service.js` — excludes chronic low-raters
  (≥5 ratings, own avg ≤2.2, ≥80% of their ratings ≤2 stars, ≥1.5 below platform avg)
  from driver averages, the go-online rating gate and dispatch ranking. 15-min
  in-process cache; must move to Redis before horizontal scaling.
- `SearchStage` is now real type-to-search: two editable fields + inline suggestions,
  keyboard/list deferred 380 ms so the morph keeps its frames; swipe-to-dismiss is
  suspended while a field is focused.

## Verification
- `tsc --noEmit` green: apps/rider, apps/driver.
- `node --check` green on all touched backend files.
- **Nothing device-tested.** expo-camera and the marker/heading work are native — OTA
  will not carry them; a fresh build is required, and the API must be redeployed.

## Open Issues
- Item 2's exact original trigger was never reproduced from logs; the fix makes the
  false-failure path impossible rather than pinning the one call that failed. If it
  recurs, the alert now shows the server's own message — capture it verbatim.
- A genuinely expired cash seat-hold still ends in "select a seat again to rebook"
  (no auto-rebook).
- Admin rating aggregates were deliberately left unfiltered (admins should see
  everything); they will read slightly lower than the driver-facing average.
