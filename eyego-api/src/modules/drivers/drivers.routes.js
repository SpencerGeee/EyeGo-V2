'use strict';

const { Router } = require('express');
const controller = require('./drivers.controller');
const { authenticateDriver, requireActiveDriver } = require('../../middleware/driverAuth');
const { body } = require('express-validator');
const validate = require('../../middleware/validate');
const multer = require('multer');

const upload = multer();

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
router.post('/go-online', requireActiveDriver, controller.goOnline);
router.post('/go-offline', controller.goOffline);

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
router.post('/trips', requireActiveDriver, controller.createTrip);
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
router.post('/trips/:id/decline', controller.declineDispatch);

// On-demand trip requests (rider "Request a Trip" flow)
router.post('/trip-requests/:id/accept', requireActiveDriver, controller.acceptTripRequest);

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

router.post('/trips/:id/board/:bookingId', requireActiveDriver, controller.boardPassenger);
router.post('/trips/:id/cancel', controller.cancelTrip);
router.post(
  '/trips/:id/report',
  body('type').notEmpty().withMessage('Report type is required'),
  body('details').optional().trim(),
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

module.exports = router;
