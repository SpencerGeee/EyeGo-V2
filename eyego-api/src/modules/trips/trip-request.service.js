'use strict';

const prisma = require('../../config/database');
const redis = require('../../config/redis');
const env = require('../../config/env');
const pushService = require('../../services/push.service');
const logger = require('../../utils/logger');
const { AppError, NotFoundError } = require('../../utils/errors');
const { calculateFare, haversineKm } = require('./fare.calculator');

const DISPATCH_RADIUS_KM = 8;
const GROUP_WINDOW_MINUTES = 60;
const MAX_DRIVERS_TO_NOTIFY = 12;
const ON_DEMAND_FALLBACK_DISTANCE_KM = 5;

/**
 * Create a trip request for a free-text destination not served by existing routes.
 * Groups similar requests heading to the same area within a 60-min window, then
 * dispatches FCM push notifications to nearby online drivers.
 */
async function createRequest(userId, { destination, scheduledAt, seatCount = 1, pickupLat, pickupLng, destLat, destLng }) {
  const scheduledTime = new Date(scheduledAt);
  const destNormalized = destination.trim();

  // 1. Persist the request
  const tripRequest = await prisma.tripRequest.create({
    data: {
      userId,
      destination: destNormalized,
      scheduledAt: scheduledTime,
      seatCount: parseInt(seatCount, 10) || 1,
      pickupLat: pickupLat != null ? parseFloat(pickupLat) : null,
      pickupLng: pickupLng != null ? parseFloat(pickupLng) : null,
      destLat: destLat != null ? parseFloat(destLat) : null,
      destLng: destLng != null ? parseFloat(destLng) : null,
      status: 'PENDING',
    },
  });

  // 2. Group with similar pending requests (same destination keyword, ±60 min window)
  const windowStart = new Date(scheduledTime.getTime() - GROUP_WINDOW_MINUTES * 60_000);
  const windowEnd   = new Date(scheduledTime.getTime() + GROUP_WINDOW_MINUTES * 60_000);

  // Match on the first significant word (e.g. "Madina" from "Madina Market")
  const destKeyword = destNormalized.split(/[\s,]/)[0];

  const similarRequests = await prisma.tripRequest.findMany({
    where: {
      id:          { not: tripRequest.id },
      destination: { contains: destKeyword },
      scheduledAt: { gte: windowStart, lte: windowEnd },
      status:      { in: ['PENDING', 'DISPATCHED'] },
    },
  });

  let groupId = null;
  let groupedCount = 1;

  if (similarRequests.length > 0) {
    const existingGroup = similarRequests.find((r) => r.groupId);
    groupId = existingGroup?.groupId ?? tripRequest.id;
    const idsToGroup = [tripRequest.id, ...similarRequests.map((r) => r.id)];
    await prisma.tripRequest.updateMany({
      where: { id: { in: idsToGroup } },
      data:  { groupId, status: 'DISPATCHED' },
    });
    groupedCount = idsToGroup.length;
  } else {
    await prisma.tripRequest.update({
      where: { id: tripRequest.id },
      data:  { status: 'DISPATCHED' },
    });
  }

  // 3. Dispatch to drivers — fire-and-forget so the response is instant
  setImmediate(() =>
    dispatchRequestToDrivers(tripRequest, destNormalized, scheduledTime, groupedCount)
  );

  return {
    requestId:    tripRequest.id,
    groupId,
    groupedCount,
    message:
      groupedCount > 1
        ? `Grouped with ${groupedCount - 1} other rider(s) heading to ${destNormalized}. A driver will be notified.`
        : `Your request to ${destNormalized} has been sent to nearby drivers.`,
  };
}

async function dispatchRequestToDrivers(tripRequest, destination, scheduledAt, groupedCount) {
  try {
    let nearbyDriverIds = [];

    if (tripRequest.pickupLat != null && tripRequest.pickupLng != null) {
      try {
        nearbyDriverIds = await redis.geosearch(
          'drivers:online',
          'FROMLONLAT', tripRequest.pickupLng, tripRequest.pickupLat,
          'BYRADIUS', DISPATCH_RADIUS_KM, 'km',
          'ASC', 'COUNT', 30
        );
      } catch (_) {
        // Older Redis — fallback
        nearbyDriverIds = await redis.georadius(
          'drivers:online',
          tripRequest.pickupLng, tripRequest.pickupLat,
          DISPATCH_RADIUS_KM, 'km',
          'ASC', 'COUNT', 30
        ).catch(() => []);
      }
    }

    let eligibleDrivers;
    if (nearbyDriverIds.length > 0) {
      eligibleDrivers = await prisma.driver.findMany({
        where: {
          id:      { in: nearbyDriverIds },
          status:  'ACTIVE',
          fcmToken: { not: null },
          trips:   { none: { status: { in: ['IN_PROGRESS', 'DRIVER_EN_ROUTE'] } } },
        },
        select:  { id: true, fcmToken: true },
        take:    MAX_DRIVERS_TO_NOTIFY,
      });
    } else {
      // No coords or empty geo result — broadcast to all online active drivers
      eligibleDrivers = await prisma.driver.findMany({
        where: {
          isOnline: true,
          status:   'ACTIVE',
          fcmToken: { not: null },
        },
        select: { id: true, fcmToken: true },
        take:   MAX_DRIVERS_TO_NOTIFY,
      });
    }

    const fcmTokens = eligibleDrivers.map((d) => d.fcmToken).filter(Boolean);
    if (fcmTokens.length === 0) {
      logger.info('No drivers to notify for trip request', { requestId: tripRequest.id });
      return;
    }

    await pushService.sendMulticastPush(
      fcmTokens,
      'Ride Request Nearby',
      `${groupedCount} rider${groupedCount > 1 ? 's' : ''} need a trip to ${destination}`,
      {
        type:         'TRIP_REQUEST_DISPATCH',
        requestId:    tripRequest.id,
        destination,
        scheduledAt:  scheduledAt.toISOString(),
        groupedCount: String(groupedCount),
        pickupLat:    tripRequest.pickupLat != null ? String(tripRequest.pickupLat) : '',
        pickupLng:    tripRequest.pickupLng != null ? String(tripRequest.pickupLng) : '',
      }
    );

    logger.info('Trip request dispatched', {
      requestId:   tripRequest.id,
      destination,
      driverCount: fcmTokens.length,
      groupedCount,
    });
  } catch (err) {
    logger.warn('Trip request dispatch failed (non-blocking):', err.message);
  }
}

/**
 * Driver accepts a dispatched trip request. Atomically claims the request (and any
 * requests grouped with it heading to the same destination/window), creates a new
 * Trip owned by the accepting driver, and books a seat for every rider in the group.
 * First driver to accept wins — losers get a 409.
 */
/**
 * Rider cancels their own pending on-demand request. Race-safe against a
 * driver accepting at the same moment: the updateMany only succeeds while
 * status is still PENDING/DISPATCHED, same guard acceptTripRequest uses in
 * reverse. If a driver already claimed it (status ACCEPTED or later), this
 * fails with a clear message instead of silently leaving a live match behind
 * that the rider thinks they cancelled.
 */
async function cancelRequest(userId, tripRequestId) {
  const tripRequest = await prisma.tripRequest.findUnique({ where: { id: tripRequestId } });
  if (!tripRequest) throw new NotFoundError('TripRequest');
  if (tripRequest.userId !== userId) throw new AppError('Not authorized', 403, 'FORBIDDEN');

  const claim = await prisma.tripRequest.updateMany({
    where: { id: tripRequestId, status: { in: ['PENDING', 'DISPATCHED'] } },
    data: { status: 'CANCELLED' },
  });
  if (claim.count === 0) {
    throw new AppError(
      'A driver already accepted this request — check your Activity tab.',
      409,
      'REQUEST_ALREADY_MATCHED',
    );
  }

  return { id: tripRequestId, status: 'CANCELLED' };
}

async function acceptTripRequest(driverId, tripRequestId) {
  const result = await prisma.$transaction(async (tx) => {
    const claim = await tx.tripRequest.updateMany({
      where: { id: tripRequestId, status: { in: ['PENDING', 'DISPATCHED'] } },
      data: { status: 'ACCEPTED' },
    });
    if (claim.count === 0) {
      throw new AppError('This trip request is no longer available', 409, 'REQUEST_UNAVAILABLE');
    }

    const tripRequest = await tx.tripRequest.findUnique({ where: { id: tripRequestId } });
    if (!tripRequest) throw new NotFoundError('TripRequest');

    // Pull in the rest of the group (if any) so every rider heading the same way gets seated.
    const groupRequests = tripRequest.groupId
      ? await tx.tripRequest.findMany({
          where: { groupId: tripRequest.groupId, status: { in: ['PENDING', 'DISPATCHED', 'ACCEPTED'] } },
        })
      : [tripRequest];

    const otherIds = groupRequests.map((r) => r.id).filter((id) => id !== tripRequestId);
    if (otherIds.length) {
      await tx.tripRequest.updateMany({ where: { id: { in: otherIds } }, data: { status: 'ACCEPTED' } });
    }

    const vehicle = await tx.vehicle.findFirst({ where: { driverId, isActive: true } });
    if (!vehicle) throw new AppError('No active vehicle registered. Add a vehicle before accepting requests.', 400, 'NO_VEHICLE');

    const originLat = tripRequest.pickupLat ?? 0;
    const originLng = tripRequest.pickupLng ?? 0;
    const hasDestCoords = tripRequest.destLat != null && tripRequest.destLng != null;
    const destLat = hasDestCoords ? tripRequest.destLat : originLat;
    const destLng = hasDestCoords ? tripRequest.destLng : originLng;
    const distanceKm = hasDestCoords
      ? Math.max(haversineKm(originLat, originLng, destLat, destLng), 1)
      : ON_DEMAND_FALLBACK_DISTANCE_KM;

    const route = await tx.route.create({
      data: {
        name: `On-demand: ${tripRequest.destination}`.slice(0, 120),
        originName: 'Pickup location',
        destinationName: tripRequest.destination,
        originLat, originLng, destLat, destLng,
        distanceKm,
        isActive: false, // ad-hoc route created for this on-demand match only, not publicly searchable
      },
    });

    const tier = 'ECO';
    const totalSeatsNeeded = groupRequests.reduce((sum, r) => sum + (r.seatCount || 1), 0);
    const maxSeats = Math.min(Math.max(totalSeatsNeeded, 1), vehicle.seaterCount || totalSeatsNeeded);
    const fare = calculateFare({ tier, distanceKm, seatCount: maxSeats });

    const trip = await tx.trip.create({
      data: {
        driverId,
        vehicleId: vehicle.id,
        routeId: route.id,
        tier,
        departureTime: new Date(),
        pickupLat: originLat,
        pickupLng: originLng,
        baseFare: fare.baseFare,
        perKmRate: fare.perKmRate,
        surgeMultiplier: fare.surgeMultiplier,
        maxSeats,
        status: 'CONFIRMED',
      },
      include: { route: true, vehicle: true, driver: { select: { name: true, phone: true, profilePhoto: true } } },
    });

    const bookings = [];
    for (const r of groupRequests) {
      const booking = await tx.booking.create({
        data: {
          tripId: trip.id,
          userId: r.userId,
          seatNumber: null,
          fareAmount: fare.farePerPerson,
          commissionAmount: fare.commissionPerSeat,
          paymentMethod: 'CASH',
          paymentStatus: 'PENDING',
          status: 'CONFIRMED',
        },
      });
      bookings.push(booking);
      await tx.tripRequest.update({ where: { id: r.id }, data: { matchedTripId: trip.id } });
    }

    return { trip, bookings, riderUserIds: groupRequests.map((r) => r.userId) };
  });

  // Notify every matched rider — fire-and-forget, must not fail the accept response.
  setImmediate(async () => {
    try {
      const riders = await prisma.user.findMany({
        where: { id: { in: result.riderUserIds } },
        select: { id: true, fcmToken: true },
      });
      for (const rider of riders) {
        if (rider.fcmToken) {
          await pushService.sendPush(
            rider.fcmToken,
            'Driver Found!',
            `A driver has accepted your trip request to ${result.trip.route.destinationName}.`,
            { type: 'TRIP_REQUEST_MATCHED', tripId: result.trip.id },
          );
        }
      }
      const io = require('../../app').get('io');
      if (io) {
        for (const userId of result.riderUserIds) {
          io.of('/passenger').to(`user:${userId}`).emit('trip:request_accepted', {
            tripId: result.trip.id,
          });
        }
      }
    } catch (err) {
      logger.warn('Trip request match notification failed (non-blocking):', err.message);
    }
  });

  return result;
}

module.exports = { createRequest, cancelRequest, acceptTripRequest };
