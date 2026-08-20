'use strict';

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('./admin.controller');
const authenticateAdmin = require('../../middleware/adminAuth');
const { requireRole, denyReadOnlyWrites, ROLE } = require('../../middleware/adminRbac');
const { audit } = require('../../middleware/adminAudit');

// One dashboard refresh fires ~10 parallel reads and the live map polls
// /live/drivers every 15s (60 req / 15 min on its own) — the previous cap of
// 20/15min guaranteed 429s within a minute of normal use. This limiter only
// needs to stop brute-forcing, not throttle a logged-in admin, so keep it
// generous.
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

// Sign-in is the one unauthenticated surface here, so it gets its own tight
// budget. Per-account lockout lives in adminAuth.service; this is the per-IP
// layer that stops someone spraying many accounts from one host.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many sign-in attempts. Try again shortly.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

const router = Router();

// ── Unauthenticated: sign-in and token rotation ─────────────────
router.post('/auth/login', loginLimiter, controller.login);
router.post('/auth/refresh', loginLimiter, controller.refreshSession);

// ── Everything below requires a console identity ────────────────
router.use(adminLimiter);
router.use(authenticateAdmin);
// Blanket write guard: a newly added mutating route is denied to VIEWER by
// default rather than being open until someone remembers to annotate it.
router.use(denyReadOnlyWrites);

router.post('/auth/logout', controller.logout);
router.get('/auth/me', controller.me);
router.post('/auth/change-password', audit('admin.change_password', { targetType: 'AdminUser' }), controller.changePassword);

// ── Admin account management (superadmin only) ───────────────────
router.get('/admins', requireRole(), controller.listAdmins);
router.post('/admins', requireRole(), adminActionLimiter, audit('admin.create', { targetType: 'AdminUser' }), controller.createAdmin);
router.patch('/admins/:id', requireRole(), adminActionLimiter, audit('admin.update', { targetType: 'AdminUser' }), controller.updateAdmin);
router.post('/admins/:id/reset-password', requireRole(), adminActionLimiter, audit('admin.reset_password', { targetType: 'AdminUser' }), controller.resetAdminPassword);

// Auditors need the log without needing the power to change anything.
router.get('/audit-logs', requireRole(ROLE.VIEWER), controller.getAuditLogs);

// ── Fleet: read ─────────────────────────────────────────────────
router.get('/drivers/pending', controller.getPendingDrivers);
// Live map: online drivers with a known GPS fix. Registered before /:id so
// "live" is not swallowed by the :id param route.
router.get('/drivers/live', controller.getLiveDriversMap);
router.get('/drivers', controller.getAllDrivers);
router.get('/drivers/:id', controller.getDriverDetail);
router.get('/drivers/:id/trips', controller.getDriverTrips);
router.get('/users', controller.getAllUsers);
router.get('/users/:id', controller.getUserDetail);
router.get('/users/:id/trips', controller.getUserTrips);
router.get('/metrics', controller.getMetrics);

// ── Analytics dashboards ────────────────────────────────────────
router.get('/analytics/overview', controller.getAnalyticsOverview);
router.get('/analytics/drivers', controller.getAnalyticsDrivers);
router.get('/analytics/safety', controller.getAnalyticsSafety);
router.get('/analytics/scheduled', controller.getAnalyticsScheduled);

router.get('/trips/active', controller.getActiveTrips);
// The zone directory. Declared BEFORE the `:zoneId` routes below so `zones` is
// never captured as a zone id.
router.get('/surge/zones', controller.getSurgeZones);
router.get('/surge/resolve', controller.resolveSurgeZone);
router.post('/surge/:zoneId', requireRole(ROLE.OPS), adminActionLimiter, audit('surge.set', { targetType: 'Zone', targetParam: 'zoneId' }), controller.setSurge);

// ── Dispatch / Live Map ─────────────────────────────────────────
router.get('/live/drivers', controller.getLiveDrivers);
// Why dispatch is or is not matching: the Redis supply pool vs what Postgres
// considers eligible, per driver, with the reason for every exclusion.
router.get('/dispatch/health', controller.getDispatchHealth);
router.get('/trips/unassigned', controller.getUnassignedTrips);
router.post('/trips/:id/assign', requireRole(ROLE.OPS), adminActionLimiter, audit('trip.assign', { targetType: 'Trip' }), controller.assignDriver);

// ── Fleet: moderation ───────────────────────────────────────────
router.post('/drivers/:id/documents/:type/review', requireRole(ROLE.OPS), adminActionLimiter, audit('driver.document_review', { targetType: 'Driver' }), controller.reviewDriverDocument);
router.post('/drivers/:id/approve', requireRole(ROLE.OPS), adminActionLimiter, audit('driver.approve', { targetType: 'Driver' }), controller.approveDriver);
router.post('/drivers/:id/suspend', requireRole(ROLE.OPS), adminActionLimiter, audit('driver.suspend', { targetType: 'Driver' }), controller.suspendDriver);
router.post('/drivers/:id/reject', requireRole(ROLE.OPS), adminActionLimiter, audit('driver.reject', { targetType: 'Driver' }), controller.rejectDriver);
router.post('/users/:id/ban', requireRole(ROLE.OPS, ROLE.SUPPORT), adminActionLimiter, audit('user.ban', { targetType: 'User' }), controller.banUser);
router.post('/users/:id/unban', requireRole(ROLE.OPS, ROLE.SUPPORT), adminActionLimiter, audit('user.unban', { targetType: 'User' }), controller.unbanUser);

// Route CRUD removed in group/on-demand pivot — admin no longer manages fixed
// routes. Routes are an internal-only concept (trips reuse the Prisma Route
// model as ad-hoc rows created during dispatch/accept).

router.get('/pulse-schedules', controller.getPulseSchedules);
router.post('/pulse-schedules', requireRole(ROLE.OPS), audit('pulse_schedule.create', { targetType: 'PulseSchedule' }), controller.createPulseSchedule);
router.delete('/pulse-schedules/:id', requireRole(ROLE.OPS), adminActionLimiter, audit('pulse_schedule.delete', { targetType: 'PulseSchedule' }), controller.deletePulseSchedule);

router.get('/trips', controller.getTrips);
// Registered after /trips/active and /trips/unassigned above, so those literal
// paths are not swallowed by this :id param route.
router.get('/trips/:id', controller.getTripDetail);
router.get('/bookings', controller.getBookings);

// ── Support ─────────────────────────────────────────────────────
router.get('/support-tickets', controller.getSupportTickets);
router.get('/support-tickets/:id', controller.getSupportTicketDetail);
router.post('/support-tickets/:id/respond', requireRole(ROLE.SUPPORT, ROLE.OPS), audit('ticket.respond', { targetType: 'SupportTicket' }), controller.respondToTicket);
router.post('/support-tickets/:id/close', requireRole(ROLE.SUPPORT, ROLE.OPS), audit('ticket.close', { targetType: 'SupportTicket' }), controller.closeTicket);

// Driver trip reports (previously persisted but never surfaced to admin)
router.get('/trip-reports', controller.getTripReports);
router.post('/trip-reports/:id/resolve', requireRole(ROLE.SUPPORT, ROLE.OPS), adminActionLimiter, audit('trip_report.resolve', { targetType: 'TripReport' }), controller.resolveTripReport);

// SOS / safety events (previously written by both apps but never queryable)
router.get('/sos-events', controller.getSosEvents);
// Is the escalation path actually wired up? Read-only, and open to every
// console role on purpose: anyone looking at this queue should be able to see
// that nobody would be woken if an alert came in right now.
router.get('/sos-events/alerting-health', controller.getSosAlertingHealth);
router.post('/sos-events/:id/acknowledge', requireRole(ROLE.SUPPORT, ROLE.OPS), adminActionLimiter, audit('sos.acknowledge', { targetType: 'SosEvent' }), controller.acknowledgeSosEvent);
router.post('/sos-events/:id/release', requireRole(ROLE.SUPPORT, ROLE.OPS), adminActionLimiter, audit('sos.release', { targetType: 'SosEvent' }), controller.releaseSosEvent);
router.post('/sos-events/:id/resolve', requireRole(ROLE.SUPPORT, ROLE.OPS), adminActionLimiter, audit('sos.resolve', { targetType: 'SosEvent' }), controller.resolveSosEvent);

// ── Platform configuration ──────────────────────────────────────
// Fares, commission, dispatch tuning and the in-app announcement, changeable
// live. Reading is open to any console role (an operator should be able to see
// what a ride costs); writing is superadmin or finance, because these numbers
// price real rides the moment they land, and every write is audited.
router.get('/settings', controller.getPlatformSettings);
router.patch(
  '/settings',
  requireRole(ROLE.FINANCE),
  adminActionLimiter,
  audit('platform_settings.update', { targetType: 'PlatformSetting' }),
  controller.updatePlatformSettings,
);

// ── Money ───────────────────────────────────────────────────────
router.get('/promotions', controller.getPromotions);
router.post('/promotions', requireRole(ROLE.FINANCE), audit('promotion.create', { targetType: 'Promotion' }), controller.createPromotion);
router.post('/promotions/:id/toggle', requireRole(ROLE.FINANCE), audit('promotion.toggle', { targetType: 'Promotion' }), controller.togglePromotion);

// Register admin device for SOS push alerts
router.post('/fcm-token', controller.registerAdminFcmToken);

// ── OTA Deploy console (superadmin only: this ships code to real phones) ──
router.get('/ota/overview', controller.getOtaOverview);
router.get('/ota/runs', controller.getOtaRuns);
router.post('/ota/publish', requireRole(), adminActionLimiter, audit('ota.publish', { targetType: 'OtaRun', targetParam: 'app' }), controller.publishOta);

// ── Refunds and wallet adjustments ──────────────────────────────
//
// FINANCE (and superadmin) only. These move real money out of the business and
// into a customer's hands, which is a different kind of power from approving a
// driver — an OPS lead can put someone on the road but cannot pay them.
// Reading what has been refunded is open to SUPPORT too, because the agent on
// the call needs to know whether this was already dealt with.
router.get('/refunds', requireRole(ROLE.SUPPORT, ROLE.FINANCE, ROLE.OPS), controller.listRefunds);
router.get('/bookings/:id/refundable', requireRole(ROLE.SUPPORT, ROLE.FINANCE, ROLE.OPS), controller.getRefundable);
router.post('/bookings/:id/refund', requireRole(ROLE.FINANCE), adminActionLimiter, audit('refund.issue', { targetType: 'Booking' }), controller.issueRefund);

router.get('/users/:id/wallet', requireRole(ROLE.SUPPORT, ROLE.FINANCE, ROLE.OPS), controller.getRiderWallet);
router.post('/users/:id/wallet-adjust', requireRole(ROLE.FINANCE), adminActionLimiter, audit('wallet.adjust_rider', { targetType: 'User' }), controller.adjustRiderWallet);
router.post('/drivers/:id/wallet-adjust', requireRole(ROLE.FINANCE), adminActionLimiter, audit('wallet.adjust_driver', { targetType: 'Driver' }), controller.adjustDriverWallet);

// ── Case notes ──────────────────────────────────────────────────
// Any role that can act on a record can annotate it; VIEWER is refused writes
// by the blanket guard at the top of this file.
router.get('/notes/:subjectType/:subjectId', controller.listNotes);
router.post('/notes/:subjectType/:subjectId', adminActionLimiter, audit('note.add', { targetType: 'AdminNote' }), controller.addNote);
router.delete('/notes/:id', adminActionLimiter, audit('note.delete', { targetType: 'AdminNote' }), controller.deleteNote);

// ── Global search ───────────────────────────────────────────────
router.get('/search', controller.globalSearch);

// ── Bulk fleet actions ──────────────────────────────────────────
router.post('/drivers/bulk', requireRole(ROLE.OPS), adminActionLimiter, audit('driver.bulk_action', { targetType: 'Driver' }), controller.bulkDriverAction);

// ── CSV export ──────────────────────────────────────────────────
//
// Every export is audited. Taking a copy of the customer table out of the
// system is exactly the action an investigation later asks about, and "who
// exported what, when" has to be answerable.
router.get('/export', controller.listExports);
router.get('/export/:dataset', audit('data.export', { targetType: 'Export', targetParam: 'dataset' }), controller.exportCsv);

// ── Two-factor authentication ───────────────────────────────────
// Acting on your OWN account, so no role gate — every operator may enrol, and
// under ADMIN_MFA_REQUIRED every operator must.
router.get('/auth/totp', controller.getTotpStatus);
router.post('/auth/totp/begin', adminActionLimiter, audit('admin.totp_begin', { targetType: 'AdminUser' }), controller.beginTotpEnrolment);
router.post('/auth/totp/confirm', adminActionLimiter, audit('admin.totp_enable', { targetType: 'AdminUser' }), controller.confirmTotpEnrolment);
router.post('/auth/totp/disable', adminActionLimiter, audit('admin.totp_disable', { targetType: 'AdminUser' }), controller.disableTotp);
// Clearing SOMEBODY ELSE'S second factor is a superadmin act — it is the
// lost-phone path, and it is also the shape an account takeover would use.
router.post('/admins/:id/reset-totp', requireRole(), adminActionLimiter, audit('admin.totp_reset', { targetType: 'AdminUser' }), controller.resetAdminTotp);

module.exports = router;
