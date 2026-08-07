'use strict';

/**
 * Server-side mirror of packages/config/src/booking.ts.
 *
 * Kept as a duplicate on purpose: the API is plain CommonJS and does not build
 * against the TypeScript workspace, so it cannot import the shared token. Both
 * files name each other so that changing one without the other is an obvious
 * omission rather than a silent drift — which is exactly how the seat cap ended
 * up being 4, 6 and 8 simultaneously and let a rider schedule 8 seats through a
 * screen whose own stepper stopped at 4.
 */

/** Most seats one rider may take in a single booking. Mirror of MAX_SEATS_PER_BOOKING. */
const MAX_SEATS_PER_BOOKING = 8;

/** Fewest seats a booking can have. */
const MIN_SEATS_PER_BOOKING = 1;

module.exports = { MAX_SEATS_PER_BOOKING, MIN_SEATS_PER_BOOKING };
