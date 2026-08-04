# EyeGo — Current Wiring (the "actual" side of the gap analysis)

_Mapped 2026-08-02. Pairs with `uber-bolt-rider-architecture.md` and `uber-bolt-driver-architecture.md`._

This file records what EyeGo **actually does today**, at the level the Uber/Bolt
dossiers describe them, so the gap doc can be a true side-by-side. Findings are
evidence-backed with file:line references. No fixes here — diagnosis only.

---

## 1. Domain model: this is a bus-seat product, not a ride-hailing product

The single most consequential finding. `prisma/schema.prisma`:

| Model | Shape | Consequence |
|---|---|---|
| `Trip` (L232) | `driverId String` **NOT NULL**, `vehicleId` NOT NULL, `routeId` NOT NULL, `maxSeats`, `confirmedSeats`, `departureTime`, `status String @default("SCHEDULED")` | A Trip **cannot exist before a driver exists**. There is no entity representing "a ride that has been requested but not yet matched". Uber's Trip is created at request time with a null driver and gets one assigned. |
| `Trip` | has `pickupLat/Lng/Address` but **no dropoff fields** | Destination lives on `Route`, so every ad-hoc ride has to mint a throwaway `Route` row. Destination is not a first-class property of the ride. |
| `Booking` (L294) | the rider's object: `seatNumber`, `fareAmount`, `paymentStatus`, its own `status String @default("PENDING")` | **The rider and the driver are looking at two different rows.** Rider owns a Booking; driver owns a Trip. Each has its own independent `status` string. Nothing forces them to agree. |
| `TripRequest` (L521) | `destination String`, `scheduledAt`, `status "PENDING\|DISPATCHED\|ACCEPTED\|EXPIRED\|CANCELLED"`, `matchedTripId` | A *scheduling intent*, not a live ride request. Carries no fare quote, no vehicle tier, no dispatch cursor, no driver assignment record. |

**Both `Trip.status` and `Booking.status` are free-form `String` with no Prisma
enum and no DB constraint.** Any string can be written. There is no persisted
state machine, no allowed-transition table, and no append-only event log — only
`DispatchAction` (L861: driverId/tripId/ACCEPTED|DECLINED), which records dispatch
outcomes, not trip lifecycle.

> This is the structural root of "the apps feel disjointed." Two rows, two status
> strings, two independent update paths, no shared canonical state, no event log
> to reconcile from. Everything downstream inherits this.

## 2. Dispatch: correct shape, non-durable substrate

`src/services/dispatch-cascade.service.js` (384 lines) implements a genuinely
Uber-shaped sequential cascade — ordered candidates, one exclusive offer at a
time, `OFFER_TTL_SECONDS` (default 20), decline/timeout advances, `MAX_CANDIDATES`
default 8, radius 5km widening to 12km, live `dispatch:*` events to the rider's
room. The *algorithm* is right. The *substrate* is not:

- **`const cascades = new Map()` (L50)** — all cascade state (candidate list,
  current offer holder, TTL timers) lives in process memory. The file's own
  header comment admits this: _"state lives in a module-level Map with real
  timers, so it is per-process… If it is ever scaled horizontally this must move
  to Redis."_
  - API restart / deploy / crash mid-search → every in-flight cascade evaporates.
    Rider is left on a spinner with no server-side actor left alive.
  - More than one API instance → each runs its own cascade for the same ride.
    Horizontal scale is currently impossible. **This alone disqualifies
    production scale.**
- **`acceptOffer()` (L349) performs no atomic claim** — it emits
  `dispatch:matched` and calls `finish()`. Whatever prevents two drivers from
  claiming one ride lives elsewhere (driver accept endpoint) and must be verified
  as a real compare-and-swap, not a read-then-write.
- **`getCascadeState()` (L362) is the rider's polling fallback** and returns
  `null` once the process forgets — so the fallback cannot recover the very
  failure it exists to cover.
- Candidate ordering is built in `buildCandidates()` from a haversine radius
  (`haversineKm`, L61) — **straight-line distance, not road ETA**, and not a
  geospatial index.
- Two dispatch paths coexist: `dispatch.service.js` (154 lines,
  `dispatchToNearbyDrivers`, the older broadcast) and the cascade. Needs an audit
  for which path each entry point still takes.

## 3. Driver availability

`src/services/driver-availability.js` (115 lines) is the single eligibility
source (per prior work) via `availableDriverWhere()` / `busyTripFilter()` — but
these are **Prisma `where` clauses against Postgres**. Every dispatch decision
hits the DB for the supply lookup; there is no Redis geo index (`GEOADD`/
`GEOSEARCH`) and no H3/geohash cell sharding, so supply lookup is the hot path
running on the cold store.

## 4. Realtime transport

`src/sockets/` (1472 lines) — Socket.io with `/passenger`, `/driver`, `/admin`
namespaces, JWT auth middleware, `pingTimeout 30s / pingInterval 25s`. Real
transport exists. What it lacks versus a RAMEN-class channel:

- **No sequence numbers, no replay, no resume.** `packages/api/src/socket.ts`
  exposes ~20 `onXxx` listeners (`onDriverLocation`, `onTripStatus`,
  `onDispatchProgress`, `onTripRequestAccepted`, `onSeatUpdate`, …). Each is an
  independent fire-and-forget event. A client that is backgrounded, on a dead
  network, or reconnecting **silently misses events with no way to detect or
  recover the gap** — it only relearns state if something else refetches.
- **No Redis adapter on the Socket.io server** (`sockets/index.js` uses Redis only
  for an admin pub/sub of driver locations). With >1 instance, a rider connected
  to instance A never receives an emit issued on instance B. Same blocker as §2.
- Events are **ad-hoc, not derived from one state machine.** `onTripStatus`,
  `onTripRequestAccepted`, `onDispatchProgress` and `onTripAssigned` are four
  different ways to learn overlapping facts, each handled separately on the
  client.
- `config/redis.js` ships an **`InMemoryRedis` fallback** used when Redis is
  absent. Its own comments record that `SET NX` was unimplemented, so payment
  double-charge and webhook-dedup locks "gave zero protection whenever Redis is
  down." The fallback makes a missing-Redis deploy *look* healthy while silently
  voiding distributed guarantees.

## 5. Rider client

- `stores/tripFlow.store.ts` (103 lines): stages are
  `'search' | 'select' | 'request' | 'assigned' | 'tracking'` — a **client-side
  UI stack** (`stack: TripStage[]`, `go()`, `popStage()`), not a projection of
  server trip state. The client decides what stage it is in.
- `components/trip/stages/RequestStage.tsx` (582 lines) runs **two
  `setInterval` polls** (L176, L233) alongside socket listeners, with comments
  describing the poll as "the fallback for a dropped socket" and referencing a
  "previously unwired" socket push. Poll and push race to settle the same
  transition; there is no version/sequence to arbitrate.
- Trip state is split across `ride.store.ts` (151) and `tripFlow.store.ts` (103)
  plus React Query caches — **no single source of truth**, and no documented
  server-wins reconciliation rule.
- Stage components are large and own their own data-fetch and socket wiring
  (`SelectStage.tsx` 1301 lines, `SearchStage.tsx` 608, `RequestStage.tsx` 582),
  so lifecycle logic is duplicated per stage rather than centralised.

## 6. What this predicts about the symptoms reported

| Symptom the user reported | Mechanism above |
|---|---|
| "Apps are disjointed; driver does something, rider doesn't see it" | §1 two rows / two status strings; §4 ad-hoc events with no replay |
| "Request-ride page isn't consistent or intuitive" | §5 client-owned stage machine racing a poll and a socket |
| "Dispatch isn't efficient like Uber" | §2 straight-line candidates, no ETA ranking, DB-backed supply lookup |
| "Not built for production scale" | §2 + §4 in-memory cascade, no Socket.io Redis adapter → hard single-instance ceiling |
| Ghost/stale trips seen in earlier stress tests | §1 no enum, no transition guard, no event log to rebuild truth |

---

## 7. Verified open items

**Two live dispatch paths, and which one you get depends on how the ride was created.**

| Entry point | Path taken |
|---|---|
| `modules/trips/trip-request.service.js:113` | `dispatchCascade.startCascade()` — sequential, TTL'd, emits `dispatch:*` progress to the rider |
| `modules/trips/trips.service.js:192` | `setImmediate(() => dispatchToNearbyDrivers(trip))` — the **old broadcast**, fire-and-forget, no rider progress events, no offer holder |

So one booking flow gives the rider a live "driver 2 of 8, 20s left" experience
and the other gives a silent spinner with five drivers racing. Same product, two
different dispatch semantics. This is a direct cause of "it's not consistent."
`setImmediate` also means the dispatch is **not awaited and not retried** — if it
throws, the request has already returned 200 and nothing ever dispatches.

**No rider- or driver-facing "get my active trip" bootstrap endpoint.**
`getActiveTrips` exists only in the admin module (`admin.routes.js:53`). Neither
app has a single call that returns full current trip state for cold start, so
rehydration after an app kill is assembled client-side from whatever queries each
screen happens to run.

**Accept-claim atomicity: correct.** `acceptTripRequest()`
(`trip-request.service.js:346`) does a real compare-and-swap — a conditional
`updateMany({ where: { id, status: { in: ['PENDING','DISPATCHED'] } } })` inside
a transaction, `claim.count === 0` → 409. `cancelRequest()` (L322) uses the same
guard in reverse. Two simultaneous accepts cannot both win. Credit where due;
this one is Uber-shaped.

**But the rider is told about a match that may not happen.**
`dispatchCascade.acceptOffer(tripRequestId, driverId)` is called at L356
**before** the transaction, and it unconditionally emits `dispatch:matched`
`{ driverId }` to the rider. A losing driver's accept — one that is about to be
rejected with 409 — still tells the rider "matched with driver X" and kills the
cascade. The comment explains *why* it's called early (stop the next offer timer
firing mid-transaction), which is sound; the bug is that stopping the timer and
announcing the winner are the same call. They need splitting.

`legacyBroadcastRequestToDrivers()` (L163) is **dead code** — no callers. The
live broadcast path is only `trips.service.js:192`.
