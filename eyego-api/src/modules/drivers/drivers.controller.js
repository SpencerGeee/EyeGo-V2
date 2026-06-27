'use strict';

const driversService = require('./drivers.service');
const tripsService = require('../trips/trips.service');
const { estimateFare } = require('../trips/fare.calculator');
const surgeService = require('../trips/surge.service');
const { ok, created } = require('../../utils/response');

const getMe = async (req, res) => {
  const driver = await driversService.getMe(req.user.userId);
  ok(res, { driver });
};

const updateMe = async (req, res) => {
  const driver = await driversService.updateProfile(req.user.userId, req.body);
  ok(res, { driver }, 'Profile updated');
};

const updateFcmToken = async (req, res) => {
  await driversService.updateFcmToken(req.user.userId, req.body.fcmToken);
  ok(res, null, 'FCM token updated');
};

const completeVerification = async (req, res) => {
  const driver = await driversService.completeVerification(req.user.userId, req.body);
  ok(res, { driver }, 'Profile submitted for review');
};

const addVehicle = async (req, res) => {
  const vehicle = await driversService.addVehicle(req.user.userId, req.body);
  created(res, { vehicle }, 'Vehicle added');
};

const goOnline = async (req, res) => {
  const { lat, lng } = req.body;
  const driver = await driversService.goOnline(req.user.userId, lat, lng);
  ok(res, { driver }, 'You are now online');
};

const goOffline = async (req, res) => {
  await driversService.goOffline(req.user.userId);
  ok(res, null, 'You are now offline');
};

const getTripHistory = async (req, res) => {
  const { page, limit } = req.query;
  const result = await driversService.getTripHistory(req.user.userId, Number(page) || 1, Number(limit) || 20);
  ok(res, result);
};

const getActiveTrip = async (req, res) => {
  const trip = await driversService.getActiveTrip(req.user.userId);
  ok(res, { trip });
};

const startTrip = async (req, res) => {
  const trip = await driversService.startTrip(req.user.userId, req.params.id);
  try {
    const io = req.app.get('io');
    if (io) io.of('/passenger').to(`trip:${trip.id}`).emit('trip:status_change', { tripId: trip.id, status: 'DRIVER_EN_ROUTE' });
  } catch (_) {}
  ok(res, { trip }, 'Trip started');
};

const departTrip = async (req, res) => {
  const trip = await driversService.departTrip(req.user.userId, req.params.id);
  try {
    const io = req.app.get('io');
    if (io) io.of('/passenger').to(`trip:${trip.id}`).emit('trip:status_change', { tripId: trip.id, status: 'IN_PROGRESS' });
  } catch (_) {}
  ok(res, { trip }, 'Trip departed');
};

const arriveTrip = async (req, res) => {
  const result = await driversService.arriveTrip(req.user.userId, req.params.id);
  try {
    const io = req.app.get('io');
    const tripId = result?.trip?.id ?? req.params.id;
    if (io) io.of('/passenger').to(`trip:${tripId}`).emit('trip:status_change', { tripId, status: 'COMPLETED' });
  } catch (_) {}
  ok(res, result, 'Trip completed');
};

const addOfflinePassenger = async (req, res) => {
  const result = await driversService.addOfflinePassenger(req.user.userId, req.params.id, req.body);
  created(res, result, 'OTP sent to passenger');
};

const addCashNoPhone = async (req, res) => {
  await driversService.addCashNoPhone(req.user.userId, req.params.id, req.body);
  ok(res, null, 'Cash passenger added. Commission deducted.');
};

const verifyOfflineOtp = async (req, res) => {
  await driversService.verifyOfflineOtp(req.user.userId, req.params.id, req.body);
  ok(res, null, 'Passenger verified and boarded');
};

const boardPassenger = async (req, res) => {
  await driversService.boardPassenger(req.user.userId, req.params.id, req.params.bookingId);
  ok(res, null, 'Passenger boarded');
};

const getAllTrips = async (req, res) => {
  const trips = await driversService.getAllTrips(req.user.userId);
  ok(res, { trips });
};

const devActivate = async (req, res) => {
  const driver = await driversService.devActivate(req.user.userId);
  ok(res, { driver }, 'Account activated for development');
};

// ── Performance ─────────────────────────────────────────────────────
const getPerformance = async (req, res) => {
  const stats = await driversService.getPerformance(req.user.userId);
  ok(res, stats);
};

// ── Ratings ─────────────────────────────────────────────────────────
const getRatings = async (req, res) => {
  const ratings = await driversService.getRatings(req.user.userId);
  ok(res, ratings);
};

// ── Documents ───────────────────────────────────────────────────────
const getDocuments = async (req, res) => {
  const docs = await driversService.getDocuments(req.user.userId);
  ok(res, docs);
};

// ── Emergency contact ───────────────────────────────────────────────
const updateEmergencyContact = async (req, res) => {
  const result = await driversService.updateEmergencyContact(req.user.userId, req.body);
  ok(res, result, 'Emergency contact updated');
};

// ── Preferences ─────────────────────────────────────────────────────
const updatePreferences = async (req, res) => {
  const result = await driversService.updatePreferences(req.user.userId, req.body);
  ok(res, result, 'Preferences updated');
};

const createTrip = async (req, res) => {
  const trip = await tripsService.createTrip(req.user.userId, req.body);
  created(res, { trip }, 'Trip created');
};

const arriveAtPickup = async (req, res) => {
  const trip = await driversService.arriveAtPickup(req.user.userId, req.params.id);
  try {
    const io = req.app.get('io');
    if (io) io.of('/passenger').to(`trip:${trip.id}`).emit('trip:status_change', { tripId: trip.id, status: 'ARRIVED_AT_PICKUP' });
  } catch (_) {}
  ok(res, { trip }, 'Arrived at pickup');
};

const getTripById = async (req, res) => {
  const trip = await driversService.getTripById(req.user.userId, req.params.id);
  ok(res, { trip });
};

const acceptDispatch = async (req, res) => {
  const trip = await driversService.acceptDispatch(req.user.userId, req.params.id);
  try {
    const io = req.app.get('io');
    if (io) io.of('/passenger').to(`trip:${trip.id}`).emit('trip:status_change', { tripId: trip.id, status: 'CONFIRMED' });
  } catch (_) {}
  ok(res, { trip }, 'Trip accepted');
};

const declineDispatch = async (req, res) => {
  const trip = await driversService.declineDispatch(req.user.userId, req.params.id);
  ok(res, { trip }, 'Trip declined');
};

const uploadDocument = async (req, res) => {
  const result = await driversService.uploadDocument(req.user.userId, req.file, req.body.type);
  ok(res, result, 'Document uploaded');
};

const cancelTrip = async (req, res) => {
  const trip = await driversService.cancelTrip(req.user.userId, req.params.id);
  // Notify any rider on the live tracking screen so they aren't stranded on a
  // stale "en route" state until the next REST poll. Reuses the existing
  // trip:status_change event the rider already listens on.
  try {
    const io = req.app.get('io');
    if (io) io.of('/passenger').to(`trip:${trip.id}`).emit('trip:status_change', { tripId: trip.id, status: 'CANCELLED' });
  } catch (_) {}
  ok(res, { trip }, 'Trip cancelled');
};

// ── Rate passenger ────────────────────────────────────────────────
const ratePassenger = async (req, res) => {
  const result = await driversService.ratePassenger(req.user.userId, req.params.bookingId, req.body);
  ok(res, result, 'Passenger rating submitted');
};

// ── Destination Filter ──────────────────────────────────────────────
const setDestinationFilter = async (req, res) => {
  const result = await driversService.setDestinationFilter(req.user.userId, req.body);
  ok(res, { filter: result }, 'Destination filter set');
};

const getDestinationFilter = async (req, res) => {
  const filter = await driversService.getDestinationFilter(req.user.userId);
  ok(res, { filter });
};

const deleteDestinationFilter = async (req, res) => {
  await driversService.deleteDestinationFilter(req.user.userId);
  ok(res, null, 'Destination filter removed');
};

// ── Shift Tracking ───────────────────────────────────────────────────
const startShift = async (req, res) => {
  const shift = await driversService.startShift(req.user.userId);
  ok(res, { shift }, 'Shift started');
};

const endShift = async (req, res) => {
  const shift = await driversService.endShift(req.user.userId);
  ok(res, { shift }, 'Shift ended');
};

const getCurrentShift = async (req, res) => {
  const shift = await driversService.getCurrentShift(req.user.userId);
  ok(res, { shift });
};

const getShiftHistory = async (req, res) => {
  const { page, limit } = req.query;
  const result = await driversService.getShiftHistory(req.user.userId, Number(page) || 1, Number(limit) || 20);
  ok(res, result);
};

// ── Earnings ─────────────────────────────────────────────────────────
const getEarningsBreakdown = async (req, res) => {
  const { period } = req.query;
  const breakdown = await driversService.getEarningsBreakdown(req.user.userId, period || 'week');
  ok(res, breakdown);
};

const getWalletTransactions = async (req, res) => {
  const { page, limit } = req.query;
  const result = await driversService.getWalletTransactions(req.user.userId, Number(page) || 1, Number(limit) || 20);
  ok(res, result);
};

// ── Support Tickets ──────────────────────────────────────────────────
const createSupportTicket = async (req, res) => {
  const ticket = await driversService.createSupportTicket(req.user.userId, req.body);
  created(res, { ticket }, 'Support ticket created');
};

const getSupportTickets = async (req, res) => {
  const result = await driversService.getSupportTickets(req.user.userId);
  ok(res, result);
};

const replyToTicket = async (req, res) => {
  await driversService.replyToTicket(req.user.userId, req.params.ticketId, req.body);
  ok(res, null, 'Reply sent');
};

// ── Vehicle Inspections ──────────────────────────────────────────────
const scheduleInspection = async (req, res) => {
  const inspection = await driversService.scheduleInspection(req.user.userId, req.body);
  created(res, { inspection }, 'Inspection scheduled');
};

const getInspections = async (req, res) => {
  const { page, limit } = req.query;
  const result = await driversService.getInspections(req.user.userId, Number(page) || 1, Number(limit) || 20);
  ok(res, result);
};

// Returns the same fare estimate the rider home screen will show for a given route,
// so drivers see consistent pricing before creating a trip.
const getFareEstimate = async (req, res) => {
  const { distanceKm, tier = 'ECO', lat, lng, availableSeats } = req.query;
  let surgeMultiplier = 1.0;
  if (lat && lng) {
    surgeMultiplier = await surgeService.getSurgeMultiplier(parseFloat(lat), parseFloat(lng));
  }
  const seats = parseInt(availableSeats, 10);
  const fare = estimateFare({
    tier,
    distanceKm: parseFloat(distanceKm) || 0,
    surgeMultiplier,
    ...(seats > 0 && { availableSeats: seats }),
  });
  ok(res, { fareEstimate: fare, surgeMultiplier });
};

// ── Account Deletion ──────────────────────────────────────────────────
const deleteMe = async (req, res) => {
  await driversService.deleteMe(req.user.userId);
  ok(res, null, 'Account deleted');
};

// ── Trip Report ───────────────────────────────────────────────────────
const reportTrip = async (req, res) => {
  const report = await driversService.reportTrip(req.user.userId, req.params.id, req.body);
  created(res, { report }, 'Trip report submitted');
};

module.exports = {
  getMe, updateMe, updateFcmToken, completeVerification, addVehicle,
  goOnline, goOffline, getTripHistory, getActiveTrip, getAllTrips, devActivate,
  startTrip, departTrip, arriveAtPickup, arriveTrip, cancelTrip,
  getTripById, acceptDispatch, declineDispatch, uploadDocument,
  addOfflinePassenger, addCashNoPhone, verifyOfflineOtp, boardPassenger,
  getPerformance, getRatings, getDocuments, updateEmergencyContact, updatePreferences,
  createTrip, ratePassenger, getFareEstimate,
  setDestinationFilter, getDestinationFilter, deleteDestinationFilter,
  startShift, endShift, getCurrentShift, getShiftHistory,
  getEarningsBreakdown, getWalletTransactions,
  createSupportTicket, getSupportTickets, replyToTicket,
  scheduleInspection, getInspections,
  deleteMe, reportTrip,
};
