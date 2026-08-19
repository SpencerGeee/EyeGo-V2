'use strict';

/**
 * WHICH BOOKINGS STILL OCCUPY A SEAT.
 *
 * BUGFIX — a no-show consumed a seat permanently.
 *
 * Every seat-occupancy query in the codebase asked the same question the same
 * wrong way: `status: { not: 'CANCELLED' }`. `BookingStatus` has FOUR terminal
 * states that release a seat — CANCELLED, EXPIRED, REFUNDED and NO_SHOW — and
 * that filter excluded exactly one of them.
 *
 * So a rider marked NO_SHOW, or a seat hold that aged out to EXPIRED, or a
 * refunded booking, kept its `seatNumber` and kept reading as occupied:
 *
 *   - `bookSeat`'s free-seat count never recovered the seat, so the trip could
 *     not be filled back to capacity.
 *   - the specific-seat collision check kept rejecting that seat number, so it
 *     could never be re-sold for the life of the trip.
 *   - the driver's seat map drew it as taken, with a passenger who is not
 *     coming.
 *
 * It is a silent fault: the seat simply never comes back, and nothing anywhere
 * reports an error.
 *
 * `trip-lifecycle.service.js` already had the correct set for its own purposes
 * and nothing else used it. This is that set, in one place, for everything.
 *
 * COMPLETED is deliberately included: on a finished trip the seat map is a
 * record of who travelled, and availability no longer matters.
 */
const SEAT_OCCUPYING_STATUSES = [
  'PENDING',
  'SEAT_HELD',
  'CONFIRMED',
  'PAID',
  'BOARDED',
  'COMPLETED',
];

/** The mirror image — a seat these bookings held is free again. */
const SEAT_RELEASING_STATUSES = ['CANCELLED', 'EXPIRED', 'REFUNDED', 'NO_SHOW'];

/**
 * Prisma filter fragment. Use this rather than writing the list inline, so a
 * new BookingStatus cannot silently start or stop occupying a seat depending on
 * which query you happened to land in.
 */
const seatOccupyingWhere = () => ({ status: { in: SEAT_OCCUPYING_STATUSES } });

/**
 * WHO IS ACTUALLY TRAVELLING — the occupancy that decides whether a bus may
 * depart.
 *
 * A THIRD question, deliberately distinct from the two above, and it exists
 * because using either of them here is wrong in a different direction:
 *
 *   - `Trip.confirmedSeats` is a PAYMENT counter. It is incremented only when
 *     money settles or the driver adds a cash passenger, so on a minibus whose
 *     riders all chose "pay cash on boarding" it reads 0 while every seat is
 *     sold. Gating departure on it refuses to let a FULL bus leave.
 *   - `SEAT_OCCUPYING_STATUSES` includes PENDING and SEAT_HELD — unpaid holds
 *     that may never become passengers. Gating departure on that lets an EMPTY
 *     bus leave on the strength of holds that are about to age out.
 *
 * So: committed bookings only. CONFIRMED (the seat is theirs), PAID, and
 * BOARDED (already aboard). COMPLETED cannot occur before departure.
 *
 * Used by the minimum-occupancy check on `POST /driver/trips/:id/depart`.
 */
const DEPARTURE_COUNTED_STATUSES = ['CONFIRMED', 'PAID', 'BOARDED'];

/** Prisma filter fragment for the set above. Never write the list inline. */
const departureCountedWhere = () => ({ status: { in: DEPARTURE_COUNTED_STATUSES } });

/**
 * WHO IS STILL EXPECTING TO TRAVEL — a FOURTH question, and the one every
 * remaining hand-written predicate in the codebase was reaching for.
 *
 * `SEAT_OCCUPYING_STATUSES` answers "is this seat sold", and it includes
 * COMPLETED on purpose so a finished trip's seat map still shows who rode. That
 * makes it the wrong set for anything asking about a trip that is still
 * happening: "does this trip still have passengers, so cancel it into a
 * re-dispatch rather than killing it", "whose fares add up to the driver's
 * offer", "which rows go in the live seat rail".
 *
 * The sites that asked those questions each wrote their own list and each got a
 * different one — `notIn: ['CANCELLED', 'COMPLETED']` counted an expired hold
 * and a no-show as live passengers, and `notIn: ['CANCELLED', 'REFUNDED',
 * 'EXPIRED']` counted the no-show alone. Neither is a crash; both quietly
 * overstate how many people are waiting.
 */
const LIVE_PASSENGER_STATUSES = SEAT_OCCUPYING_STATUSES.filter((s) => s !== 'COMPLETED');

/** Prisma filter fragment for the set above. Never write the list inline. */
const livePassengerWhere = () => ({ status: { in: LIVE_PASSENGER_STATUSES } });

module.exports = {
  SEAT_OCCUPYING_STATUSES,
  SEAT_RELEASING_STATUSES,
  DEPARTURE_COUNTED_STATUSES,
  LIVE_PASSENGER_STATUSES,
  seatOccupyingWhere,
  departureCountedWhere,
  livePassengerWhere,
};
