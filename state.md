# State — 17-item stress-test sweep (2026-07-29)

## Current Goal
All 17 reported issues fixed. Awaiting device testing.

## Decisions (user-confirmed this session)
- Provider: **Mapbox Search + Directions**, proxied through the backend. `eyego-api/.env`
  already holds a real `MAPBOX_SECRET_TOKEN`; the secret must never ship in an app bundle.
- Item 3 dispatch map: **real driver positions, real polyline** to the currently-offered driver.
- Dispatch debugging: inferred from code (no live server logs available).

## Root causes worth remembering

1. **`MorphTarget`'s inner `Animated.View` had no `flex: 1`.** Full-screen morph targets
   collapsed to content height, so `absoluteFill` MapViews measured 0×0 and drew nothing.
   This was the black tracking map, and would have hit any future full-screen morph target.

2. **`SelectStage` painted an opaque `backgroundDeep` over the persistent TripMap.** The map
   was never broken — just covered. Explains why the search stage looked fine.

3. **Broadcast dispatch had no "driver being asked".** Replaced with a sequential cascade
   (`services/dispatch-cascade.service.js`). The old `dispatch.service.js` also filtered
   candidates by `fcmToken: { not: null }` and then emitted sockets over that same filtered
   list, so a driver without an FCM token got nothing at all.

4. **`getPendingTripRequests` handed every recent request to every polling driver.** This
   silently re-created a broadcast behind the cascade's back. Now scoped to the offer holder.

5. **Free-flow routing everywhere.** Clients called `router.project-osrm.org` directly and
   `mapbox.service.getDirections` used the `driving` profile. Both return empty-road times —
   the "8.3 km ≈ 12 min" figure. Now `driving-traffic` via `/v1/geo/route`.

6. **Empty `bookingId` interpolated into API paths** produced `/bookings//pickup`, which
   Express 404s as "Route PATCH … not found". One cause for BOTH the group-hub invite-link
   failure and the pickup-update failure.

7. **Cash bookings are `CONFIRMED` at creation with `paymentStatus: 'PENDING'`.** Pressing
   "Pay in cash" then hit `confirmPayment`'s SEAT_HELD guard and threw "seat hold expired",
   surfacing as "Payment failed" on a perfectly valid booking.

8. **Marker `rotation` had a hardcoded `+ 45`** on both driver map screens. `rotation` is a
   TRUE compass bearing that `@eyego/maps` compensates against map bearing; the glyph's
   artwork tilt must live on the glyph, not folded into the bearing. That 45° error is why
   the pin turned with the phone but pointed at the wrong thing.

## Verification
- `tsc --noEmit` green for `apps/rider` and `apps/driver`.
- `node --check` green on all 16 touched/created backend files.
- `prisma validate` green.
- **Nothing device-tested.** Native map/morph changes need a fresh build (not OTA-safe).

## Open Issues
- The cascade keeps state in a module-level `Map` with real timers, so it is per-process.
  Fine for the single API instance today; must move to Redis before horizontal scaling.
- `legacyBroadcastRequestToDrivers` in `trip-request.service.js` is dead code kept only for
  reference — safe to delete.
- Item 2's trigger may have been leftover test trips: a driver-created `SCHEDULED`/`FILLING`
  trip departing within 45 min marks that driver busy in `driver-availability.js`.
