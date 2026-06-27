'use strict';

const prisma = require('../../config/database');
const redis = require('../../config/redis');
const pushService = require('../../services/push.service');
const logger = require('../../utils/logger');

const DISPATCH_RADIUS_KM = 8;
const GROUP_WINDOW_MINUTES = 60;
const MAX_DRIVERS_TO_NOTIFY = 12;

/**
 * Create a trip request for a free-text destination not served by existing routes.
 * Groups similar requests heading to the same area within a 60-min window, then
 * dispatches FCM push notifications to nearby online drivers.
 */
async function createRequest(userId, { destination, scheduledAt, seatCount = 1, pickupLat, pickupLng }) {
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

module.exports = { createRequest };
