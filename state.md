# State — Stress Sweep 2026-08-11b (items 1–32)

## Current Goal
32-item stress list. Items 8–22 were TRUNCATED out of the user's message and
are unrecoverable — user will re-capture them in the next stress round.
Everything else must be finished this session ("dont end till its done").

## Answers locked from the user (do not re-ask)
- **#4 where-to**: full-screen route mirroring `apps/driver/app/(trip)/create.tsx`;
  suggestions = saved Home/Work + recents ONLY (no POIs, no "use current location").
- **#1 back nav**: header chevron on every stage past the first + Android
  hardware back + iOS edge-swipe step back ONE stage; backing out of Request
  cancels the ride request.
- **#28 door pickup**: fee = `max(minFee, detourKm × perKmRate)`, gated to a max
  detour radius, offered as a Configure-stage toggle on ALL trips, folded into
  the quote before Request.
- **#28 at-pickup test**: driver GPS within **150 m** of trip pickup at Start →
  skip "driver on the way", show "Driver is at the pickup point"; outside →
  DRIVER_EN_ROUTE "Driving to pickup point".
- **#24 driver redesign**: port rider `TrackingStage` visual system wholesale
  (map treatment, glass panel, glow borders, motion timings); re-skin seat map,
  status stepper, swipe action into that shell. Absorbs #5 and #26.

## Delivered — 2 commits
- `6b91f19` #2, #3, #6, #31
- `44720bf` #4 (SearchStage rebuilt as driver-style full-screen Skia surface)

## Root causes worth not re-deriving
- **#2/#3 are ONE chain.** `requestRide` calls `fareQuote.redeemQuote` (a
  destructive single-use Redis DEL) BEFORE `startCascade`, which can throw.
  503 "couldn't send request" → retry sends the same quoteId at a deleted key →
  "this price has expired". Fix: `restoreQuote()` + `giveQuoteBack()` on every
  post-redemption failure path, plus a one-shot client re-quote on FARE_EXPIRED.
- **The orphan.** Trip+Booking COMMIT before dispatch is attempted, and the
  terminal write was `.catch(() => {})`. A trip that could not transition stayed
  REQUESTED with a CONFIRMED booking and no driver forever. Added `failTripHard`
  (applyTransition, then a direct terminal write as fallback).
- **`getActiveBooking`'s terminal list** never learned `NO_DRIVERS_FOUND` or
  `NO_SHOW`, so the orphan came back as the rider's ACTIVE booking. Rider home's
  `TERMINAL_TRIP` was missing `NO_DRIVERS_FOUND`/`REASSIGNING` too. Card now
  additionally REQUIRES `trip.driverId` — the user's "rider and driver in
  agreement" rule. (`driver` select has no `id`; use the `driverId` scalar.)
- **#6**: `FareBreakdownSheet` prop was `fare: number` with no unit; caller
  passed pesewas → "GH₵720" over a page saying 7.20. Renamed `farePesewas`,
  routed through `formatGhs`. `platformFeePesewas` was misnamed (it is cedis).
- **#31**: `User` has NO `rating` column. Rider ratings live in
  `PassengerRating[]` and nothing aggregated them, so `freshProfile?.rating` was
  always undefined and the chip was hidden. Now aggregated in `getMe`.
- **where-to.tsx is only a redirect stub.** The real screen is
  `components/trip/stages/SearchStage.tsx` inside the persistent trip surface
  (`app/trip.tsx`).
- `GradientGlowBorder` requires `fillColor`; the glow reach cap is
  **`maxGlowRadius`**, not `glowMaxRadius`.
- Rider Skia bg usage: `<AppBackground variant="static" isDark={isDark} />`
  with `isDark` from `stores/theme.store`.

## Remaining (task list IDs)
- #3 — multistep polish: Skia bg + glow borders + per-stage back nav (item 1)
- #5 — public /invite + /track: road polyline, load speed, ETA, brand parity (7, 25)
- #6 — driver manage: clipped top strip + slow status chips (5, 26)
- #7 — port rider tracking aesthetic to driver manage + swipe-to-start (24)
- #8 — pickup-point semantics + paid door pickup (28, 29)
- #9 — post-trip home renders under the opaque map (30)

## Evidence
- `apps/rider` `tsc --noEmit` **exit 0** after every commit.
- `node --check` clean on all changed backend files.
- **Nothing device-tested.** Item 27 needs no work (user confirmed ETA correct).
- Item 23 is only half-visible in the transcript; cannot action.

## Build/tooling
- `npx` is broken here. Use `node node_modules/typescript/lib/tsc.js --noEmit`
  from inside `apps/<app>`.
