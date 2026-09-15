# State — 2026-09-15

## Current Goal
12-item device-test pass from the 2026-09-15 report. ALL ITEMS ADDRESSED IN CODE.
Commits: 8d0d284, f26f363, 5ae4869 (+ this docs commit). NOT pushed. NOTHING device-tested.

## Root cause behind items 3, 5, 6, 8 (and probably 4, 10)
`Booking.dropoffStopId` entered schema.prisma in 7d558c3 with NO migration file → the
generated client selected a column the local DB lacked → every Booking include/create 500'd.
- Migration `20260914120000_booking_alighting_stop` written, diff-verified empty, APPLIED to local docker DB.
- `server.js assertMigrationsApplied()` refuses boot with pending migrations (escape: `PRISMA_ALLOW_PENDING_MIGRATIONS=true`).
- USER MUST RESTART the local API (`npm run dev` in eyego-api) — it was not running when checked.

## What changed per item
1. Driver home: sheet gutter 32→20 (`DriverSheetHost bodyStyle`), header inset 32→20; `DriverTripMap` Camera gets a first stop (puck or Accra), idle mode `follow` not `followCourse` (no target → never commanded → zoom-0 blank).
2. `place-picker.tsx`: all three lists hide on `onUserGesture`, keyboard dismissed; return on input focus/typing.
3. Request stage: Home pill removed for `request` (`trip.tsx` `!stageOwnsTopLeft`); the panel already has "Leave without cancelling". Server message now surfaced on failure.
4. No code change — no COMPLETED event exists in the DB for today; retest after API restart, report trip id if it recurs.
5/6. Migration. `getActiveTrip` (home) and `getTripById` (active page) use `include` → were the 500s; `getAllTrips` uses `select` → Trips tab worked.
7. `VehicleCabin.tsx` rewritten: SVG replica of seat.jpg nose-up (lit outline draws in ~900ms, windscreen/headlights/mirrors/arches, right-side sliding door + green strip, driver wheel left, seat glyphs with headrest/armrests, halo on selected, crossed-out figure on occupied, price tag above selection, rows fade in front→back). `layoutFor` now: front seat, rows of L/aisle/R, rear bench ≤4. Legend pill. Header "Select seat · route • Minibus 15-Seater • n free". Sheet overlap fixed: `gap` moved onto `sheetBody` wrapper (MorphSheet leaves non-padding style on the surface view).
8. Migration + payment screen shows the server's message instead of a fixed line.
9. `payout-account.tsx`: onSuccess writes payload into `['payout-account']` cache + invalidates (5-min staleTime served the empty pre-save answer).
10. `promotions.tsx`: swapping a held code asks to forfeit (Alert); offers/Apply disabled while a promo is applied on the live booking. `payment.tsx`: pending promo row with estimated discount + remove, before the charge. Server: discount `Math.round` (Int column rejected 682.5).
11. `POST /wallet/send`: recipient gets push (pref-gated, after commit) + `wallet:credited` socket frame; rider `TripStatusListener` invalidates wallet queries + banner; sender form clears + goBack, transactions invalidated.
12. `MorphProvider`: flight opens the transition clock (`beginTransition(1000)`) at take-off, releases after the clone crossfade / on cleanup. `trip.tsx`: map + AppBackground mounts wait on `afterTransition`, not `runAfterInteractions` (a Reanimated spring registers no interaction handle → MapLibre mounted mid-flight on the main thread).

## Design choices to confirm with user (item 7)
- Selected seat uses the app accent (green), reading the legend's "Glowing Accent" literally; the reference's red is available by passing `accent`.
- Numbers upright, not rotated with the body. 3D "camera swing" from last pass removed in favour of the outline draw-in.
- Ghana layout: driver LEFT, sliding door RIGHT.

## Env facts
- Phone → Metro host :3000 in dev (`packages/api/src/client.ts`). DB = docker `eyego-postgres`, redis local.
- `node node_modules/prisma/build/index.js <cmd>`; tsc `node node_modules/typescript/lib/tsc.js -p apps/<app> --noEmit` (rider tsc covers packages via paths).
- Python edits: `open(p,'w',newline='')` to keep CRLF/LF.

## Open Issues
- Nothing device-tested. Item 4 unexplained. Both apps tsc green at 5ae4869.
