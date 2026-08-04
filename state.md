# State — MVP/enterprise completion pass (2026-08-04, IN PROGRESS)

## Current Goal
Take the whole product from "pages done" to Uber/Bolt-grade. User approved MAX
scope: full map rebuild, money→pesewas, realtime+location, payments, safety,
and putting the group/bus flow on the same state machine.

## Startup (unchanged)
Dev infra is **Neon (Postgres) + Upstash (Redis)**. API port **5020**.
`npx` is broken — always `node node_modules/prisma/build/index.js …` and
`node node_modules/typescript/lib/tsc.js …`.

## Plan Status

| # | Phase | State |
|---|-------|-------|
| P0 | Commit 7-phase rewire checkpoint | **DONE** `f979058` |
| P1 | Money → integer pesewas | **DONE** `1197846` (server) + `fa9446c` (apps) |
| P2 | Map rebuild | **PART DONE** `7f3e4ab` — primitives built, screens NOT wired |
| P3 | Realtime + location pipeline | not started |
| P4 | Money-adjacent flows (Paystack idempotency, refunds, ledger) | not started |
| P5 | Safety + comms (chat outbox, SOS, masked calls, share links) | not started |
| P6 | Group/bus flow onto the state machine | not started |

## P1 — money (complete, verified)
25 money columns are `Int` pesewas and **renamed with a `Pesewas` suffix**. The
rename IS the safety mechanism: retyping `fareAmount` in place would leave every
read site compiling and charging 100×. Rules now in force:
1. `eyego-api/src/utils/money.js` is the ONLY place a `*100` / `/100` is allowed.
2. Commission is taken and the driver keeps the REMAINDER — never `fare * 0.85`.
3. Splitting uses `split()` (largest-remainder) so N shares sum back exactly.
4. Paystack takes `amountPesewas` and sends it UNCHANGED — the `*100` is deleted.
5. Clients never do money arithmetic. `formatGhs(pesewas)` only; `formatCurrency`
   is deleted so the compiler finds every site.
Migration is hand-written (add → backfill `ROUND(old*100)` → drop). Applied to
the live DB. 22 jest invariants in `eyego-api/__tests__/money.pesewas.test.js`.

**Live blocker fixed on the way:** `fare-quote.service.js` signed with
`env.JWT_SECRET`, which is not in the env schema (zod strips it) → `undefined` →
`createHmac` threw → **every fare quote 500'd**. Now `JWT_ACCESS_SECRET`,
asserted at load.

## P2 — map (primitives done, wiring NOT done)
Built in `packages/maps/src/`:
- `puck.ts` — GPS fixes → continuous motion. Shortest-angle bearing (the
  359°→1° spin), heading held below walking pace, settles instead of dead
  reckoning, interpolates over the observed sample gap.
- `camera.ts` — modes `overview | follow | followCourse | free`. Stage requests,
  user gesture always wins, auto-resume after 12s. `boundsFor` can never return
  a degenerate box — **that, not NaN, is the map SIGABRT cause**.
- `useMapCamera.ts` — rAF loop drives the camera imperatively, republishes React
  state at 400ms. Only `isUserInteraction` releases the camera.
29 behaviour checks pass (run against transpiled modules — `packages/*` has no
jest runner, so the committed `.test.ts` is not in CI).

### P2 REMAINING — this is the actual "map isn't built right" fix
1. **Five MapView instances** exist: rider `TripMap.tsx`, rider
   `ride/[id]/tracking.tsx`, driver `(trip)/active/[id].tsx` (TWO, at ~line 353
   and ~432), driver `(trip)/tracking/[id].tsx`. Uber has ONE persistent map;
   every screen mounting its own is why navigation feels like a teardown.
2. Point all of them at `useMapCamera` and **delete their local camera code**
   (`recenterCamera`, bespoke `setCamera`, per-screen pitch constants).
3. `apps/rider/components/trip/useTripCamera.ts` is superseded — fold its
   sheet-padding into `paddingForSheet` and delete it.
4. **Route geometry must come from the server trip snapshot**, not per-screen
   Mapbox calls (see `routeRetryTimerRef` in rider tracking.tsx). Add it to
   `trip-view.js` `buildTripSnapshot`.
5. Driver navigation: off-route detection + re-route request.

## Open Issues
- Nothing has been run on a device this session. Both apps tsc-clean, backend
  boots clean against Neon+Upstash, `/health/dispatch` green — but no ride has
  been requested end to end.
- `packages/*` has no jest runner; two committed test files are not in CI.
- Still unaudited (from the previous pass): chat outbox, SOS delivery, driver
  foreground-service call sites, iOS background location, Paystack capture
  idempotency. These are P3–P5.
