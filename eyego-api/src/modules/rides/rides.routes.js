'use strict';

const { Router } = require('express');
const { body, query, param } = require('express-validator');
const rides = require('./rides.service');
const authenticate = require('../../middleware/auth');
// Platform-wide maintenance switch — see middleware/killSwitch.js.
const { requireBookingEnabled } = require('../../middleware/killSwitch');
const { authenticateDriver } = require('../../middleware/driverAuth');
const validate = require('../../middleware/validate');
// One ceiling for the party size, shared with the rider app's picker — see the
// note on `seatCount` in the create route below for what happened without it.
const { MAX_SEATS_PER_BOOKING } = require('../../config/booking');

/**
 * On-demand rides. ONE path, for both apps.
 *
 * The rider surface is deliberately tiny — quote, request, read, cancel — and
 * the driver surface is one verb per state transition. Everything else the
 * apps used to poll for (dispatch progress, driver position, "has anyone
 * accepted yet") arrives on the `trip:event` channel instead, replayable by
 * seq, so there is nothing left to poll.
 */

const router = Router();
const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);

/**
 * Both auth middlewares put the decoded JWT on `req.user`, and the id in that
 * payload is `userId` — there is no `id` on it, and no `req.driver` at all.
 * Reading the wrong field made every rider call act as an anonymous stranger
 * and every driver call throw before it reached the service, which is why
 * dispatch offers never arrived on the driver app.
 */
const actorId = (req) => req.user.userId;

// ── rider ────────────────────────────────────────────────────────────────────

/** Price a ride. Returns a signed, single-use, short-lived quote. */
router.post(
  '/quote',
  authenticate,
  [
    body('pickupLat').isFloat({ min: -90, max: 90 }),
    body('pickupLng').isFloat({ min: -180, max: 180 }),
    body('dropoffLat').isFloat({ min: -90, max: 90 }),
    body('dropoffLng').isFloat({ min: -180, max: 180 }),
    body('tier').optional().isIn(['ECO', 'COMFORT', 'PREMIUM']),
    // The party being priced. Optional and defaulted to one, so an ordinary hail
    // is unaffected; see `partySize` in fare.calculator.js for what it changes.
    body('seatCount').optional().isInt({ min: 1, max: MAX_SEATS_PER_BOOKING }).toInt(),
  ],
  validate,
  h(async (req, res) => {
    const quote = await rides.quoteRide(actorId(req), {
      tier: req.body.tier ?? 'ECO',
      // A quote for a party of eight is not the same price as one for a party
      // of two, and it is signed with this value, so the ride that redeems it
      // must be for the same party. See createQuote.
      seatCount: req.body.seatCount ?? 1,
      pickupLat: Number(req.body.pickupLat),
      pickupLng: Number(req.body.pickupLng),
      dropoffLat: Number(req.body.dropoffLat),
      dropoffLng: Number(req.body.dropoffLng),
      /**
       * TRI-STATE, NOT A BOOLEAN. `!!` was flattening "the rider has not said"
       * into "the rider declined", and the quote's doorstep derivation needs
       * the difference: an off-road pin nobody has commented on IS a doorstep
       * pickup, while one the rider explicitly turned off moves the pickup to
       * the kerb. See `createQuote`.
       */
      doorstepPickup:
        req.body.doorstepPickup === undefined
          ? undefined
          : req.body.doorstepPickup === true || req.body.doorstepPickup === 'true',
      heavyLoad: !!req.body.heavyLoad,
    });
    res.json({ success: true, data: quote });
  }),
);

/**
 * Request a ride. Creates the Trip at REQUESTED and starts dispatch.
 *
 * `Idempotency-Key` is honoured: a retried Confirm replays the original ride
 * rather than booking a second one.
 */
router.post(
  '/',
  authenticate,
  requireBookingEnabled,
  [
    body('quoteId').isString().isLength({ min: 64, max: 64 }),
    body('pickupLat').isFloat({ min: -90, max: 90 }),
    body('pickupLng').isFloat({ min: -180, max: 180 }),
    body('dropoffLat').isFloat({ min: -90, max: 90 }),
    body('dropoffLng').isFloat({ min: -180, max: 180 }),
    body('paymentMethod').optional().isIn(['CASH', 'CARD', 'MOMO', 'WALLET']),
    /**
     * Party size. Bounded here rather than trusted: it becomes the trip's
     * capacity, and an unbounded value would let a client publish a trip
     * claiming a hundred seats.
     *
     * BUGFIX ("on the group ride option, when I get to the party size page and
     * choose 8, it books just the 8th seat and not a party of 8").
     *
     * The ceiling was SIX here and in `requestRide`'s own clamp, while the
     * group picker on the rider app offers up to `MAX_SEATS_PER_BOOKING` — 8.
     * So a party of seven or eight was rejected by this validator outright, and
     * anything that got past it was silently clamped back to six: the rider
     * chose eight and the trip was created for a different number than the one
     * they were shown. One constant, shared with the client, is the only way
     * these two cannot drift again.
     *
     * It DOES now affect the fare — see `partySize` in fare.calculator.js.
     */
    body('seatCount').optional().isInt({ min: 1, max: MAX_SEATS_PER_BOOKING }).toInt(),
    // "Yes, book a second ride anyway" — see requestRide. The rider has to have
    // been shown the prompt for this to be true, so it is never a default.
    body('allowConcurrent').optional().isBoolean(),
    // Booking on someone else's behalf. Name only is enough to identify the
    // passenger to the driver; the phone is what lets the driver reach them at
    // the kerb, which is the whole point of the feature.
    body('passenger.name').optional().isString().isLength({ min: 1, max: 80 }),
    body('passenger.phone').optional().isString().isLength({ min: 5, max: 20 }),
  ],
  validate,
  h(async (req, res) => {
    const result = await rides.requestRide(actorId(req), {
      ...req.body,
      pickupLat: Number(req.body.pickupLat),
      pickupLng: Number(req.body.pickupLng),
      dropoffLat: Number(req.body.dropoffLat),
      dropoffLng: Number(req.body.dropoffLng),
      idempotencyKey: req.get('Idempotency-Key') || req.body.idempotencyKey || null,
      allowConcurrent: req.body.allowConcurrent === true || req.body.allowConcurrent === 'true',
    });
    res.status(201).json({ success: true, data: result });
  }),
);

/**
 * ONE-CALL REHYDRATION for the rider app. Cold start, foreground, reconnect.
 * Neither app had an equivalent; both dossiers name its absence as the cause
 * of an entire class of "the app forgot I was on a trip" bugs.
 */
router.get(
  '/active',
  authenticate,
  h(async (req, res) => {
    res.json({ success: true, data: await rides.getActiveRide(actorId(req)) });
  }),
);

/** Replay: everything that happened after the seq the client last applied. */
router.get(
  '/:id/events',
  authenticate,
  [param('id').isString(), query('since').optional().isInt({ min: 0 })],
  validate,
  h(async (req, res) => {
    const since = Number.parseInt(req.query.since, 10) || 0;
    res.json({ success: true, data: await rides.getRideEvents(req.params.id, actorId(req), since) });
  }),
);

router.post(
  '/:id/cancel',
  authenticate,
  h(async (req, res) => {
    res.json({
      success: true,
      data: await rides.cancelRide(actorId(req), req.params.id, req.body?.reason ?? null),
    });
  }),
);

// ── driver ───────────────────────────────────────────────────────────────────

/** ONE-CALL REHYDRATION for the driver app. */
router.get(
  '/driver/state',
  authenticateDriver,
  h(async (req, res) => {
    res.json({ success: true, data: await rides.getDriverState(actorId(req)) });
  }),
);

/**
 * FOREGROUND RESYNC. A POST because it has effects — see rides.service.
 *
 * The driver app calls this on every `AppState -> active`, and nothing else
 * calls it. Everything a returning app needs is in the one reply: the live
 * trip, the offer it may have missed, and every search still running nearby.
 */
router.post(
  '/driver/resync',
  authenticateDriver,
  h(async (req, res) => {
    res.json({ success: true, data: await rides.resyncDriver(actorId(req)) });
  }),
);

router.post(
  '/:id/accept',
  authenticateDriver,
  h(async (req, res) => {
    res.json({ success: true, data: await rides.acceptRide(actorId(req), req.params.id) });
  }),
);

router.post(
  '/:id/decline',
  authenticateDriver,
  h(async (req, res) => {
    res.json({ success: true, data: await rides.declineRide(actorId(req), req.params.id) });
  }),
);

router.post(
  '/:id/en-route',
  authenticateDriver,
  h(async (req, res) => {
    res.json({ success: true, data: await rides.startEnRoute(actorId(req), req.params.id) });
  }),
);

router.post(
  '/:id/arrived',
  authenticateDriver,
  h(async (req, res) => {
    res.json({ success: true, data: await rides.markArrived(actorId(req), req.params.id) });
  }),
);

router.post(
  '/:id/start',
  authenticateDriver,
  h(async (req, res) => {
    res.json({ success: true, data: await rides.startTrip(actorId(req), req.params.id) });
  }),
);

router.post(
  '/:id/complete',
  authenticateDriver,
  h(async (req, res) => {
    res.json({ success: true, data: await rides.completeTrip(actorId(req), req.params.id) });
  }),
);

/** Driver drops out. Redispatches THIS trip rather than minting a new one. */
router.post(
  '/:id/driver-cancel',
  authenticateDriver,
  h(async (req, res) => {
    res.json({
      success: true,
      data: await rides.driverCancel(actorId(req), req.params.id, req.body?.reason ?? null),
    });
  }),
);

module.exports = router;
