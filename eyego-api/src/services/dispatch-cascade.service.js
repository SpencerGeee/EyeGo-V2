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
const { isDriverAvailable, explainIneligible } = require('./driver-availability');
const { sendMulticastPush } = require('./push.service');
const { formatGhs } = require('../utils/money');
const { livePassengerWhere } = require('../utils/booking-status');
const scheduledTasks = require('./scheduled-task.service');
const matcher = require('./matcher.service');
const destinationMode = require('./destination-mode.service');
const publisher = require('./trip-events.publisher');
const tripState = require('./trip-state.service');
const { TRIP_STATUS, ACTOR } = tripState;

/**
 * DISPATCH TUNING IS READ PER CALL, NOT PER PROCESS.
 *
 * These were module-level `const`s captured from `process.env` at require time,
 * which meant every one of them needed a restart to change. They are now getters
 * over the runtime settings registry, so an operator widening the search radius
 * or lengthening the offer countdown from the console affects the very next
 * dispatch. `settings.get()` is a synchronous cache read — see
 * src/config/settings.js — so this costs nothing on the hot path.
 */
const settings = require('../config/settings');

/**
 * How long a single driver holds an exclusive offer before it moves on.
 *
 * Was 20 s. That is a fine number when the offer reaches the phone instantly,
 * and a hostile one when it does not: the driver-side fallback for a dropped
 * socket frame is a REST poll, so a phone that misses the push has to poll,
 * render, and be READ inside the window. Twenty seconds left roughly none of
 * it for the human. Uber and Bolt both sit in the 30–60 s band; 45 s is the
 * middle of it and still short enough that a pocketed phone does not hold a
 * rider hostage.
 */
const offerTtlSeconds = () => settings.get('DISPATCH_OFFER_TTL_SECONDS') ?? 45;
/** Nearest-first search radius, and the wider sweep used if nobody is close. */
const dispatchRadiusKm = () => settings.get('DISPATCH_RADIUS_KM') ?? 5;
const dispatchExtendedRadiusKm = () => settings.get('DISPATCH_EXTENDED_RADIUS_KM') ?? 12;

/**
 * How long the search stays alive with nobody to offer it to.
 *
 * Mirrors RIDE_REQUEST_EXPIRY_SECONDS in modules/rides — that task is what
 * actually fails the trip, and a search that gave up first would strand the
 * rider on a spinner until it fired.
 */
const searchTimeoutSeconds = () =>
  settings.get('DISPATCH_SEARCH_TIMEOUT_SECONDS') ??
  parseInt(process.env.RIDE_REQUEST_EXPIRY_SECONDS, 10) ??
  300;
/** Gap between re-scans while waiting for supply to appear. */
const RESWEEP_INTERVAL_SECONDS =
  parseInt(process.env.DISPATCH_RESWEEP_SECONDS, 10) || 10;

const TASK_OFFER_TIMEOUT = 'DISPATCH_OFFER_TIMEOUT';
const TASK_RESWEEP = 'DISPATCH_RESWEEP';
/**
 * "Start the search for this trip" as a durable row.
 *
 * `requestRide` used to AWAIT `startCascade` inside the HTTP handler. Measured
 * against a remote Postgres that answers in ~300 ms, the request took fourteen
 * seconds end to end — REQUESTED at :16, MATCHING at :20, SEARCHING at :25,
 * OFFERED at :30 — against a fifteen-second client timeout. The rider saw
 * "couldn't reach the server" for a trip that had in fact been created and was
 * already being dispatched, then hit "you already have a ride in progress" on
 * the retry. Every one of those symptoms is this one await.
 *
 * So the cascade is kicked off out of band. This row is what makes that safe:
 * it is written INSIDE the creating transaction, so a process that dies between
 * the commit and the `setImmediate` still has a search armed on disk.
 */
const TASK_DISPATCH_START = 'DISPATCH_START';
/** Cascade state outlives any single offer but must not leak forever. */
const STATE_TTL_SECONDS = 30 * 60;

const stateKey = (tripId) => `dispatch:cascade:${tripId}`;
const lockKey = (tripId) => `dispatch:lock:${tripId}`;
/**
 * The offer, mirrored per-driver so it can be FETCHED rather than only pushed.
 *
 * Cascade state is keyed by trip, which answers "who is this trip offered to".
 * It cannot answer the question a driver's app asks on every cold start,
 * foreground and reconnect: "is anyone waiting on me right now". A socket frame
 * is the only way an offer has ever reached a phone, and an offer carries no
 * trip seq, so unlike every lifecycle event there is nothing to replay it from
 * — a phone asleep for those twenty seconds never learned the offer existed.
 * This key self-expires with the offer, so it can never outlive its own answer.
 */
const driverOfferKey = (driverId) => `dispatch:offer:driver:${driverId}`;

/** Park an offer where `GET /rides/driver/state` can find it. */
async function rememberOffer(driverId, payload, expiresAtMs) {
  const ms = Math.max(1000, expiresAtMs - Date.now());
  await redis.set(driverOfferKey(driverId), JSON.stringify(payload), 'PX', ms).catch(() => {});
}

/** Drop it the moment it stops being true — taken, declined, revoked, expired. */
async function forgetOffer(driverId) {
  if (!driverId) return;
  await redis.del(driverOfferKey(driverId)).catch(() => {});
}

/**
 * The live offer for this driver, or null. Expired entries answer null rather
 * than a dead card: redis TTL is the authority, and we re-check the deadline
 * anyway in case the key outlived it by a tick.
 */
async function getOfferForDriver(driverId) {
  try {
    const raw = await redis.get(driverOfferKey(driverId));
    if (!raw) return null;
    const offer = JSON.parse(raw);
    if (!offer?.expiresAtServerMs || offer.expiresAtServerMs <= Date.now()) return null;
    return offer;
  } catch {
    return null;
  }
}

/**
 * The drivers this cascade must not offer to.
 *
 * Tolerates both shapes on purpose: state written before this became a list
 * carries a scalar `excludeDriverId`, and those cascades are still live in Redis
 * across the deploy that introduces the array. Reading only the new field would
 * silently re-offer a trip to the driver who just dropped it, for as long as any
 * pre-deploy search is still running.
 */
const excludedFrom = (state) => {
  if (!state) return [];
  if (Array.isArray(state.excludeDriverIds)) return state.excludeDriverIds;
  return state.excludeDriverId ? [state.excludeDriverId] : [];
};

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

async function pushToDriver(driver, trip, expiresAtMs, offer = {}) {
  if (!driver.fcmToken) {
    // Worth a line in the log: with no token the ONLY way this driver sees the
    // offer is an open socket, so a backgrounded app misses it entirely. That is
    // "the request never showed up on the driver phone" with a knowable cause.
    logger.warn('Dispatch offer cannot be pushed — driver has no FCM token', {
      driverId: driver.id,
      tripId: trip.id,
    });
    return;
  }
  try {
    /**
     * Say what the job IS. "A rider needs a trip" told the driver nothing they
     * could act on from the lock screen — not where, not how far, not what it
     * pays — so the only way to judge an offer was to open the app, by which
     * time the countdown had eaten several of its seconds.
     *
     * Everything here is already computed for the socket payload, so this costs
     * nothing extra.
     */
    const parts = [];
    if (Number.isFinite(offer.etaSeconds)) parts.push(`${Math.max(1, Math.round(offer.etaSeconds / 60))} min away`);
    if (Number.isFinite(offer.driverEarningsPesewas) && offer.driverEarningsPesewas > 0) {
      parts.push(`you earn ${formatGhs(offer.driverEarningsPesewas)}`);
    }
    const where = trip.pickupAddress || offer.pickupAddress || null;

    await sendMulticastPush(
      [driver.fcmToken],
      where ? `New trip from ${where}` : 'New trip nearby',
      parts.length
        ? `${parts.join(' · ')} — tap to accept before it expires`
        : 'Tap to accept before it expires',
      {
        type: 'TRIP_OFFER',
        tripId: trip.id,
        expiresAt: new Date(expiresAtMs).toISOString(),
      },
    );
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
          where: livePassengerWhere(),
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
        // The re-check between building the list and reaching this candidate is
        // deliberate, but "skipped" on its own is useless when the whole list
        // gets skipped and the rider sees nothing. Name the reason.
        const [why] = await explainIneligible(prisma, [candidate.id]).catch(() => []);
        logger.info('Dispatch skipped candidate', {
          tripId,
          driverId: candidate.id,
          reason: why?.reason ?? 'UNKNOWN',
        });
        continue;
      }

      const expiresAtMs = Date.now() + offerTtlSeconds() * 1000;
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

      const offerPayload = {
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
        expiresInSeconds: offerTtlSeconds(),
        etaSeconds: candidate.etaSeconds,
        attempt: state.index,
        totalCandidates: state.candidates.length,
      };

      // Park it BEFORE publishing. If the driver's socket is down, the push
      // notification is what wakes the app, and the app's first act on wake is
      // to hydrate — which must already be able to see this.
      await rememberOffer(candidate.id, offerPayload, expiresAtMs);
      publisher.publishOfferToDriver(candidate.id, offerPayload);
      pushToDriver(candidate, trip, expiresAtMs, offerPayload).catch(() => {});

      /**
       * WHETHER THE OFFER COULD POSSIBLY HAVE ARRIVED.
       *
       * Two independent delivery paths, both of which can be silently absent:
       * an open socket in `driver:<id>`, and an FCM token to push to. When both
       * are zero the driver's only remaining hope is their own 2 s REST poll,
       * and the rider is watching a countdown against a phone that may never
       * have been told. Recording it on the event means the admin dispatch board
       * answers "did it reach the phone" without anyone reading server logs —
       * which is how this bug has stayed alive across several sweeps.
       */
      const deliveredToSockets = await publisher.countDriverSockets(candidate.id).catch(() => 0);
      if (deliveredToSockets === 0 && !candidate.fcmToken) {
        logger.error('Dispatch offer has NO delivery path', {
          tripId,
          driverId: candidate.id,
          reason: 'no open socket in driver room and no FCM token on the driver row',
        });
      }

      await emitProgress(tripId, 'DISPATCH_PROGRESS', {
        phase: 'OFFERED',
        driverId: candidate.id,
        deliveredToSockets,
        pushable: !!candidate.fcmToken,
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
        radiusKm: dispatchExtendedRadiusKm(),
        excludeDriverId: excludedFrom(state),
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
    if (elapsedMs < searchTimeoutSeconds() * 1000) {
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
      searchTimeoutSeconds: searchTimeoutSeconds(),
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
        radiusKm: dispatchExtendedRadiusKm(),
        excludeDriverId: excludedFrom(state),
        tier: trip.tier,
        // Destination mode reads the trip's dropoff to decide whether a
        // homeward-bound driver is being sent the right way.
        trip,
      })
      .catch((err) => {
        logger.warn(`Dispatch resweep ranking failed for ${tripId}: ${err.message}`);
        return [];
      });

    /**
     * A DRIVER WHO TIMED OUT IS ASKED AGAIN. THIS IS THE WHOLE POINT.
     *
     * BUGFIX ("the rider app says asking driver 1 of 1 and the driver app never
     * shows anything"). The header two lines below used to claim a timed-out
     * driver was "deliberately eligible again", and the code immediately
     * contradicted it: candidates were filtered with `!seen.has(c.id)`, and
     * `seen` was built from `state.candidates` — which already contains every
     * driver the cascade has ever walked past. So the ONLY drivers a resweep
     * could ever find were ids that had never been in the list at all.
     *
     * With one driver in the city that made the search a single 45-second shot.
     * Miss that one socket frame — a backgrounded app, a phone switching between
     * the two apps on one handset, no APNs key, a doze — and the driver was
     * never asked again. The resweep then ran every ten seconds for five minutes
     * finding "no new supply", and the ride died as EXPIRED with the driver
     * sitting online the whole time.
     *
     * So the resweep now REBUILDS the queue from whoever is dispatchable right
     * now, minus explicit declines, and rewinds the cursor. `offerNext` re-checks
     * availability and declines before every single offer, and this only runs
     * when the list is already exhausted (no offer is in flight), so re-asking
     * cannot double-offer a trip.
     */
    const declined = new Set(state.declined);
    const extra = fresh
      .filter((c) => !declined.has(c.id))
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
      if (elapsedMs < searchTimeoutSeconds() * 1000) {
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

    logger.info('Dispatch re-sweeping supply', {
      tripId,
      dispatchable: extra.length,
      driverIds: extra.map((c) => c.id),
      previouslyTried: state.candidates.length,
    });
    // Rewind: the list is exhausted, so index 0 of the fresh list is the next
    // driver to ask. Without the rewind the new list would be walked from a
    // cursor that is already past its end and nothing would ever be offered.
    state.candidates = extra;
    state.index = 0;
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
      if (excludedFrom(state).includes(driverId)) continue;
      await scheduledTasks.cancel(TASK_RESWEEP, trip.id).catch(() => {});
      await resweep(trip.id);
    }
  } catch (err) {
    logger.warn(`notifySupplyAvailable(${driverId}) failed: ${err.message}`);
  }
}

/**
 * THE FOREGROUND HANDSHAKE — "I'm back. Is anything waiting on me?"
 *
 * BUGFIX ("when I switch back to the driver app nothing happens… it's saying
 * asking driver 1 of 1 but nothing on the driver app is showing").
 *
 * `notifySupplyAvailable` above is a SUPPLY event: it exists for the moment a
 * driver becomes dispatchable, and it deliberately touches only cascades that
 * are parked (`state.waiting`). Both of those are wrong for a foreground:
 *
 *   - It is gated by the caller on the presence absent→present EDGE. A driver
 *     who spent forty seconds in the rider app never lost their presence key,
 *     so `rejoined` is false and nothing is nudged at all.
 *   - A cascade that is MID-OFFER to this very driver is skipped, because it is
 *     not parked. That is precisely the failing case: the offer was published
 *     into an empty socket room, the Redis key holding it is the only surviving
 *     copy, and the driver's app has to be told to go and look.
 *
 * So this is the other verb. It asks about THIS driver specifically and does
 * whichever of the two things is true:
 *
 *   - an offer is live and held by them → re-publish the frame and refresh the
 *     mirror key, so both delivery paths fire again the instant they are back;
 *   - the search is parked → jump the resweep timer.
 *
 * Never creates a second parallel offer: re-publishing an offer this driver
 * already holds is idempotent, and `resweep` only ever runs when the candidate
 * list is exhausted.
 *
 * @returns {Promise<{offer: object|null, nudged: number}>}
 */
async function resyncDriver(driverId) {
  if (!driverId) return { offer: null, nudged: 0 };
  let nudged = 0;
  try {
    const searching = await prisma.trip.findMany({
      where: { status: { in: [TRIP_STATUS.MATCHING, TRIP_STATUS.REASSIGNING] } },
      select: { id: true },
      take: 25,
    });

    for (const trip of searching) {
      const state = await readState(trip.id);
      if (!state || state.done) continue;
      if (excludedFrom(state).includes(driverId)) continue;

      // Held by us, right now. Re-deliver rather than re-offer.
      if (state.currentDriverId === driverId) {
        const offer = await getOfferForDriver(driverId);
        if (offer) {
          publisher.publishOfferToDriver(driverId, { ...offer, serverNowMs: Date.now() });
          nudged += 1;
        }
        continue;
      }

      // Parked with nobody holding it — the same nudge `notifySupplyAvailable`
      // performs, but reached without needing a presence edge to have happened.
      if (state.waiting) {
        await scheduledTasks.cancel(TASK_RESWEEP, trip.id).catch(() => {});
        await resweep(trip.id);
        nudged += 1;
      }
    }
  } catch (err) {
    logger.warn(`resyncDriver(${driverId}) failed: ${err.message}`);
  }

  // Read AFTER the nudges: a resweep above may have just offered this driver a
  // trip, and the caller's whole purpose is to hand that back in one round trip.
  const offer = await getOfferForDriver(driverId).catch(() => null);
  return { offer, nudged };
}

/**
 * Every live search this driver could still be given, whether or not it is
 * currently offered to them.
 *
 * Powers the driver app's Alerts → Dispatch list, which answers the question
 * the offer card cannot: "did I miss something while I was away?" An offer is a
 * 45-second window; a SEARCH runs for five minutes, and for all of that time the
 * rider is still waiting. Showing the search — with `offeredToMe` marking the
 * one the driver actually holds — is the difference between a missed frame
 * costing the ride and costing a few seconds.
 *
 * Deliberately not filtered by `isDriverAvailable`: a driver reading this list
 * is asking what work exists, and hiding it because their own presence key
 * lapsed is how the original bug hid the ride in the first place. The accept
 * path is still first-claim-wins and re-checks everything.
 */
async function listSearchesForDriver(driverId, { limit = 10 } = {}) {
  if (!driverId) return [];
  try {
    const trips = await prisma.trip.findMany({
      where: { status: { in: [TRIP_STATUS.MATCHING, TRIP_STATUS.REASSIGNING] } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        status: true,
        tier: true,
        createdAt: true,
        pickupLat: true,
        pickupLng: true,
        pickupAddress: true,
        dropoffLat: true,
        dropoffLng: true,
        dropoffAddress: true,
        commissionRate: true,
        bookings: {
          where: livePassengerWhere(),
          select: { fareAmountPesewas: true, commissionAmountPesewas: true },
        },
      },
    });
    if (trips.length === 0) return [];

    const held = await getOfferForDriver(driverId).catch(() => null);

    const out = [];
    for (const trip of trips) {
      const state = await readState(trip.id);
      if (state?.done) continue;
      if (excludedFrom(state).includes(driverId)) continue;
      if (state?.declined?.includes(driverId)) continue;

      const grossPesewas = trip.bookings.reduce((n, b) => n + (b.fareAmountPesewas || 0), 0);
      const commissionPesewas = trip.bookings.reduce(
        (n, b) =>
          n +
          (b.commissionAmountPesewas ??
            Math.round((b.fareAmountPesewas || 0) * (trip.commissionRate ?? 0.15))),
        0,
      );

      out.push({
        tripId: trip.id,
        status: trip.status,
        tier: trip.tier,
        requestedAtMs: trip.createdAt.getTime(),
        pickupLat: trip.pickupLat,
        pickupLng: trip.pickupLng,
        pickupAddress: trip.pickupAddress,
        dropoffLat: trip.dropoffLat,
        dropoffLng: trip.dropoffLng,
        dropoffAddress: trip.dropoffAddress,
        farePesewas: grossPesewas,
        driverEarningsPesewas: Math.max(0, grossPesewas - commissionPesewas),
        /** True when THIS driver is the one the cascade is currently asking. */
        offeredToMe: held?.tripId === trip.id || state?.currentDriverId === driverId,
        expiresAtServerMs:
          state?.currentDriverId === driverId ? state?.expiresAtMs ?? null : null,
        /** Somebody else is holding the exclusive offer this instant. */
        heldByAnother: !!state?.currentDriverId && state.currentDriverId !== driverId,
      });
    }
    return out;
  } catch (err) {
    logger.warn(`listSearchesForDriver(${driverId}) failed: ${err.message}`);
    return [];
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

  /**
   * EVERY DRIVER WHO WALKED AWAY FROM THIS TRIP, NOT JUST THE LAST ONE.
   *
   * `excludeDriverId` is a single id supplied by whoever restarted the cascade,
   * and `clearState()` below wipes the previous run's `declined` list. So on the
   * second redispatch the driver who cancelled the FIRST time was a candidate
   * again — and being re-offered the ride you just abandoned, possibly several
   * times over as `redispatchCount` climbs toward `MAX_REDISPATCH`, is both
   * useless and infuriating.
   *
   * Cancellations are durable in `DispatchAction`, so they survive the state
   * wipe, a deploy and a Redis flush. Read them back and exclude the lot.
   *
   * NOTE the deliberate asymmetry with a DECLINE. A driver who let an offer
   * time out, or tapped decline, IS re-offered on a later sweep — that was a
   * bug fixed earlier this month and must stay fixed, because the usual reason
   * is simply that they were not looking at their phone. Abandoning an ACCEPTED
   * trip is a different act, and is recorded as `CANCELLED` for exactly this
   * reason.
   */
  let excludeDriverIds = [];
  try {
    const priorCancellations = await prisma.dispatchAction.findMany({
      where: { tripId, action: 'CANCELLED' },
      select: { driverId: true },
    });
    excludeDriverIds = priorCancellations.map((a) => a.driverId);
  } catch (err) {
    // Worth a line, not a failed dispatch: the cost of losing this list is a
    // driver seeing a trip they dropped, which is far better than no dispatch.
    logger.warn(`startCascade: could not read prior cancellations for ${tripId}: ${err.message}`);
  }
  if (excludeDriverId && !excludeDriverIds.includes(excludeDriverId)) {
    excludeDriverIds.push(excludeDriverId);
  }

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
  // The recovery row has done its job the moment we get here.
  await scheduledTasks.cancel(TASK_DISPATCH_START, tripId).catch(() => {});

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
    radiusKm: dispatchRadiusKm(),
    excludeDriverId: excludeDriverIds,
    tier: trip.tier,
    // Destination mode reads the trip's dropoff to decide whether a
    // homeward-bound driver is being sent the right way.
    trip,
  });

  await writeState({
    tripId,
    kind,
    excludeDriverIds,
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

  // The head of every dispatch investigation: what the search actually started
  // with. `matcher.rankCandidates` logs WHY the list is the length it is; this
  // logs WHO is on it, so a specific driver's absence is traceable to a specific
  // trip rather than inferred.
  logger.info('Dispatch cascade started', {
    tripId,
    kind,
    radiusKm: dispatchRadiusKm(),
    candidates: candidates.length,
    driverIds: candidates.map((c) => c.id),
    pickup: { lat: trip.pickupLat, lng: trip.pickupLng },
    tier: trip.tier,
  });
  if (candidates.length === 0) {
    logger.warn('No drivers in initial radius — search will wait for supply', {
      tripId,
      radiusKm: dispatchRadiusKm(),
      searchTimeoutSeconds: searchTimeoutSeconds(),
    });
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

  await forgetOffer(driverId);
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
      // Including the winner: their offer is now a trip, and a stale REST
      // offer would re-open the card over the trip screen on next hydrate.
      await forgetOffer(id);
    }
  }
  await forgetOffer(driverId);
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
    await forgetOffer(state.currentDriverId);
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
  if (driverId) {
    await forgetOffer(driverId);
    publisher.publishOfferRevoked(driverId, tripId, 'TIMEOUT');
  }
  await offerNext(tripId);
});

/**
 * Safety net for a search that was never actually started.
 *
 * Armed in the same transaction that creates the trip and cancelled by
 * `startCascade` the moment the real search begins, so in the ordinary case it
 * never runs. It exists for the case the in-process kick never happened — a
 * crash, a deploy, an unhandled throw between commit and `setImmediate`.
 */
scheduledTasks.registerHandler(TASK_DISPATCH_START, async (task) => {
  const { tripId, kind } = task.payload || {};
  if (!tripId) return;
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, select: { status: true } });
  if (!trip) return;
  if (![TRIP_STATUS.REQUESTED, TRIP_STATUS.MATCHING, TRIP_STATUS.REASSIGNING].includes(trip.status)) return;
  // A live cascade is already working this trip — nothing to recover.
  const state = await readState(tripId);
  if (state && !state.done) return;
  logger.warn('Dispatch never started in-process — recovering from the durable task', { tripId });
  await startCascade(tripId, { kind: kind || 'ON_DEMAND' });
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
  resyncDriver,
  listSearchesForDriver,
  declineOffer,
  stopOfferTimer,
  announceWinner,
  resumeAfterFailedClaim,
  cancelCascade,
  getCascadeState,
  getOfferForDriver,
  forgetOffer,
  // Exported as functions, not values: a caller that captured a number would be
  // holding a stale copy the moment an admin changed it.
  offerTtlSeconds,
  dispatchRadiusKm,
  dispatchExtendedRadiusKm,
  searchTimeoutSeconds,
  TASK_OFFER_TIMEOUT,
  TASK_RESWEEP,
  TASK_DISPATCH_START,
};
