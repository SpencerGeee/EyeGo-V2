'use strict';

const driversService = require('./drivers.service');
const tripsService = require('../trips/trips.service');
const tripRequestService = require('../trips/trip-request.service');
const { estimateFare } = require('../trips/fare.calculator');
const surgeService = require('../trips/surge.service');
const mapboxService = require('../../services/mapbox.service');
const { blacklistToken } = require('../../middleware/auth');
const { ok, created } = require('../../utils/response');
const destinationMode = require('../../services/destination-mode.service');
const { seatOccupyingWhere } = require('../../utils/booking-status');

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

/**
 * Keep a driver in the dispatch pool without a socket — see
 * `driversService.recordPresence` for why this exists at all.
 */
const presence = async (req, res) => {
  const { lat, lng, heading, speed } = req.body;
  const result = await driversService.recordPresence(req.user.userId, {
    lat: Number(lat),
    lng: Number(lng),
    heading: Number(heading) || 0,
    speed: Number(speed) || 0,
  });
  ok(res, result);
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
  // Set by the driver app on the SECOND attempt, after the under-minimum
  // confirm sheet. A 409 `BELOW_MIN_OCCUPANCY` is what asks for it.
  const trip = await driversService.departTrip(req.user.userId, req.params.id, {
    acknowledgeUnderMinimum: req.body?.acknowledgeUnderMinimum === true,
  });
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
  const result = await driversService.addCashNoPhone(req.user.userId, req.params.id, req.body);
  ok(res, result, 'Cash passenger added. Commission deducted.');
};

const verifyOfflineOtp = async (req, res) => {
  await driversService.verifyOfflineOtp(req.user.userId, req.params.id, req.body);
  ok(res, null, 'Passenger verified and boarded');
};

// Driver backed out of the OTP step — hand the seat straight back rather than
// leaving it held until the code expires. See releaseOfflineHold.
const releaseOfflineHold = async (req, res) => {
  const result = await driversService.releaseOfflineHold(
    req.user.userId,
    req.params.id,
    req.params.bookingId,
  );
  ok(res, result, result.released ? 'Seat released' : 'Nothing to release');
};

const boardPassenger = async (req, res) => {
  // `pin` is only consulted for bookings that carry one ("Verify My Ride").
  // Everyone else boards exactly as before — see boardPassenger's own note.
  await driversService.boardPassenger(req.user.userId, req.params.id, req.params.bookingId, {
    pin: req.body?.pin ?? null,
  });
  ok(res, null, 'Passenger boarded');
};

/**
 * Ask this booking's rider to show their Verify My Ride code.
 *
 * The digits are NOT returned here — they are already in the rider's own trip
 * snapshot and deliberately absent from every driver-facing payload (a driver
 * who could read the code would not have to be told it, and the check would
 * prove nothing). All this does is raise the popup on their screen.
 */
const requestBoardingPin = async (req, res) => {
  const result = await driversService.requestBoardingPin(
    req.user.userId,
    req.params.id,
    req.params.bookingId,
  );
  ok(res, result, 'Rider asked for their code');
};

/**
 * Pause / resume incoming offers without going offline.
 *
 * Separate from the online toggle deliberately: going offline for a breather
 * costs the driver their place in the supply index, so they decline instead and
 * take the hit on acceptance rate. This is the honest version of what they are
 * already doing.
 */
const setRequestsPaused = async (req, res) => {
  const paused = req.body?.paused === true;
  await driversService.setRequestsPaused(req.user.userId, paused);
  ok(res, { paused }, paused ? 'Requests paused' : 'Requests resumed');
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
    // Broadcast the status the trip actually landed on rather than a hardcoded
    // 'CONFIRMED' — riders were being told CONFIRMED even when the service put
    // the trip somewhere else, so their tracking screen showed a stale stage
    // until the next poll.
    if (io) io.of('/passenger').to(`trip:${trip.id}`).emit('trip:status_change', { tripId: trip.id, status: trip.status });
  } catch (_) {}
  ok(res, { trip }, 'Trip accepted');
};

const claimReassignedTrip = async (req, res) => {
  const trip = await driversService.claimReassignedTrip(req.user.userId, req.params.id);
  try {
    const io = req.app.get('io');
    // BUGFIX: this read `io.of('\passenger')` — a backslash, not a slash. In JS
    // '\p' is just 'p', so this addressed a namespace called "passenger" with
    // no leading slash: a namespace Socket.IO happily creates and no client is
    // ever connected to. Every rider whose trip was claimed after a driver
    // cancellation was told nothing at all.
    //
    // Status is the trip's real one for the same reason as acceptDispatch
    // above: claiming can land somewhere other than DRIVER_EN_ROUTE, and
    // announcing a status the trip is not in is worse than announcing none.
    if (io) io.of('/passenger').to(`trip:${trip.id}`).emit('trip:status_change', { tripId: trip.id, status: trip.status });
  } catch (_) {}
  ok(res, { trip }, 'Trip claimed');
};

const declineDispatch = async (req, res) => {
  const trip = await driversService.declineDispatch(req.user.userId, req.params.id);
  ok(res, { trip }, 'Trip declined');
};

const acceptTripRequest = async (req, res) => {
  const { trip, bookings } = await tripRequestService.acceptTripRequest(req.user.userId, req.params.id);
  ok(res, { trip, bookings }, 'Trip request accepted');
};

const declineTripRequest = async (req, res) => {
  const result = await tripRequestService.declineTripRequest(req.user.userId, req.params.id);
  ok(res, result, 'Trip request declined');
};

const uploadDocument = async (req, res) => {
  const result = await driversService.uploadDocument(req.user.userId, req.file, req.body.type);
  ok(res, result, 'Document uploaded');
};

const cancelTrip = async (req, res) => {
  const { reason, note } = req.body || {};
  const trip = await driversService.cancelTrip(req.user.userId, req.params.id, { reason, note });
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

// ── Notifications (derived history — backfills what was missed while killed) ──
const getNotifications = async (req, res) => {
  const { limit } = req.query;
  const result = await driversService.getNotifications(req.user.userId, limit);
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
  const {
    distanceKm, tier = 'ECO', lat, lng, availableSeats,
    originLat, originLng, destLat, destLng,
  } = req.query;
  let surgeMultiplier = 1.0;
  if (lat && lng) {
    surgeMultiplier = await surgeService.getSurgeMultiplier(parseFloat(lat), parseFloat(lng));
  }
  const seats = parseInt(availableSeats, 10);

  // BUGFIX (the preview quoted ~2× what the trip actually cost): this priced
  // whatever `distanceKm` the client measured, but the trip that gets created
  // prices `mapbox.roadDistanceKm` between the same two points. Two different
  // distances meant two different fares for one ride. When the endpoints are
  // supplied, resolve the distance here exactly as trip creation will — the
  // preview is then a real quote rather than an approximation of one, and it
  // cannot be inflated by editing the request either.
  let resolvedDistanceKm = parseFloat(distanceKm) || 0;
  const coords = [originLat, originLng, destLat, destLng].map((v) => parseFloat(v));
  if (coords.every((v) => Number.isFinite(v))) {
    const road = await mapboxService.roadDistanceKm(coords[0], coords[1], coords[2], coords[3]);
    resolvedDistanceKm = road.distanceKm;
  }

  const fare = estimateFare({
    tier,
    distanceKm: resolvedDistanceKm,
    surgeMultiplier,
    ...(seats > 0 && { availableSeats: seats }),
  });
  ok(res, { fareEstimate: fare, surgeMultiplier, distanceKm: resolvedDistanceKm });
};

// ── Account Deletion ──────────────────────────────────────────────────
/**
 * Blacklist first, delete second — same reasoning as the rider's deleteMe.
 * `authenticateDriver` checks the JWT signature and the blacklist, never
 * whether the driver still exists, so without this the access token kept
 * working after the account was gone: still able to go online, still able to
 * accept a dispatch offer.
 */
const deleteMe = async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (token) await blacklistToken(token);
  await driversService.deleteMe(req.user.userId);
  ok(res, null, 'Account deleted');
};

// ── Emergency SOS ────────────────────────────────────────────────────
// Mirrors the rider-side emergencyAlert (trips.controller.js): a real DB record,
// admin/rider push, and an SMS to the driver's saved emergency contact. Previously
// the driver app's 3 SOS buttons only did `Linking.openURL('tel:191')` with no
// backend call at all, despite the UI claiming location would be shared.
const emergencyAlert = async (req, res) => {
  const { latitude, longitude, timestamp } = req.body;
  const tripId = req.params.id;
  const driverId = req.user.userId;

  ok(res, { alertReceived: true }, 'Emergency alert dispatched');

  setImmediate(async () => {
    try {
      const prisma = require('../../config/database');
      const pushService = require('../../services/push.service');
      const smsService = require('../../services/sms.service');
      const redis = require('../../config/redis');
      const logger = require('../../utils/logger');

      const lat = latitude ? parseFloat(latitude) : null;
      const lng = longitude ? parseFloat(longitude) : null;

      // SosEvent.userId has no FK constraint — it's a plain identifier column,
      // so it's safe to store the reporting driver's id here.
      const sosEvent = await prisma.sosEvent.create({ data: { tripId, userId: driverId, lat, lng } }).catch((err) => {
        // BUGFIX: this swallowed DB failures on the actual SOS audit record with zero
        // logging — if this write failed, there was no trace ANYWHERE that a driver
        // SOS was ever triggered, even though the ticket/push notification below might
        // still succeed independently.
        logger.error("Failed to persist driver SOS event record", { tripId, driverId, error: err.message });
        return null;
      });

      // SMS to the on-call roster — the one channel that reaches somebody who
      // is not already looking at the console. Fire-and-forget for the same
      // reason as the rider path: no provider round-trip in front of a panic.
      if (sosEvent) {
        require('../../services/sos-alert.service')
          .dispatchAlert(sosEvent)
          .catch((err) => logger.error('[sos] driver alert dispatch failed', { error: err.message }));
      }

      const driver = await prisma.driver.findUnique({
        where: { id: driverId },
        select: { name: true, emergencyContact: true },
      });

      const trip = await prisma.trip.findFirst({
        where: { id: tripId, driverId },
        include: { bookings: { where: { ...seatOccupyingWhere() }, include: { user: { select: { fcmToken: true } } } } },
      });

      const ticket = await prisma.supportTicket.create({
        data: {
          userId: driverId,
          driverId,
          subject: `🚨 DRIVER EMERGENCY ALERT — Trip #${tripId.slice(0, 8)}`,
          status: 'URGENT',
        },
      }).catch(() => null);
      if (ticket) {
        await prisma.ticketMessage.create({
          data: {
            ticketId: ticket.id,
            senderId: driverId,
            senderRole: 'DRIVER',
            text: `EMERGENCY triggered by driver ${driverId} on trip ${tripId}.\nLocation: ${lat}, ${lng}\nTime: ${timestamp || new Date().toISOString()}`,
          },
        }).catch(() => {});
      }

      const riderTokens = (trip?.bookings ?? []).map((b) => b.user?.fcmToken).filter(Boolean);
      const adminTokens = await redis.smembers('admin:fcm_tokens').catch(() => []);
      const fcmTargets = [...riderTokens, ...adminTokens].filter(Boolean);
      if (fcmTargets.length > 0) {
        await pushService.sendMulticastPush(
          fcmTargets,
          '🚨 Driver SOS Alert!',
          `Your driver triggered an SOS on trip ${tripId.slice(0, 8)}.`,
          { type: 'SOS', tripId },
        ).catch(() => {});
      }

      if (driver?.emergencyContact) {
        try {
          const contact = JSON.parse(driver.emergencyContact);
          if (contact?.phone) {
            // `lat && lng` was also a live bug: a driver sitting exactly on the
            // equator or the prime meridian has a falsy-but-valid coordinate, and
            // the old test would have told their emergency contact "Location
            // unavailable". `describeLocation` checks for finite numbers.
            const googleMapsLink = require('../../utils/geo-links').describeLocation({ lat, lng });
            await smsService.sendSms(
              contact.phone,
              `🚨 EMERGENCY: ${driver.name || 'Your contact'} (EyeGo driver) has triggered an SOS alert. Trip ID: ${tripId.slice(0, 8)}. Location: ${googleMapsLink}. Please contact them immediately.`,
            );
          }
        } catch (smsErr) {
          logger.warn('Failed to send driver SOS SMS to emergency contact:', smsErr.message);
        }
      }

      logger.warn('Driver SOS emergency alert', { tripId, driverId, lat, lng });
    } catch (err) {
      // BUGFIX: the response is already sent above (setImmediate runs after), so
      // catching here was never actually needed to not block anything — but
      // swallowing it silently meant a failure anywhere in the SOS pipeline (ticket
      // creation, push notification, etc.) left ZERO trace that an emergency alert
      // was ever triggered. Log loudly instead — this is a life-safety path.
      logger.error("Driver SOS emergency alert pipeline failed", { tripId, driverId, error: err.message, stack: err.stack });
    }
  });
};

// ── Trip Report ───────────────────────────────────────────────────────
const reportTrip = async (req, res) => {
  const report = await driversService.reportTrip(req.user.userId, req.params.id, {
    type: req.body?.type,
    details: req.body?.details,
    // Which seat on this trip. Optional: a trip-level report is still valid.
    bookingId: req.body?.bookingId ?? null,
  });
  created(res, { report }, 'Trip report submitted');
};

// ── Pending trip-request poll fallback ────────────────────────────────
const getPendingTripRequests = async (req, res) => {
  const lat = req.query.lat != null ? parseFloat(req.query.lat) : undefined;
  const lng = req.query.lng != null ? parseFloat(req.query.lng) : undefined;
  const requests = await driversService.getPendingTripRequests(req.user.userId, { lat, lng });
  ok(res, { requests });
};

const getUpcomingScheduled = async (req, res) => {
  const scheduled = await driversService.getUpcomingScheduledTrips(req.user.userId);
  ok(res, { scheduled });
};

// ── Destination mode ────────────────────────────────────────────────────────
const getDestinationMode = async (req, res) => {
  ok(res, await destinationMode.getStatus(req.user.userId));
};

const setDestinationMode = async (req, res) => {
  const { lat, lng, address } = req.body ?? {};
  ok(
    res,
    await destinationMode.setDestination(req.user.userId, {
      lat: Number(lat),
      lng: Number(lng),
      address: typeof address === 'string' ? address.slice(0, 200) : null,
    }),
    'Destination set — only rides heading that way from now on',
  );
};

const clearDestinationMode = async (req, res) => {
  ok(res, await destinationMode.clearDestination(req.user.userId, 'MANUAL'));
};

module.exports = {
  getMe, updateMe, updateFcmToken, completeVerification, addVehicle,
  goOnline, goOffline, getTripHistory, getActiveTrip, getAllTrips, devActivate,
  startTrip, departTrip, arriveAtPickup, arriveTrip, cancelTrip, presence,
  getTripById, acceptDispatch, declineDispatch, claimReassignedTrip,
  acceptTripRequest, declineTripRequest, uploadDocument,
  addOfflinePassenger, addCashNoPhone, verifyOfflineOtp, releaseOfflineHold, boardPassenger, requestBoardingPin, setRequestsPaused,
  getPerformance, getRatings, getDocuments, updateEmergencyContact, updatePreferences,
  createTrip, ratePassenger, getFareEstimate,
  setDestinationFilter, getDestinationFilter, deleteDestinationFilter,
  startShift, endShift, getCurrentShift, getShiftHistory,
  getEarningsBreakdown, getWalletTransactions, getNotifications,
  createSupportTicket, getSupportTickets, replyToTicket,
  scheduleInspection, getInspections,
  deleteMe, reportTrip, emergencyAlert,
  getPendingTripRequests, getUpcomingScheduled,
  getDestinationMode, setDestinationMode, clearDestinationMode,
};
