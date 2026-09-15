# State — 2026-09-15

## Current Goal
Ship the 12-item device-test pass (user list of 2026-09-15). Caveman + ponytail + context-management active.

## ROOT CAUSE FOUND (drives items 3, 5, 6, 8, likely 4 + 10)
`Booking.dropoffStopId` was added to schema.prisma in 7d558c3 with NO migration file.
Generated client selected a column the local DB lacked → every Booking `include`
(getTripById, getActiveTrip, booking.create in POST /rides, payment init) 500'd.
`getAllTrips` uses `select` → worked → that is why Trips tab saw the trip but Home did not.
- DONE: wrote `eyego-api/prisma/migrations/20260914120000_booking_alighting_stop/migration.sql`
  (verified with `prisma migrate diff` = empty) and APPLIED to local docker DB.
- DONE: `server.js` `assertMigrationsApplied()` boot guard (refuses boot on pending migrations;
  `PRISMA_ALLOW_PENDING_MIGRATIONS=true` escape hatch). Called after `connectWithRetry()`.
- Local API was NOT running when checked; user must restart `npm run dev` in eyego-api.

## Item plan / status
COMMITTED 8d0d284: migration+boot guard, items 1 (gutter 20 + camera first stop + idle follow), 2 (picker lists hide on gesture),
3 (Home pill off request stage; server msg surfaced), 8 (server msg), 9 (payout cache), 10 (forfeit confirm, payment-screen promo row, rounded discount).
Both apps tsc green. REMAINING: 11 send credits, 12 where-to morph, 7 seat page. NOTE: python file writes → use newline='' (CRLF warnings).
1. Driver home gutter + blank map — DIAGNOSED, NOT EDITED.
   - Gutter: `MapSheetHost` body = `spacing['2xl']` (32). Rider home uses 20. Fix: `DriverSheetHost`
     pass `bodyStyle={{ paddingHorizontal: spacing.lg }}`; also header `left/right` spacing['2xl']→lg in home.tsx styles.
   - Blank map: `DriverTripMap` `<MapboxGL.Camera ref>` has NO first stop (old home had
     `centerCoordinate=[-0.187,5.6037] zoom 13/14`). Idle = no target → planCamera 'none' → zoom-0 world.
     Fix in DriverTripMap: Camera `centerCoordinate={location ?? ACCRA}` `zoomLevel={14}`; and mode
     `target ? 'followCourse' : 'follow'` when idle (no nav pitch/rotation on idle home).
2. Rider map picker: hide suggestions on map move — TODO (apps/rider/app/profile/place-picker.tsx or where-to / ride pickup picker; find the map-drag handler + suggestions list).
3. Requesting page: "couldn't send" = migration (fixed). Top-right recenter + home button while a back
   button exists on the left — TODO: `apps/rider/components/trip/stages/RequestStage.tsx` ~line 683 comment mentions it; also `SearchingPanel`. Remove the home button (top-right), keep back.
4. Driver "trip completed" for unsent trip — likely fallout of the 500s; re-test after migration. No COMPLETED TripEvent today in DB.
5/6. Driver create → black page + unfinished trip not on home + blank detail = migration (fixed). Verify `getActiveTrip` on home after restart.
7. Seat page replica of `screenshots/seat.jpg` — TODO (big). Reference: dark bg, van seen from above nose-LEFT (landscape art; in portrait rotate nose-up), glowing white outline body, legend pill (Available outline / Selected red glow / Occupied muted with icon), seats = rounded-rect glyphs with rotated numbers, price tooltip "GHS 45.00 Standard" above selected seat, driver seat + steering wheel, sliding door with green LED strip. Current file: `apps/rider/app/ride/[id]/seat.tsx` (commit 8e7ccb2 did a top-down car with faked perspective; user says "still looks the same" + "Your seat / Seat 3" text overlapped by glow button + fare section overlapped). Fluid entry animations required. User invited questions.
8. Payment init failed — migration likely; also verify Paystack keys in eyego-api/.env + payment provider seam (`PAYMENT_PROVIDER`).
9. Payout account save wiped on reopen — TODO: `apps/driver/app/(profile)/payout-account.tsx` + backend driver payout route; likely saved field names ≠ read field names.
10. Promo apply not enforced / not shown on booking — TODO: `apps/rider/app/profile/promotions.tsx` + backend promotions; single active promo, forfeit flow, show on fare.
11. Send ride credits E2E — TODO: `apps/rider/app/profile/send-money.tsx`, `pay/[phone].tsx`, backend wallet transfer.
12. Where-to morph smoothness — TODO: research packages/ui/src/motion (MorphProvider, springs.morph), memory `project_morph_cost_is_the_mount.md`, `project_motion_stack_is_mature.md`, rider home where-to card → where-to.tsx. Last session: ζ≈0.82, ~510ms, clone held. "Last time we do this" — do extensive research.

## Env facts
- API dev target: phone hits Metro host machine :3000 (`packages/api/src/client.ts` resolveBaseUrl). DB = local docker `eyego-postgres` (user from .env), redis local.
- `node node_modules/prisma/build/index.js <cmd>` works (npx broken).
- tsc: `node node_modules/typescript/lib/tsc.js -p apps/<app>` per memory.
- Today's DB: one trip `cmu2o1ct9003j12oiln51z4pj` FILLING (driver-created 12:46), no rider trips.

## Open Issues
- Nothing device-tested. Need user to restart API, then re-test 3/4/5/6/8.
