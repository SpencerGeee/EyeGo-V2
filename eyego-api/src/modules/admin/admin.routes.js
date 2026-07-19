'use strict';

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('./admin.controller');
const authenticateAdmin = require('../../middleware/adminAuth');

// One dashboard refresh fires ~10 parallel reads and the live map polls
// /live/drivers every 15s (60 req / 15 min on its own) — the previous cap of
// 20/15min guaranteed 429s within a minute of normal use. This limiter only
// needs to stop brute-forcing of x-admin-secret, not throttle a logged-in
// admin, so keep it generous.
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  message: 'Too many admin requests',
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter limiter for destructive admin actions (approve/suspend/reject/ban/
// review). Sized so a real review session (e.g. a fleet of drivers x 3 docs
// each) doesn't lock the admin out mid-task.
const adminActionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 300,
  message: 'Too many admin actions. Slow down.',
});

const router = Router();

router.use(adminLimiter);
router.use(authenticateAdmin);

router.get('/drivers/pending', controller.getPendingDrivers);
router.get('/drivers', controller.getAllDrivers);
router.get('/drivers/:id', controller.getDriverDetail);
router.get('/drivers/:id/trips', controller.getDriverTrips);
router.get('/users', controller.getAllUsers);
router.get('/users/:id', controller.getUserDetail);
router.get('/users/:id/trips', controller.getUserTrips);
router.get('/metrics', controller.getMetrics);
router.get('/trips/active', controller.getActiveTrips);
router.post('/surge/:zoneId', controller.setSurge);

// ── Dispatch / Live Map ─────────────────────────────────────────
router.get('/live/drivers', controller.getLiveDrivers);
router.get('/trips/unassigned', controller.getUnassignedTrips);
router.post('/trips/:id/assign', adminActionLimiter, controller.assignDriver);

router.post('/drivers/:id/documents/:type/review', adminActionLimiter, controller.reviewDriverDocument);
router.post('/drivers/:id/approve', adminActionLimiter, controller.approveDriver);
router.post('/drivers/:id/suspend', adminActionLimiter, controller.suspendDriver);
router.post('/drivers/:id/reject', adminActionLimiter, controller.rejectDriver);
router.post('/users/:id/ban', adminActionLimiter, controller.banUser);
router.post('/users/:id/unban', adminActionLimiter, controller.unbanUser);

router.get('/routes', controller.getRoutes);
router.post('/routes', controller.createRoute);
router.put('/routes/:id', controller.updateRoute);
router.delete('/routes/:id', controller.deleteRoute);
router.post('/routes/:id/stops', controller.addStops);

router.get('/pulse-schedules', controller.getPulseSchedules);
router.post('/pulse-schedules', controller.createPulseSchedule);
router.delete('/pulse-schedules/:id', adminActionLimiter, controller.deletePulseSchedule);

router.get('/trips', controller.getTrips);
router.get('/bookings', controller.getBookings);

router.get('/support-tickets', controller.getSupportTickets);
router.post('/support-tickets/:id/respond', controller.respondToTicket);
router.post('/support-tickets/:id/close', controller.closeTicket);

// Driver trip reports (previously persisted but never surfaced to admin)
router.get('/trip-reports', controller.getTripReports);
router.post('/trip-reports/:id/resolve', adminActionLimiter, controller.resolveTripReport);

// SOS / safety events (previously written by both apps but never queryable)
router.get('/sos-events', controller.getSosEvents);
router.post('/sos-events/:id/resolve', adminActionLimiter, controller.resolveSosEvent);

router.get('/promotions', controller.getPromotions);
router.post('/promotions', controller.createPromotion);
router.post('/promotions/:id/toggle', controller.togglePromotion);

// Register admin device for SOS push alerts
router.post('/fcm-token', controller.registerAdminFcmToken);

module.exports = router;
