# Booking-flow consistency scan — rider vs driver vs server

Static scan, 2026-08-11. Every finding below has a file:line and a concrete
failure. Nothing here is device-tested — that is the point, these are the ones
you would otherwise have had to find by hand.

Ordered by severity.

---

## 1. `confirmedSeats` drifts DOWN and can oversell the vehicle — HIGH

`Trip.confirmedSeats` is a denormalised counter with **two decrement sites but
only one real increment site**, and they do not agree on what they are counting.

| Site | Action | Guard |
|---|---|---|
| `payments.service.js:410` | `increment: settledCount` | on payment settlement |
| `drivers.service.js:1109,1160` | `increment: 1` | driver-added offline/cash passenger |
| `cancellation.service.js:157` | `decrement: 1` | **guarded** on `paymentStatus === 'PAID'` ✅ |
| `trips.service.js:1091` (`riderNoShow`) | `decrement: 1` | **UNGUARDED** ❌ |

`bookSeat` never increments — a seat only becomes "confirmed" when payment
settles. So marking an **unpaid** rider as a no-show decrements a counter that
was never incremented for them.

**Consequence, and it is the wrong direction.** `availableSeats` is computed as
`Math.max(0, maxSeats - confirmedSeats)` (`graphql/dataloaders.js:40`). With
`confirmedSeats` negative, that becomes `maxSeats + n` — the trip advertises
**more seats than the vehicle has**. The clamp protects against the harmless
direction and not the harmful one.

It also skews `orderBy: { confirmedSeats: 'desc' }` in
`trips.service.js:1291` ("prefer filling an already-popular trip") and the
`MIN_OCCUPANCY_TO_DEPART` check.

**Fix:** guard the `riderNoShow` decrement on `paymentStatus === 'PAID'`, the
same way cancellation already does.

**Checked against live data (2026-08-11):** 0 trips with `confirmedSeats < 0`
and 0 with `confirmedSeats > maxSeats`. The bug is **latent** — nobody has been
marked no-show on an unpaid booking yet — so no backfill is needed, only the
guard. Worth fixing before it fires rather than after.

---

## 2. Four different formulas for "seats available" — HIGH

The same question is answered four ways, and they disagree whenever a seat is
held but unpaid — which is exactly what sharing an invite does.

| Where | Formula | Counts holds? |
|---|---|---|
| `graphql/dataloaders.js:40` | `maxSeats - confirmedSeats` | no |
| `apps/rider/app/ride/[id].tsx:94` | `maxSeats - bookings.length` | **yes** |
| `apps/rider/app/(tabs)/home.tsx:151` | `maxSeats - confirmedSeats - pendingSeats` | partly |
| `apps/rider/app/join/[token].tsx:146` | `maxSeats - confirmedSeats` | no |

A host with cover-all on holds every remaining seat. On the book-a-seat page
that reads as **0 seats left**; on the home card and the join page the same trip
still shows seats free. A rider taps through from one to the other and the
number changes.

**Fix:** one server-computed `availableSeats` on the trip payload, and delete
all three client formulas.

---

## 3. Fabricated seat numbers in the UI — MEDIUM

Three different invented fallbacks when the real number is missing:

- `apps/rider/components/trip/stages/SelectStage.tsx:507` — `trip.availableSeats ?? 3`
  renders "3 SEATS LEFT" for a trip whose seat count never loaded.
- `apps/rider/app/ride/[id].tsx:189` — `trip.totalSeats ?? 10`
- `apps/rider/app/ride/[id].tsx:527` — `seats={trip?.maxSeats ?? 4}` into the
  price-breakdown sheet

Same class of bug as the "4.9 rating" that was removed earlier: a plausible
invented number is worse than an absent one, because nothing looks wrong.

**Fix:** render nothing (or a skeleton) rather than a guess.

---

## 4. Driver app has four independent status-label maps — MEDIUM

The same `TripStatus` is given a different label depending on which driver
screen you are on:

| File:line | `DRIVER_EN_ROUTE` reads as |
|---|---|
| `active/[id].tsx:55` | "Heading to Pickup" |
| `active/[id].tsx:77` | "En Route" |
| `tracking/[id].tsx:35` | "En Route to Stop" |
| `tracking/[id].tsx:725` | "En Route" |
| `components/TripCard.tsx:22` | "En Route" |

Two of those maps are in the *same file*. The rider meanwhile says "Driver is on
the way" (`tripLiveNotification.ts:13`). A driver moving between manage and
tracking mid-trip sees the status rename itself.

**Fix:** one exported `TRIP_STATUS_LABELS` in `@eyego/config`, consumed by both
apps, so the rider and driver vocabulary is defined once.

---

## 5. `rides.service.js:251` sets `confirmedSeats: 1` on an unpaid booking — LOW/MEDIUM

An on-demand trip is created with `confirmedSeats: 1` while its booking is
`paymentStatus: 'PENDING'`. Everywhere else, "confirmed" means settled. Harmless
for a 1-seat on-demand ride today, but it is the definitional inconsistency that
makes finding #1 possible in the first place.

**Fix:** pick one meaning of `confirmedSeats` — committed, or paid — and make
all five write sites obey it. Recommend *committed*, since that is what a seat
map should show.

---

## Not a bug (checked and cleared)

- Server queries correctly exclude `CANCELLED` bookings everywhere
  (`trips.service.js:262,327,473,547`), so client `bookings.length` is already
  cancellation-safe.
- Payment-method vocabulary (`CASH`/`CARD`/`MOMO`/`WALLET`) matches across
  client, API types and server validators.
- `MAX_SEATS_PER_BOOKING` is imported from `@eyego/config` in every rider seat
  stepper — no local copies.
- `cancellation.service.js` guards its decrement correctly.

---

## Suggested order

1 and 2 are the ones that can take money or oversell a vehicle. 3 and 4 are
polish that stops the flow *reading* inconsistently. 5 is the cleanup that
prevents 1 recurring.
