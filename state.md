# State — 2026-09-17

## Current Goal
15-item device report (2026-09-17). ALL ITEMS ADDRESSED IN CODE. Rider tsc green; driver tsc +
maps tests + api geo test run at end of session (see Evidence). NOT device-tested. NOT committed.
Plan/root causes: docs/superpowers/plans/2026-09-17-fifteen-item-pass.md.

## What changed per item
1–2. Morph: clone draws its ring on frame one (`CloneSizeContext`), overlay `overflow: visible`
   (halo), source hidden only while a clone flies, deferred-pop reverse fades the surface on the
   flight, `landingKey` shared prediction (`utils/morphKeys.ts`).
3. `trip.store` OFFER handler dropped `geometry`; `offerFromPayload` keeps it; mini map draws the
   road as the hero approach line; a tapped row fetches its leg via `/geo/route`.
4. Card always has a deadline (`searchExpiresAtServerMs` on rows); `PerimeterDrain` frame; m:ss digits.
5. Home board = rows only ("New request" / "Offered to you" headline + direction hint); map card gone.
6. Driver: ONE offer renderer (root `DispatchOfferSheet`, held ?? focused row); `dispatch/[id]` +
   `tracking/[id]` are shims; `_layout` push taps + legacy `trip:assigned` → hydrate + openOffer.
   Rider: `TripStatusListener` tripId guard; `watch(newId)` clears the previous trip's snapshot.
7. Seat page: `RouteDropoffMap` (route drawn, centre pin snapped ≤150 m); server `resolveDropoff`
   + `Booking.dropoffLat/Lng/Address` (MIGRATION `20260917100000_booking_free_dropoff` — NOT applied);
   `GET /trips/:id` carries `path`; driver stop list uses the booking's own drop coords.
8. `priceSeat()` = the one pricing path; `POST /bookings/preview` shown on seat + payment pages.
9–13. Driver trip = stages on home: `deriveDriverStage(activeTrip.status)` (was never passed);
   `TripStages` in rider tracking language; swipe `key={status}`; manage page has no map
   (`StopTimelineSurface` = header + list + action); accept/create → `goOut(home)`.
   `DriverTripMap` = native `trackUserLocation="course"` + native puck + `contentInset`.
   Deleted: DispatchOfferStage, DispatchLiveMap, LiveTripCard, TripSurfaceShell.
14. `goFresh(href)` (dismissAll + push): payment → trip surface; complete → `goOut(home)`.
   Biometrics: `useBiometricGate`/`BiometricLock` (packages/ui/src/security); rider wallet +
   driver earnings; `expo-local-authentication ~17.0.7` added to both apps + app.json plugin.

## Evidence
- `node node_modules/typescript/lib/tsc.js -p apps/rider --noEmit` → exit 0.
- `node scripts/e2e/conditional-hooks.mjs` → green. `button-wiring.mjs` → green once tracking became `<Redirect>`.
- Driver tsc / maps tests / `jest src/utils/geo.test.js` → see session end; fix anything red before push.

## Open Issues
- `yarn install` TIMED OUT (TLS) — lock files NOT regenerated. Run `yarn` then
  `npm install --package-lock-only` before pushing (both locks, per project rule).
- New native build required (expo-local-authentication). Prisma migration must be applied
  (`prisma migrate deploy`) or every Booking endpoint 500s at boot (boot refuses pending migrations).
- Nothing device-tested: native tracking camera feel, contentInset on Android, PerimeterDrain on
  Android (SVG dash), morph halo with `overflow: visible` on Android hardware texture.
- Driver home `openOffer` const now unused (harmless). `useMapCamera` only serves the rider now.
