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

### Booking flow — STILL NOT AUDITED (pass 3 backlog)
- Guest bookings end to end (multiple guests per account; the `samePassenger` keying is subtle and has regressed twice).
- Group cover-all beyond the `syncCoveredSeatsTx` fixes already made.
- Trip-completion receipt vs actual settlement reconciliation (an agent died mid-edit in this area; the floor fix and receipt fix were verified present, the whole path was not re-derived).
- Promo codes / tips / disputes / ratings interaction with cancelled and refunded bookings.

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
