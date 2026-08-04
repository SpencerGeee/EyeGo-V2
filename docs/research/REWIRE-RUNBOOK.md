# Uber-grade rewire — runbook

_Built 2026-08-03. Companion to `GAP-ANALYSIS-AND-REWIRE-PLAN.md`._

## Starting it up

The dev database is now **Postgres, not SQLite**, and **Redis is required**.

This machine has no Docker and no package manager, so dev runs on hosted free
tiers: **Neon** (Postgres) + **Upstash** (Redis). Full walkthrough in
**`eyego-api/SETUP-CLOUD-DEV.md`** — paste two connection strings into `.env`,
then:

```powershell
cd "C:\Users\user\Downloads\Projects\EyeGo V2\eyego-api"
node node_modules/prisma/build/index.js migrate dev --name canonical-trip
node node_modules/prisma/build/index.js generate
npm run dev
```

`eyego-api/docker-compose.yml` still exists and is the better option once
Docker is available — `docker compose up -d` gives the same two services
locally and offline.

Two gotchas that will bite otherwise:
- **PowerShell 5.1 has no `&&`.** Use `;` or separate lines.
- **`npx` is broken in this workspace.** Call binaries through
  `node node_modules/...` as above.
- **Neon needs BOTH `DATABASE_URL` (pooled) and `DIRECT_URL` (not pooled).**
  The pooler runs in transaction mode and cannot run migrations; giving Prisma
  only the pooled URL fails with "prepared statement already exists", which
  looks like a schema bug and is not one.

**Why Postgres.** Production was already Postgres (`.env.example`); dev was
SQLite. That gap is itself the defect: SQLite has no enums, no `jsonb`, no
`SELECT … FOR UPDATE SKIP LOCKED`, and it serialises writes — so every
concurrency bug in dispatch (two drivers claiming one trip, two workers
claiming one timer) is structurally invisible locally and only appears in
production.

**Why Redis is mandatory.** It holds cascade state, the driver GEO index, the
Socket.IO adapter and the payment locks. The old `InMemoryRedis` fallback made
a Redis-less deploy look healthy while silently voiding the payment
double-charge lock — its own comments admitted `SET NX` "gave zero protection
whenever Redis is down". `src/config/redis.js` now exits the process instead.

## Is it working?

```
GET /health            # load-balancer probe, no DB
GET /health/dispatch   # live trips by status, stuck count, timer-worker backlog
```

`/health/dispatch` returns 503 when trips are stuck or the `ScheduledTask`
worker is not draining. That second one is the alarm that matters: a wedged
worker means offer timeouts and request expiries never fire, which strands
riders mid-search. Under the old in-memory `setTimeout` design this failure
left no trace anywhere.

## The five rules this architecture runs on

1. **`Trip.status` is the only lifecycle authority.** `Booking.status` is seat
   and money state and must never answer "where is my ride". The rider and the
   driver looking at two different rows with two independent status strings was
   the mechanical cause of the apps feeling disjointed.
2. **Nothing writes `Trip.status` except `applyTransition()`.** It checks the
   transition is legal for that actor, swaps under a version CAS, appends a
   `TripEvent`, and arms any timers in the same transaction. If you find
   yourself writing `trip.update({ data: { status } })`, that is the bug.
   Inside an existing transaction, use `applyTransitionTx(tx, …)` and call
   `publishCommitted(result)` after it commits — never before.
3. **Timers are rows, not `setTimeout`.** `ScheduledTask`, written inside the
   transition that arms them, claimed with `SKIP LOCKED`. A deploy cannot lose
   one and a second instance shares the work rather than duplicating it.
4. **One socket event: `trip:event`.** It carries `seq` (gap-free, == version),
   the complete snapshot, and `serverNowMs`. Clients apply exactly one rule —
   *if version > mine, replace; else discard* — which is what removes the
   poll-vs-push race. There are no polls left in the request flow.
5. **Clients project, never decide.** The rider's stage is
   `stageForStatus(trip.status)`; the driver's screen is
   `driverScreenForStatus(...)`. Both read the same field, so the two apps
   cannot show different phases of the same ride. Every countdown renders
   against `serverNowMs + elapsed`, never `Date.now()`.

## What each new file is for

| File | Role |
|---|---|
| `services/trip-state.service.js` | The state machine. Transition table, CAS, event log. **Start here.** |
| `services/scheduled-task.service.js` | Durable timers / outbox. `SKIP LOCKED` poller. |
| `services/dispatch-cascade.service.js` | Sequential cascade on Redis + task rows + per-trip lock. |
| `services/matcher.service.js` | `rankCandidates` (geo narrows → SQL decides → ETA ranks) + batch-shaped `solve()`. |
| `services/supply-index.service.js` | Redis GEO driver index with presence TTL. |
| `services/eta.service.js` | Batched Mapbox Matrix, cached, free-flow fallback flagged `degraded`. |
| `services/trip-events.publisher.js` | The one outbound envelope. |
| `services/trip-view.js` | The one snapshot shape both apps read. |
| `services/fare-quote.service.js` | HMAC-signed, single-use, expiring price. |
| `services/trip-health.service.js` | Stuck-trip and dead-worker alarms. |
| `sockets/resume.socket.js` | `trip:subscribe` / replay / ack (RAMEN). |
| `modules/rides/*` | The single on-demand path + both bootstrap endpoints. |
| `packages/api/src/tripChannel.ts` | Client half: server-wins-by-version, gap detection, TTL. |
| `apps/*/stores/trip.store.ts` | One store per app. Stage is derived, not stored. |

## Deliberately NOT done

**Money is still `Float` cedis, not integer pesewas.** Integers are the correct
end state — no representation error, and Paystack already speaks them — but it
is a representation change across ~263 read/write sites in four codebases, and
the failure mode of missing one site is a charge wrong by a factor of 100:
strictly worse than the drift it fixes, and invisible until a real rider is
billed. It needs a running database and an end-to-end payment test to land
safely. `src/utils/money.js` now guarantees nothing reaches storage with more
than two decimal places (so drift cannot accumulate) and exposes
`toMinor`/`fromMinor` so the conversion has one boundary to move rather than
263 scattered ones.

**Not yet verified on a device or against a live database.** Everything here
passes `prisma validate`, `node --check`, a module-load check, and `tsc` clean
on both apps — but no request has been served. First run should be: bring the
stack up, request a ride, watch `/health/dispatch`.
