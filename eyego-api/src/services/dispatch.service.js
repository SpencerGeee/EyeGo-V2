'use strict';

const redis = require('../config/redis');
const prisma = require('../config/database');
const { sendMulticastPush } = require('./push.service');
const logger = require('../utils/logger');

const DISPATCH_RADIUS_KM = 5;
const DISPATCH_EXTENDED_RADIUS_KM = 10;
const DISPATCH_EXPIRY_SECONDS = 30;
const MAX_DRIVERS_TO_NOTIFY = 5;

/**
 * Find nearby online drivers and send them a dispatch request via FCM push.
 * Called after a trip is created so drivers in range are alerted.
 * Falls back to a wider radius if no drivers are found in the initial radius.
 */
async function dispatchToNearbyDrivers(trip, radiusKm = DISPATCH_RADIUS_KM) {
  try {
    if (!trip.pickupLat || !trip.pickupLng) {
      // No pickup coordinates — use FCM broadcast to all online drivers instead
      logger.info('Dispatch skipped: trip has no pickup coordinates', { tripId: trip.id });
      return;
    }

    // GEORADIUS: find driver IDs within radius
    // Redis GEOSEARCH (Redis 6.2+) with fallback to GEORADIUS
    let nearbyDriverIds = [];
    try {
      nearbyDriverIds = await redis.geosearch(
        'drivers:online',
        'FROMLONLAT', trip.pickupLng, trip.pickupLat,
        'BYRADIUS', radiusKm, 'km',
        'ASC',
        'COUNT', 20
      );
    } catch (_) {
      // Older Redis — use GEORADIUS
      nearbyDriverIds = await redis.georadius(
        'drivers:online', trip.pickupLng, trip.pickupLat, radiusKm, 'km',
        'ASC', 'COUNT', 20
      );
    }

    if (!nearbyDriverIds || nearbyDriverIds.length === 0) {
      if (radiusKm < DISPATCH_EXTENDED_RADIUS_KM) {
        logger.info('No drivers in radius, expanding search', { tripId: trip.id, radiusKm });
        setTimeout(async () => {
          // Guard: skip extended search if the trip was cancelled or already assigned
          const current = await prisma.trip.findUnique({
            where: { id: trip.id },
            select: { status: true },
          });
          if (!current || current.status === 'CANCELLED' || current.status === 'IN_PROGRESS' || current.status === 'COMPLETED') {
            logger.info('Extended dispatch skipped — trip no longer needs drivers', { tripId: trip.id, status: current?.status });
            return;
          }
          dispatchToNearbyDrivers(trip, DISPATCH_EXTENDED_RADIUS_KM);
        }, 30_000);
      }
      return;
    }

    // Exclude the trip's own driver and find eligible drivers (ACTIVE, no IN_PROGRESS trip)
    // Driver has no `rating` scalar column — it's derived from the DriverRating relation,
    // so it can't be selected/ordered on directly in this query.
    let eligibleDrivers = await prisma.driver.findMany({
      where: {
        id: { in: nearbyDriverIds.filter((id) => id !== trip.driverId) },
        status: 'ACTIVE',
        fcmToken: { not: null },
        trips: { none: { status: { in: ['IN_PROGRESS', 'DRIVER_EN_ROUTE'] } } },
      },
      select: { id: true, fcmToken: true },
      take: MAX_DRIVERS_TO_NOTIFY * 3, // over-fetch so we can rank by rating before trimming to MAX_DRIVERS_TO_NOTIFY
    });

    if (eligibleDrivers.length === 0) {
      logger.info('No eligible drivers found for dispatch', { tripId: trip.id });
      return;
    }

    // Rank by average rating (unrated drivers default to 5 so new drivers aren't starved of trips).
    const avgRatings = await prisma.driverRating.groupBy({
      by: ['driverId'],
      where: { driverId: { in: eligibleDrivers.map((d) => d.id) } },
      _avg: { stars: true },
    });
    const ratingByDriverId = new Map(avgRatings.map((r) => [r.driverId, r._avg.stars ?? 5]));
    eligibleDrivers = eligibleDrivers
      .sort((a, b) => (ratingByDriverId.get(b.id) ?? 5) - (ratingByDriverId.get(a.id) ?? 5))
      .slice(0, MAX_DRIVERS_TO_NOTIFY);

    const fcmTokens = eligibleDrivers.map((d) => d.fcmToken).filter(Boolean);
    const expiresAt = new Date(Date.now() + DISPATCH_EXPIRY_SECONDS * 1000).toISOString();

    await sendMulticastPush(
      fcmTokens,
      'New Trip Nearby',
      `${trip.route?.origin ?? 'Origin'} → ${trip.route?.destination ?? 'Destination'}`,
      {
        type: 'DISPATCH_REQUEST',
        tripId: trip.id,
        routeOrigin: trip.route?.origin ?? '',
        routeDestination: trip.route?.destination ?? '',
        departureTime: trip.departureTime?.toISOString() ?? '',
        farePerSeat: String(trip.farePerSeat ?? ''),
        totalSeats: String(trip.maxSeats ?? ''),
        expiresAt,
      }
    );

    // Also emit a live socket event so the driver app can show/update the dispatch
    // card in real time without relying solely on the push notification landing
    // (push may be delayed/dropped by the OS). The driver home screen and
    // DriverTripStatusListener both listen for this via driverSocketEvents.onTripAssigned.
    try {
      const io = require('../app').get('io');
      const assignedPayload = {
        tripId: trip.id,
        tripShortId: trip.shortId,
        routeOrigin: trip.route?.origin ?? '',
        routeDestination: trip.route?.destination ?? '',
        departureTime: trip.departureTime?.toISOString() ?? '',
        estimatedEarnings: trip.farePerSeat ?? undefined,
        seatCount: trip.maxSeats ?? undefined,
        bookedCount: trip.confirmedSeats ?? undefined,
        expiresAt,
      };
      for (const d of eligibleDrivers) {
        io.of('/driver').to(`driver:${d.id}`).emit('trip:assigned', assignedPayload);
      }
    } catch (emitErr) {
      logger.warn('Dispatch socket emit failed (non-blocking):', emitErr.message);
    }

    logger.info('Dispatch sent', { tripId: trip.id, driverCount: fcmTokens.length, radiusKm });
  } catch (err) {
    // Non-blocking — a dispatch failure should never break trip creation
    logger.warn('Dispatch failed (non-blocking):', err.message);
  }
}

module.exports = { dispatchToNearbyDrivers };
