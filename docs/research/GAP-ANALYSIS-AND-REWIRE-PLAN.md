# EyeGo — Gap Analysis & Rewire Plan
### Uber/Bolt architecture vs. what EyeGo actually does, and how to close it

_2026-08-02. Sources: `uber-bolt-rider-architecture.md` (45 sources, 64-row scorecard),
`uber-bolt-driver-architecture.md` (79 sources, 34+-row scorecard),
`eyego-current-wiring.md` (codebase map)._

**Status: awaiting approval. No code changed yet.**

---

## 1. Verdict

The screens are done. The **wiring is not a ride-hailing system** — it is a
bus-seat booking system with ride-hailing features bolted on top, running on a
substrate that cannot survive a deploy or a second server instance.

Three findings carry almost all the weight:

1. **There is no single shared ride object.** The rider owns a `Booking`, the
   driver owns a `Trip`, each with its own free-string `status`. Nothing in the
   database forces them to agree. This is the literal, mechanical cause of "the
   apps feel disjointed."
2. **Dispatch state lives in process memory.** `const cascades = new Map()` with
   `setTimeout` timers. Every deploy strands every in-flight search. More than
   one API instance is impossible. Both dossiers name this exact pattern as the
   thing that "strands trips on every deploy."
3. **The realtime channel has no sequence, no replay, no resume.** ~20 ad-hoc
   socket events, fire-and-forget. A backgrounded or reconnecting client misses
   messages and cannot detect that it did. Uber's answer (RAMEN) is fully
   published and directly copyable.

Everything the user described — inconsistent request flow, dispatch that doesn't
feel efficient, driver actions not reflected on the rider side — falls out of
these three.

**Not production-scale** is not an opinion here. Items 2 and 3 impose a hard
single-instance ceiling. One box, and a deploy loses live rides.

---

## 2. Root cause: the domain model

```
TODAY                                    UBER/BOLT
──────────────────────────────────       ──────────────────────────────────
Trip { driverId NOT NULL,                Trip { driverId NULL-able,
       vehicleId NOT NULL,                      dropoff coords first-class,
       routeId NOT NULL,                        status ENUM + version,
       pickup only, NO dropoff,                 TripEvent[] append-only }
       status String }                          ↑ ONE row, both apps project it
Booking { status String }  ← rider's row
   ↑ driver never touches this
```

A `Trip` **cannot exist before a driver exists**. So there is no object
representing "a ride that has been requested but not yet matched" — which is
precisely the object Uber redispatches when a driver cancels
(_"Uber will attempt to redispatch **the trip**"_, rider dossier §2.4). We
structurally cannot do that; we'd have to invent a new trip and lose receipt,
share-link and support continuity.

Destination isn't even a property of the ride — it lives on `Route`, so every
ad-hoc ride mints a throwaway `Route` row.

Both `Trip.status` and `Booking.status` are `String` with no Prisma enum, no DB
constraint, and no append-only event log to rebuild truth from.

> Driver dossier §8.5 #15 flags the milder version of this ("one
> `driver.currentTripId` column") as structurally foreclosing stacked dispatch,
> pool and reserve. Ours is worse: the trip itself can't exist without a driver.

---

## 3. Audit against the dossier scorecards

Rows marked **[V]** I verified in the codebase this session. **[?]** = not yet
checked, to be audited during the build. I am not going to claim results I
didn't look at.

### 3.1 Fails that matter most

| # | Capability | EyeGo today | Ev. |
|---|---|---|---|
| R1/R2 | Server-owned state machine + transition guard | Statuses are free strings on two rows. An `assertTransition` guard exists from prior work but has no enum or DB constraint behind it | [V] |
| R3 | Monotonic trip version | None. No version/seq on any payload | [V] |
| R4 | Terminal-state lock | Nothing prevents a late push resurrecting a cancelled trip | [V] |
| R13 | Seq + resume on the stream | None. Missed messages are undetectable | [V] |
| R21 | One-call rehydration | No rider or driver bootstrap endpoint. `getActiveTrips` is admin-only | [V] |
| R33 | Durable timers | `setTimeout` in-process. Deploy = all offer expiries evaporate | [V] |
| R34 | Post-commit tasks in-transaction | No outbox/LATE table | [V] |
| R36 | Redispatch reuses tripId | Impossible — Trip requires a driver | [V] |
| R50 | Append-only event log | None. Only `DispatchAction` (dispatch outcomes, not lifecycle) | [V] |
| D1 | Separate session vs trip state machines | Availability is a Postgres `where` clause; no separate supply store | [V] |
| D6 | H3/cell-set candidate lookup | Haversine radius scan over Postgres | [V] |
| D7 | ETA from a routing engine | **Straight-line distance ranking** | [V] |
| D19 | Append-only event log, `(tripId, seq)` unique | None | [V] |
| D22 | Sequence-numbered stream with replay | None | [V] |
| D25 | `GET /driver/state` bootstrap | None | [V] |
| — | Socket.io Redis adapter | Absent. Redis used only for an admin pub/sub | [V] |
| — | Single dispatch path | **Two.** `trip-request.service.js:113` → cascade; `trips.service.js:192` → old broadcast via `setImmediate` (not awaited, throws silently after 200) | [V] |
| R10 | Integer money | `Float` throughout (`fareAmount`, `baseFare`, `commissionAmount`…) | [V] |

### 3.2 Passes — credit where due

| # | Capability | EyeGo today | Ev. |
|---|---|---|---|
| D16/R35 | Exactly-once assignment via CAS | **Correct.** `acceptTripRequest()` uses a conditional `updateMany` on `status IN (PENDING,DISPATCHED)` inside a transaction; losers get 409. `cancelRequest()` uses the same guard in reverse | [V] |
| D3 | Busy-driver exclusion at source | `driver-availability.js` is the single eligibility function (prior work) | [V] |
| D13 | Offer TTL configurable | `DISPATCH_OFFER_TTL_SECONDS`, default 20s | [V] |
| D15 | Escalation with a global deadline | `MAX_CANDIDATES` default 8, 5km→12km widening, explicit exhausted state | [V] |
| — | Sequential cascade shape | The *algorithm* is genuinely Uber-shaped. Only the substrate is wrong | [V] |
| — | Persistent map + stage-swap surface | Built during the fluid-UI work; needs a mount-count check to confirm | [?] |

### 3.3 Bugs found while mapping

1. **`acceptOffer()` announces a winner that may lose.** Called at
   `trip-request.service.js:356`, *before* the claim transaction, and emits
   `dispatch:matched {driverId}` unconditionally. A driver about to get a 409
   still tells the rider "matched with driver X" and kills the cascade. Stopping
   the offer timer and announcing the winner must be two calls.
2. **`setImmediate(() => dispatchToNearbyDrivers(trip))`** — dispatch is not
   awaited and not retried. If it throws, the request already returned 200 and
   nothing ever dispatches.
3. **`InMemoryRedis` fallback masks lost guarantees.** Its own comments record
   that `SET NX` was unimplemented, so payment double-charge and webhook-dedup
   locks "gave zero protection whenever Redis is down." A misconfigured deploy
   looks healthy.
4. **Poll racing push.** `RequestStage.tsx` runs two `setInterval` polls (L176,
   L233) alongside socket listeners, settling the same transition with no
   version to arbitrate.
5. `legacyBroadcastRequestToDrivers()` — dead code, no callers. Delete.

---

## 4. Target architecture

### 4.1 One canonical ride object

Relax `Trip` into the ride-hailing shape rather than adding a parallel `Ride`
model (a second model would recreate the two-row split we're fixing):

```prisma
enum TripStatus {
  REQUESTED  MATCHING  DRIVER_ASSIGNED  DRIVER_EN_ROUTE  DRIVER_ARRIVED
  IN_TRIP  COMPLETED
  CANCELLED_RIDER  CANCELLED_DRIVER  NO_DRIVERS_FOUND  EXPIRED
}

model Trip {
  driverId    String?      // was NOT NULL — the whole unlock
  vehicleId   String?
  routeId     String?      // null for on-demand; set for the bus/group product
  dropoffLat  Float?
  dropoffLng  Float?
  dropoffAddress String?
  status      TripStatus @default(REQUESTED)
  version     Int        @default(0)   // monotonic, bumped on every transition
  events      TripEvent[]
}

model TripEvent {               // append-only. never UPDATE, never DELETE
  tripId  String
  seq     Int
  type    String
  actor   String                // RIDER | DRIVER | SYSTEM
  payload Json
  createdAt DateTime @default(now())
  @@unique([tripId, seq])
}
```

The bus/group product survives: it's a Trip **with** a `routeId` and
`maxSeats > 1`. An on-demand ride is a Trip with no route and one seat.
`Booking` stays, but narrows to **payment and seat concerns only**
(`RESERVED | PAID | REFUNDED | CANCELLED`). **Lifecycle status lives on `Trip`
and nowhere else.** One authority, both apps project it.

### 4.2 Every write goes through one function

```
applyTransition(tripId, to, actor, payload) →  in ONE transaction:
   assertTransition(from → to, actor)   // table-driven, rejects illegal pairs
   UPDATE trip SET status=to, version=version+1 WHERE id=? AND version=?  // CAS
   INSERT TripEvent (seq = version)
   INSERT ScheduledTask rows for any timers this transition arms   // outbox
```

Terminal statuses are absorbing. Nothing else may write `Trip.status`.

### 4.3 Durable dispatch

- Cascade state → **Redis hash + keyspace TTL**, not a JS `Map`.
- Timers → **`ScheduledTask` table** (`runAt`, `type`, `payload`, `claimedAt`),
  written *inside* the state transaction, polled with `SKIP LOCKED`. Survives
  deploys. This is Uber's LATE-table pattern.
- Supply lookup → **Redis GEO** (`GEOADD`/`GEOSEARCH`) with presence TTL, so a
  dead phone leaves the pool by expiry rather than an explicit `goOffline`.
- Ranking → **routing-engine ETA** (Mapbox matrix, batched + cached), not
  haversine. Free-flow fallback flagged `degraded`.
- Matcher written **batch-shaped** — `solve(requests[], drivers[])` — even while
  it runs at batch=1, so a real optimiser drops in later without a rewrite.
- **Delete the second dispatch path.** One entry point.
- Split `acceptOffer()` into `stopOfferTimer()` (before the txn) and
  `announceWinner()` (after commit).

### 4.4 Sequenced realtime channel

- **Socket.io Redis adapter** — prerequisite for instance #2 existing at all.
- Collapse the ~20 ad-hoc events into one envelope:
  `trip:event { tripId, seq, version, type, payload, serverNowMs }`, seq drawn
  from `TripEvent`.
- Client connects with `lastSeq`; server replays `> lastSeq`. Reconnect *is* the
  ack, plus a periodic ack (RAMEN's protocol, published and copyable).
- Per-message TTL, priority buckets, newest-of-type dedup.
- **`GET /v1/me/active-trip`** and **`GET /v1/driver/state`** — one-call
  rehydration on cold start, foreground, and reconnect. Both dossiers say this
  single endpoint kills an entire bug class.
- Delete the `RequestStage` polls; keep one adaptive-poll fallback that engages
  only on a visible "reconnecting" state.

### 4.5 Clients project, never decide

- `tripFlow` stage becomes **derived from server `TripStatus`**, not a
  client-owned stack.
- One trip store per app. Server wins by `version`; lower version = discard.
- No client-computed statuses, distances, fares, or countdowns. Every payload
  carries `serverNowMs`; all timers render against it.

---

## 5. Build order

Sequenced by dependency. Each phase ends green (`tsc` + `prisma validate`).

| Ph | Work | Why here | Risk |
|---|---|---|---|
| **0** | `TripStatus` enum, nullable `driverId`/`vehicleId`/`routeId`, dropoff fields, `version`, `TripEvent`, `ScheduledTask`. Backfill migration for existing rows | Everything below depends on a canonical object | **High** — destructive-ish migration; needs a backfill + rollback script |
| **1** | `applyTransition()` + table-driven `assertTransition` + terminal lock. Route every existing status write through it. Narrow `Booking.status` to payment concerns | Single authority before anything reads from it | Med — touches every trip mutation |
| **2** | Redis-backed cascade, `ScheduledTask` durable timers, one dispatch path, ETA ranking, Redis GEO supply index, batch-shaped matcher. Fix the `acceptOffer` announce bug | Dispatch is the loudest symptom | Med |
| **3** | Socket.io Redis adapter, `trip:event` envelope + seq/replay, TTL/priority/dedup, both bootstrap endpoints | Needs the event log from Ph 0/1 | Med |
| **4** | Rider + driver clients project server state. Kill polls, kill client-computed status, `serverNowMs` timers, single store, server-wins-by-version | Needs the channel from Ph 3 | Med |
| **5** | Integer minor units (pesewas), server-signed fare quote with expiry, idempotency keys on every trip action, immutable receipts | Money integrity; independent of 0–4 but wide | **High** — touches every price path |
| **6** | Production gates: Redis mandatory (fail loud, not silent in-memory), stuck-trip alarms, foreground-service audit, permission ladder, store declarations | Shippability | Low |

Phases 0–4 are the "feels like Uber" work. Phase 5 is the "defensible in a
dispute" work. Phase 6 is the "App Store lets us in" work.

---

## 6. Decisions — ANSWERED 2026-08-02

| # | Decision | Consequence for the build |
|---|---|---|
| 1 | **Dev only — reset the DB** | Phase 0 writes a clean migration. No backfill, no legacy status mapping, no rollback script needed. Removes the single highest-risk item in the plan. |
| 2 | **Redis required, fail loud** | `InMemoryRedis` fallback is deleted. `config/env.js` gains a hard `REDIS_URL` requirement outside `NODE_ENV=development`. Unlocks multi-instance, durable dispatch, real distributed locks. Every §4.3/§4.4 item is now unblocked. |
| 3 | **Include Phase 5 in this pass** | Full run: 0→6. `Float` → integer pesewas across Prisma, both apps, Paystack, receipts. Because of decision 1 this is a schema rewrite, not a data migration — substantially cheaper than it would otherwise be. |
| 4 | **Keep both products** | One `Trip` model serves both. On-demand = no `routeId`, `maxSeats=1`. Group/bus = `routeId` set, `maxSeats>1`. The state machine must be valid for both; group-specific states stay additive, not a second lifecycle. |

Decision 1 + decision 3 compound favourably: with no data to preserve, the money
migration is a schema change plus code, not a reconciliation exercise. Phase 5's
risk rating drops from **High** to **Medium**.

## 6b. Revised risk table

| Ph | Risk after decisions |
|---|---|
| 0 | High → **Low** (clean migration, no backfill) |
| 1 | Med |
| 2 | Med |
| 3 | Med |
| 4 | Med |
| 5 | High → **Med** (schema rewrite, not data migration) |
| 6 | Low |

---

## 7. What I have not audited yet

Honest list, to be closed during the build: map mount count across a full trip;
camera ownership; marker interpolation quality; chat outbox behaviour; SOS
delivery guarantees; the driver app's foreground-service call sites; iOS
background-location strategy; existing idempotency-key coverage; Paystack
capture idempotency. These are scorecard rows I have not personally verified.
