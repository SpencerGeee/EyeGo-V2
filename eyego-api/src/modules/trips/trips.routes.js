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
// GET /v1/trips/scheduled — rider's own scheduled ride intents. MUST be
// registered before the generic '/:id' route below: Express matches routes
// in registration order, and '/:id' is a single dynamic segment that was
// silently swallowing GET /trips/scheduled (id="scheduled") — the request
// never reached getScheduledRides, it 404'd inside getTrip instead, and the
// rider-side query silently fell back to an empty list ("no scheduled rides
// yet") even though the POST /trips/schedule that created the ride had
// already succeeded.
router.get('/scheduled', authenticate, tripsController.getScheduledRides);
router.get('/:id', authenticate, tripsController.getTrip);
router.get('/:id/contact', authenticate, tripsController.getTripContact);
router.get('/:id/seats', authenticate, tripsController.getSeatMap);
router.get('/:id/receipt', authenticate, tripsController.getTripReceipt);
// Group-hub joiner picking their own pickup point — preview the deviation
// surcharge (if any) before they commit to booking at that spot.
router.get('/:id/deviation-estimate', authenticate, tripsController.getDeviationEstimate);

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

// POST /v1/trips/:id/live-activity-token — rider registers/refreshes the
// ActivityKit push token for their lock-screen Live Activity on this trip.
// Separate channel from the FCM device token (see users.routes.js) — this
// one is consumed only by live-activity-push.service.js (direct APNs).
router.post(
  '/:id/live-activity-token',
  authenticate,
  body('pushToken').isString().notEmpty().withMessage('pushToken is required'),
  body('activityId').optional().isString(),
  validate,
  tripsController.saveLiveActivityToken
);

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
  body('destLat').optional().isFloat({ min: -90, max: 90 }),
  body('destLng').optional().isFloat({ min: -180, max: 180 }),
  validate,
  tripsController.requestTrip
);

// GET /v1/trips/request/:id — rider polls/checks status of a pending trip request
router.get('/request/:id', authenticate, tripsController.getTripRequestStatus);

// DELETE /v1/trips/request/:id — rider cancels a still-pending on-demand request
router.delete('/request/:id', authenticate, tripsController.cancelTripRequest);

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

// DELETE /v1/trips/scheduled/:id — cancel a pending scheduled ride
router.delete('/scheduled/:id', authenticate, tripsController.cancelScheduledRide);

// ── Driver-only state transitions ────────────────────────────
router.post('/:id/driver-no-show', authenticateDriver, tripsController.driverNoShow);
router.post('/:id/rider-no-show/:bookingId', authenticateDriver, tripsController.riderNoShow);

module.exports = router;
