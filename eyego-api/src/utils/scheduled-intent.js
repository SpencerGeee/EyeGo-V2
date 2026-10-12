'use strict';

const { TERMINAL_STATUSES, ACTIVE_STATUSES } = require('../services/trip-state.service');

/**
 * WHAT A SCHEDULED RIDE IS NOW — read off the ride it became, not its own row.
 *
 * BUGFIX ("my Friday 11:15 ride still shows as upcoming"). An intent's own
 * status stops moving at DISPATCHED (handed to live dispatch) or MATCHED
 * (seated on a bus). Nothing wrote it again when that ride completed, found no
 * driver, or was cancelled, so every screen that filters on
 * PENDING/DISPATCHED/MATCHED kept it "upcoming" for ever. A PENDING intent the
 * sweeper never reached (API down at the time) stayed upcoming the same way.
 *
 * @param intent  { status, scheduledAt }
 * @param ride    { tripStatus, riderOn } for its matched trip, or null —
 *                riderOn = the rider still holds a seat on it.
 */
const LIVE_INTENT_STATUSES = ['PENDING', 'DISPATCHED', 'MATCHED'];
const NO_RIDE_GRACE_MS = 60 * 60 * 1000; // same hour the sweeper allows before giving up

function settledIntentStatus(intent, ride, now = Date.now()) {
  if (!LIVE_INTENT_STATUSES.includes(intent.status)) return intent.status;
  if (ride) {
    if (ride.tripStatus === 'COMPLETED') return ride.riderOn ? 'COMPLETED' : 'CANCELLED';
    if (TERMINAL_STATUSES.includes(ride.tripStatus)) return ride.tripStatus === 'CANCELLED' ? 'CANCELLED' : 'EXPIRED';
    if (!ride.riderOn) return 'CANCELLED'; // gave up their own seat; the bus went on
    // A driver took the dispatched request — it is confirmed, not "looking".
    if (ACTIVE_STATUSES.includes(ride.tripStatus)) return 'MATCHED';
    return intent.status;
  }
  return now - new Date(intent.scheduledAt).getTime() > NO_RIDE_GRACE_MS ? 'EXPIRED' : intent.status;
}

module.exports = { settledIntentStatus, LIVE_INTENT_STATUSES };
