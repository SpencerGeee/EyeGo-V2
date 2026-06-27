'use strict';

const { Router } = require('express');
const tripsController = require('./trips.controller');
const bookingsController = require('../bookings/bookings.controller');
const authenticate = require('../../middleware/auth');
const { authenticateDriver } = require('../../middleware/driverAuth');
const { body } = require('express-validator');
const validate = require('../../middleware/validate');

const router = Router();

// ── Public ──────────────────────────────────────────────────
router.get('/pulse', tripsController.getPulseSchedules);
router.get('/join/:shareToken', tripsController.getTripByShareToken);
// Public live-tracking data for the share-trip web page
router.get('/track/:shortId/data', tripsController.getTrackingData);
// Public join/invite data for the invite web page — returns trip, route, driver, fare
router.get('/join/:shareToken/data', tripsController.getJoinData);

// ── Passenger ───────────────────────────────────────────────
router.get('/', authenticate, tripsController.searchTrips);
router.get('/active', authenticate, tripsController.getActiveTrip);
router.get('/fare-estimate', authenticate, tripsController.getFareEstimate);
router.get('/:id', authenticate, tripsController.getTrip);
router.get('/:id/seats', authenticate, tripsController.getSeatMap);
router.get('/:id/receipt', authenticate, tripsController.getTripReceipt);

// POST /v1/trips/:id/book  — book a seat
router.post(
  '/:id/book',
  authenticate,
  body('seatNumber').isInt({ min: 1 }).withMessage('Valid seat number required'),
  validate,
  bookingsController.bookSeat
);

// POST /v1/trips/:id/group  — create ride group / invite link
router.post('/:id/group', authenticate, bookingsController.createGroup);

// POST /v1/trips/:id/emergency  — SOS emergency alert
router.post('/:id/emergency', authenticate, tripsController.emergencyAlert);

// POST /v1/trips/request — rider requests a trip to a free-text destination
// Dispatched to nearby drivers who can accept and create the trip
router.post(
  '/request',
  authenticate,
  body('destination').trim().notEmpty().withMessage('Destination is required'),
  body('scheduledAt').isISO8601().withMessage('scheduledAt must be a valid ISO 8601 datetime'),
  body('seatCount').optional().isInt({ min: 1, max: 6 }),
  body('pickupLat').optional().isFloat({ min: -90, max: 90 }),
  body('pickupLng').optional().isFloat({ min: -180, max: 180 }),
  validate,
  tripsController.requestTrip
);

// POST /v1/trips/schedule — schedule a future trip (rider)
router.post(
  '/schedule',
  authenticate,
  body('routeId').notEmpty(),
  body('scheduledAt').isISO8601().withMessage('scheduledAt must be an ISO 8601 datetime'),
  body('seatCount').optional().isInt({ min: 1, max: 4 }),
  validate,
  tripsController.scheduleTrip
);

// ── Driver-only state transitions ────────────────────────────
router.post('/:id/driver-no-show', authenticateDriver, tripsController.driverNoShow);
router.post('/:id/rider-no-show/:bookingId', authenticateDriver, tripsController.riderNoShow);

module.exports = router;
