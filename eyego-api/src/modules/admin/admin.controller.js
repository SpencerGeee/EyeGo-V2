'use strict';

const { formatGhs, percentOf, assertPesewas } = require('../../utils/money');

const adminService = require('./admin.service');
const driversService = require('../drivers/drivers.service');
const env = require('../../config/env');
const { ok, created } = require('../../utils/response');

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
  const event = await adminService.resolveSosEvent(req.params.id);
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
  const overview = await adminService.getAnalyticsOverview();
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
  const { email, password } = req.body;
  const result = await adminAuthService.login({
    email,
    password,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
  ok(res, result, 'Signed in');
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

module.exports = {
  login, refreshSession, logout, me, changePassword,
  listAdmins, createAdmin, updateAdmin, resetAdminPassword, getAuditLogs,
  reviewDriverDocument,
  approveDriver, suspendDriver, rejectDriver, banUser, unbanUser,
  getMetrics, getActiveTrips, setSurge,
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
};
