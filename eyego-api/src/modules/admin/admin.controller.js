'use strict';

const { formatGhs, percentOf, assertPesewas } = require('../../utils/money');

const adminService = require('./admin.service');
const driversService = require('../drivers/drivers.service');
const env = require('../../config/env');
const { ok, created } = require('../../utils/response');
const logger = require('../../utils/logger');

const reviewDriverDocument = async (req, res) => {
  const { approve, rejectionReason } = req.body;
  const result = await driversService.reviewDocument(req.params.id, req.params.type, { approve: !!approve, rejectionReason });
  ok(res, { review: result }, approve ? 'Document approved' : 'Document rejected');
};

const approveDriver = async (req, res) => {
  const driver = await adminService.approveDriver(req.params.id);
  ok(res, { driver }, 'Driver approved');
};

const suspendDriver = async (req, res) => {
  const driver = await adminService.suspendDriver(req.params.id, req.body.reason);
  ok(res, { driver }, 'Driver suspended');
};

// Route CRUD handlers removed in group/on-demand pivot (admin no longer
// manages fixed routes). The underlying adminService route helpers remain for
// internal reuse but are no longer exposed via HTTP.

const getPulseSchedules = async (req, res) => {
  const schedules = await adminService.getAllPulseSchedules();
  ok(res, { schedules });
};

const createPulseSchedule = async (req, res) => {
  const schedule = await adminService.createPulseSchedule(req.body);
  created(res, { schedule }, 'Pulse schedule created');
};

const getTrips = async (req, res) => {
  const result = await adminService.getAllTrips(req.query);
  ok(res, result);
};

const getBookings = async (req, res) => {
  const result = await adminService.getAllBookings(req.query);
  ok(res, result);
};

const getPendingDrivers = async (req, res) => {
  const drivers = await adminService.getPendingDrivers();
  ok(res, { drivers });
};

const getAllDrivers = async (req, res) => {
  const result = await adminService.getAllDrivers(req.query);
  // BUGFIX: this dropped total/page/limit even though adminService already computes
  // them — harmless only because the console always requests limit=500 with no
  // pagination UI of its own; the moment driver count exceeds that, the remainder
  // silently never appears with nothing on screen revealing the truncation.
  ok(res, { drivers: result.data, total: result.total, page: result.page, limit: result.limit });
};

const getAllUsers = async (req, res) => {
  const result = await adminService.getAllUsers(req.query);
  ok(res, { users: result.data, total: result.total, page: result.page, limit: result.limit });
};

const getDriverDetail = async (req, res) => {
  const driver = await adminService.getDriverDetail(req.params.id);
  ok(res, { driver });
};

const getTripDetail = async (req, res) => {
  const trip = await adminService.getTripDetail(req.params.id);
  ok(res, { trip });
};

const getDriverTrips = async (req, res) => {
  const result = await adminService.getDriverTrips(req.params.id, req.query);
  ok(res, result);
};

const getUserDetail = async (req, res) => {
  const user = await adminService.getUserDetail(req.params.id);
  ok(res, { user });
};

const getUserTrips = async (req, res) => {
  const result = await adminService.getUserTrips(req.params.id, req.query);
  ok(res, result);
};

const getSupportTickets = async (req, res) => {
  const result = await adminService.getSupportTickets(req.query);
  ok(res, result);
};

const getSupportTicketDetail = async (req, res) => {
  const ticket = await adminService.getSupportTicketDetail(req.params.id);
  ok(res, { ticket });
};

const getTripReports = async (req, res) => {
  const result = await adminService.getTripReports(req.query);
  ok(res, result);
};

const resolveTripReport = async (req, res) => {
  const report = await adminService.resolveTripReport(req.params.id);
  ok(res, { report }, 'Trip report resolved');
};

const respondToTicket = async (req, res) => {
  const message = await adminService.respondToTicket(req.params.id, req.body);
  ok(res, { message }, 'Response sent');
};

const closeTicket = async (req, res) => {
  await adminService.closeTicket(req.params.id);
  ok(res, null, 'Ticket closed');
};

const getPromotions = async (req, res) => {
  const promotions = await adminService.getPromotions();
  ok(res, { promotions });
};

const createPromotion = async (req, res) => {
  const promotion = await adminService.createPromotion(req.body);
  created(res, { promotion }, 'Promotion created');
};

const togglePromotion = async (req, res) => {
  const promotion = await adminService.togglePromotion(req.params.id);
  ok(res, { promotion }, 'Promotion toggled');
};

const rejectDriver = async (req, res) => {
  const driver = await adminService.rejectDriver(req.params.id, req.body.reason);
  ok(res, { driver }, 'Driver application rejected');
};

const banUser = async (req, res) => {
  await adminService.banUser(req.params.id, req.body.reason);
  ok(res, null, 'User banned');
};

const unbanUser = async (req, res) => {
  await adminService.unbanUser(req.params.id);
  ok(res, null, 'User unbanned');
};

const deletePulseSchedule = async (req, res) => {
  await adminService.deletePulseSchedule(req.params.id);
  ok(res, null, 'Pulse schedule deleted');
};

const getSosEvents = async (req, res) => {
  const result = await adminService.getSosEvents(req.query);
  ok(res, result);
};

const resolveSosEvent = async (req, res) => {
  const event = await adminService.resolveSosEvent(req.params.id, { outcome: req.body?.outcome }, req.admin);
  ok(res, { event }, 'SOS event resolved');
};

const getMetrics = async (req, res) => {
  const metrics = await adminService.getMetrics();
  ok(res, metrics);
};

const getActiveTrips = async (req, res) => {
  const trips = await adminService.getActiveTrips();
  ok(res, { trips });
};

const setSurge = async (req, res) => {
  const result = await adminService.setSurgeMultiplier(req.params.zoneId, Number(req.body.multiplier));
  ok(res, result);
};

/** The zone directory — see admin.service.getSurgeZones. */
const getSurgeZones = async (req, res) => {
  ok(res, await adminService.getSurgeZones());
};

/**
 * Which zone a map pin falls in. Lets the console offer "surge around here"
 * rather than making an operator round coordinates to 2dp themselves — the
 * exact hand-rounding that produces an id the fare path never reads.
 */
const resolveSurgeZone = async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new (require('../../utils/errors').AppError)('lat and lng are required', 400);
  }
  const surge = require('../trips/surge.service');
  ok(res, { zoneId: surge.zoneIdForCoords(lat, lng), lat, lng });
};

const registerAdminFcmToken = async (req, res) => {
  const { fcmToken } = req.body;
  if (!fcmToken) throw new (require('../../utils/errors').AppError)('fcmToken required', 400);
  const redis = require('../../config/redis');
  await redis.sadd('admin:fcm_tokens', fcmToken);
  ok(res, null, 'Admin FCM token registered');
};

// ── Dispatch / Live Map ──────────────────────────────────────────
const getLiveDrivers = async (req, res) => {
  const drivers = await adminService.getLiveDrivers();
  ok(res, { drivers });
};

const assignDriver = async (req, res) => {
  const { driverId } = req.body;
  if (!driverId) {
    throw new (require('../../utils/errors').AppError)('driverId is required', 400);
  }
  const trip = await adminService.assignDriverToTrip(req.params.id, driverId, req.admin?.userId || 'admin');
  
  // Emit socket event to the assigned driver
  try {
    const io = req.app.get('io');
    if (io) {
      const earnings = trip.bookings?.reduce((s, b) => s + (b.fareAmountPesewas || 0), 0) || 0;
      io.of('/driver').to(`driver:${driverId}`).emit('trip:assigned', {
        tripId: trip.id,
        tripShortId: trip.shortId?.slice(0, 8) || trip.id.slice(0, 8),
        routeOrigin: trip.route?.originName || '—',
        routeDestination: trip.route?.destinationName || '—',
        departureTime: trip.departureTime,
        estimatedEarningsPesewas: earnings - percentOf(earnings, env.PLATFORM_COMMISSION), // driver cut after platform commission
        seatCount: trip.maxSeats || 0,
        bookedCount: (trip.bookings || []).length,
        expiresAt: new Date(Date.now() + 120 * 1000).toISOString(), // 2 min to accept
      });
    }
  } catch (err) {
    console.error('Failed to emit dispatch socket:', err);
  }
  
  ok(res, { trip }, 'Driver assigned to trip');
};

const getUnassignedTrips = async (req, res) => {
  const trips = await adminService.getUnassignedTrips();
  ok(res, { trips });
};

// ── OTA Deploy console ───────────────────────────────────────────
const otaService = require('./ota.service');

const getOtaOverview = async (req, res) => {
  const overview = await otaService.getOverview();
  ok(res, overview);
};

const publishOta = async (req, res) => {
  const result = await otaService.dispatchOta(req.body, req.admin?.userId || 'admin');
  ok(res, result, result.action === 'republish' ? 'Rollback dispatched' : 'OTA publish dispatched');
};

const getOtaRuns = async (req, res) => {
  const runs = await otaService.getOtaRuns();
  ok(res, { runs });
};

// ── Analytics dashboards ─────────────────────────────────────────
const getAnalyticsOverview = async (req, res) => {
  const overview = await adminService.getAnalyticsOverview({ from: req.query.from, to: req.query.to });
  ok(res, overview);
};

const getAnalyticsDrivers = async (req, res) => {
  const analytics = await adminService.getAnalyticsDrivers();
  ok(res, analytics);
};

const getAnalyticsSafety = async (req, res) => {
  const analytics = await adminService.getAnalyticsSafety();
  ok(res, analytics);
};

const getAnalyticsScheduled = async (req, res) => {
  const analytics = await adminService.getAnalyticsScheduled();
  ok(res, analytics);
};

// ── Live driver positions (admin map) ────────────────────────────
const getPlatformSettings = async (req, res) => {
  const settings = await adminService.getPlatformSettings();
  ok(res, settings);
};

const updatePlatformSettings = async (req, res) => {
  const result = await adminService.updatePlatformSettings(req.body?.settings, {
    id: req.admin?.id ?? null,
    email: req.admin?.email ?? null,
  });
  ok(res, result, 'Settings applied — live immediately, no restart needed');
};

const getDispatchHealth = async (req, res) => {
  const health = await adminService.getDispatchHealth();
  ok(res, health);
};

const getLiveDriversMap = async (req, res) => {
  const drivers = await adminService.getLiveDriversMap();
  ok(res, { drivers });
};

// ── Console identity ─────────────────────────────────────────────
// Tokens are returned in the JSON body, not as Set-Cookie. The Next.js console
// is the only browser client and it keeps them in httpOnly cookies it sets
// itself, so the API stays a pure bearer-token service and needs no CORS
// credential dance or cookie parser.
const adminAuthService = require('./adminAuth.service');

const login = async (req, res) => {
  const { email, password, totpCode } = req.body;
  try {
    const result = await adminAuthService.login({
      email,
      password,
      totpCode,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    ok(res, result, 'Signed in');
  } catch (err) {
    // "Your password is right, now show me the code" is a distinct answer from
    // "wrong password", and the sign-in form has to be able to tell them apart
    // to draw the second step. It carries no token, so it grants nothing — and
    // it is only ever reached AFTER the password has already been verified, so
    // it leaks nothing an attacker did not already have.
    if (err?.totpRequired) {
      return res.status(401).json({
        success: false,
        code: err.code || 'TOTP_REQUIRED',
        totpRequired: true,
        message: err.message,
      });
    }
    throw err;
  }
};

const refreshSession = async (req, res) => {
  const result = await adminAuthService.refresh(req.body.refreshToken);
  ok(res, result);
};

const logout = async (req, res) => {
  // Prefer the caller's own session over a body-supplied id so one admin can
  // never revoke another admin's session by guessing a token id.
  await adminAuthService.logout(req.admin?.tokenId || req.body.tokenId);
  ok(res, null, 'Signed out');
};

const me = async (req, res) => {
  ok(res, { admin: req.admin });
};

const changePassword = async (req, res) => {
  if (!req.admin?.id) {
    throw new (require('../../utils/errors').ForbiddenError)(
      'The legacy shared-secret session has no password to change.'
    );
  }
  const result = await adminAuthService.changePassword(req.admin.id, req.body);
  ok(res, result, 'Password changed. Sign in again.');
};

const listAdmins = async (req, res) => {
  const admins = await adminAuthService.listAdmins();
  ok(res, { admins });
};

const createAdmin = async (req, res) => {
  const admin = await adminAuthService.createAdmin(req.body, req.admin?.id || null);
  created(res, { admin }, 'Admin created');
};

const updateAdmin = async (req, res) => {
  const admin = await adminAuthService.updateAdmin(req.params.id, req.body, req.admin?.id || null);
  ok(res, { admin }, 'Admin updated');
};

const resetAdminPassword = async (req, res) => {
  const result = await adminAuthService.resetAdminPassword(req.params.id, req.body.newPassword);
  ok(res, result, 'Password reset. The admin must change it at next sign-in.');
};

const getAuditLogs = async (req, res) => {
  const result = await adminAuthService.getAuditLogs(req.query);
  ok(res, result);
};

// ── SOS triage ───────────────────────────────────────────────────
const acknowledgeSosEvent = async (req, res) => {
  const event = await adminService.acknowledgeSosEvent(req.params.id, req.admin);
  ok(res, { event }, 'You are now handling this alert');
};

const releaseSosEvent = async (req, res) => {
  const event = await adminService.releaseSosEvent(req.params.id, req.admin);
  ok(res, { event }, 'Returned to the queue');
};

const getSosAlertingHealth = async (req, res) => {
  ok(res, await adminService.getSosAlertingHealth());
};

// ── Case notes ───────────────────────────────────────────────────
const listNotes = async (req, res) => {
  const notes = await adminService.listNotes(req.params.subjectType, req.params.subjectId);
  ok(res, { notes });
};

const addNote = async (req, res) => {
  const note = await adminService.addNote(
    req.params.subjectType, req.params.subjectId, req.body?.body, req.admin,
  );
  created(res, { note }, 'Note added');
};

const deleteNote = async (req, res) => {
  await adminService.deleteNote(req.params.id, req.admin);
  ok(res, null, 'Note retracted');
};

// ── Search and bulk ──────────────────────────────────────────────
const globalSearch = async (req, res) => {
  ok(res, await adminService.globalSearch(req.query.q, { limit: req.query.limit }));
};

const bulkDriverAction = async (req, res) => {
  const result = await adminService.bulkDriverAction(
    req.body?.driverIds, req.body?.action, { reason: req.body?.reason },
  );
  ok(res, result, `${result.succeeded.length} of ${result.total} updated`);
};

// ── Money ────────────────────────────────────────────────────────
const refunds = require('../../services/refunds.service');
const riderWallet = require('../../services/rider-wallet.service');

const getRefundable = async (req, res) => {
  ok(res, await refunds.refundableAmount(req.params.id));
};

const issueRefund = async (req, res) => {
  const refund = await refunds.issueRefund(req.params.id, {
    amountPesewas: req.body?.amountPesewas,
    reason: req.body?.reason,
    destination: req.body?.destination,
    admin: req.admin,
  });
  created(res, { refund }, refund.status === 'PENDING'
    ? 'Refund sent to the payment provider — it settles in a few days'
    : 'Refund credited to the rider\'s wallet');
};

const listRefunds = async (req, res) => {
  ok(res, await refunds.listRefunds(req.query));
};

const adjustRiderWallet = async (req, res) => {
  const tx = await adminService.adjustRiderWallet(req.params.id, req.body, req.admin);
  created(res, { transaction: tx }, 'Wallet adjusted');
};

const adjustDriverWallet = async (req, res) => {
  const tx = await adminService.adjustDriverWallet(req.params.id, req.body, req.admin);
  created(res, { transaction: tx }, 'Wallet adjusted');
};

const getRiderWallet = async (req, res) => {
  const [history, reconciliation] = await Promise.all([
    riderWallet.history(req.params.id, req.query),
    riderWallet.reconcile(req.params.id),
  ]);
  ok(res, { ...history, reconciliation });
};

// ── CSV export ───────────────────────────────────────────────────
const exportService = require('../../services/admin-export.service');
const { toCsv, contentDisposition } = require('../../utils/csv');

const listExports = async (req, res) => {
  ok(res, { datasets: exportService.listDatasets() });
};

const exportCsv = async (req, res) => {
  const { dataset, rows, columns, truncated, maxRows } = await exportService.buildExport(
    req.params.dataset, req.query,
  );
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `eyego-${req.params.dataset}-${stamp}.csv`;

  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', contentDisposition(filename));
  // Truncation is announced rather than silent — an export short by 12,000 rows
  // that looks complete is how a reconciliation goes wrong for a month.
  res.setHeader('x-eyego-row-count', String(rows.length));
  if (truncated) res.setHeader('x-eyego-truncated', `true; capped at ${maxRows}`);

  res.send(toCsv(rows, columns));

  logger.info('[ADMIN] data exported', {
    dataset: req.params.dataset, rows: rows.length, by: req.admin?.email, filters: req.query,
  });
  // `dataset` is read for its label only; keeping the reference makes the
  // intent of buildExport's return obvious at the call site.
  void dataset;
};

// ── Two-factor ───────────────────────────────────────────────────
const getTotpStatus = async (req, res) => {
  ok(res, await adminAuthService.getTotpStatus(req.admin.id));
};

const beginTotpEnrolment = async (req, res) => {
  const { secret, otpauthUri } = await adminAuthService.beginTotpEnrolment(req.admin.id);
  // The QR is rendered here rather than in the browser so the secret never has
  // to be handed to client JavaScript to be drawn.
  let qrDataUri = null;
  try {
    const QRCode = require('qrcode');
    qrDataUri = await QRCode.toDataURL(otpauthUri, { margin: 1, width: 240 });
  } catch (err) {
    logger.warn('[adminAuth] QR generation unavailable, falling back to the secret', { error: err.message });
  }
  ok(res, { secret, otpauthUri, qrDataUri }, 'Scan this, then confirm with a code');
};

const confirmTotpEnrolment = async (req, res) => {
  const result = await adminAuthService.confirmTotpEnrolment(req.admin.id, req.body?.code);
  ok(res, result, 'Two-factor is on. Save these recovery codes — they are not shown again.');
};

const disableTotp = async (req, res) => {
  ok(res, await adminAuthService.disableTotp(req.admin.id, req.body?.code), 'Two-factor switched off');
};

const resetAdminTotp = async (req, res) => {
  const result = await adminAuthService.resetTotpFor(req.params.id, req.admin);
  ok(res, result, 'Two-factor cleared and every session for that account signed out');
};

module.exports = {
  login, refreshSession, logout, me, changePassword,
  listAdmins, createAdmin, updateAdmin, resetAdminPassword, getAuditLogs,
  acknowledgeSosEvent, releaseSosEvent, getSosAlertingHealth,
  listNotes, addNote, deleteNote,
  globalSearch, bulkDriverAction,
  getRefundable, issueRefund, listRefunds,
  adjustRiderWallet, adjustDriverWallet, getRiderWallet,
  listExports, exportCsv,
  getTotpStatus, beginTotpEnrolment, confirmTotpEnrolment, disableTotp, resetAdminTotp,
  reviewDriverDocument,
  approveDriver, suspendDriver, rejectDriver, banUser, unbanUser,
  getMetrics, getActiveTrips, setSurge, getSurgeZones, resolveSurgeZone,
  getPulseSchedules, createPulseSchedule, deletePulseSchedule,
  getTrips, getBookings, getPendingDrivers, getAllDrivers, getAllUsers,
  getDriverDetail, getDriverTrips, getTripDetail,
  getUserDetail, getUserTrips,
  getSupportTickets, getSupportTicketDetail, getTripReports, resolveTripReport, respondToTicket, closeTicket,
  getPromotions, createPromotion, togglePromotion,
  registerAdminFcmToken,
  getLiveDrivers, assignDriver, getUnassignedTrips,
  getSosEvents, resolveSosEvent,
  getOtaOverview, publishOta, getOtaRuns,
  getAnalyticsOverview, getAnalyticsDrivers, getAnalyticsSafety, getAnalyticsScheduled,
  getLiveDriversMap,
  getDispatchHealth,
  getPlatformSettings,
  updatePlatformSettings,
};
