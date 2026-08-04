'use strict';

const prisma = require('../config/database');
const logger = require('../utils/logger');
const scheduledTasks = require('./scheduled-task.service');

/**
 * THE trip state machine. One authority, one write path.
 *
 * Before this file existed, `Trip.status` and `Booking.status` were free-form
 * strings written from ~30 places, and the rider's row and the driver's row
 * could disagree with each other with nothing in the system able to notice.
 * That is the mechanical reason the two apps felt disjointed.
 *
 * The contract now:
 *
 *   - `Trip.status` is the ONLY lifecycle authority. `Booking.status` is seat
 *     and money state and must never answer "where is my ride".
 *   - Nothing writes `Trip.status` except `applyTransition()`. Anything that
 *     does is a bug; the transition table is not advisory.
 *   - Every transition is legal-checked (from → to, and who is allowed to do
 *     it), applied under a version compare-and-swap, and recorded as an
 *     append-only `TripEvent` whose `seq` IS the new version.
 *   - Terminal statuses are absorbing. A late push cannot resurrect a
 *     cancelled trip, which is what used to produce ghost trips.
 *   - Timers armed by a transition are written in the same transaction
 *     (see scheduled-task.service.js), so they cannot outlive a rollback or
 *     die with the process.
 *
 * The monotonic `version` doubles as the arbiter the clients needed: a payload
 * carrying a version lower than what a client already has is stale and gets
 * dropped, which is what kills the poll-vs-socket race in the request screen.
 */

const S = Object.freeze({
  REQUESTED: 'REQUESTED',
  MATCHING: 'MATCHING',
  SCHEDULED: 'SCHEDULED',
  FILLING: 'FILLING',
  CONFIRMED: 'CONFIRMED',
  DRIVER_ASSIGNED: 'DRIVER_ASSIGNED',
  REASSIGNING: 'REASSIGNING',
  DRIVER_EN_ROUTE: 'DRIVER_EN_ROUTE',
  ARRIVED_AT_PICKUP: 'ARRIVED_AT_PICKUP',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  NO_DRIVERS_FOUND: 'NO_DRIVERS_FOUND',
  EXPIRED: 'EXPIRED',
  NO_SHOW: 'NO_SHOW',
});

const ACTOR = Object.freeze({ RIDER: 'RIDER', DRIVER: 'DRIVER', SYSTEM: 'SYSTEM', ADMIN: 'ADMIN' });

/** Absorbing. No outbound edges, ever. */
const TERMINAL_STATUSES = Object.freeze([
  S.COMPLETED,
  S.CANCELLED,
  S.NO_DRIVERS_FOUND,
  S.EXPIRED,
  S.NO_SHOW,
]);

/** A driver is attached and the ride is running. */
const ACTIVE_STATUSES = Object.freeze([
  S.DRIVER_ASSIGNED,
  S.DRIVER_EN_ROUTE,
  S.ARRIVED_AT_PICKUP,
  S.IN_PROGRESS,
]);

/** No driver yet — the states that never existed under the old model. */
const PRE_DRIVER_STATUSES = Object.freeze([S.REQUESTED, S.MATCHING, S.REASSIGNING]);

/** Group / bus product, before departure. */
const PRE_TRIP_STATUSES = Object.freeze([S.SCHEDULED, S.FILLING, S.CONFIRMED]);

/** Everything a rider or driver would call "my current ride". */
const LIVE_STATUSES = Object.freeze([
  ...PRE_DRIVER_STATUSES,
  ...PRE_TRIP_STATUSES,
  ...ACTIVE_STATUSES,
]);

const A_ANY = [ACTOR.RIDER, ACTOR.DRIVER, ACTOR.SYSTEM, ACTOR.ADMIN];
const A_SYS = [ACTOR.SYSTEM, ACTOR.ADMIN];
const A_RIDER_CANCEL = [ACTOR.RIDER, ACTOR.SYSTEM, ACTOR.ADMIN];

/**
 * from → { to: [actors permitted to make this move] }
 *
 * Anything not listed is rejected. This is the table the old code did not have:
 * previously any string could be written from anywhere, so "driver arrived"
 * could land on a trip that had already been cancelled.
 */
const TRANSITIONS = Object.freeze({
  // ── on-demand, pre-driver ───────────────────────────────────────────────
  [S.REQUESTED]: {
    [S.MATCHING]: A_SYS,
    [S.CANCELLED]: A_RIDER_CANCEL,
    [S.NO_DRIVERS_FOUND]: A_SYS,
    [S.EXPIRED]: A_SYS,
  },
  [S.MATCHING]: {
    [S.DRIVER_ASSIGNED]: [ACTOR.DRIVER, ACTOR.SYSTEM, ACTOR.ADMIN],
    [S.NO_DRIVERS_FOUND]: A_SYS,
    [S.CANCELLED]: A_RIDER_CANCEL,
    [S.EXPIRED]: A_SYS,
  },
  [S.REASSIGNING]: {
    [S.MATCHING]: A_SYS,
    [S.DRIVER_ASSIGNED]: [ACTOR.DRIVER, ACTOR.SYSTEM, ACTOR.ADMIN],
    [S.NO_DRIVERS_FOUND]: A_SYS,
    [S.CANCELLED]: A_RIDER_CANCEL,
    [S.EXPIRED]: A_SYS,
  },

  // ── group / bus product ─────────────────────────────────────────────────
  [S.SCHEDULED]: {
    [S.FILLING]: A_ANY,
    [S.CONFIRMED]: A_ANY,
    [S.MATCHING]: A_SYS,
    [S.DRIVER_EN_ROUTE]: [ACTOR.DRIVER, ACTOR.ADMIN],
    [S.CANCELLED]: A_ANY,
    [S.EXPIRED]: A_SYS,
  },
  [S.FILLING]: {
    [S.CONFIRMED]: A_ANY,
    // A seat released back to zero drops it out of FILLING again.
    [S.SCHEDULED]: A_SYS,
    [S.DRIVER_EN_ROUTE]: [ACTOR.DRIVER, ACTOR.ADMIN],
    [S.CANCELLED]: A_ANY,
    [S.EXPIRED]: A_SYS,
  },
  [S.CONFIRMED]: {
    [S.FILLING]: A_SYS,
    [S.DRIVER_EN_ROUTE]: [ACTOR.DRIVER, ACTOR.ADMIN],
    [S.REASSIGNING]: A_SYS,
    [S.CANCELLED]: A_ANY,
    [S.EXPIRED]: A_SYS,
  },

  // ── driver attached ─────────────────────────────────────────────────────
  [S.DRIVER_ASSIGNED]: {
    [S.DRIVER_EN_ROUTE]: [ACTOR.DRIVER, ACTOR.SYSTEM],
    // A driver dropping out sends THIS trip back to dispatch — same id, same
    // receipt, same share link. Under the old model the trip could not exist
    // without a driver, so this edge was unrepresentable.
    [S.REASSIGNING]: A_SYS,
    [S.CANCELLED]: A_ANY,
    [S.EXPIRED]: A_SYS,
  },
  [S.DRIVER_EN_ROUTE]: {
    [S.ARRIVED_AT_PICKUP]: [ACTOR.DRIVER, ACTOR.SYSTEM],
    // Doorstep pickups where the rider is already curbside skip ARRIVED.
    [S.IN_PROGRESS]: [ACTOR.DRIVER],
    [S.REASSIGNING]: A_SYS,
    [S.CANCELLED]: A_ANY,
    [S.EXPIRED]: A_SYS,
  },
  [S.ARRIVED_AT_PICKUP]: {
    [S.IN_PROGRESS]: [ACTOR.DRIVER],
    [S.NO_SHOW]: [ACTOR.DRIVER, ACTOR.SYSTEM, ACTOR.ADMIN],
    [S.REASSIGNING]: A_SYS,
    [S.CANCELLED]: A_ANY,
    [S.EXPIRED]: A_SYS,
  },
  [S.IN_PROGRESS]: {
    [S.COMPLETED]: [ACTOR.DRIVER, ACTOR.SYSTEM, ACTOR.ADMIN],
    // A rider cannot "cancel" a ride they are sitting in. Support can.
    [S.CANCELLED]: A_SYS,
    [S.EXPIRED]: A_SYS,
  },

  // ── terminal: no outbound edges ─────────────────────────────────────────
  [S.COMPLETED]: {},
  [S.CANCELLED]: {},
  [S.NO_DRIVERS_FOUND]: {},
  [S.EXPIRED]: {},
  [S.NO_SHOW]: {},
});

class TransitionError extends Error {
  constructor(message, code, status = 409) {
    super(message);
    this.name = 'TransitionError';
    this.code = code;
    this.statusCode = status;
  }
}

const isTerminal = (status) => TERMINAL_STATUSES.includes(status);
const isLive = (status) => LIVE_STATUSES.includes(status);
const hasDriver = (status) => ACTIVE_STATUSES.includes(status);

/**
 * Pure legality check. Throws TransitionError; never touches the database.
 * Exported so callers can pre-validate (e.g. to 400 early) without a write.
 */
function assertTransition(from, to, actor) {
  if (from === to) {
    throw new TransitionError(`Trip is already ${to}`, 'TRIP_ALREADY_IN_STATE', 409);
  }
  if (isTerminal(from)) {
    throw new TransitionError(
      `Trip is ${from}, which is final; cannot move to ${to}`,
      'TRIP_TERMINAL',
      409,
    );
  }
  const allowedActors = TRANSITIONS[from]?.[to];
  if (!allowedActors) {
    throw new TransitionError(`Illegal transition ${from} → ${to}`, 'ILLEGAL_TRANSITION', 409);
  }
  if (!allowedActors.includes(actor)) {
    throw new TransitionError(
      `${actor} may not move a trip from ${from} to ${to}`,
      'ACTOR_NOT_PERMITTED',
      403,
    );
  }
  return true;
}

/** Timestamp columns each status stamps on arrival. Derived, never hand-set. */
function timestampsFor(to, now) {
  switch (to) {
    case S.REQUESTED:
      return { requestedAt: now };
    case S.DRIVER_ASSIGNED:
      return { assignedAt: now };
    case S.IN_PROGRESS:
      return { departedAt: now };
    case S.ARRIVED_AT_PICKUP:
      return { arrivedAt: now };
    case S.COMPLETED:
      return { completedAt: now };
    case S.CANCELLED:
    case S.EXPIRED:
    case S.NO_DRIVERS_FOUND:
    case S.NO_SHOW:
      return { cancelledAt: now };
    default:
      return {};
  }
}

/**
 * Move a trip. The only legal way to change `Trip.status`.
 *
 * @param {string} tripId
 * @param {string} to                       target TripStatus
 * @param {object} opts
 * @param {string} opts.actor               RIDER | DRIVER | SYSTEM | ADMIN
 * @param {string} [opts.actorId]           driver/user id behind the action
 * @param {object} [opts.payload]           recorded verbatim on the TripEvent
 * @param {object} [opts.data]              extra Trip columns to set atomically
 *                                          (driverId, vehicleId, dropoff…)
 * @param {number} [opts.expectedVersion]   optimistic-concurrency guard; when
 *                                          supplied the write fails if another
 *                                          writer moved first
 * @param {Array}  [opts.tasks]             timers to arm in the SAME transaction
 * @param {(tx, trip) => Promise<void>} [opts.sideEffects]
 *                                          extra in-transaction work (seat
 *                                          release, wallet, bookings)
 * @param {boolean} [opts.publish=true]     emit to the realtime channel post-commit
 * @returns {Promise<{trip: object, event: object}>}
 */
async function applyTransition(tripId, to, opts = {}) {
  const result = await prisma.$transaction((tx) => applyTransitionTx(tx, tripId, to, opts));

  // Post-commit. Never inside the transaction: an emit for a transaction that
  // then rolls back is a lie the clients cannot un-hear.
  if (opts.publish !== false) publishCommitted(result);

  logger.info(
    `Trip ${tripId} ${result.from} → ${to} by ${opts.actor ?? ACTOR.SYSTEM} v${result.trip.version}`,
  );
  return result;
}

/**
 * The same transition, inside a transaction the CALLER owns.
 *
 * Several existing flows already wrap several writes in one `$transaction` —
 * completing a trip settles the driver's wallet, cancelling releases seats and
 * issues refunds. Those writes must stay atomic with the status change, and
 * Prisma has no nested transactions, so they cannot call `applyTransition`.
 * Before this existed the only way out was to write `Trip.status` directly,
 * which is exactly the hole the state machine is supposed to close.
 *
 * The caller MUST call `publishCommitted(result)` after its transaction
 * commits — the realtime fan-out is deliberately not done here, because at
 * this point the transaction can still roll back.
 */
async function applyTransitionTx(tx, tripId, to, opts = {}) {
  const {
    actor = ACTOR.SYSTEM,
    actorId = null,
    payload = {},
    data = {},
    expectedVersion = null,
    tasks = [],
    sideEffects = null,
  } = opts;

  if (!Object.values(ACTOR).includes(actor)) {
    throw new TransitionError(`Unknown actor ${actor}`, 'UNKNOWN_ACTOR', 400);
  }

  {
    const current = await tx.trip.findUnique({
      where: { id: tripId },
      select: { id: true, status: true, version: true, driverId: true, requesterId: true },
    });
    if (!current) {
      throw new TransitionError(`Trip ${tripId} not found`, 'TRIP_NOT_FOUND', 404);
    }
    if (expectedVersion !== null && current.version !== expectedVersion) {
      throw new TransitionError(
        `Trip ${tripId} moved on (have v${expectedVersion}, is v${current.version})`,
        'VERSION_CONFLICT',
        409,
      );
    }

    assertTransition(current.status, to, actor);

    const now = new Date();
    const nextVersion = current.version + 1;

    // Compare-and-swap. Conditioning on BOTH the status we validated and the
    // version we read is what makes two concurrent callers resolve to exactly
    // one winner — the loser's count is 0 and it raises rather than silently
    // overwriting, which is how the old read-then-write lost updates.
    const swap = await tx.trip.updateMany({
      where: { id: tripId, status: current.status, version: current.version },
      data: {
        ...data,
        ...timestampsFor(to, now),
        status: to,
        version: nextVersion,
      },
    });
    if (swap.count === 0) {
      throw new TransitionError(
        `Trip ${tripId} was modified concurrently`,
        'VERSION_CONFLICT',
        409,
      );
    }

    // Append-only. seq === the version this transition produced, so the log is
    // gap-free and strictly increasing and the realtime channel can replay
    // "everything above lastSeq" with no ambiguity.
    const event = await tx.tripEvent.create({
      data: {
        tripId,
        seq: nextVersion,
        type: to,
        actor,
        actorId,
        payload: { from: current.status, to, ...payload },
      },
    });

    for (const task of tasks) {
      await scheduledTasks.enqueueTx(tx, { tripId, ...task });
    }

    // Reaching a terminal state disarms everything still pending for this
    // trip. Without it an offer timeout could fire against a cancelled ride.
    if (isTerminal(to)) {
      await scheduledTasks.cancelAllForTripTx(tx, tripId);
    }

    if (sideEffects) await sideEffects(tx, { id: tripId, status: to, version: nextVersion });

    const trip = await tx.trip.findUnique({ where: { id: tripId } });
    return { trip, event, from: current.status };
  }
}

/**
 * Fan a COMMITTED transition out to both apps. Idempotent and never throws:
 * the database is the source of truth and a client that misses this will
 * replay it from `seq` on its next reconnect.
 */
function publishCommitted(result) {
  if (!result?.trip || !result?.event) return;
  // A transition may have armed timers inside its transaction. Now that it has
  // committed, wake the scheduler so a 20-second offer deadline is honoured to
  // the second instead of waiting out whatever sleep the loop is in.
  try {
    scheduledTasks.wake();
  } catch {
    /* scheduler not started (tests, scripts) — nothing to wake */
  }
  try {
    // Lazy require breaks the cycle (the publisher reads trip view helpers).
    require('./trip-events.publisher').publish(result.trip, result.event);
  } catch (err) {
    logger.warn(
      `trip:event publish failed for ${result.trip.id} (state IS committed): ${err.message}`,
    );
  }

  /**
   * Sockets reach an app that is open. This reaches one that is not — the FCM
   * push, the lock-screen Live Activity, the GraphQL subscription.
   *
   * Deliberately here rather than in the callers. Those notifications used to
   * live in the legacy driver socket handlers and in ad-hoc `setImmediate`
   * blocks inside individual service functions, so what a rider was told
   * depended on which code path the driver's tap travelled down — and the
   * rewired REST endpoints travelled down none of them. Now every transition
   * from every path notifies identically, and it is deduped on the trip
   * version so the overlap between the two paths cannot buzz a phone twice.
   */
  try {
    require('./trip-notify.service').notifyTransition(result.trip, result.event);
  } catch (err) {
    logger.warn(
      `trip notify failed for ${result.trip.id} (state IS committed): ${err.message}`,
    );
  }
}

/**
 * Record something that happened to a trip WITHOUT changing its status —
 * driver location snapshots at milestones, fare quote issued, rider messaged.
 *
 * Still bumps `version` so it takes a seq and the client's server-wins
 * comparison stays total: every fact a client can observe is ordered.
 */
async function recordEvent(tripId, type, opts = {}) {
  const { actor = ACTOR.SYSTEM, actorId = null, payload = {}, publish = true } = opts;

  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.trip.findUnique({
      where: { id: tripId },
      select: { status: true, version: true },
    });
    if (!current) throw new TransitionError(`Trip ${tripId} not found`, 'TRIP_NOT_FOUND', 404);

    const nextVersion = current.version + 1;
    const swap = await tx.trip.updateMany({
      where: { id: tripId, version: current.version },
      data: { version: nextVersion },
    });
    if (swap.count === 0) {
      throw new TransitionError(`Trip ${tripId} was modified concurrently`, 'VERSION_CONFLICT', 409);
    }

    const event = await tx.tripEvent.create({
      data: { tripId, seq: nextVersion, type, actor, actorId, payload },
    });
    const trip = await tx.trip.findUnique({ where: { id: tripId } });
    return { trip, event };
  });

  if (publish) {
    try {
      require('./trip-events.publisher').publish(result.trip, result.event);
    } catch (err) {
      logger.warn(`trip:event publish failed for ${tripId}: ${err.message}`);
    }
  }
  return result;
}

/** Events strictly after `sinceSeq`, oldest first — the replay query. */
async function eventsSince(tripId, sinceSeq = 0, limit = 200) {
  return prisma.tripEvent.findMany({
    where: { tripId, seq: { gt: sinceSeq } },
    orderBy: { seq: 'asc' },
    take: limit,
  });
}

module.exports = {
  TRIP_STATUS: S,
  ACTOR,
  TRANSITIONS,
  TERMINAL_STATUSES,
  ACTIVE_STATUSES,
  PRE_DRIVER_STATUSES,
  PRE_TRIP_STATUSES,
  LIVE_STATUSES,
  TransitionError,
  assertTransition,
  applyTransition,
  applyTransitionTx,
  publishCommitted,
  recordEvent,
  eventsSince,
  isTerminal,
  isLive,
  hasDriver,
};
