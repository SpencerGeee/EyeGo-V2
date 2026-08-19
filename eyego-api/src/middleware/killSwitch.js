'use strict';

const settings = require('../config/settings');
const { AppError } = require('../utils/errors');

/**
 * The two platform-wide kill switches, enforced.
 *
 * `RIDER_BOOKING_ENABLED` and `DRIVER_ONLINE_ENABLED` have been in the settings
 * registry — and on the admin console's Apps page, with help text promising
 * "stops new bookings platform-wide" and "no driver can go online" — since the
 * registry was written. Nothing read them. An operator flipping either one
 * during an incident changed exactly nothing: the console said the platform was
 * closed and the platform kept dispatching.
 *
 * They are enforced HERE, in front of the routes, rather than inside each
 * service, for two reasons: a reader can see at the route table which calls a
 * maintenance window closes, and a new booking path added later has to make a
 * deliberate decision about the switch rather than inherit an omission.
 *
 * What they deliberately do NOT touch: anything that finishes work already in
 * flight. A rider mid-trip must still be able to pay, rate, cancel and call for
 * help, and a driver on a live trip must still be able to complete it, or
 * closing the platform would strand everyone currently on it.
 */

/** 503 rather than 403: this is "temporarily closed", not "you may not". */
function closed(message, code) {
  return new AppError(message, 503, code);
}

/** Blocks the creation of new rider demand. */
function requireBookingEnabled(req, res, next) {
  if (settings.get('RIDER_BOOKING_ENABLED') === false) {
    return next(
      closed(
        'EyeGo is not taking new bookings right now. Please try again shortly.',
        'BOOKING_DISABLED',
      ),
    );
  }
  next();
}

/** Blocks a driver joining the dispatch pool. */
function requireDriverOnlineEnabled(req, res, next) {
  if (settings.get('DRIVER_ONLINE_ENABLED') === false) {
    return next(
      closed(
        'Going online is temporarily unavailable while EyeGo is under maintenance.',
        'DRIVER_ONLINE_DISABLED',
      ),
    );
  }
  next();
}

module.exports = { requireBookingEnabled, requireDriverOnlineEnabled };
