# State — Uber-grade rewire (COMPLETE, 2026-08-03)

## Status
All 7 phases built. `prisma validate` green, all `src/*.js` pass `node --check`,
all 14 new backend modules load, **rider + driver both tsc-clean (0 errors)**.
**Nothing has served a request yet** — no Postgres instance has been run.

Read `docs/research/REWIRE-RUNBOOK.md` first. It has the startup commands, the
five architectural rules, a file-by-file map, and what was deliberately left out.

## Startup (dev is now Postgres + Redis, both required)
```
cd eyego-api && docker compose up -d
node node_modules/prisma/build/index.js migrate dev --name canonical-trip
node node_modules/prisma/build/index.js generate
```
`npx` is broken here — always `node node_modules/prisma/build/index.js …` and
`node node_modules/typescript/lib/tsc.js …`.

## The five rules (do not violate these)
1. `Trip.status` is the ONLY lifecycle authority. `Booking.status` = seat+money.
2. Nothing writes `Trip.status` except `applyTransition()` /
   `applyTransitionTx(tx, …)` + `publishCommitted(result)` post-commit.
   **Verified: zero raw `trip.update({status})` sites remain.**
3. Timers are `ScheduledTask` rows written inside the transition, never setTimeout.
4. One socket event `trip:event` (seq == version, full snapshot, serverNowMs).
   Client rule: `if (version > mine) replace else discard`.
5. Clients project. Rider stage = `stageForStatus(status)`; driver screen =
   `driverScreenForStatus(status)`. No client-computed status, no polls.

## Enum vocabulary (reuse, don't rename)
`TripStatus`: REQUESTED, MATCHING, SCHEDULED, FILLING, CONFIRMED,
DRIVER_ASSIGNED, REASSIGNING, DRIVER_EN_ROUTE, ARRIVED_AT_PICKUP, IN_PROGRESS,
COMPLETED, CANCELLED, NO_DRIVERS_FOUND, EXPIRED, NO_SHOW.
Who cancelled = `Trip.cancelledBy`, NOT split statuses (saved ~77 edits).
Dropped: DISPATCHING→MATCHING, MATCHED→DRIVER_ASSIGNED.
`BookingStatus`: PENDING, SEAT_HELD, CONFIRMED, PAID, BOARDED, COMPLETED,
CANCELLED, REFUNDED, EXPIRED, NO_SHOW.

## What was built
**Ph0** Trip.driverId/vehicleId/routeId nullable; +requesterId, dropoff coords,
`version`, redispatchCount, cancel fields; `TripEvent` (append-only,
`@@unique([tripId,seq])`); `ScheduledTask` (outbox, `@@unique([type,dedupeKey])`).
Provider sqlite→postgresql + `eyego-api/docker-compose.yml`.

**Ph1** `trip-state.service.js` — transition table, version CAS, event log,
in-txn timers, terminal absorbing + auto task-cancel. All 13 legacy status
writes converted (drivers/bookings/cancellation/payments/trips/trip-lifecycle).
`drivers.service.js`'s private 4-row transition table → `needsTransition()`
delegating to the real one.

**Ph2** Redis cascade + durable timers + per-trip lock; `matcher.service.js`
(geo narrows → SQL decides → ETA ranks, batch-shaped `solve()`);
`supply-index.service.js` (GEO + presence TTL); `eta.service.js` (batched
Mapbox Matrix, cached, `degraded` fallback). **`dispatch.service.js` DELETED**
— one path. `acceptOffer` split into `stopOfferTimer()`/`announceWinner()`.
`trip-request.service.js` no longer cascades (20s offer is meaningless for a
ride 4 days out) — scheduled requests broadcast via
`notifyDriversOfScheduledRequest()`.

**Ph3** Socket.IO Redis adapter; `trip-events.publisher.js` (one envelope);
`sockets/resume.socket.js` (`trip:subscribe`+replay+ack+`time:sync`);
`trip-view.js`; `GET /v1/rides/active` + `/v1/rides/driver/state` bootstraps;
`/v1/rides/:id/events` replay.

**Ph4** `packages/api/src/tripChannel.ts` (server-wins-by-version, gap
detection→replay, TTL drop, clock-skew); `rides.api.ts`;
`apps/rider/stores/trip.store.ts` + `apps/driver/stores/trip.store.ts`;
`tripFlow.store.ts` gained `syncFromServer` and `popStage` now refuses on
server-owned stages; **both `setInterval` polls + the 3-min client timeout
deleted from RequestStage**; driver `_layout.tsx` hydrates + one offer listener.

**Ph5** `fare-quote.service.js` (HMAC 64-hex, single-use Redis redemption,
409 FARE_EXPIRED / 422 INVALID_FARE_ID); idempotency keys on ride creation;
`money.js` hardened (+`toMinor`/`fromMinor`/`assertMoney`).

**Ph6** Redis mandatory + `assertReady()` exits; `InMemoryRedis` deleted;
`trip-health.service.js` stuck-trip + dead-worker alarms; `GET /health/dispatch`;
~40 lines added to `.env.example`; `REWIRE-RUNBOOK.md`.

## Deliberately NOT done (user's call to schedule)
**Float cedis → integer pesewas.** ~263 read/write sites across 4 codebases;
missing one = a 100×-wrong charge, worse than the drift it fixes and invisible
until a real rider is billed. Needs a live DB + end-to-end payment test.
`money.js` now prevents drift accumulating and defines the conversion boundary.

## Open Issues
- Never run against a live database or device. First run: `docker compose up -d`,
  migrate, request a ride, watch `GET /health/dispatch`.
- Legacy `/v1/trips` group/bus flows still exist alongside `/v1/rides` — correct
  (two products) but only `/v1/rides` has been exercised by the new client code.
- Still unaudited: map mount count, camera ownership, marker interpolation,
  chat outbox, SOS delivery, driver foreground-service call sites, iOS
  background location, Paystack capture idempotency.

---

## 2026-08-03 — FIRST LIVE RUN (backend verified against real infra)

Dev infra is **Neon (Postgres) + Upstash (Redis)** — this machine has no Docker
and no package manager. `eyego-api/SETUP-CLOUD-DEV.md` is the walkthrough.
**API port is 5020, not 3000.**

**Verified working end to end:**
```
Socket.io server initialized  →  Redis connected  →  Database connected
→  ScheduledTask worker started  →  Trip health monitor started
→  EyeGo API running on port 5020
GET /health/dispatch → {"live":{},"stuck":0,"scheduledTasks":{"overdue":0,"failed":0},"healthy":true}
```
95s clean run, zero errors. Migration applied. `FOR UPDATE SKIP LOCKED` claim
query confirmed executing. Redis GEOADD/GEOSEARCH confirmed working on Upstash.

**Four real bugs found and fixed by actually running it:**
1. **Upstash needs `rediss://` not `redis://`.** With plain `redis://` the TCP
   socket opens and logs "Redis connected", then every command times out —
   because the server is waiting on a TLS handshake that never comes.
   `config/redis.js` now warns explicitly on this combination.
2. **`maxRetriesPerRequest: 3` crashed the process.** The Socket.IO adapter
   attaches no catch handlers, so a transient blip surfaced as unhandled
   rejections and killed the server. Now `null` on both the main client and
   `duplicate()` (which is what Socket.IO's own docs require).
3. **Neon cold start looked like a dead database.** Serverless Postgres scales
   to zero; the first connect after idle is reachable on TCP but refuses
   queries, which Prisma reports as P1001 "Can't reach database server".
   `server.js` now has `connectWithRetry()` (6 attempts, backoff) and proves
   liveness with `SELECT 1`, not just an open socket.
4. **`trip-lifecycle.service.js` held a stale private status list** containing
   `DISPATCHING` (retired) and missing `NO_DRIVERS_FOUND` — so the expiry sweep
   threw on every run. Now imports `PRE_TRIP_STATUSES` / `ACTIVE_STATUSES` /
   `TERMINAL_STATUSES` / `PRE_DRIVER_STATUSES` from `trip-state.service.js`.
   **This is exactly what the enum was introduced to catch, and it caught it.**
   Swept the whole backend for other retired literals — clean. (`MATCHED` on
   `ScheduledRideIntent` is fine; that column is still a `String`.)

**Also fixed — would have burned the Neon free tier:** the ScheduledTask worker
polled on a fixed 1s `setInterval` = ~86,400 remote queries/day, which means a
serverless database NEVER idles and the monthly compute allowance is gone in
about a week on zero traffic. Replaced with sleep-until-next-due (`nextDueAt()`
+ interruptible sleep + `wake()` on arm). **Measured: 1 claim query per 20s
idle, down from ~20.** Timing got *more* precise, not less — a task due in
300ms now runs in 300ms instead of on the next tick boundary.

## Still not done
- No ride has been requested yet. Next: point the rider app at
  `http://<lan-ip>:5020`, request a ride, watch `/health/dispatch` and the
  `trip:event` stream.
- Float cedis → integer pesewas (see money.js for why it was deferred).
