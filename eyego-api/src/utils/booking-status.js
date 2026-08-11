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

module.exports = {
  SEAT_OCCUPYING_STATUSES,
  SEAT_RELEASING_STATUSES,
  seatOccupyingWhere,
};
