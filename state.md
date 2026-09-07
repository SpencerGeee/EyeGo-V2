# State — 2026-09-07 completion pass

## Current Goal
Nine items from a real two-device test. Plan: `docs/plans/2026-09-07-completion-pass.md`.

## Decisions taken (user-confirmed)
- Item 4 → build a real scan-to-pay sheet for driver trip codes.
- Item 2 → route IMMEDIATE trip-requests through the existing cascade; leave
  genuinely scheduled ones broadcasting. Do NOT build a second dispatch engine.
- Item 7 → H3 as a spatial index layer (k-ring candidate expansion, cell-keyed
  surge/heatmap). Keep road-ETA ranking as the matcher.

## Plan Status

### DONE (both apps `tsc --noEmit` clean)
- **Item 5 — multi-seat 409.** `RequestStage` re-quoted without `seatCount`, so
  the quote was signed for a party of 1 while the request sent 3 →
  `rides.service.js:350` threw 409 `FARE_EXPIRED`. Both calls now read one
  `chosenSeats`. Stale comments in `rides.api.ts` and `rides.service.js` that
  claimed the party was capacity-only have been corrected — they were the
  reason the bug was written.
- **Item 1 — driver lag.** Three fixes:
  1. `AppBackground.variant` now defaults to `'static'`; the two root layouts
     opt in with `variant="animated"`. Was `'animated'`, and the driver app
     never overrode it — 34 mounts all asking for a live raymarch, incl. over
     the tracking map. Rider had spelled out `static` on 14 screens.
  2. `usePerformanceTier` rewritten: adds a real `'mid'` tier and MEASURES the
     device (rAF p75 probe, once, 4s after launch, latched, downgrade-only).
     Previously every iPhone was `'high'` — only Android API<31 ever degraded.
     Consumers taught about `'mid'`: cheap raymarch kernel + 20fps
     (LightPillarBackground), blur/chroma off (GlassSurface), ring rotation off
     (GradientGlowBorder).
  3. New `packages/ui/src/effects/ChromeBlur.tsx` — blur on `'high'` only, flat
     fill otherwise. Swapped the 3 raw `<BlurView>`s on driver tracking (they
     sat over a live MapView, so they were re-sampled every GPS frame) and the
     driver tab bar.
- **Item 9 — straight approach line.** `geo.controller` now forwards a
  whitelisted `profile` (`getRoute` always accepted one and nothing passed it);
  `walking`/`cycling` skip the driving re-timing. Rider gains
  `fetchWalkingRoute`; `TripMap.approachLine` uses real walking geometry, keyed
  on rounded endpoints so GPS jitter does not refetch. Straight line kept as
  the fallback.

- **Item 2 (the reported symptom) — FIXED.** `listSearchesForDriver` had NO
  radius and NO candidacy filter: it listed every live MATCHING/REASSIGNING
  trip in the world to every driver. So a driver saw banner rows for rides they
  were never a candidate for and could never be offered — "banner, but no
  popup". Now scoped to `dispatchFinalRadiusKm()` from the driver's supply-index
  position; a held offer is never filtered out. The popup path itself was
  already correct and was NOT touched.
- **Item 3 — dispatch screen crowding.** Top chrome (back control, "Held for
  you" pill, scrim) now auto-hides after 3.2s idle and returns on map
  interaction, via a new `onUserInteraction` prop on `DispatchLiveMap`. The
  offer card and countdown never hide. The "Frame the ride" FAB was already
  correctly gated on `!framed` — left alone.
- **QA harness.** Two new suites, both registered in `run-all.mjs`:
  - `scripts/e2e/ui-invariants.mjs` — source-level, no stack, ~1s. 15 checks:
    one animated background per app, the default is static, the tier has a
    'mid' rung and is measured + downgrade-only, 'mid' is actually cheaper in
    all three consumers, no raw `<BlurView>` over a live map, dispatch chrome
    auto-hides but the offer card does not, RequestStage quotes what it
    requests. **RUN: 15/15 green.** It immediately caught a real second
    animated background in `apps/rider/app/scheduled/[id].tsx` (now fixed).
  - `scripts/e2e/completion-pass.mjs` — API-level, needs a live stack. Covers
    multi-seat success + the 409 guard still biting, the walking profile
    (route not ruler, not silently driving, bad profile refused), and the
    dispatch board radius (far driver excluded, near driver still served).
    **NOT YET RUN — needs the local stack up.**

- **Item 2 (second half) — DONE.** `createRequest` now splits on
  `isImmediate(scheduledTime)` (new `REQUEST_IMMEDIATE_WINDOW_MINUTES` setting,
  default 15). Immediate + has coords → `dispatchImmediately()` mints a
  server-side quote and delegates to `rides.requestRide`, which is the proven
  on-demand path: Trip row, price lock, booking, concurrency guard, idempotency
  (keyed on the request id) and `startCascade`. The request row closes to
  ACCEPTED + `matchedTripId`. Anything further out still broadcasts — that is
  correct, not a gap. Falls back to the board if the quote or the ride fails.
  **Deliberately NOT done:** teaching the cascade about `TripRequest`s. That is
  a second dispatch engine; the cascade is keyed on a real Trip everywhere.
- **Item 4 — DONE.** New `apps/rider/app/pay/trip/[id].tsx`: driver, vehicle,
  one seat, fare, wallet balance, one Pay button. Books + charges via
  `bookingsApi.create` → `paymentsApi.initialize` (WALLET), disables after the
  first press, `router.replace` so Back cannot charge twice. Short balance
  offers a top-up rather than silently reopening the booking screen.
  `scan-pay.tsx` now routes trip codes here instead of `/ride/[id]`.
- **Item 6 — DONE (small).** Was ~90% built: `TripMap` already highlights the
  candidate's pin and draws a real road route to them. The missing piece was
  the number — the server has sent `etaSeconds` on every DISPATCH_PROGRESS
  frame all along and the store kept it, but nothing rendered it. Panel now
  reads "Asking a driver 4 min away · 2 of 5".
- **Item 7 — DONE.** `h3-js@4.5.0` added. New
  `eyego-api/src/services/h3-index.service.js` owns the cell vocabulary (res 8).
  `supply-index` maintains `supply:h3:<cell>` sets alongside the geo-set (and
  cleans them on move + on removal); `driversInCells` / `supplyByCell` added.
  `matcher.rankCandidates` runs a hex sweep as a SECOND door and UNIONs it with
  the geo circle — ranking is still road ETA, untouched. Heatmap now keys
  buckets by H3 cell so demand and supply share one vocabulary.
  **Non-obvious:** ring sizing is CALIBRATED at load, not derived. The textbook
  `edge·√3` (~0.92 km/ring) over-states reach by ~30% because the global average
  edge is not the local cell size and `gridDistance` counts cells on a distorted
  grid. Measured value is ~0.66 km/ring. The harness caught this.

## Harness

`scripts/e2e` is now 15 suites. Three run with no stack at all:

**FULL RUN 2026-09-07: 424/424 checks, 15/15 suites**, in order, no manual pool
reset. `ui-invariants` (19) and `h3-index` (17) need no stack and run in ~1s.

The three new suites earned their keep on the first run:
- `ui-invariants` caught a second animated `AppBackground` in
  `apps/rider/app/scheduled/[id].tsx`.
- `h3-index` caught the ring-sizing bug (sweeps under-covered by ~35%).
- `completion-pass` caught itself: it left two drivers online at the standard
  Accra pickup, which starved `rider-happy-path`'s driver of its offer and cost
  that suite 10 checks — while reporting 19/19 itself. Fixed with the `finally`
  sign-out every other suite already had. **Convention: any suite that calls
  `goOnline` MUST `/driver/go-offline` in a `finally`, and must set
  `process.exitCode` rather than calling `process.exit()`, or the `finally`
  never runs.**

None of the three was visible to `tsc` or to a single-suite run.

## Evidence
- On-demand dispatch popup chain verified CORRECT end to end — `offerNext` →
  `rememberOffer` → `/rides/driver/state` → 2s poll in `app/_layout.tsx` →
  `DispatchOfferSheet`. Do not "fix" it. The gap is only `trip-request.service`.
- `apps/rider` and `apps/driver` both `tsc --noEmit` clean as of this entry.

## Open Issues
- Nothing has been run on a device; all verification so far is static + tsc.
- `npx` is broken here — use `node node_modules/typescript/lib/tsc.js`.
