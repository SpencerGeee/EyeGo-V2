'use strict';

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('./admin.controller');
const authenticateAdmin = require('../../middleware/adminAuth');

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many admin requests',
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter limiter for auth-like admin endpoints (approve/suspend/reject/ban)
const adminActionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
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

router.post('/drivers/:id/approve', adminActionLimiter, controller.approveDriver);
router.post('/drivers/:id/suspend', adminActionLimiter, controller.suspendDriver);
router.post('/drivers/:id/reject', adminActionLimiter, controller.rejectDriver);
router.post('/users/:id/ban', adminActionLimiter, controller.banUser);

router.get('/routes', controller.getRoutes);
router.post('/routes', controller.createRoute);
router.put('/routes/:id', controller.updateRoute);
router.delete('/routes/:id', controller.deleteRoute);
router.post('/routes/:id/stops', controller.addStops);

router.get('/pulse-schedules', controller.getPulseSchedules);
router.post('/pulse-schedules', controller.createPulseSchedule);

router.get('/trips', controller.getTrips);
router.get('/bookings', controller.getBookings);

router.get('/support-tickets', controller.getSupportTickets);
router.post('/support-tickets/:id/respond', controller.respondToTicket);
router.post('/support-tickets/:id/close', controller.closeTicket);

// Driver trip reports (previously persisted but never surfaced to admin)
router.get('/trip-reports', controller.getTripReports);

router.get('/promotions', controller.getPromotions);
router.post('/promotions', controller.createPromotion);
router.post('/promotions/:id/toggle', controller.togglePromotion);

// Register admin device for SOS push alerts
router.post('/fcm-token', controller.registerAdminFcmToken);

module.exports = router;
