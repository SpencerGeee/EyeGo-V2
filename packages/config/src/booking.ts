/**
 * Booking limits shared by both apps.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────
 * "scheduling is only capped at 4 seats. the only way to go past it is to pick
 * 8 seats on the where to page then tap schedule. i dont need my users finding
 * hacks (everything should be simple)."
 *
 * That was not a hack the rider invented. It was four independent answers to
 * one question, and the rider simply walked through the gap between them:
 *
 *   SearchStage stepper ....... Math.min(8, …)
 *   SelectStage stepper ....... Math.min(8, …)
 *   schedule.tsx stepper ...... Math.min(4, …)
 *   POST /trips/request ....... isInt({ min: 1, max: 6 })
 *   POST /trips/schedule ...... isInt({ min: 1, max: 4 })
 *
 * The schedule screen seeds its seat count from `requestSeatCount` — whatever
 * Where To last set — so picking 8 there sailed past a stepper that could only
 * ever have produced 4, and then died on a validator that allowed 4. Hence
 * "confirm schedule → scheduling failed (validation failed)": the two bugs the
 * rider reported as 17 and 18 are the same missing constant, seen from the two
 * ends of one request.
 *
 * A limit enforced in five places is not a limit; it is five opinions. This is
 * the one. The server validators mirror it (see eyego-api/src/config/booking.js
 * — deliberately duplicated rather than imported, because the API does not
 * build against the TS workspace, and both files name each other so a change to
 * either is a change to both).
 */

/**
 * Most seats one rider may take in a single booking, on any surface: on-demand,
 * scheduled, or reserved.
 *
 * Bounded by the group vehicles in service rather than by anything technical —
 * a rider booking more than this is booking the bus, which is a different
 * product with a different price. Raising it means raising it in
 * eyego-api/src/config/booking.js too.
 */
export const MAX_SEATS_PER_BOOKING = 8;

/** Fewest seats a booking can have. Present so no screen re-decides it. */
export const MIN_SEATS_PER_BOOKING = 1;

/** Clamp any seat count to the bookable range. */
export function clampSeats(n: number): number {
  if (!Number.isFinite(n)) return MIN_SEATS_PER_BOOKING;
  return Math.min(MAX_SEATS_PER_BOOKING, Math.max(MIN_SEATS_PER_BOOKING, Math.round(n)));
}
