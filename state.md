# State

## Current Goal
Ship the 12-item sweep of 2026-08-27 (aesthetics + seat/fare correctness).

## Plan Status
All 12 items implemented. Both apps typecheck clean; backend files pass `node --check`.
NOT device-tested, and the runtime e2e suite was not run (API not running locally).

## Decisions
- `Card` forwards `glowPalette` whether or not the ring rotates; `animated` now
  controls motion only. This was the Comfort-is-green bug.
- Dispatch screen inverted: full-bleed pannable map + docked glass sheet, no ring.
  `DispatchOfferCard` gained `variant: 'card' | 'sheet'`; the takeover sheet keeps
  `'card'` (ring + inner mini map) unchanged.
- Offline passengers are refused on on-demand trips and counted as PEOPLE
  (`Booking.seats`), server-side in `assertSeatIsSellable`.
- Driver ratings are aggregate-only. The per-rating list is removed from the API
  response, not just hidden in the app.
- Pre-departure trips get a `toPickup` leg when the driver is far from the pickup,
  and the drop-off preview is anchored at the pickup rather than at the driver.

## Evidence
- `node node_modules/typescript/lib/tsc.js --noEmit -p apps/{driver,rider}/tsconfig.json` — both silent.
- `node --check` on the 5 changed backend files — all OK.

## Open Issues
- Runtime e2e (`scripts/e2e`) not run; needs the API on :5000.
- Two rotating glow rings now co-exist on the Services screen (Premium + Comfort),
  against GradientGlowBorder's one-per-screen note. Requested explicitly; watch FPS
  on a low-end device.
