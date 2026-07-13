'use strict';

const tripsService = require('./trips.service');
const surgeService = require('./surge.service');
const { estimateFare } = require('./fare.calculator');
const { ok } = require('../../utils/response');
const tripRequestService = require('./trip-request.service');
const prisma = require('../../config/database');
const { NotFoundError } = require('../../utils/errors');

const getFareEstimate = async (req, res) => {
  const { lat, lng, tier, distanceKm, doorstepPickup, heavyLoad } = req.query;
  
  // Record demand
  if (lat && lng) {
    await surgeService.recordDemand(parseFloat(lat), parseFloat(lng), req.user.userId);
  }

  const surgeMultiplier = (lat && lng) ? await surgeService.getSurgeMultiplier(parseFloat(lat), parseFloat(lng)) : 1.0;

  const fare = estimateFare({
    tier: tier || 'ECO',
    distanceKm: parseFloat(distanceKm) || 0,
    doorstepPickup: doorstepPickup === 'true',
    heavyLoad: heavyLoad === 'true',
    surgeMultiplier,
  });

  ok(res, { fareEstimate: fare, surgeMultiplier });
};

const createTrip = async (req, res) => {
  const trip = await tripsService.createTrip(req.user.userId, req.body);
  ok(res, { trip }, 'Trip created', 201);
};

const getTrip = async (req, res) => {
  const trip = await tripsService.getTrip(req.params.id);
  ok(res, { trip });
};

const getTripByShareToken = async (req, res) => {
  const result = await tripsService.getTripByShareToken(req.params.shareToken);
  ok(res, result);
};

const getSeatMap = async (req, res) => {
  const seatMap = await tripsService.getSeatMap(req.params.id);
  ok(res, seatMap);
};

const getPulseSchedules = async (req, res) => {
  const schedules = await tripsService.getPulseSchedules();
  ok(res, { schedules });
};

const searchTrips = async (req, res) => {
  const result = await tripsService.searchTrips(req.query);
  ok(res, {
    trips: result.trips,
    total: result.total,
    page: result.page,
    totalPages: result.totalPages,
  });
};

const getActiveTrip = async (req, res) => {
  const booking = await tripsService.getActiveTrip(req.user.userId);
  ok(res, { booking });
};

const emergencyAlert = async (req, res) => {
  const { latitude, longitude, passengerPhone, timestamp, emergencyContactPhone } = req.body;
  const tripId = req.params.id;
  const userId = req.user.userId;

  // Return immediately — SOS must be instant
  ok(res, { alertReceived: true }, 'Emergency alert dispatched');

  // Fire-and-forget all downstream work
  setImmediate(async () => {
    try {
      const prisma = require('../../config/database');
      const pushService = require('../../services/push.service');
      const logger = require('../../utils/logger');

      const lat = latitude ? parseFloat(latitude) : null;
      const lng = longitude ? parseFloat(longitude) : null;

      // Persist SOS event
      await prisma.sosEvent.create({
        data: { tripId, userId, lat, lng },
      }).catch(() => {});

      // Create urgent support ticket
      // URGENT is a valid `priority`, not a `status` — SupportTicket.status only
      // ever transitions OPEN → IN_PROGRESS → CLOSED. Setting status:'URGENT'
      // made SOS tickets invisible to the admin queue's default status filters.
      const ticket = await prisma.supportTicket.create({
        data: {
          userId,
          subject: `🚨 EMERGENCY ALERT — Trip #${tripId.slice(0, 8)}`,
          status: 'OPEN',
          priority: 'URGENT',
          category: 'TRIP',
        },
      });

      await prisma.ticketMessage.create({
        data: {
          ticketId: ticket.id,
          senderId: userId,
          senderRole: 'USER',
          text: `EMERGENCY triggered by user ${userId} on trip ${tripId}.\nLocation: ${lat}, ${lng}\nPhone: ${passengerPhone || 'N/A'}\nTime: ${timestamp || new Date().toISOString()}`,
        },
      });

      // Fetch trip driver + admin FCM tokens
      const redis = require('../../config/redis');
      const [trip, adminTokenRaw] = await Promise.all([
        prisma.trip.findUnique({
          where: { id: tripId },
          select: { driver: { select: { fcmToken: true } } },
        }),
        redis.smembers('admin:fcm_tokens').catch(() => []),
      ]);

      const fcmTargets = [
        trip?.driver?.fcmToken,
        ...adminTokenRaw,
      ].filter(Boolean);

      if (fcmTargets.length > 0) {
        await pushService.sendMulticastPush(
          fcmTargets,
          '🚨 Rider SOS Alert!',
          `Passenger triggered SOS on trip ${tripId.slice(0, 8)}. Check admin panel.`,
          { type: 'SOS', tripId },
        );
      }

      // ── Push notification to emergency contact ───────────────────
      if (emergencyContactPhone) {
        // Emergency contacts don't have FCM tokens in the app — send SMS fallback
        // For a future upgrade, store emergency contact FCM tokens in the database
        try {
          const smsService = require('../../services/sms.service');
          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { name: true },
          });
          const riderName = user?.name || 'A rider';
          const googleMapsLink = lat && lng
            ? `https://maps.google.com/?q=${lat},${lng}`
            : 'Location unavailable';
          await smsService.sendSms(
            emergencyContactPhone,
            `🚨 EMERGENCY: ${riderName} has triggered an SOS alert on EyeGo! Trip ID: ${tripId.slice(0, 8)}. Location: ${googleMapsLink}. Please contact them immediately.`
          );
        } catch (smsErr) {
          logger.warn('Failed to send SOS SMS to emergency contact:', smsErr.message);
        }
      }

      logger.warn('SOS emergency alert', { tripId, userId, lat, lng });
    } catch (_) {
      // Silent fail — never block the SOS response
    }
  });
};

const getTripReceipt = async (req, res) => {
  const receipt = await tripsService.getTripReceipt(req.params.id, req.user.userId);
  ok(res, { receipt });
};

const scheduleTrip = async (req, res) => {
  const intent = await tripsService.scheduleTrip(req.user.userId, req.body);
  ok(res, { intent }, 'Ride scheduled. We will notify you when a driver is available.', 201);
};

const getScheduledRides = async (req, res) => {
  const intents = await tripsService.getScheduledRides(req.user.userId);
  ok(res, { intents });
};

const cancelScheduledRide = async (req, res) => {
  const intent = await tripsService.cancelScheduledRide(req.user.userId, req.params.id);
  ok(res, { intent }, 'Scheduled ride cancelled');
};

const getTrackingData = async (req, res) => {
  const data = await tripsService.getTrackingData(req.params.shortId);
  ok(res, data);
};

const getJoinData = async (req, res) => {
  const data = await tripsService.getTripByShareToken(req.params.shareToken);
  ok(res, data);
};

const driverNoShow = async (req, res) => {
  const result = await tripsService.driverNoShow(req.params.id, req.user.userId);
  ok(res, result, 'Driver no-show recorded — affected riders will be refunded');
};

const riderNoShow = async (req, res) => {
  const result = await tripsService.riderNoShow(req.params.id, req.params.bookingId, req.user.userId);
  ok(res, result, 'Rider no-show recorded');
};

const requestTrip = async (req, res) => {
  const { destination, scheduledAt, seatCount, pickupLat, pickupLng, destLat, destLng } = req.body;
  const result = await tripRequestService.createRequest(req.user.userId, {
    destination,
    scheduledAt,
    seatCount,
    pickupLat,
    pickupLng,
    destLat,
    destLng,
  });
  ok(res, result, result.message, 201);
};

const getTripRequestStatus = async (req, res) => {
  const request = await prisma.tripRequest.findFirst({
    where: { id: req.params.id, userId: req.user.userId },
    select: { id: true, status: true, matchedTripId: true },
  });
  if (!request) throw new NotFoundError('TripRequest');
  ok(res, request);
};

const cancelTripRequest = async (req, res) => {
  const result = await tripRequestService.cancelRequest(req.user.userId, req.params.id);
  ok(res, result, 'Trip request cancelled');
};

// POST /v1/trips/:id/live-activity-token — rider registers/refreshes the
// ActivityKit push token for their Live Activity on this trip.
const saveLiveActivityToken = async (req, res) => {
  const { pushToken, activityId } = req.body;
  const result = await tripsService.saveLiveActivityToken(req.user.userId, req.params.id, { pushToken, activityId });
  ok(res, result, 'Live Activity token saved');
};

module.exports = { createTrip, getTrip, getTripByShareToken, getSeatMap, getPulseSchedules, searchTrips, getActiveTrip, getFareEstimate, emergencyAlert, getTripReceipt, driverNoShow, riderNoShow, scheduleTrip, getScheduledRides, cancelScheduledRide, getTrackingData, getJoinData, requestTrip, getTripRequestStatus, cancelTripRequest, saveLiveActivityToken };
