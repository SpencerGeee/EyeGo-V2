# State — 2026-08-12

## Current Goal
Booking-flow bug hunt (pass 1 done), then full Next.js admin rebuild.

## Decisions (this session, user-approved)
- Phase 1 scope: bugs + edge cases + missing pieces under ~1h each. Bigger features reported, not built.
- Admin rebuild: new `apps/admin` workspace, deploy to Vercel, talks to eyego-api over HTTPS.
- Admin auth: reuse existing adminAuth JWT, add RBAC roles (superadmin/ops/finance/support) enforced in BOTH Next middleware and the backend, plus an audit log of every mutating action.
- Admin approach: parity first across the 46 existing endpoints, then extend.

## Plan Status

### Booking flow — pass 1 DONE (6 bugs fixed, all verified green)
1. `packages/types/src/trip.types.ts` — `TripStatus` had 8 of 15 real statuses and invented a phantom `'BOARDING'`. Rewrote to mirror the Prisma enum + added TERMINAL/ACTIVE/PRE_DRIVER/PRE_TRIP/LIVE groupings and predicates.
2. `apps/rider/components/TripStatusListener.tsx` — `NO_DRIVERS_FOUND` and `EXPIRED` were handled NOWHERE. Rider sat on the searching screen forever when dispatch exhausted or the request aged out. Added to the terminal branch with distinct copy.
3. `apps/rider/app/(tabs)/home.tsx` — `activeBookingStatusLabel` had no case for REQUESTED/MATCHING/REASSIGNING/SCHEDULED, so the live-trip card showed no status for the whole dispatch window. Added.
4. `eyego-api/src/graphql/dataloaders.js` — still computed `availableSeats = maxSeats - confirmedSeats` (ignores holds), the exact divergence the "ONE ANSWER" note in trips.service.js claims to have fixed. Now counts `seatOccupyingWhere()` bookings. Was an overbooking path.
5. `eyego-api/src/modules/admin/admin.service.js` assignDriverToTrip — swapped `driverId` with a bare `updateMany`: no version bump, no TripEvent, no publish. Neither app learned of an admin reassignment. Now appends a `DRIVER_REASSIGNED` event via `recordEvent` (which owns the version bump — do NOT bump in the claim, or version↔event stops being 1:1 and replay gaps).
6. `eyego-api/src/modules/rides/rides.service.js` force-terminal fallback — only seat-release site that never set `seatNumber: null`, so a cancelled row kept blocking `@@unique([tripId, seatNumber])`.

### Booking flow — pass 2 DONE: 4 areas audited, ALL SOUND, 0 new bugs
Verified correct, so these do NOT need stress-testing:
- **Paystack webhook idempotency** — constant-time signature compare (`crypto.timingSafeEqual` with a length pre-check), Redis `NX` lock per reference, and an existing-`SUCCESS`-row check before reprocessing. Correct.
- **Last-seat race / double-booking** — `bookSeat` runs at `isolationLevel: 'Serializable'` (also `createRideGroup` and one other), re-reads the trip inside the tx, releases the caller's own stale hold BEFORE the capacity count, and both the capacity guard and the specific-seat collision check use `seatOccupyingWhere()`. Backed by `@@unique([tripId, seatNumber])`. Correct.
- **`confirmedSeats` counter symmetry — my drift hypothesis was WRONG.** I suspected the 3 increments vs 1 decrement would drift. They do not: `cancellation.service` decrements only when `paymentStatus === 'PAID'`, and BOTH `drivers.service` increment sites (cash-passenger boarded :1249, offline-OTP verified :1300) set `paymentStatus: 'PAID'` in the same transaction. Increment and decrement are gated on the same condition. Decrement is also floored via `updateMany` + `gt: 0`.
- **Cash settlement semantics** — cash commission is debited from the driver wallet with a matching `WalletTransaction` ledger row (balanceBefore/After recorded), and the auto-settle-on-arrival path filters to unsettled cash only, matching `completeTrip`'s PAID-only filter so it cannot double-charge.

### Booking flow — pass 3 DONE (5 bugs fixed)
1. **`rateBooking` had NO state check** — existence, ownership and the 1-5 range were the only gates. A rider could rate a driver on a trip CANCELLED before the driver arrived, or on a seat they were NO_SHOW for. Ratings feed `rating-integrity.service`, which gates the go-online check AND dispatch ranking, so a one-star on a ride that never happened suppressed real work. Griefing vector: cancel, rate one star, repeat. Now requires `trip.status === 'COMPLETED'` and a non-releasing booking status. (Double-rating was already safe — upsert on `userId_tripId`.)
2. **`rateBooking` accepted fractional stars** — the message promised an integer, the check was `isNaN(stars) || <1 || >5`. Now `Number.isInteger`.
3. **`tipDriver` had NO state check** — same hole, but it moves real money: a rider whose trip was cancelled or refunded could be charged a MoMo tip for a driver who never carried them. Same gate.
4. **Guest seat collision** — the stale-hold release was an `updateMany` keyed on `{ guestName, guestPhone }`, which is NOT unique: two guests can share a name and `guestPhone` is optional. Booking a second seat for a second same-named guest with no phone cancelled the first one's seat. Now releases AT MOST ONE row (most recent); ambiguous matches leave older rows alone to expire on their own timer.
5. **THE REAL item-22 root cause, finally.** `getBooking` — the endpoint the trip-complete screen calls — returned the bare `Booking` row with no `fareBreakdown`, though the client's API type has always declared one. So the screen fell through to its own fallback: one booking's `fareAmountPesewas` (the "8", floored to the per-seat minimum) with `seatCount` hardcoded to 1 — because a cover-all host owns ONE BOOKING PER COVERED SEAT and this endpoint only looked at one. Now attaches `fareBreakdown` built from `getTripFareForRider`, the single fare derivation the group hub / tracking / cancellation quote already share. Field names mapped to the client's contract (`total`, not `totalPesewas`) — that mismatch is why even the cancellation path's `fareBreakdown` was being silently ignored.
6. Also fixed in pass 1-scope: `getTripReceipt` used `findFirst` over a per-BOOKING `Receipt` table, returning one arbitrary seat's receipt for a cover-all host. Now sums all of the rider's receipts for the trip and reports `seatCount` + `seatNumbers`.

Verified sound in pass 3, no change needed: `applyPromoCode` (guards `paymentStatus === 'PAID'` + duplicate promo), `recomputeBookingAddons` (guards status ∈ {SEAT_HELD, PENDING} both before and inside its write), `syncCoveredSeatsTx` (releases with `seatNumber: null`, re-derives free seats from `seatOccupyingWhere()`, prices on the `maxSeats` denominator). `submitDispute` has no status guard deliberately — disputing a charge on a cancelled booking is legitimate.

### Booking flow — residual risk (not blocking)
- Nothing is device-tested.
- `getBooking` now does an extra fare derivation per call; it is best-effort and degrades to the client fallback, but it adds a query to a hot endpoint.

### Superseded pass 2 backlog (kept for context)
- Payment: Paystack callback idempotency, cash settlement, refund paths on each cancel type.
- Concurrency: two riders racing the last seat; driver accepting two dispatches; double-tap booking idempotency.
- Guest + offline bookings (`isOffline`, `offlineOtp`) end to end.
- Group hub cover-all edge cases beyond what was already fixed.
- Trip completion money settlement (driver wallet, commission) vs the receipt.
- `confirmedSeats` column drift: incremented in 3 places (drivers.service ×2, payments.service), decremented in 1 (cancellation.service). Payments gates "trip full" on the column while the seat map derives from rows — if the column drifts, false "full" or overbooking.

### Admin rebuild — NOT STARTED
Current admin = `eyego-api/public/index.html`, 2378-line vanilla SPA. Backend has 46 routes / 45 service fns in `src/modules/admin/`.

## Evidence
- Both apps `tsc --noEmit` clean; all changed backend JS `node --check` clean; prisma schema valid.
- Architecture is sound and should be preserved: `Trip.status` is the ONLY lifecycle authority, `applyTransition` its only writer, version CAS + append-only TripEvent with `seq === version`, terminals absorbing. `Booking.status` is seat+money state only and must never answer "where is my ride".

## Open Issues
- Nothing committed to git this session. ~56 files modified.
- Session hit the monthly spend cap once already (killed 2 subagents mid-edit). Admin rebuild is large — consider a fresh session.
- Carried-over risk: nothing from this or the previous 22-item sweep is device-tested.
