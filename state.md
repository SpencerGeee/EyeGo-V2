# State — Stress Sweep 2026-08-11 (23 items)

## Current Goal
23-item stress-test list from device testing on `main`. Working through
task list #1–#18 (23 user items grouped into 18 tasks).

## Key facts discovered this session (do not re-derive)
- **Dispatch (item 3) root cause**: driver socket is `autoConnect:false`; the
  ONLY caller of `connectDriverSocket()` was `watch()`, which runs when the
  driver is ALREADY on a trip. An idle driver held a socket that never dialled.
  Server side was fine (`socket.join('driver:<id>')` at driver.socket.js:243,
  `publishOfferToDriver` → that room).
- **Fare "—" (item 2)**: `ridesApi.quote` returns `amountPesewas`.
  ConfigureStage read `farePesewas ?? fareAmountPesewas ?? totalPesewas` —
  none exist, so it always coalesced to null.
- `GradientGlowBorder` palette `brandGreen` IS the where-to green glow
  (`#4BE277` / `#1FAE52`). Use it for item 22.
- Driver reference design for paged forms: `apps/driver/app/(trip)/create.tsx`
  (AppBackground + header + StepIndicator + ScrollView + pinned footer).
- `npx` is broken here. Typecheck with:
  `cd apps/<app> && node ../../node_modules/typescript/lib/tsc.js --noEmit`

## Plan Status

### DONE (not yet committed)
- **Task 2 / item 3** dispatch offer never reached driver:
  - `apps/driver/stores/trip.store.ts` — `listenForOffers()` now takes a
    refcounted `connectDriverSocket()`, re-hydrates on every `connect`, and
    releases on teardown. `hydrate()` adopts a REST-delivered offer.
  - `eyego-api/src/services/dispatch-cascade.service.js` — offers mirrored to
    `dispatch:offer:driver:<id>` (self-expiring); `forgetOffer` on decline /
    accept / cancel / timeout; exports `getOfferForDriver`, `forgetOffer`.
  - `eyego-api/src/modules/rides/rides.service.js` — `getDriverState` returns
    `offer` (suppressed while on a trip).
  - `packages/api/src/rides.api.ts` — `PendingOffer` type on DriverStateResponse.
  - `apps/driver/app/_layout.tsx` — `TRIP_OFFER` push had NO case and fell to
    the catch-all, opening `(trip)/active/<id>` for an unowned trip. Now
    hydrates (tap + foreground-received).
- **Task 1 / items 1,2** rider multistep:
  - `apps/rider/components/trip/stages/ConfigureStage.tsx` REWRITTEN from an
    InlayPanel over the map (fixed 62 % height → clipped content) into a
    full-bleed screen on `AppBackground` with header, animated step rail,
    ScrollView body, pinned footer. Per-tier prices now quoted in parallel.
    Review card uses `brandGreen` glow.

### REMAINING — tasks #3–#18
3 driver DestinationModeCard layout + glow · 4 rider ghost live-trip card after
cancel · 5 driver home panel initial snap height · 6 invite page (map/480 vs
4.80/overlap/theme) · 7 coverAll fare on tracking + driver earnings ·
8 pickup update not reaching driver · 9 driver tracking panel height +
pre-start ETA/polyline · 10 chat badges + keyboard covering input (both chats) ·
11 driver manage/tracking redesign · 12 perf pass · 13 public tracking page
(MANDATORY: straight line, ETA 64 vs 16, stuck card, theme) · 14 rider/driver
status discrepancy · 15 swipe bounciness · 16 route end pins · 17 rider
tracking glow borders · 18 complete-screen 0 flash

## Evidence
- `tsc --noEmit` exit 0 for apps/rider and apps/driver after the above.
- `node --check` clean on both changed backend files.
- Nothing device-tested.

## Open Issues
- Migration `20260810120000_driver_destination_mode` still NOT applied.
- `(trip)/dispatch/[id].tsx` is still the legacy scheduled/route offer screen;
  the new sheet handles on-demand only.
