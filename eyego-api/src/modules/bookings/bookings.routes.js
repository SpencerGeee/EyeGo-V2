'use strict';

const { Router } = require('express');
const { body } = require('express-validator');
const controller = require('./bookings.controller');
const authenticate = require('../../middleware/auth');
const validate = require('../../middleware/validate');
const { bookingCreateLimiter } = require('../../middleware/rateLimiter');

const router = Router();

// GET /v1/bookings/promos/validate?code=X — validate a promo code without a booking (no auth required)
router.get('/promos/validate', controller.validatePromoCode);

router.use(authenticate);

// GET /v1/bookings          — list my bookings
// GET /v1/bookings/active   — current active booking (must be before /:bookingId)
// GET /v1/bookings/:id      — single booking receipt
router.get('/', controller.getUserBookings);
router.post('/', bookingCreateLimiter, controller.bookSeat);
// Fixed-segment routes MUST come before /:bookingId to avoid param capture
router.get('/active', controller.getActiveBooking);
// POST /bookings/join/:shareToken — must be before /:bookingId/* routes
router.post('/join/:shareToken', controller.joinGroup);

router.get('/:bookingId', controller.getBooking);
router.post('/:bookingId/cancel', controller.cancelBooking);
// DELETE /:bookingId  — kept for backward compat (cancels without reason)
router.delete('/:bookingId', controller.cancelBooking);
router.post('/:bookingId/rating', controller.rateBooking);
router.post('/:bookingId/tip', controller.tipDriver);
router.post('/:bookingId/apply-promo', controller.applyPromoCode);
router.post('/:bookingId/dispute', controller.submitDispute);
// Group-hub joiner setting/changing their own pickup point — pre-payment only.
// Validated: a malformed/missing lat or lng must 400 here, not flow through as
// NaN into the booking's recomputed fareAmount/commissionAmount.
router.patch(
  '/:bookingId/pickup',
  body('lat').isFloat({ min: -90, max: 90 }),
  body('lng').isFloat({ min: -180, max: 180 }),
  body('address').optional().isString(),
  validate,
  controller.updatePickup,
);
router.patch(
  '/:bookingId/heavy-cargo',
  body('heavyCargo').isBoolean(),
  validate,
  controller.updateHeavyCargo,
);

// ── Group Hub ──────────────────────────────────────────────────────────────
router.post('/:bookingId/invite', controller.generateInvite);
// POST to regenerate — invalidates old token, issues new one
router.post('/:bookingId/invite/regenerate', controller.regenerateInvite);
router.get('/:bookingId/group', controller.getGroup);

module.exports = router;
