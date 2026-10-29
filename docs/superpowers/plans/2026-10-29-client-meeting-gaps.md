# Client Meeting 2026-10-29 — Gap Analysis & Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **No subagents** (standing user rule, state.md D-rules).

**Goal:** Turn EyeGo into the "premium trotro" the clients described: riders join a bus that is already on the road, fill seats freed mid-route, and pick one of three products (seat / whole bus / private ride) from the first screen.

**Architecture:** Seats are sold per **segment** of the route, not per trip. Each booking gets a `[boardRatio, alightRatio)` span along the trip's polyline (0 = origin, 1 = destination). One pure helper decides how many seats are free over any span. Running trips become joinable for spans that are still ahead of the bus. Everything else (shared on-demand, waiting-rider pushes, the home picker) reuses that helper, the one cascade engine, and `trip-notify.service.js`.

**Tech Stack:** Node/Express/Prisma/Postgres/Redis/Socket.IO (eyego-api), Expo/expo-router (apps/rider, apps/driver), Next 15 (apps/admin), jest (API), node:test (`yarn test`).

**Status:** Gap table verified against code on 2026-10-29. Decisions D1–D8 answered the same day (§2). Phases A0/A are at full detail. Phases B–F are task-level and are expanded to step level at the start of each phase, after the previous phase is committed.

---

## 1. Gap table

| # | Client ask | Verdict | Evidence (file:line) |
|---|---|---|---|
| 1 | Join a bus already on the road; seats freed mid-route resold; "bus passing your stop in 4 min, 1 seat" | **MISSING** (pieces exist) | `bookSeat` refuses unless `SCHEDULED/FILLING` — `bookings.service.js:435`. Capacity counted per TRIP, not per segment — `bookings.service.js:596-601`. `searchTrips` lists only `SCHEDULED/FILLING` — `trips.service.js:756-761`; matches ends by haversine radius with **no direction check** — `trips.service.js:815-828`; returns no ETA to the rider's stop. No per-passenger alight state — `Booking` model `schema.prisma:657-817` (status goes BOARDED → COMPLETED only at trip end). `TripAlert` exists but fires **only on publish** — `trips.service.js:294` → `trip-notify.service.js:452`. Reusable: `projectOntoPolyline` (`utils/geo.js:88`, returns `alongM/totalM`), `alongRouteRatio`/`resolveDropoff` (`bookings.service.js:232-275`), `priceSeat` segment pricing (`bookings.service.js:290-392`), virtual stops (`services/virtual-stops.service.js:99`), `eta.etaSeconds` (`services/eta.service.js:155`). `boardPassenger` has no trip-status gate, so boarding mid-route already works — `drivers.service.js:2142`. |
| 2 | No matching trip → request a bus: **Shared** (driver on a trip heading your way adds you, normal seat price) or **Private** (empty bus comes, premium) | **PARTIAL** | Private = today's on-demand: `POST /rides` → cascade, priced as the whole vehicle on `RIDE_CARD` — `fare.calculator.js:344` (`calculateRideFare`), so it already costs more than a seat. Shared does not exist: `availableDriverWhere` excludes any driver with a live trip — `driver-availability.js:63,119-127`. The only busy-driver branch is the mid-ride "queued" offer, which is **dead** (bug B1). |
| 3 | Book the whole bus (charter), door-to-door, one payer, easy return booking | **PARTIAL** | On-demand already carries a party in one row (`rides.service.js:410-513`, `partySize` → `Booking.seats`), priced by `RIDE_EXTRA_SEAT_RATE` (`fare.calculator.js:386-427`). Cover-all can buy every free seat of a *published* trip — `syncCoveredSeatsTx` `bookings.service.js:818-916`. Missing: a "whole bus" product name/entry, a party = full capacity preset, vehicle capacity filtering (bug B2), and "book the return". |
| 4 | One person books N seats for people without the app; one total; driver sees "10 passengers – 1 booking" | **PARTIAL** | On-demand: yes (`partySize`, one row). Seat trips: N seats = N rows, one at a time via guest-selection (`app/ride/guest-selection.tsx`) or cover-all (all free seats or nothing). `Booking.seats` + `sumSeats()` already exist (`utils/booking-status.js:113`), and the driver UI already reads `seatCount` (`useTripStops.ts:154`). There's no "N seats" stepper on the seat path. |
| 5 | Don't make riders pick a seat; show availability | **EXISTS (opposite)** | Seat map is a mandatory step: `ride/[id].tsx:293,714` → `ride/[id]/seat.tsx` (Cabin3D) → payment `seat.tsx:240`. `bookSeat` requires an integer `seatNumber` — `bookings.service.js:440`. **Constraint:** `@@unique([tripId, seatNumber])` `schema.prisma:814` blocks reselling seat N to a second, disjoint segment. That's why D1 matters. |
| 6 | Pay before the bus arrives; not there → no-show; seat back on sale down the road | **PARTIAL** | Holds expire (`SEAT_HOLD_DURATION_MINUTES`=10, `settings.js:237`; sweeps `trip-lifecycle.service.js:273-280`, `server.js:279`). Cash seats exist (`CASH_PENDING`, `bookings.service.js:846`). Unrelated to seats, on-demand is cash-at-end (`ConfigureStage.tsx:880`). `riderNoShow` releases correctly (`NO_SHOW`, `seatNumber:null`, `trips.service.js:1592-1640`), **but** the freed seat can't be resold because a running trip refuses bookings (item 1). There's no grace period and no "bus is at your stop" stamp, so a driver can no-show a rider who hasn't been reached yet. |
| 7 | Premium pricing (~₵28 Kasoa→Shiashie); same segment = same price; mid-route pays its segment; private > seat | **PARTIAL** | Segment pro-rata exists (`priceSeat`, `calculateSegmentFareByRatio` `fare.calculator.js:605`). Seat price = vehicle fare ÷ `maxSeats` (`trips.service.js:842-853`), so **two buses on the same corridor price differently** if their `maxSeats` or tier differ. There are no operator-set corridor prices. Private > seat holds by construction (whole-vehicle card). |
| 8 | First screen asks: Book a seat / Book the whole bus / Book a ride | **MISSING** | `home.tsx:86-89` = Scan/Saved/Schedule/Wallet; `home.tsx:141` = single "Where to?" → `trip.tsx` search stage (`home.tsx:1034`). The product split happens later, implicitly, in SelectStage ("Request a Trip" fallback `SelectStage.tsx:525-532`). |
| 9 | Launch corridors (Madina↔La Paz, Kasoa→Madina AM/PM), own drivers, see demand peaks at stops | **PARTIAL** | Heatmap is **driver-facing only** (`heatmap.routes.js:10`, `authenticateDriver`) and covers 'recent bookings near me'. Admin analytics has no stop/corridor/hour view (`apps/admin/app/(console)/analytics/page.tsx`). Searches that found nothing aren't recorded anywhere, so unmet demand is invisible. `PulseSchedule` (admin-created, `schema.prisma:1039`) is **read-only display**: nothing materialises it into Trips (bug B4). The driver create flow has no "repeat my usual run" (`apps/driver/app/(trip)/create.tsx`). |

### Bugs found during the audit (fix in Phase A0, independent of decisions)

| ID | Bug | Evidence | Effect |
|---|---|---|---|
| B1 | `midRideAvailableDriverIds` calls `eta.etaMinutes`, which doesn't exist (`eta.service.js:160` exports `etaMatrix, etaSeconds, freeFlowSeconds, FALLBACK_SPEED_KMH`). The TypeError is swallowed by the inner `catch` | `driver-availability.js:216-222` | Mid-ride "queued" offers have **never** fired. Same shape as the earlier `destinationLat` bug in the same function (comment at `:198`). |
| B2 | Matcher selects `vehicles.seaterCount` but never filters on it, so a party of 12 can be offered to a 4-seater | `matcher.service.js:281` (select), `:360-366` (tier-only filter) | Wrong vehicle for groups and charters. |
| B3 | Driver Stop Timeline never advances past the first drop-off while `IN_PROGRESS`, because there's no per-passenger alight | `apps/driver/components/trip/useTripStops.ts:165-170` | Driver can't see progress on a multi-stop run. Becomes material once mid-route joiners exist. |
| B4 | `PulseSchedule` rows never become Trips | `pulseSchedule` is referenced only in `trips.service.js:690` (read) and admin create | Admin "schedules" look live but publish nothing. |

---

## 2. Decisions (ANSWERED by the user, 2026-10-29)

| ID | Decision | Where it lands |
|---|---|---|
| D1 | **Remove the seat map** from the booking path. Seats are a count; new seat bookings have `seatNumber` null | A4 step 3, Phase E |
| D2 | **Private ride = ride card × multiplier.** PlatformSetting `PRIVATE_RIDE_MULTIPLIER` (default 1.2, `pricing_rules` group), applied in `calculateRideFare` only for `product: PRIVATE` (shown on the quote breakdown as its own line) | C4 |
| D3 | **Driver accepts each shared add-on** (normal offer card + countdown) | C2 |
| D4 | **Charter = whole-vehicle ride card, party = vehicle capacity.** No new rate card. The D2 multiplier applies (a charter is private) | D1 |
| D5 | **Operator-fixed corridor prices.** Admin sets a seat price per corridor. Every bus on it charges that, mid-route pays its share, and off-corridor stays computed | **New Task A2b**, F3 |
| D6 | **No-show grace 3 min**, PlatformSetting `NO_SHOW_GRACE_MINUTES` | A6 |
| D7 | **N seats on seat trips + on-demand** | D2 |
| D8 | **Prepay mid-route joins only.** Cash stays for boarding at the origin; PlatformSetting `MIDROUTE_PREPAY_REQUIRED` (default true) | A4 step 4 |

### 2b. Grill round 2 (2026-10-29): device bugs + Uber/Bolt parity

| ID | Decision |
|---|---|
| G1 | Group-trip crash: capture `adb logcat` when the Android phone is back. No fix without a stack (static suspects ruled out) |
| G2 | Tier pick: bring back ONLY the in-place bus turn on Eco/Comfort/Premium. No cross-screen flights (rest of 10-22 D1 stands) |
| G3 | Card system: keep SnapSheet mechanics; rebuild visuals + layout flat, Uber/Bolt-style (dense product rows, outlined selection, pinned CTA); timings from decompile + recordings |
| G4 | **Bus-only: minimum 6 seats** per vehicle (user override of the 12 recommended). Saloon pricing (`RIDE_INCLUDED_SEATS`) and saloon/van cabin layouts removed; private ride = whole vehicle × `PRIVATE_RIDE_MULTIPLIER` |
| G5 | Splash: OS static splash → ~1.2 s Reanimated brand intro (mark draws, route sweeps, bus dot), skippable, cold start only, no Skia at launch; green rider / blue driver |

Known bugs added this round:
- Android Skia background mis-scaled: `LightPillarBackground.tsx:297` sizes the canvas from `useWindowDimensions()` (excludes system bars on Android) but centres it in a full-screen container; `AppBackground.tsx:131` same. Fix: size from container `onLayout`.
- Morph "never works": unconfirmed. (a) Reduce Motion / Android "Remove animations" skips it (`MorphProvider.tsx:449`); (b) stage content portalled into MapSheetHost since `b5120f9`, so the target may never report → clone times out and fades.
- Android driver crash on first open + close: suspect = root UI-thread frame loop (`LightPillarBackground` `useFrameCallback`) ticking during activity destroy on Back. Test Back vs Home with logcat.

---

## 3. File map

| File | Responsibility | Phase |
|---|---|---|
| `eyego-api/src/utils/segment-seats.js` (new) | Pure: span of a booking, peak occupancy, free seats on a span, joinable span | A |
| `eyego-api/__tests__/segment-seats.test.js` (new) | Unit tests for the above | A |
| `eyego-api/prisma/schema.prisma` + migration | `Booking.boardRatio Float?`, `Booking.alightRatio Float?`, `Booking.stopArrivedAt DateTime?` | A |
| `schema.prisma` `Corridor`, `Trip.corridorId`, `Trip.corridorSeatPricePesewas`; `fullSeatFarePesewas()` | Operator-fixed corridor seat price, pinned at publish | A2b |
| `eyego-api/src/services/trip-position.service.js` (new) | `busRatioFor(trip)`: driver GPS projected on the trip polyline | A |
| `eyego-api/src/modules/bookings/bookings.service.js` | `bookSeat`: running trips, span capacity, ratios written, prepaid-only mid-route, ETA-bounded hold | A |
| `eyego-api/src/modules/trips/trips.service.js` | `searchTrips`: running trips, polyline+direction match, span seats, ETA | A |
| `eyego-api/src/modules/trips/trips.service.js` `riderNoShow` | Grace gate on `stopArrivedAt` | A |
| `eyego-api/src/modules/drivers/*` | `POST /driver/trips/:id/stops/arrive` → stamps `stopArrivedAt`, notifies | A |
| `eyego-api/src/services/trip-notify.service.js` | `notifySeatPassing(tripId)`: the single owner of the new push | A |
| `eyego-api/src/config/settings.js` | `NO_SHOW_GRACE_MINUTES`, `JOIN_AHEAD_MARGIN_M`, `SEAT_CASH_ALLOWED` | A |
| `scripts/invariants.test.mjs` | Two new grep invariants (see Task A9) | A |
| `apps/rider/app/(tabs)/home.tsx` | Three-product picker | B |
| `apps/rider/app/trip.tsx`, `SelectStage.tsx`, `ConfigureStage.tsx` | `product` param feeds stages | B, C, D |
| `eyego-api/src/services/matcher.service.js`, `dispatch-cascade.service.js`, `driver-availability.js` | Shared-seat eligibility branch, capacity filter | C |
| `apps/admin/app/(console)/demand/*` (new) | Demand by stop/corridor/hour | F |

---

## 4. Phase A0 — audit bugs (no decision needed)

### Task A0.1: B1, the dead mid-ride offer

**Files:** Modify `eyego-api/src/services/driver-availability.js:216-219`

- [ ] **Step 1:** Replace the call with the export that exists:

```js
          const { seconds } = await eta.etaSeconds(
            { lat: fromLat, lng: fromLng },
            { lat: destLat, lng: destLng },
          );
          const minutes = seconds / 60;
```

- [ ] **Step 2:** Add an invariant to `scripts/invariants.test.mjs` that every `eta.<fn>(` call in `eyego-api/src` names a function in `eta.service.js`'s `module.exports`. A text check, same style as the existing two.
- [ ] **Step 3:** `yarn test:invariants`. Expected: PASS. Then `cd eyego-api && npx jest`: no regressions.
- [ ] **Step 4:** Commit `fix(dispatch): mid-ride offers called eta.etaMinutes, which never existed`.

### Task A0.2: B2, capacity filter

**Files:** Modify `eyego-api/src/services/matcher.service.js` (after the tier pool, ~`:366`)

- [ ] **Step 1:** `rankCandidates` gains `minSeats = 1`. After `pool` is built:

```js
  // A party of 12 is not a ride a 4-seater can take. Unlike tier, there is no
  // fallback: an under-capacity car is not a worse match, it is no match.
  pool = pool.filter((d) => d.vehicles.some((v) => (v.seaterCount ?? 0) >= minSeats));
```

- [ ] **Step 2:** `dispatch-cascade.service.js` passes `minSeats: sumSeats(trip.bookings)` (it already computes this as `partySize` at `:367`).
- [ ] **Step 3:** jest test in `__tests__/matcher.capacity.test.js` with a mocked prisma: a 4-seater is dropped for party 5 and kept for party 4.
- [ ] **Step 4:** Commit.

(B3 is fixed by Task A7; B4 is fixed in Phase F.)

---

## 5. Phase A — Join a moving bus (items 1, 6, 7)

### Task A1: Segment-seat helper (pure, TDD)

**Files:** Create `eyego-api/src/utils/segment-seats.js`, `eyego-api/__tests__/segment-seats.test.js`

- [ ] **Step 1: Write the failing test**

```js
const { freeSeatsOnSpan, peakOccupancy, isJoinableSpan, spanOf } = require('../src/utils/segment-seats');

const b = (from, to, seats = 1) => ({ boardRatio: from, alightRatio: to, seats });

describe('segment seats', () => {
  test('a booking with no ratios rides the whole route', () => {
    expect(spanOf({})).toEqual([0, 1]);
  });
  test('full bus leaving origin, two get off at 0.5 → two seats free after 0.5', () => {
    const bookings = [b(0, 0.5), b(0, 0.5), b(0, 1), b(0, 1)];
    expect(freeSeatsOnSpan(bookings, 4, 0, 1)).toBe(0);
    expect(freeSeatsOnSpan(bookings, 4, 0.5, 1)).toBe(2);
  });
  test('alighting at x frees the seat for someone boarding at x (half-open spans)', () => {
    expect(freeSeatsOnSpan([b(0, 0.4)], 1, 0.4, 1)).toBe(1);
  });
  test('peak, not sum: two non-overlapping riders use one seat', () => {
    expect(peakOccupancy([b(0, 0.3), b(0.3, 0.6)], 0, 1)).toBe(1);
  });
  test('a multi-seat booking counts all its seats', () => {
    expect(freeSeatsOnSpan([b(0.2, 0.8, 10)], 14, 0.5, 0.9)).toBe(4);
  });
  test('joinable only ahead of the bus and forward', () => {
    expect(isJoinableSpan({ busRatio: 0.3, from: 0.5, to: 0.9 })).toBe(true);
    expect(isJoinableSpan({ busRatio: 0.6, from: 0.5, to: 0.9 })).toBe(false); // bus passed the stop
    expect(isJoinableSpan({ busRatio: 0, from: 0.7, to: 0.4 })).toBe(false);   // backwards
    expect(isJoinableSpan({ busRatio: 0.45, from: 0.5, to: 0.9, aheadMargin: 0.1 })).toBe(false);
  });
});
```

- [ ] **Step 2:** `cd eyego-api && npx jest __tests__/segment-seats.test.js`. Expected: FAIL, "Cannot find module".
- [ ] **Step 3: Implement**

```js
/**
 * Seats on a bus are sold by SEGMENT, not by trip.
 *
 * A trotro leaves Kasoa full and is half empty by Kaneshie. Counting bookings
 * per trip calls that bus full all the way to Shiashie; counting the most
 * people aboard at any one point of the rider's own stretch is the truth.
 *
 * A span is [from, to) as a fraction of the route, 0 = origin, 1 = destination.
 * Half-open on purpose: someone alighting at x frees the seat for someone
 * boarding at x. Callers pass only seat-occupying bookings (seatOccupyingWhere).
 */
const EPS = 1e-6;

function spanOf(b) {
  const from = Number.isFinite(b?.boardRatio) ? b.boardRatio : 0;
  const to = Number.isFinite(b?.alightRatio) ? b.alightRatio : 1;
  return [from, to];
}

/** Most seats held at any single point inside [from, to). */
function peakOccupancy(bookings, from = 0, to = 1) {
  const events = [];
  for (const bk of bookings ?? []) {
    const [s, e] = spanOf(bk);
    const lo = Math.max(s, from);
    const hi = Math.min(e, to);
    if (hi - lo <= EPS) continue;
    const n = bk.seats ?? 1;
    events.push([lo, n], [hi, -n]);
  }
  // At the same point, ends (-n) sort before starts (+n): the half-open rule.
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let peak = 0;
  for (const [, d] of events) {
    cur += d;
    if (cur > peak) peak = cur;
  }
  return peak;
}

function freeSeatsOnSpan(bookings, maxSeats, from = 0, to = 1) {
  return Math.max(0, maxSeats - peakOccupancy(bookings, from, to));
}

/** The rider's stretch must point forward and start ahead of the bus. */
function isJoinableSpan({ busRatio = 0, from, to, aheadMargin = 0 }) {
  return to - from > EPS && from >= busRatio + aheadMargin;
}

module.exports = { spanOf, peakOccupancy, freeSeatsOnSpan, isJoinableSpan };
```

- [ ] **Step 4:** Run the test. Expected: 6 passed.
- [ ] **Step 5:** Commit `feat(seats): segment-seat availability helper`.

### Task A2: Store each booking's span

**Files:** `eyego-api/prisma/schema.prisma` (Booking), new migration, `bookings.service.js#priceSeat` / `bookSeat`

- [ ] **Step 1:** Add to `Booking`:

```prisma
  /// Where on the route this passenger boards / alights, 0 = origin, 1 = destination.
  /// Null = the trip's own end. Read only through utils/segment-seats.js#spanOf.
  boardRatio          Float?
  alightRatio         Float?
  /// When the driver marked the bus as at this passenger's stop (no-show grace starts here).
  stopArrivedAt       DateTime?
```

- [ ] **Step 2:** `npx prisma migrate dev --create-only --name segment_seats`, review the SQL (3 `ADD COLUMN`, all nullable), then `npx prisma migrate dev` and `npx prisma generate`. Existing rows stay null = whole route: conservative, so the change can never oversell.
- [ ] **Step 3:** `priceSeat` already projects both ends. Make it also return `boardRatio`/`alightRatio` (`boardProj.alongM / totalM`, `proj.alongM / totalM`; in the stop branch, the same projections `alongRouteRatio` takes). `bookSeat` writes them.
- [ ] **Step 4:** Extend `segment-seats.test.js` with a `priceSeat` case (export it for test): a pin halfway gives `alightRatio ≈ 0.5`.
- [ ] **Step 5:** Run `node ../scripts/e2e/prisma-fields.mjs` (catches selected-but-missing columns). Commit.

### Task A2b: Operator-fixed corridor prices (D5)

**Files:** `schema.prisma` (new `Corridor`, `Trip.corridorId`, `Trip.corridorSeatPricePesewas`), same migration as A2; `fare.calculator.js`; `trips.service.js#createTrip`, `#searchTrips`; `bookings.service.js#priceSeat`, `#syncCoveredSeatsTx`

- [ ] **Step 1:** Model:

```prisma
model Corridor {
  id               String   @id @default(cuid())
  name             String   // "Kasoa → Shiashie"
  originLat        Float
  originLng        Float
  destLat          Float
  destLng          Float
  /// How close a trip's ends must be to count as this corridor.
  radiusKm         Float    @default(2)
  seatPricePesewas Int
  isActive         Boolean  @default(true)
  createdAt        DateTime @default(now())
  trips            Trip[]
}
```

Plus `Trip.corridorId String?` and `Trip.corridorSeatPricePesewas Int?`. The price is **pinned on the Trip at publish**, the same rule as the rest of the price lock (memory: Price Lock Is Whole). An admin edit never reprices a bus already selling seats.
- [ ] **Step 2:** `createTrip` matches the nearest active corridor whose two ends are both within `radiusKm` of the route's ends **in the same direction**, and pins both fields.
- [ ] **Step 3:** One function decides a seat's full-route price, and every price surface calls it:

```js
/** Full-route price of one seat on this trip. A corridor price, when pinned, IS the price. */
function fullSeatFarePesewas(trip) {
  if (Number.isInteger(trip.corridorSeatPricePesewas)) return trip.corridorSeatPricePesewas;
  return calculateFare({ /* today's args, unchanged */ }).farePerPersonPesewas;
}
```

`priceSeat` (`:293`), `searchTrips` (`:842`) and `syncCoveredSeatsTx` (`:887`) all switch to it. Segment ratio and add-ons apply on top as today, and commission = `percentOf(fare, commissionRateFor(trip))`.
- [ ] **Step 4:** Invariant: `farePerPersonPesewas` is read only inside `fullSeatFarePesewas` in `bookings.service.js`/`trips.service.js` (otherwise a corridor bus shows one price and charges another, i.e. the "it said 11 then charged 3.61" class).
- [ ] **Step 5:** jest: a corridor trip charges the corridor price; a mid-route rider pays `round(price × ratio)`; an admin edit after publish doesn't change a pinned trip; an off-corridor trip is unchanged.
- [ ] **Step 6:** Commit. (Admin CRUD for corridors is F3.)

### Task A3: Bus position on the route

**Files:** Create `eyego-api/src/services/trip-position.service.js`

- [ ] **Step 1:**

```js
const { projectOntoPolyline } = require('../utils/geo');

/** How far along its own road the bus is, 0..1. 0 before departure or without a fix. */
function busRatioFor(trip, routeLine) {
  const departed = ['DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'IN_PROGRESS'].includes(trip.status);
  const lat = trip.driver?.currentLat;
  const lng = trip.driver?.currentLng;
  if (!departed || !routeLine || !Number.isFinite(lat) || !Number.isFinite(lng)) return 0;
  const p = projectOntoPolyline(lat, lng, routeLine);
  return p && p.totalM > 0 ? p.alongM / p.totalM : 0;
}

module.exports = { busRatioFor };
```

- [ ] **Step 2:** jest test with a straight 3-point polyline: driver at the midpoint gives ≈0.5; `FILLING` gives 0.
- [ ] **Step 3:** Commit.

### Task A4: `bookSeat` accepts running trips, by span

**Files:** `eyego-api/src/modules/bookings/bookings.service.js:419-720`

- [ ] **Step 1:** Replace the status gate at `:435` with:

```js
      const JOINABLE = ['SCHEDULED', 'FILLING', 'CONFIRMED', 'DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'IN_PROGRESS'];
      // Public group trips only: an on-demand trip's route is minted inactive
      // (trips.service searchTrips privacy note) and must never take a stranger.
      if (!JOINABLE.includes(trip.status) || trip.route?.isActive === false) {
        throw new AppError('This trip is no longer accepting bookings', 400, 'TRIP_UNAVAILABLE');
      }
```

- [ ] **Step 2:** Replace the per-trip count at `:596-601` with span capacity. Price first (move the `priceSeat` call above), then:

```js
      const occupying = await tx.booking.findMany({
        where: { tripId, ...seatOccupyingWhere() },
        select: { boardRatio: true, alightRatio: true, seats: true },
      });
      const from = priced.boardRatio ?? 0;
      const to = priced.alightRatio ?? 1;
      if (running && !isJoinableSpan({ busRatio, from, to, aheadMargin: joinAheadMargin(trip) })) {
        throw new AppError('This bus has already passed your stop', 409, 'BUS_PASSED_STOP');
      }
      if (freeSeatsOnSpan(occupying, trip.maxSeats, from, to) < seatsRequested) {
        throw new AppError('This trip is full', 400, 'TRIP_FULL');
      }
```

`busRatio` comes from `busRatioFor` (Task A3) using `routeLine`, which is already fetched before the tx. `trip` must include `driver: { select: { currentLat, currentLng } }`.
- [ ] **Step 3:** Seat number: per D1, the seat-taken check at `:605-608` only runs when a `seatNumber` was sent (it's optional). Nulls don't collide on `@@unique([tripId, seatNumber])` in Postgres.
- [ ] **Step 4:** Mid-route = prepaid (D8). If `running && normalizePaymentMethod(paymentMethod) === 'CASH'` → `409 PREPAY_REQUIRED`. Hold = `min(seatHoldMs(), etaToStopMs - 60_000)`, floored at 2 min.
- [ ] **Step 5:** jest `__tests__/bookings.midroute.test.js` (mocked prisma, pattern of `bookings.cancelBooking.test.js`): IN_PROGRESS + stop ahead → booked; stop behind → `BUS_PASSED_STOP`; full on span → `TRIP_FULL`; seat freed by a passenger alighting earlier → booked; private on-demand route → `TRIP_UNAVAILABLE`.
- [ ] **Step 6:** Commit `feat(bookings): book a seat on a bus already on the road`.

### Task A5: `searchTrips`: running buses, direction, seats on your stretch, ETA

**Files:** `eyego-api/src/modules/trips/trips.service.js:725-893`

- [ ] **Step 1:** Add `{ status: { in: ['DRIVER_EN_ROUTE','ARRIVED_AT_PICKUP','IN_PROGRESS'] }, updatedAt: { gte: now - IN_FLIGHT_IDLE_HOURS } }` to the `OR`. `route.isActive: true` stays (privacy). Include `driver.currentLat/Lng` **for the server's use only**, and strip it before returning (privacy note at `:786-788`).
- [ ] **Step 2:** In the geo branch, replace the end-radius filter with: project the rider's origin and destination on the trip polyline (`routeLineForTrip`, cached per trip id). Both must be within `radius` km of the line, `from < to`, and `isJoinableSpan` against `busRatioFor`. Keep the old end-radius match as the fallback when the polyline is unavailable.
- [ ] **Step 3:** Per kept trip: `availableSeats = freeSeatsOnSpan(...)` **for the rider's span** (Invariant 4: derived once, on the server), `boardRatio/alightRatio`, the segment fare via `priceSeat`, and `etaToPickupSec` via `eta.etaSeconds(driverPos, riderOrigin)` (null when not departed: use departure time). Sort running trips by ETA, upcoming ones by departure.
- [ ] **Step 4:** jest: a trip heading the wrong way is excluded; a running bus that has passed the rider is excluded; a full-then-freed bus shows the right seats.
- [ ] **Step 5:** Rider `SelectStage.tsx`: row copy "Passing your stop in N min · K seats free · ₵X" when `etaToPickupSec` is present. Use the existing `formatGhs` and the dates helpers (no `toLocale*`, memory: Demo Pass).
- [ ] **Step 6:** Commit.

### Task A6: No-show grace + resale

**Files:** `trips.service.js#riderNoShow:1592`, driver routes/service, `settings.js`

- [ ] **Step 1:** New `POST /driver/trips/:id/stops/arrive { bookingIds }` stamps `stopArrivedAt = now` (owned-trip check, conditional `updateMany`, only rows with `stopArrivedAt: null`) and calls `trip-notify` → "Your bus is at the stop".
- [ ] **Step 2:** `riderNoShow` refuses with `409 NO_SHOW_TOO_EARLY` (`details: { waitUntil }`) unless `stopArrivedAt + NO_SHOW_GRACE_MINUTES ≤ now`. The driver app branches this 409 before the generic handler (Invariant 28).
- [ ] **Step 3:** After the commit, call `trip-notify.notifySeatPassing(tripId)` (Task A8): the released span is for sale immediately, because `bookSeat` now accepts running trips.
- [ ] **Step 4:** jest: early no-show refused, after grace accepted, seat bookable again by a span further down.
- [ ] **Step 5:** Commit.

### Task A7: Alight = segment end (fixes B3)

- [ ] **Step 1:** No new status (Booking is seat+money only, schema comment `:715`). Alighting is implied by `alightRatio < busRatio`, which already frees the span in A1's math.
- [ ] **Step 2:** `useTripStops.ts:165-170`: the current stop is the first stop whose ratio is ahead of the bus's ratio (server sends `busRatio` on the trip snapshot; publisher must carry it, Invariant 16). This fixes B3.
- [ ] **Step 3:** Commit.

### Task A8: Push "bus with a free seat passing your stop"

**Files:** `eyego-api/src/services/trip-notify.service.js` (single owner, Invariant 18), `server.js` sweep

- [ ] **Step 1:** `notifySeatPassing(tripId)`: load open `TripAlert`s (origin set) and project each origin and dest on the trip polyline. Keep those that are joinable, have ≥1 free seat on their span, and whose ETA ≤ `SEAT_PASSING_PUSH_MAX_MIN` (setting, default 15). Claim per (alert, trip) with Redis `SET NX` (the alert's single `tripId` claim stays for publish alerts). Send FCM + socket `user:<id>` frame `trip:seat_passing { tripId, etaSec, seats, farePesewas }`. The rider must have a listener (Invariant 19).
- [ ] **Step 2:** Triggers: after no-show (A6), after a cancellation on a running trip, and a 60 s sweep over running public trips (Redis lease per tick, like the other sweeps).
- [ ] **Step 3:** Rider: in SelectStage's empty state, "Tell me when a bus passes" creates a TripAlert with origin (the endpoint exists: `createTripAlert` `trips.service.js:2398`). The tap on the push opens `/ride/[id]` with the rider's span prefilled.
- [ ] **Step 4:** Extend `scripts/e2e/trip-alerts.mjs` with a static check that the `trip:seat_passing` emit has a rider listener.
- [ ] **Step 5:** Commit.

### Task A9: Invariants + verify + docs

- [ ] **Step 1:** `scripts/invariants.test.mjs`:
  - **Seat capacity on a group trip is decided only by `freeSeatsOnSpan`.** No `booking.count(` with `seatOccupyingWhere()` compared to `maxSeats` in `bookings.service.js`/`trips.service.js`.
  - **`eta.` calls name real exports** (from A0.1).
- [ ] **Step 2:** Run all of: `node node_modules/typescript/lib/tsc.js -p apps/rider` (and driver, admin); `yarn test`; `cd eyego-api && npx jest`; `node scripts/e2e/run-all.mjs --static` (or each static suite per `scripts/e2e/README.md`).
- [ ] **Step 3:** Update `state.md` + append to `session-log.md`. Commit `docs: phase A state`.

---

## 6. Phases B–F (task level; expanded after D1–D8)

### Phase B: Entry picker (item 8)
- B1. `home.tsx`: replace the single pill with three product cards ("Book a seat", "Book the whole bus", "Book a ride"), keeping Scan/Saved/Schedule/Wallet as the secondary row. Each card does `morphTo` into `/trip?stage=search&product=seat|bus|ride` (the one container transform, state.md D1; no new flights).
- B2. `trip.tsx` reads `product` into the ride store. `seat` → Search → Select (list of buses, A5). `ride` → Search → Configure (existing). `bus` → Search → Configure with party = vehicle capacity and charter copy (Phase D). Scheduling stays reachable from `ride`.
- B3. Static check in `scripts/e2e/button-wiring.mjs` that the three cards route to real stages.

### Phase C: Shared vs private on-demand (item 2)
- C1. `driver-availability.js`: `sharedSeatDriverIds(prisma, { pickup, dropoff, seats })`. Drivers with a public, joinable, running or upcoming trip whose polyline passes within `SHARED_MAX_OFF_ROUTE_M` of both points in order, with `freeSeatsOnSpan ≥ seats`. Same file = still the one eligibility source (Invariant 11).
- C2. `startCascade(tripId, { kind: 'SHARED_SEAT' })`: the matcher uses the C1 ids instead of `availableDriverWhere`. Same offer TTL, lock and three delivery paths (Invariants 13–15). D3 decides whether accept is required or automatic.
- C3. Accept a `SHARED_SEAT` offer → `bookSeat` on the driver's trip with the rider's span (normal seat price, D-pricing). The placeholder request Trip → `CANCELLED` (sys, reason `MERGED_INTO_TRIP`) via `tripState`. The rider is moved to the host trip's tracking.
- C4. Cascade exhausts → `NO_SHARED_BUS` outcome. The rider sees "No bus heading your way. Get a private bus for ₵Y?", and accepting re-quotes as `ON_DEMAND` (existing path, D2 premium).
- C5. Tests: eligibility (direction, seats, off-route), merge accept, fallback.

### Phase D: Charter + multi-seat (items 3, 4)
- D1. Charter = on-demand with `product: 'CHARTER'`, `partySize = vehicle capacity`, private, priced per D4. B2 capacity filter applies. Receipt + "Book the return" button (pre-fills the reversed pickup/drop-off and a time picker → scheduled ride intent, which already exists).
- D2. Seat trips: `bookSeat` accepts `seats: N` (one row, `seatNumber` null per D1, span capacity checks N). `getTripFareForRider`/`sumSeats` already aggregate seats. Driver row shows "10 passengers · 1 booking" (`useTripStops` already reads `seatCount`); boarding = party boarding (exists, `scripts/e2e/party-boarding.mjs`).
- D3. Tests: charter price, N-seat span capacity, N-seat cancel = one refund.

### Phase E: Seat map removed (item 5, D1)
- E1. `ride/[id].tsx`: "K seats free · ₵X" plus a seats stepper (cap = `availableSeats` for the rider's span) → `seat.tsx`, which is reduced to "where do you get off" (RouteDropoffMap) and the price. Cabin3D leaves the booking path (the file stays only if another screen imports it; otherwise delete it).
- E2. The client stops sending `seatNumber`; `bookSeat` treats it as optional (A4 step 3). Driver surfaces that show seat numbers fall back to "Passenger N" (check `useTripStops.ts:150` `extraSeatNumbers`, the driver seat strip, receipts).
- E3. `tsc` + `scripts/e2e/button-wiring.mjs` (no dead `/seat` routes) + `motion-invariants.mjs`.

### Phase F: Driver supply + admin (item 9, positioning, B4)
- F1. Driver home/create: "Repeat last run" (prefill from the driver's last published trip: no schema) plus optional weekly recurrence that materialises Trips from `PulseSchedule`-shaped rows owned by the driver (fixes B4 for admin schedules too: one materialiser).
- F2. Record unmet demand: every `searchTrips` with coordinates and 0 results → `DemandSignal { originLat/Lng, destLat/Lng, hour, dow }` (migration; fire-and-forget, after the response).
- F3. Admin `/demand`: bookings + TripAlerts + DemandSignals grouped by nearest virtual stop / corridor (origin-dest cell pair) × hour of week. Filters for the launch corridors. Corridor fixed prices UI only if D5 = fixed.

---

## 7. Verification gates (every phase)
`tsc` rider/driver/admin = 0 · `yarn test` · `npx jest` (API) · static e2e suites · new unit tests named in each task. **Not verifiable here:** anything on a device (pushes on iOS are blocked by the missing APNs key, Part 7), real Mapbox ETAs, real Paystack. Each phase's state.md entry will say so.

## 8. Self-review
- Coverage: items 1→A, 2→C, 3/4→D, 5→E, 6→A6/A4, 7→A2/A4/C3/D5, 8→B, 9→F. Bugs B1–B4 → A0/A7/F1.
- Names used consistently: `boardRatio`, `alightRatio`, `stopArrivedAt`, `freeSeatsOnSpan`, `isJoinableSpan`, `busRatioFor`, `notifySeatPassing`, codes `BUS_PASSED_STOP`, `PREPAY_REQUIRED`, `NO_SHOW_TOO_EARLY`.
