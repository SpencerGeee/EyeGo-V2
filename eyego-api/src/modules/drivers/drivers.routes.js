'use strict';

const { Router } = require('express');
const controller = require('./drivers.controller');
const { authenticateDriver, requireActiveDriver } = require('../../middleware/driverAuth');
const { requireDriverOnlineEnabled } = require('../../middleware/killSwitch');
const { body } = require('express-validator');
const validate = require('../../middleware/validate');
const idempotency = require('../../middleware/idempotency');
// Driver document photos. A bare `multer()` accepted any file of any size
// straight into process memory — see middleware/upload.js.
const { imageUpload: upload } = require('../../middleware/upload');

const router = Router();

router.use(authenticateDriver);

// Profile
router.get('/me', controller.getMe);
router.patch('/me', controller.updateMe);
router.delete('/me', controller.deleteMe);
router.post('/fcm-token', body('fcmToken').notEmpty(), validate, controller.updateFcmToken);
router.post('/verify', controller.completeVerification);
router.post('/vehicle', requireActiveDriver, controller.addVehicle);

// Dev-only self-activation (skips PENDING_REVIEW for testing)
router.post('/dev-activate', controller.devActivate);

// Online/offline
// `requireDriverOnlineEnabled` is the maintenance-window switch the admin
// console's Apps page exposes — see middleware/killSwitch.js. Deliberately NOT
// on go-offline or on any in-trip route: closing the platform must never trap a
// driver online or strand them mid-trip.
router.post('/go-online', requireActiveDriver, requireDriverOnlineEnabled, controller.goOnline);
router.post('/go-offline', controller.goOffline);
// Presence over HTTP — the non-socket path into the dispatch pool. Beat this
// from the driver app whenever the websocket is not connected; see
// drivers.service.recordPresence.
router.post('/presence', requireActiveDriver, controller.presence);

// Performance & ratings
router.get('/performance', controller.getPerformance);
router.get('/ratings', controller.getRatings);
router.get('/documents', controller.getDocuments);
router.post('/documents', upload.single('file'), controller.uploadDocument);

// Emergency contact
router.patch('/emergency-contact', controller.updateEmergencyContact);

// Preferences
router.patch('/preferences', controller.updatePreferences);

// Trips
router.get('/fare-estimate', controller.getFareEstimate);
// Publishing a trip is a create, so a replayed request means a duplicate trip
// on every rider's home screen. The client sends a per-attempt Idempotency-Key
// (drivers.api.ts createTrip); this replays the original response instead of
// creating a second Trip row. Requests without the header still pass through,
// so older installs keep working.
router.post('/trips', requireActiveDriver, idempotency, controller.createTrip);
router.get('/trips', controller.getTripHistory);
router.get('/trips/all', controller.getAllTrips);
router.get('/trips/active', controller.getActiveTrip);
router.get('/trips/:id', controller.getTripById);
router.post('/trips/:id/start', requireActiveDriver, controller.startTrip);
router.post('/trips/:id/arrive-at-pickup', requireActiveDriver, controller.arriveAtPickup);
router.post('/trips/:id/depart', requireActiveDriver, controller.departTrip);
router.post('/trips/:id/arrive', requireActiveDriver, controller.arriveTrip);
router.post('/trips/:id/emergency', controller.emergencyAlert);
router.post('/trips/:id/accept', requireActiveDriver, controller.acceptDispatch);
// A trip a previous driver bailed on pre-boarding (see drivers.service.js
// redispatchTrip) — first online nearby driver to claim it takes over.
router.post('/trips/:id/claim-reassignment', requireActiveDriver, controller.claimReassignedTrip);
router.post('/trips/:id/decline', controller.declineDispatch);

// On-demand trip requests (rider "Request a Trip" flow)
// Reliable POLL fallback for pending on-demand requests (socket/FCM dispatch is
// racy/fire-and-forget). Registered before /:id/accept so "pending" isn't
// treated as a request id.
router.get('/trip-requests/pending', controller.getPendingTripRequests);
router.post('/trip-requests/:id/accept', requireActiveDriver, controller.acceptTripRequest);
// Declining advances the dispatch cascade to the next driver immediately
// instead of making the rider wait out this driver's offer timeout.
router.post('/trip-requests/:id/decline', controller.declineTripRequest);

// Upcoming scheduled trips this driver is matched to (scheduled-ride awareness).
router.get('/scheduled/upcoming', controller.getUpcomingScheduled);

// Offline passenger flow
router.post(
  '/trips/:id/add-offline-passenger',
  requireActiveDriver,
  body('seatNumber').isInt({ min: 1 }),
  body('phone').notEmpty(),
  validate,
  controller.addOfflinePassenger
);

router.post(
  '/trips/:id/add-cash-no-phone',
  requireActiveDriver,
  body('seatNumber').isInt({ min: 1 }),
  validate,
  controller.addCashNoPhone
);

router.post(
  '/trips/:id/verify-otp',
  requireActiveDriver,
  body('bookingId').notEmpty(),
  body('otp').isLength({ min: 4, max: 4 }),
  validate,
  controller.verifyOfflineOtp
);

// Abandon an unverified Phone + OTP hold and give the seat straight back. The
// driver app calls this when the OTP screen is dismissed without verifying.
router.post(
  '/trips/:id/offline-hold/:bookingId/release',
  requireActiveDriver,
  controller.releaseOfflineHold,
);

router.post('/trips/:id/board/:bookingId', requireActiveDriver, controller.boardPassenger);
// "Ask the rider for their code" — raises the Verify My Ride popup on the
// rider's tracking screen. Separate from the board call because the driver taps
// it BEFORE they have a code to send. See publishBoardingPinRequested.
router.post('/trips/:id/board/:bookingId/request-pin', requireActiveDriver, controller.requestBoardingPin);
// Pause/resume back-to-back offers without going offline. Not gated on
// requireActiveDriver: a driver whose documents have lapsed still gets to stop
// the pings.
router.patch('/requests-paused', controller.setRequestsPaused);
router.post('/trips/:id/cancel', controller.cancelTrip);
router.post(
  '/trips/:id/report',
  body('type').notEmpty().withMessage('Report type is required'),
  body('details').optional().trim(),
  body('bookingId').optional().isString(),
  validate,
  controller.reportTrip,
);

// ── Rate passenger ────────────────────────────────────────────────
router.post('/rate-passenger/:bookingId', controller.ratePassenger);

// ── Destination Filter ────────────────────────────────────────────
router.get('/destination-filter', controller.getDestinationFilter);
router.post('/destination-filter', controller.setDestinationFilter);
router.delete('/destination-filter', controller.deleteDestinationFilter);

// ── Shift Tracking ────────────────────────────────────────────────
router.post('/shifts/start', controller.startShift);
router.post('/shifts/end', controller.endShift);
router.get('/shifts/current', controller.getCurrentShift);
router.get('/shifts/history', controller.getShiftHistory);

// ── Earnings ──────────────────────────────────────────────────────
router.get('/earnings/breakdown', controller.getEarningsBreakdown);
router.get('/earnings/transactions', controller.getWalletTransactions);

// ── Notifications ─────────────────────────────────────────────────
router.get('/notifications', controller.getNotifications);

// ── Support Tickets ───────────────────────────────────────────────
router.get('/support-tickets', controller.getSupportTickets);
router.post('/support-tickets', controller.createSupportTicket);
router.post('/support-tickets/:ticketId/reply', controller.replyToTicket);

// ── Vehicle Inspections ───────────────────────────────────────────
router.get('/inspections', controller.getInspections);
router.post('/inspections', controller.scheduleInspection);

// ── Destination mode ──────────────────────────────────────────────
// "I'm heading home — only send me rides going my way."
// See services/destination-mode.service.js for the matching rule and why the
// allowance is rationed.
router.get('/destination', controller.getDestinationMode);
router.post('/destination', requireActiveDriver, controller.setDestinationMode);
router.delete('/destination', controller.clearDestinationMode);

module.exports = router;
