'use strict';

/**
 * Sequential dispatch cascade — one driver at a time, Uber/Bolt style.
 *
 * THE ALGORITHM (unchanged, it was already right)
 * ----------------------------------------------
 * Hold an ordered candidate list. Offer the ride to exactly ONE driver for
 * `OFFER_TTL_SECONDS`. Decline or timeout advances to the next. Widen the
 * radius once before giving up. When the list is exhausted, say so explicitly
 * — silence is the worst possible failure mode for a rider watching a spinner.
 *
 * Broadcasting to five drivers at once, which this replaced, has three
 * problems the rider feels directly: there is no "the driver who was offered
 * this ride" to draw a pin or an ETA for; four of five drivers get an offer
 * guaranteed to be revoked, which trains them to ignore the dispatch screen;
 * and total failure is indistinguishable from silence.
 *
 * WHAT CHANGED: THE SUBSTRATE
 * ---------------------------
 * The old implementation kept every cascade in `const cascades = new Map()`
 * with `setTimeout` timers. Its own header admitted the consequence: state was
 * per-process. That meant
 *
 *   - every deploy, crash or restart stranded every in-flight search, with no
 *     server-side actor left alive to advance or fail it, and
 *   - a second API instance was impossible, because both would run their own
 *     cascade for the same ride.
 *
 * Now: cascade state is a Redis key, timers are `ScheduledTask` rows written
 * inside the state transaction, and each advance is taken under a short
 * per-trip Redis lock so exactly one instance moves a given cascade at a time.
 * A restart mid-search resumes on the next tick instead of losing the rider.
 *
 * AND ONE REAL BUG
 * ----------------
 * `acceptOffer()` used to stop the timer AND emit `dispatch:matched` in the
 * same call, and it was called BEFORE the claim transaction. A driver whose
 * accept was about to lose a 409 still told the rider "matched with driver X"
 * and killed the cascade. Those are now two calls: `stopOfferTimer()` before
 * the transaction (which is what genuinely must happen early, so the next
 * offer cannot fire mid-claim) and `announceWinner()` after it commits.
 */

const prisma = require('../config/database');
const redis = require('../config/redis');
const logger = require('../utils/logger');
const { isDriverAvailable } = require('./driver-availability');
const { sendMulticastPush } = require('./push.service');
const scheduledTasks = require('./scheduled-task.service');
const matcher = require('./matcher.service');
const destinationMode = require('./destination-mode.service');
const publisher = require('./trip-events.publisher');
const tripState = require('./trip-state.service');
const { TRIP_STATUS, ACTOR } = tripState;

/** How long a single driver holds an exclusive offer before it moves on. */
const OFFER_TTL_SECONDS = parseInt(process.env.DISPATCH_OFFER_TTL_SECONDS, 10) || 20;
/** Nearest-first search radius, and the wider sweep used if nobody is close. */
const DISPATCH_RADIUS_KM = parseFloat(process.env.DISPATCH_RADIUS_KM) || 5;
const DISPATCH_EXTENDED_RADIUS_KM = parseFloat(process.env.DISPATCH_EXTENDED_RADIUS_KM) || 12;

/**
 * How long the search stays alive with nobody to offer it to.
 *
 * Mirrors RIDE_REQUEST_EXPIRY_SECONDS in modules/rides — that task is what
 * actually fails the trip, and a search that gave up first would strand the
 * rider on a spinner until it fired.
 */
const SEARCH_TIMEOUT_SECONDS =
  parseInt(process.env.DISPATCH_SEARCH_TIMEOUT_SECONDS, 10) ||
  parseInt(process.env.RIDE_REQUEST_EXPIRY_SECONDS, 10) ||
  300;
/** Gap between re-scans while waiting for supply to appear. */
const RESWEEP_INTERVAL_SECONDS =
  parseInt(process.env.DISPATCH_RESWEEP_SECONDS, 10) || 10;

const TASK_OFFER_TIMEOUT = 'DISPATCH_OFFER_TIMEOUT';
const TASK_RESWEEP = 'DISPATCH_RESWEEP';
/** Cascade state outlives any single offer but must not leak forever. */
const STATE_TTL_SECONDS = 30 * 60;

const stateKey = (tripId) => `dispatch:cascade:${tripId}`;
const lockKey = (tripId) => `dispatch:lock:${tripId}`;

// ── state ────────────────────────────────────────────────────────────────────

async function readState(tripId) {
  try {
    const raw = await redis.get(stateKey(tripId));
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    logger.warn(`cascade readState ${tripId}: ${err.message}`);
    return null;
  }
}

async function writeState(state) {
  await redis.set(stateKey(state.tripId), JSON.stringify(state), 'EX', STATE_TTL_SECONDS);
}

async function clearState(tripId) {
  await redis.del(stateKey(tripId)).catch(() => {});
}

/**
 * Advance-the-cascade mutual exclusion.
 *
 * Two things can try to move the same cascade at the same instant: the timeout
 * worker and a driver's decline. Without this they can each offer the ride to a
 * different driver — the exact double-offer the sequential design exists to
 * prevent. Short TTL so a crashed holder cannot wedge a rider's search.
 */
async function withLock(tripId, fn) {
  const token = `${process.pid}-${Date.now()}-${Math.random()}`;
  const acquired = await redis.set(lockKey(tripId), token, 'PX', 5000, 'NX');
  if (!acquired) return null;
  try {
    return await fn();
  } finally {
    // Only release if still ours — a lock that expired and was retaken by
    // another worker must not be deleted out from under them.
    const held = await redis.get(lockKey(tripId)).catch(() => null);
    if (held === token) await redis.del(lockKey(tripId)).catch(() => {});
  }
}

// ── offering ─────────────────────────────────────────────────────────────────

async function pushToDriver(driver, trip, expiresAtMs) {
  if (!driver.fcmToken) return;
  try {
    await sendMulticastPush([driver.fcmToken], 'New trip nearby', 'A rider needs a trip', {
      type: 'TRIP_OFFER',
      tripId: trip.id,
      expiresAt: new Date(expiresAtMs).toISOString(),
    });
  } catch (err) {
    logger.warn(`Dispatch push failed for driver ${driver.id}: ${err.message}`);
  }
}

/** Rider-facing dispatch progress. Rides the same envelope as everything else. */
async function emitProgress(tripId, type, payload) {
  try {
    await tripState.recordEvent(tripId, type, { actor: ACTOR.SYSTEM, payload });
  } catch (err) {
    // Progress is informational; never let it break the cascade.
    logger.warn(`emitProgress ${type} for ${tripId}: ${err.message}`);
  }
}

/**
 * Offer the trip to the candidate at `state.index`, or finish the cascade.
 *
 * Availability is re-checked immediately before each offer rather than trusted
 * from when the list was built — a driver near the front of the queue can
 * easily accept something else while we are still walking earlier candidates.
 */
async function offerNext(tripId) {
  return withLock(tripId, async () => {
    const state = await readState(tripId);
    if (!state || state.done) return;

    // Everything the driver's offer card renders is selected here, once. The
    // card used to get lat/lng and a tier and nothing else, so it could not
    // say where the ride was going or what it paid — the two facts a driver
    // actually decides on.
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      select: {
        id: true, status: true, tier: true, version: true,
        pickupLat: true, pickupLng: true, pickupAddress: true,
        dropoffLat: true, dropoffLng: true, dropoffAddress: true,
        commissionRate: true,
        bookings: {
          where: { status: { notIn: ['CANCELLED', 'REFUNDED', 'EXPIRED'] } },
          select: { fareAmountPesewas: true, commissionAmountPesewas: true },
        },
      },
    });
    // The trip may have been accepted, cancelled or expired out from under us.
    if (!trip || ![TRIP_STATUS.MATCHING, TRIP_STATUS.REASSIGNING].includes(trip.status)) {
      await finish(tripId, 'resolved');
      return;
    }

    while (state.index < state.candidates.length) {
      const candidate = state.candidates[state.index];
      state.index += 1;

      if (state.declined.includes(candidate.id)) continue;

      const free = await isDriverAvailable(prisma, candidate.id).catch(() => false);
      if (!free) {
        logger.info('Dispatch skipped busy candidate', { tripId, driverId: candidate.id });
        continue;
      }

      const expiresAtMs = Date.now() + OFFER_TTL_SECONDS * 1000;
      state.currentDriverId = candidate.id;
      state.expiresAtMs = expiresAtMs;
      await writeState(state);

      // The timer is a ROW, not a setTimeout. It survives this process dying.
      await scheduledTasks.enqueue({
        type: TASK_OFFER_TIMEOUT,
        dedupeKey: tripId,
        tripId,
        runAt: new Date(expiresAtMs),
        payload: { tripId, driverId: candidate.id, attempt: state.index },
      });

      // What the driver nets if they take it: gross fare on the trip minus the
      // platform's cut. Computed from the bookings that already exist rather
      // than re-quoting, so the number cannot disagree with what gets paid out.
      const grossPesewas = trip.bookings.reduce((n, b) => n + (b.fareAmountPesewas || 0), 0);
      const commissionPesewas = trip.bookings.reduce(
        (n, b) => n + (b.commissionAmountPesewas ?? Math.round((b.fareAmountPesewas || 0) * (trip.commissionRate ?? 0.15))),
        0,
      );

      publisher.publishOfferToDriver(candidate.id, {
        tripId,
        kind: state.kind,
        pickupLat: trip.pickupLat,
        pickupLng: trip.pickupLng,
        pickupAddress: trip.pickupAddress,
        dropoffLat: trip.dropoffLat,
        dropoffLng: trip.dropoffLng,
        dropoffAddress: trip.dropoffAddress,
        farePesewas: grossPesewas,
        driverEarningsPesewas: Math.max(0, grossPesewas - commissionPesewas),
        tier: trip.tier,
        // Server-authoritative countdown. The driver app renders
        // (expiresAtServerMs - serverNowMs), never its own clock, so a phone
        // with a skewed clock cannot show a different number of seconds.
        expiresAtServerMs: expiresAtMs,
        serverNowMs: Date.now(),
        expiresInSeconds: OFFER_TTL_SECONDS,
        etaSeconds: candidate.etaSeconds,
        attempt: state.index,
        totalCandidates: state.candidates.length,
      });
      pushToDriver(candidate, trip, expiresAtMs).catch(() => {});

      await emitProgress(tripId, 'DISPATCH_PROGRESS', {
        phase: 'OFFERED',
        driverId: candidate.id,
        driverLat: candidate.currentLat ?? null,
        driverLng: candidate.currentLng ?? null,
        etaSeconds: candidate.etaSeconds,
        etaDegraded: candidate.etaDegraded,
        attempt: state.index,
        totalCandidates: state.candidates.length,
        expiresAtServerMs: expiresAtMs,
      });

      logger.info('Dispatch offer sent', {
        tripId,
        driverId: candidate.id,
        attempt: state.index,
        of: state.candidates.length,
        etaSeconds: candidate.etaSeconds,
      });
      return;
    }

    // Everyone in range has passed. Widen once before giving up — the rider is
    // better served by a driver 10 km away than by a failure screen.
    if (!state.widened) {
      state.widened = true;
      const wider = await matcher.rankCandidates({
        tripId,
        pickupLat: trip.pickupLat,
        pickupLng: trip.pickupLng,
        radiusKm: DISPATCH_EXTENDED_RADIUS_KM,
        excludeDriverId: state.excludeDriverId,
        tier: trip.tier,
        // Destination mode reads the trip's dropoff to decide whether a
        // homeward-bound driver is being sent the right way.
        trip,
      });
      const seen = new Set(state.candidates.map((c) => c.id));
      const extra = wider.filter((c) => !seen.has(c.id));
      if (extra.length > 0) {
        logger.info('Dispatch widening radius', { tripId, extra: extra.length });
        state.candidates = state.candidates.concat(extra);
        await writeState(state);
        await emitProgress(tripId, 'DISPATCH_PROGRESS', {
          phase: 'WIDENING',
          totalCandidates: state.candidates.length,
        });
        // Released and re-taken rather than recursed under the held lock.
        setImmediate(() => offerNext(tripId).catch((e) => logger.warn(e.message)));
        return;
      }
      await writeState(state);
    }

    // NOBODY TO OFFER IT TO — WHICH IS NOT THE SAME AS FAILING.
    //
    // This used to go straight to NO_DRIVERS_FOUND, which made the cascade a
    // ONE-SHOT: the candidate list was built once, at the instant of the
    // request, and if it came back empty the rider was told "no drivers" a
    // fraction of a second later. Reported as "I requested a trip, then put
    // the driver online, and the dispatch never showed up" — correct, because
    // by the time the driver came online there was no search left running to
    // notice them. Supply arriving one second after the request was
    // indistinguishable from supply never arriving at all.
    //
    // So the search now has a DURATION. Until the deadline it keeps re-scanning
    // for drivers who have come online, come free, or driven into range.
    const elapsedMs = Date.now() - (state.startedAtMs ?? Date.now());
    if (elapsedMs < SEARCH_TIMEOUT_SECONDS * 1000) {
      await scheduleResweep(tripId, state);
      return;
    }

    logger.info('Dispatch exhausted', { tripId, tried: state.candidates.length });
    await finish(tripId, 'exhausted');
    // Terminal, and said out loud. The old code's silent give-up is what left
    // riders on an infinite spinner.
    await tripState
      .applyTransition(tripId, TRIP_STATUS.NO_DRIVERS_FOUND, {
        actor: ACTOR.SYSTEM,
        payload: { tried: state.candidates.length, widened: state.widened },
      })
      .catch((err) => logger.warn(`NO_DRIVERS_FOUND transition failed for ${tripId}: ${err.message}`));
  });
}

/**
 * Park the search and arm a re-scan. Caller must hold the cascade lock.
 *
 * Only announces WAITING once per cascade: the rider's screen should say "still
 * looking" and then stay put, not restart its copy every ten seconds.
 */
async function scheduleResweep(tripId, state) {
  const announced = state.waiting === true;
  state.waiting = true;
  await writeState(state);

  await scheduledTasks.enqueue({
    type: TASK_RESWEEP,
    dedupeKey: tripId,
    tripId,
    runAt: new Date(Date.now() + RESWEEP_INTERVAL_SECONDS * 1000),
    payload: { tripId },
  });

  if (!announced) {
    logger.info('Dispatch waiting for supply', { tripId, tried: state.candidates.length });
    await emitProgress(tripId, 'DISPATCH_PROGRESS', {
      phase: 'WAITING_FOR_SUPPLY',
      totalCandidates: state.candidates.length,
      searchTimeoutSeconds: SEARCH_TIMEOUT_SECONDS,
    });
  }
}

/**
 * Re-scan for drivers who were not available when the list was built.
 *
 * Runs at the WIDE radius: a rider who has already been waiting would rather
 * have a driver twelve kilometres out than keep waiting for a nearer one that
 * may never come online.
 */
async function resweep(tripId) {
  return withLock(tripId, async () => {
    const state = await readState(tripId);
    if (!state || state.done) return;

    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      select: { id: true, status: true, pickupLat: true, pickupLng: true, tier: true },
    });
    if (!trip || ![TRIP_STATUS.MATCHING, TRIP_STATUS.REASSIGNING].includes(trip.status)) {
      await finish(tripId, 'resolved');
      return;
    }

    const fresh = await matcher
      .rankCandidates({
        tripId,
        pickupLat: trip.pickupLat,
        pickupLng: trip.pickupLng,
        radiusKm: DISPATCH_EXTENDED_RADIUS_KM,
        excludeDriverId: state.excludeDriverId,
        tier: trip.tier,
        // Destination mode reads the trip's dropoff to decide whether a
        // homeward-bound driver is being sent the right way.
        trip,
      })
      .catch((err) => {
        logger.warn(`Dispatch resweep ranking failed for ${tripId}: ${err.message}`);
        return [];
      });

    // A driver who timed out earlier is deliberately eligible again — a missed
    // offer is usually a phone in a pocket, not a refusal. An explicit decline
    // (`state.declined`) is still respected, and offerNext re-checks it anyway.
    const seen = new Set(state.candidates.map((c) => c.id));
    const extra = fresh
      .filter((c) => !seen.has(c.id) && !state.declined.includes(c.id))
      .map((c) => ({
        id: c.id,
        fcmToken: c.fcmToken,
        currentLat: c.currentLat,
        currentLng: c.currentLng,
        etaSeconds: c.etaSeconds,
        etaDegraded: c.etaDegraded,
        vehicleId: c.vehicleId,
      }));

    if (extra.length === 0) {
      const elapsedMs = Date.now() - (state.startedAtMs ?? Date.now());
      if (elapsedMs < SEARCH_TIMEOUT_SECONDS * 1000) {
        await scheduleResweep(tripId, state);
        return;
      }
      logger.info('Dispatch exhausted after waiting', { tripId, tried: state.candidates.length });
      await finish(tripId, 'exhausted');
      await tripState
        .applyTransition(tripId, TRIP_STATUS.NO_DRIVERS_FOUND, {
          actor: ACTOR.SYSTEM,
          payload: { tried: state.candidates.length, waited: true },
        })
        .catch((err) => logger.warn(`NO_DRIVERS_FOUND transition failed for ${tripId}: ${err.message}`));
      return;
    }

    logger.info('Dispatch found new supply', { tripId, found: extra.length });
    state.candidates = state.candidates.concat(extra);
    state.waiting = false;
    await writeState(state);
    // Released and re-taken rather than recursed under the held lock.
    setImmediate(() => offerNext(tripId).catch((e) => logger.warn(e.message)));
  });
}

/**
 * A driver just became dispatchable (went online, or finished a trip).
 *
 * Without this the rider still gets their driver — the resweep timer would find
 * them within RESWEEP_INTERVAL_SECONDS — but a ten-second delay on the one
 * event we know about is a poor trade for one indexed query.
 */
async function notifySupplyAvailable(driverId) {
  if (!driverId) return;
  try {
    const searching = await prisma.trip.findMany({
      where: { status: { in: [TRIP_STATUS.MATCHING, TRIP_STATUS.REASSIGNING] } },
      select: { id: true },
      take: 25,
    });
    for (const trip of searching) {
      const state = await readState(trip.id);
      // Only nudge searches that are actually parked. One mid-offer is already
      // being worked and must not be jogged into a second parallel offer.
      if (!state || state.done || !state.waiting) continue;
      if (state.excludeDriverId === driverId) continue;
      await scheduledTasks.cancel(TASK_RESWEEP, trip.id).catch(() => {});
      await resweep(trip.id);
    }
  } catch (err) {
    logger.warn(`notifySupplyAvailable(${driverId}) failed: ${err.message}`);
  }
}

async function finish(tripId, reason) {
  const state = await readState(tripId);
  if (state) {
    state.done = true;
    await writeState(state);
  }
  await scheduledTasks.cancel(TASK_OFFER_TIMEOUT, tripId).catch(() => {});
  // The waiting-for-supply timer is a second armed clock. Leaving it behind
  // would wake a cascade that has already been won or cancelled.
  await scheduledTasks.cancel(TASK_RESWEEP, tripId).catch(() => {});
  logger.info('Dispatch cascade finished', { tripId, reason });
}

// ── public API ───────────────────────────────────────────────────────────────

/**
 * Begin cascading a trip to drivers. The trip must already exist; this moves it
 * to MATCHING and starts offering.
 *
 * @param {string} tripId
 * @param {{kind?: string, excludeDriverId?: string|null}} [opts]
 */
async function startCascade(tripId, opts = {}) {
  const { kind = 'DISPATCH', excludeDriverId = null } = opts;

  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    // dropoff is selected for destination mode — see matcher.rankCandidates.
    select: {
      id: true, status: true, tier: true,
      pickupLat: true, pickupLng: true,
      dropoffLat: true, dropoffLng: true,
    },
  });
  if (!trip) throw new Error(`startCascade: trip ${tripId} not found`);

  // Restarting a trip's cascade (driver cancelled, say) must not leave the old
  // timer armed, or two chains would advance the same trip independently.
  await finish(tripId, 'restarted');
  await clearState(tripId);

  if (trip.status !== TRIP_STATUS.MATCHING) {
    await tripState.applyTransition(tripId, TRIP_STATUS.MATCHING, {
      actor: ACTOR.SYSTEM,
      payload: { kind },
    });
  }

  const candidates = await matcher.rankCandidates({
    tripId,
    pickupLat: trip.pickupLat,
    pickupLng: trip.pickupLng,
    radiusKm: DISPATCH_RADIUS_KM,
    excludeDriverId,
    tier: trip.tier,
    // Destination mode reads the trip's dropoff to decide whether a
    // homeward-bound driver is being sent the right way.
    trip,
  });

  await writeState({
    tripId,
    kind,
    excludeDriverId,
    candidates: candidates.map((c) => ({
      id: c.id,
      fcmToken: c.fcmToken,
      currentLat: c.currentLat,
      currentLng: c.currentLng,
      etaSeconds: c.etaSeconds,
      etaDegraded: c.etaDegraded,
      vehicleId: c.vehicleId,
    })),
    index: 0,
    declined: [],
    widened: false,
    done: false,
    currentDriverId: null,
    expiresAtMs: null,
    startedAtMs: Date.now(),
  });

  await emitProgress(tripId, 'DISPATCH_PROGRESS', {
    phase: 'SEARCHING',
    totalCandidates: candidates.length,
  });

  if (candidates.length === 0) {
    logger.info('No drivers in initial radius', { tripId, radiusKm: DISPATCH_RADIUS_KM });
  }
  await offerNext(tripId);
}

/**
 * Driver declined. Advances immediately rather than waiting out the TTL.
 * A decline from a driver who no longer holds the offer is ignored — it is a
 * late tap on an offer that already moved on, and acting on it would skip the
 * candidate who is currently mid-decision.
 */
async function declineOffer(tripId, driverId) {
  const state = await readState(tripId);
  if (!state || state.done) return false;
  if (!state.declined.includes(driverId)) state.declined.push(driverId);
  await writeState(state);
  if (state.currentDriverId !== driverId) return false;

  publisher.publishOfferRevoked(driverId, tripId, 'DECLINED');
  await scheduledTasks.cancel(TASK_OFFER_TIMEOUT, tripId).catch(() => {});
  await offerNext(tripId);
  return true;
}

/**
 * Stop the offer clock. Call BEFORE the claim transaction.
 *
 * This is the half of the old `acceptOffer()` that genuinely must happen early:
 * without it the next offer can fire while the claim is still in flight, and
 * two drivers end up holding live offers for one ride. It deliberately
 * announces nothing — the claim has not been won yet.
 */
async function stopOfferTimer(tripId) {
  await scheduledTasks.cancel(TASK_OFFER_TIMEOUT, tripId).catch(() => {});
  const state = await readState(tripId);
  if (state && !state.done) {
    state.done = true;
    await writeState(state);
  }
}

/**
 * A driver's claim COMMITTED. Call after the transaction, never before.
 *
 * The old code announced the winner before the claim, so a driver about to be
 * rejected with a 409 still told the rider "matched with driver X" and killed
 * the cascade. Splitting the call is the fix.
 */
async function announceWinner(tripId, driverId) {
  const state = await readState(tripId);
  // Everyone who was offered this trip and did not win learns it explicitly,
  // so no driver is left holding a dead offer card.
  if (state) {
    const offered = state.candidates.slice(0, state.index).map((c) => c.id);
    for (const id of offered) {
      if (id !== driverId) publisher.publishOfferRevoked(id, tripId, 'TAKEN');
    }
  }
  await finish(tripId, 'accepted');
  await clearState(tripId);

  // Destination mode buys ONE ride in the right direction, not a filtered
  // shift. The session ends here rather than at drop-off, so the driver is back
  // in the general pool the moment they have the ride they asked for.
  const winner = await prisma.driver
    .findUnique({ where: { id: driverId }, select: { destinationExpiresAt: true, destinationLat: true, destinationLng: true } })
    .catch(() => null);
  if (destinationMode.isActive(winner)) {
    await destinationMode.clearDestination(driverId, 'MATCHED');
  }
}

/** The claim FAILED (lost the race, or threw). Put the cascade back to work. */
async function resumeAfterFailedClaim(tripId, driverId) {
  const state = await readState(tripId);
  if (!state) return;
  state.done = false;
  if (driverId && !state.declined.includes(driverId)) state.declined.push(driverId);
  await writeState(state);
  await offerNext(tripId);
}

/** Rider cancelled, or the trip expired. */
async function cancelCascade(tripId) {
  const state = await readState(tripId);
  if (state?.currentDriverId) {
    publisher.publishOfferRevoked(state.currentDriverId, tripId, 'CANCELLED');
  }
  await finish(tripId, 'cancelled');
  await clearState(tripId);
}

/**
 * Current offer state.
 *
 * Now genuinely useful as a fallback: it reads from Redis, so unlike the old
 * in-process version it still answers after a deploy — which was precisely the
 * failure the fallback existed to cover and could not.
 */
async function getCascadeState(tripId) {
  const state = await readState(tripId);
  if (!state) return null;
  return {
    tripId,
    currentDriverId: state.currentDriverId,
    expiresAtServerMs: state.expiresAtMs,
    serverNowMs: Date.now(),
    attempt: state.index,
    totalCandidates: state.candidates.length,
    done: state.done,
  };
}

/**
 * Timer fired: the holding driver never answered.
 *
 * A timeout is a SOFT decline — the driver may simply have had the phone in a
 * pocket — so they stay eligible for the widened second sweep.
 */
scheduledTasks.registerHandler(TASK_OFFER_TIMEOUT, async (task) => {
  const { tripId, driverId } = task.payload || {};
  if (!tripId) return;
  const state = await readState(tripId);
  // Ignore a timeout for an offer that has already moved on.
  if (!state || state.done || state.currentDriverId !== driverId) return;
  logger.info('Dispatch offer timed out', { tripId, driverId });
  if (driverId) publisher.publishOfferRevoked(driverId, tripId, 'TIMEOUT');
  await offerNext(tripId);
});

/** Waiting-for-supply timer fired: look again. */
scheduledTasks.registerHandler(TASK_RESWEEP, async (task) => {
  const { tripId } = task.payload || {};
  if (!tripId) return;
  await resweep(tripId);
});

module.exports = {
  startCascade,
  resweep,
  notifySupplyAvailable,
  declineOffer,
  stopOfferTimer,
  announceWinner,
  resumeAfterFailedClaim,
  cancelCascade,
  getCascadeState,
  OFFER_TTL_SECONDS,
  DISPATCH_RADIUS_KM,
  DISPATCH_EXTENDED_RADIUS_KM,
  SEARCH_TIMEOUT_SECONDS,
  TASK_OFFER_TIMEOUT,
  TASK_RESWEEP,
};
