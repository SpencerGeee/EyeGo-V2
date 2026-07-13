'use strict';

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

const getRoutes = async (req, res) => {
  const result = await adminService.getRoutes();
  ok(res, result);
};

const createRoute = async (req, res) => {
  const route = await adminService.createRoute(req.body);
  created(res, { route }, 'Route created');
};

const addStops = async (req, res) => {
  await adminService.addVirtualStops(req.params.id, req.body.stops);
  ok(res, null, 'Stops added');
};

const updateRoute = async (req, res) => {
  const route = await adminService.updateRoute(req.params.id, req.body);
  ok(res, { route }, 'Route updated');
};

const deleteRoute = async (req, res) => {
  await adminService.deleteRoute(req.params.id);
  ok(res, null, 'Route deactivated');
};

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
  ok(res, { drivers: result.data });
};

const getAllUsers = async (req, res) => {
  const result = await adminService.getAllUsers(req.query);
  ok(res, { users: result.data });
};

const getDriverDetail = async (req, res) => {
  const driver = await adminService.getDriverDetail(req.params.id);
  ok(res, { driver });
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

const getTripReports = async (req, res) => {
  const result = await adminService.getTripReports(req.query);
  ok(res, result);
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
      const earnings = trip.bookings?.reduce((s, b) => s + (b.fareAmount || 0), 0) || 0;
      io.of('/driver').to(`driver:${driverId}`).emit('trip:assigned', {
        tripId: trip.id,
        tripShortId: trip.shortId?.slice(0, 8) || trip.id.slice(0, 8),
        routeOrigin: trip.route?.originName || '—',
        routeDestination: trip.route?.destinationName || '—',
        departureTime: trip.departureTime,
        estimatedEarnings: Math.round(earnings * (1 - env.PLATFORM_COMMISSION) * 100) / 100, // driver cut after platform commission
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

module.exports = {
  reviewDriverDocument,
  approveDriver, suspendDriver, rejectDriver, banUser,
  getMetrics, getActiveTrips, setSurge,
  createRoute, updateRoute, deleteRoute, addStops,
  getPulseSchedules, createPulseSchedule,
  getTrips, getBookings, getPendingDrivers, getAllDrivers, getAllUsers,
  getDriverDetail, getDriverTrips,
  getUserDetail, getUserTrips,
  getSupportTickets, getTripReports, respondToTicket, closeTicket,
  getRoutes,
  getPromotions, createPromotion, togglePromotion,
  registerAdminFcmToken,
  getLiveDrivers, assignDriver, getUnassignedTrips,
};
