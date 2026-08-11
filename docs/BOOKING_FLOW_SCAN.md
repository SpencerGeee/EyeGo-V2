# Booking-flow scan — findings and fixes

Two passes over the booking flow across rider, driver and server, 2026-08-11.
Everything below is **fixed and committed** unless marked otherwise.

Commits: `d7058ae` (pass 1), `3a0fdda` (pass 2).

---

## Pass 1 — the counters and the seat filter

### 1. The rider's trip list was ALWAYS empty — CRITICAL
`SelectStage` filtered `(t.availableSeats ?? 0) >= minSeats` with `minSeats`
defaulting to 1, and `searchTrips` never returned `availableSeats`. So the test
was `0 >= 1` for every trip and every trip was dropped. `filtersActive` is
`minSeats > 1`, so no filter badge appeared either — an empty list with nothing
to explain it.
**Fixed:** endpoint returns the field; filter now fails OPEN, so an unknown
count can never hide a real trip.

### 2. A no-show consumed a seat permanently — CRITICAL
Every occupancy query asked `status: { not: 'CANCELLED' }`. `BookingStatus` has
FOUR terminal states that release a seat — CANCELLED, EXPIRED, REFUNDED,
NO_SHOW — and the filter excluded one. A no-show kept its seat in the counts,
in the collision check and on the driver's map. `riderNoShow` also did not null
`seatNumber`, and `@@unique([tripId, seatNumber])` has no status in it, so the
next rider to pick that seat failed on a constraint for a seat drawn as free.
**Fixed:** one shared `seatOccupyingWhere()` in `utils/booking-status.js`, used
by all 22 occupancy queries; `seatNumber` released on no-show.

### 3. `confirmedSeats` could go negative and OVERSELL — HIGH
Incremented only on payment settlement, but `riderNoShow` decremented
unconditionally while deliberately accepting unpaid SEAT_HELD bookings.
`availableSeats = maxSeats - confirmedSeats`, so a negative counter advertises
MORE seats than exist — the `Math.max(0, …)` clamp guarded the harmless
direction only.
**Fixed:** guarded on PAID (matching cancellation), and floored with
`updateMany … confirmedSeats: { gt: 0 }`. Live data checked: 0 rows were out of
range, so it was latent — no backfill needed.

### 4. Four formulas for "seats available" — HIGH
Server, booking page, home card and join page each computed it differently and
disagreed the moment a seat was held but unpaid — which is exactly what sharing
an invite does.
**Fixed:** derived once server-side from the occupancy-filtered bookings;
every client reads the field.

### 5. Three invented numbers — MEDIUM
`availableSeats ?? 3` rendered "3 SEATS LEFT" for a trip whose count never
loaded; `totalSeats ?? 10` sized the occupancy bar for a van that might hold 4
or 14; `maxSeats ?? 4` fed the price-breakdown sheet whose whole job is
explaining the number.
**Fixed:** unknown renders nothing.

### 6. Four status-label maps in the driver app — MEDIUM
`DRIVER_EN_ROUTE` was written five ways across four maps, two in the same file.
**Fixed:** one shared vocabulary in `@eyego/config/tripStatus.ts`, with separate
rider and driver phrasing per status.

---

## Pass 2 — the condition-dependent ones

### 7. Cover-all, toggled twice, destroyed its own seats — HIGH
Turning cover-all OFF cancelled the held seats without nulling `seatNumber`, so
each released seat became permanently unbookable — and `createMany({
skipDuplicates: true })` then silently skipped them if the host toggled it back
ON, so the host could not re-hold the van either.
**Fixed:** `seatNumber: null` on release.

### 8. The seat filter in eleven more places — HIGH
Same `not: 'CANCELLED'` in the driver's add-passenger collision checks (a
no-show seat could not be resold to a walk-up), the "last rider left → back on
sale" check (a trip whose remaining bookings were all no-shows never returned
to sale), push-notification recipient lists (no-shows still notified), and four
socket authorisation checks.
**Fixed.** Admin analytics deliberately left alone — a no-show still counts as
revenue.

### 9. Anyone could cancel a driver's offline passenger — SECURITY
`cancelBooking` read `if (booking.userId !== null && booking.userId !== userId)
throw`, so a null `userId` passed the check and any authenticated rider could
cancel that booking given only its id. The justification in the comment was
wrong: rider-made guest bookings carry the BOOKER's userId; the only
null-userId rows are the driver's own cash passengers.
**Fixed:** null userId is now rejected outright on this endpoint.

### 10. The seat stepper did nothing — HIGH
`RequestStage` read `requestSeatCount` and never sent it (TypeScript had it
flagged as unused), and `requestRide` hardcoded `maxSeats: 1`. A rider choosing
three seats got a one-seat trip and a driver expecting one passenger.
**Fixed:** sent, validated (1–6), clamped server-side. Fare untouched — an
on-demand ride is priced as the whole car. Verified this cannot leak a private
hire into public listings: `searchTrips` returns only SCHEDULED/FILLING and
on-demand trips never enter those states.

---

## Checked and cleared

- Server queries correctly exclude cancelled bookings — client `bookings.length`
  was already cancellation-safe.
- Payment-method vocabulary matches across client, API types and validators.
- `MAX_SEATS_PER_BOOKING` imported from `@eyego/config` everywhere; no copies.
- Seat-hold expiry sweep releases `seatNumber` correctly.
- `acceptTripRequest` uses a proper compare-and-swap claim — no double-accept.
- `bookSeat` releases a passenger's prior hold keyed on the PASSENGER, not the
  account, so booking for a guest then for yourself no longer cancels the guest.
- `cancelBooking` correctly refuses PAID bookings.
- `drivers.service` cancel-trip path already nulled `seatNumber`.
- `confirmPayment`'s trip-full guard is a secondary check behind the unique seat
  assignment; the drifting counter it read is now fixed anyway.

## Still open

- `rides.service.js` creates on-demand trips with `confirmedSeats = partySize`
  while payment is PENDING, whereas group trips only count a seat once payment
  settles. Harmless today (on-demand trips are never publicly listed, so nothing
  reads their availability), but the two products still mean slightly different
  things by "confirmed". Worth unifying if on-demand ever becomes shareable.
- Nothing here is device-tested. Backend changes need a deploy.
