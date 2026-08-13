'use strict';

const prisma = require('../../config/database');
const redis = require('../../config/redis');
const env = require('../../config/env');
const pushService = require('../../services/push.service');
const { availableDriverWhere, isDriverAvailable } = require('../../services/driver-availability');
const logger = require('../../utils/logger');
const { AppError, NotFoundError } = require('../../utils/errors');
const { calculateFare, haversineKm } = require('./fare.calculator');

// Runtime-tunable: the console owns this number now (src/config/settings.js).
const dispatchRadiusKm = () => require('../../config/settings').get('DISPATCH_RADIUS_KM') ?? 8;
const GROUP_WINDOW_MINUTES = 60;
const MAX_DRIVERS_TO_NOTIFY = 12;

/**
 * Create a trip request for a free-text destination not served by existing routes.
 * Groups similar requests heading to the same area within a 60-min window, then
 * dispatches FCM push notifications to nearby online drivers.
 */
async function createRequest(userId, { destination, scheduledAt, seatCount = 1, coverAll = true, pickupLat, pickupLng, destLat, destLng }) {
  const scheduledTime = new Date(scheduledAt);
  const destNormalized = destination.trim();

  // 1. Persist the request
  const tripRequest = await prisma.tripRequest.create({
    data: {
      userId,
      destination: destNormalized,
      scheduledAt: scheduledTime,
      seatCount: parseInt(seatCount, 10) || 1,
      coverAll: !!coverAll,
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

/**
 * Notify drivers of a SCHEDULED ride request.
 *
 * This used to run the sequential dispatch cascade. It no longer does, and the
 * reason is a product one rather than a technical one: the cascade offers a
 * ride to one driver at a time on a **20-second** exclusive timer. That is
 * exactly right for "I want a car now" and meaningless for "I want a car on
 * Tuesday at 7am" — no driver is going to sit on a twenty-second countdown for
 * a ride four days out, so every candidate times out and the request expires
 * having reached nobody.
 *
 * A scheduled request is therefore a BROADCAST notification: every nearby
 * eligible driver is told it exists and can claim it whenever they like. Live,
 * on-demand dispatch is `modules/rides` and runs the cascade against a real
 * Trip row.
 */
async function dispatchRequestToDrivers(tripRequest, destination, scheduledAt, groupedCount) {
  try {
    await notifyDriversOfScheduledRequest(tripRequest, destination, scheduledAt, groupedCount);
  } catch (err) {
    logger.warn('Trip request dispatch failed (non-blocking):', err.message);
  }
}

async function notifyDriversOfScheduledRequest(tripRequest, destination, scheduledAt, groupedCount) {
  try {
    let nearbyDriverIds = [];

    if (tripRequest.pickupLat != null && tripRequest.pickupLng != null) {
      try {
        nearbyDriverIds = await redis.geosearch(
          'drivers:online',
          'FROMLONLAT', tripRequest.pickupLng, tripRequest.pickupLat,
          'BYRADIUS', dispatchRadiusKm(), 'km',
          'ASC', 'COUNT', 30
        );
      } catch (_) {
        // Older Redis — fallback
        nearbyDriverIds = await redis.georadius(
          'drivers:online',
          tripRequest.pickupLng, tripRequest.pickupLat,
          dispatchRadiusKm(), 'km',
          'ASC', 'COUNT', 30
        ).catch(() => []);
      }
    }

    // BUGFIX: `fcmToken: { not: null }` used to be a hard filter on BOTH branches
    // below, which meant the eligibility query itself excluded any driver who
    // hadn't (yet) registered a push token — e.g. simulators/emulators, a fresh
    // install before permission is granted, or a token registration that's still
    // in flight. Because the socket emit loop only ever iterated over this same
    // FCM-filtered list (and the function returned early when fcmTokens was
    // empty), those drivers never received the real-time `trip:assigned` socket
    // event either, even though the socket path has nothing to do with FCM.
    // Online + active + in-radius is now the only real-time eligibility
    // criterion; the FCM token is looked up for the *separate*, best-effort
    // push notification only. Also added `isOnline: true` to the geo-radius
    // branch — goOffline() never removes the driver from the `drivers:online`
    // Redis geo-set, so a stale/offline driver could otherwise still surface.
    //
    // BUSY-DRIVER LEAK FIX: both branches now share the single availability
    // rule in services/driver-availability.js. Previously the geo branch only
    // excluded IN_PROGRESS/DRIVER_EN_ROUTE (so a driver who had just accepted a
    // trip, or was running their own self-created bus route, still got offered
    // unrelated riders) and the no-coords fallback branch had NO busy filter at
    // all — it broadcast to every online driver in the system.
    // REDIS-GEO BLIND SPOT FIX ("I requested a trip, the driver app is free,
    // and nothing showed up"): `drivers:online` is only populated by driver
    // location pings. A driver who has just gone online, whose ping hasn't
    // landed yet, or who is running against a Redis that was restarted, is
    // simply absent from the geo-set. Because `ids` is an intersecting filter,
    // ONE unrelated driver being present in the set was enough to switch this
    // query into "geo mode" and silently exclude every driver Redis didn't
    // know about — while the no-coords path happily notified all of them.
    //
    // The geo-set is now treated as a ranking hint, not as the membership
    // list: drivers it returns are preferred, and any other available driver
    // whose last known DB position is inside the same radius is included too.
    const availableDrivers = await prisma.driver.findMany({
      where: availableDriverWhere(),
      select: { id: true, fcmToken: true, currentLat: true, currentLng: true },
    });

    const nearbySet = new Set(nearbyDriverIds);
    const hasPickup = tripRequest.pickupLat != null && tripRequest.pickupLng != null;

    const eligibleDrivers = availableDrivers
      .map((d) => {
        const inGeoSet = nearbySet.has(d.id);
        const distanceKm =
          hasPickup && d.currentLat != null && d.currentLng != null
            ? haversineKm(tripRequest.pickupLat, tripRequest.pickupLng, d.currentLat, d.currentLng)
            : null;
        return { ...d, inGeoSet, distanceKm };
      })
      // With no pickup coordinate there is nothing to filter on, so every
      // available driver is a candidate (unchanged behaviour). With one, keep
      // the geo-set hits plus anyone provably in range; a driver with no known
      // position at all is still included rather than silently dropped —
      // missing telemetry must not cost a rider their ride.
      .filter((d) => !hasPickup || d.inGeoSet || d.distanceKm == null || d.distanceKm <= dispatchRadiusKm())
      // Closest first, geo-set hits ahead of position-less drivers.
      .sort((a, b) => (a.distanceKm ?? Number.MAX_SAFE_INTEGER) - (b.distanceKm ?? Number.MAX_SAFE_INTEGER))
      .slice(0, MAX_DRIVERS_TO_NOTIFY);

    if (eligibleDrivers.length === 0) {
      logger.info('No drivers to notify for trip request', { requestId: tripRequest.id });
      return;
    }

    const fcmTokens = eligibleDrivers.map((d) => d.fcmToken).filter(Boolean);
    if (fcmTokens.length > 0) {
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
    }

    // Also emit a live socket event, mirroring dispatch.service.js's pattern for
    // the pre-scheduled-trip path — without this, on-demand rider requests only
    // ever reached drivers via FCM push, so a driver with the app open in the
    // foreground (no OS push banner) never saw the dispatch screen at all, and
    // the Alerts "Dispatch" tab (fed by the same handler) stayed empty.
    // `kind: 'REQUEST'` tells the client to call acceptTripRequest(id) instead
    // of acceptDispatch(id) — apps/driver/app/(trip)/dispatch/[id].tsx already
    // branches on this.
    try {
      const io = require('../../app').get('io');
      const expiresAt = new Date(Date.now() + 30 * 1000).toISOString();
      const assignedPayload = {
        tripId: tripRequest.id,
        kind: 'REQUEST',
        routeOrigin: 'Pickup nearby',
        routeDestination: destination,
        departureTime: scheduledAt.toISOString(),
        estimatedEarnings: undefined,
        seatCount: groupedCount,
        expiresAt,
      };
      for (const d of eligibleDrivers) {
        io.of('/driver').to(`driver:${d.id}`).emit('trip:assigned', assignedPayload);
      }
    } catch (emitErr) {
      logger.warn('Trip request dispatch socket emit failed (non-blocking):', emitErr.message);
    }

    logger.info('Trip request dispatched', {
      requestId:   tripRequest.id,
      destination,
      driverCount: eligibleDrivers.length,
      pushCount:   fcmTokens.length,
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

  // Kill the in-flight offer chain so no further driver is disturbed by a ride
  // the rider has already walked away from.
  // No cascade to cancel: scheduled requests broadcast rather than cascade
  // (see notifyDriversOfScheduledRequest). Flipping the row to CANCELLED below
  // is what stops a driver claiming it.

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
  // Server-side backstop for the busy-driver rule (services/driver-availability.js).
  // The dispatch/poll paths already hide offers from engaged drivers, but a card
  // left on screen from before they took another trip must not be claimable.
  if (!(await isDriverAvailable(prisma, driverId))) {
    throw new AppError('Finish your current trip before accepting another.', 409, 'DRIVER_BUSY');
  }

  // Stop the cascade before the claim, not after: the next offer is on a timer
  // and would otherwise fire at a second driver while this transaction runs.
  // Nothing to stop before the claim — a scheduled request has no exclusive
  // offer timer. The conditional `updateMany` below is the compare-and-swap
  // that makes exactly one driver win.

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

    // Defaulting missing coordinates to (0,0)/origin (the old behavior) put
    // pickup in the Gulf of Guinea or collapsed dropoff onto pickup whenever a
    // request came from a free-text flow with no map picker (e.g. schedule's
    // "request new destination"). Geocode the free-text destination as a last
    // resort instead of fabricating coordinates that render nonsensically.
    if (tripRequest.pickupLat == null || tripRequest.pickupLng == null) {
      throw new AppError('Trip request is missing a pickup location', 400, 'MISSING_PICKUP_COORDS');
    }
    const originLat = tripRequest.pickupLat;
    const originLng = tripRequest.pickupLng;
    let destLat = tripRequest.destLat;
    let destLng = tripRequest.destLng;
    if (destLat == null || destLng == null) {
      const mapboxService = require('../../services/mapbox.service');
      const geo = await mapboxService.forwardGeocode(tripRequest.destination).catch(() => null)
        ?? await mapboxService.nominatimForwardGeocode(tripRequest.destination).catch(() => null);
      if (geo) { destLat = geo.lat; destLng = geo.lng; }
    }
    const hasDestCoords = destLat != null && destLng != null;
    // Geocoding (both Mapbox and the Nominatim fallback) failed to resolve the
    // free-text destination. Collapsing destLat/destLng onto the pickup point
    // here would silently create a trip whose route destination is a fabricated
    // coordinate (same as pickup) instead of where the rider actually asked to
    // go — block the accept and surface a real error instead.
    if (!hasDestCoords) {
      throw new AppError(
        `Could not determine a location for "${tripRequest.destination}". Ask the rider to pick a destination on the map and try again.`,
        400,
        'MISSING_DEST_COORDS',
      );
    }
    // Road distance, not the crow-flies line: the fare is `base + perKm × km`, so
    // pricing a straight line quotes roughly half the real journey in a city. The
    // driver's create-trip flow resolves the same way (trips.service.createTrip),
    // so an on-demand match and a driver-published trip over the same two points
    // now cost the same. Falls back to haversine × 1.35 when routing is
    // unavailable — see mapbox.service.roadDistanceKm.
    const mapbox = require('../../services/mapbox.service');
    const resolvedDistance = await mapbox.roadDistanceKm(originLat, originLng, destLat, destLng);
    const distanceKm = Math.max(resolvedDistance.distanceKm, 1);

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
        baseFarePesewas: fare.baseFarePesewas,
        perKmRatePesewas: fare.perKmRatePesewas,
        surgeMultiplier: fare.surgeMultiplier,
        maxSeats,
        // DRIVER_EN_ROUTE, not CONFIRMED. This trip only exists because a rider
        // requested a ride *now* and this driver just accepted it — accepting IS
        // setting off for the pickup. Parking it at CONFIRMED made the driver app
        // show a "Start Trip" button they had to tap before anything progressed,
        // while the rider sat watching a driver who appeared not to have moved.
        // "Start Trip" is reserved for genuinely SCHEDULED trips (see
        // TRIP_STATUS_CONFIG in apps/driver/app/(trip)/active/[id].tsx), which is
        // also why claimReassignedTrip already lands on DRIVER_EN_ROUTE.
        status: 'DRIVER_EN_ROUTE',
      },
      include: { route: true, vehicle: true, driver: { select: { name: true, phone: true, profilePhoto: true } } },
    });

    // A rider who asked for seatCount > 1 (booking for their own group, e.g.
    // "me + 3 friends") is handled two ways, per their coverAll choice:
    //  - coverAll=true: book ALL their seats now under their own userId (one
    //    booking per seat — every other consumer in this codebase, from seat
    //    maps to confirmedSeats counters, assumes 1 booking = 1 seat) and
    //    auto-create a RideGroup so a single payment settles every one of
    //    those sibling bookings together (existing isCoverAll settlement
    //    logic in payments.service.js — no changes needed there).
    //  - coverAll=false: book just their own seat; the remaining seats stay
    //    open on the trip (maxSeats above already accounts for them via
    //    totalSeatsNeeded) and a RideGroup is still created so they have an
    //    invite link immediately, for friends to join and pay individually
    //    via the existing invite/join flow (also unchanged).
    const bookings = [];
    for (const r of groupRequests) {
      const seatsRequested = Math.max(r.seatCount || 1, 1);
      const seatsToBookNow = (seatsRequested > 1 && r.coverAll) ? seatsRequested : 1;
      for (let i = 0; i < seatsToBookNow; i++) {
        const booking = await tx.booking.create({
          data: {
            tripId: trip.id,
            userId: r.userId,
            seatNumber: null,
            fareAmountPesewas: fare.farePerPersonPesewas,
            commissionAmountPesewas: fare.commissionPerSeatPesewas,
            paymentMethod: 'CASH',
            paymentStatus: 'PENDING',
            status: 'CONFIRMED',
          },
        });
        bookings.push(booking);
      }
      if (seatsRequested > 1) {
        // RideGroup.tripId is unique — if two different multi-seat requests
        // landed on the same matched trip (rare), only the first can hold
        // it; skip rather than fail the whole accept over an edge case.
        const existingGroup = await tx.rideGroup.findUnique({ where: { tripId: trip.id } });
        if (!existingGroup) {
          await tx.rideGroup.create({
            data: {
              tripId: trip.id,
              leadPassengerId: r.userId,
              isCoverAll: !!r.coverAll,
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
          });
        }
      }
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
            // The trip is created at DRIVER_EN_ROUTE (see above) — the driver is
            // already moving toward the pickup, so say so rather than "accepted".
            `Your driver is on the way to pick you up for ${result.trip.route.destinationName}.`,
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

/**
 * Driver declines an on-demand request offer.
 *
 * Without this the cascade could only advance on the 20-second offer timeout, so
 * a rider whose first three candidates all tapped "Decline" instantly still
 * waited a full minute. Deliberately does NOT touch the TripRequest row — the
 * request stays open, it is only this driver who passed on it.
 */
async function declineTripRequest(driverId, tripRequestId) {
  // A scheduled request is broadcast, so there is no queue to advance — this
  // driver simply stops seeing it. `advanced` stays in the response shape so
  // the driver app's handler is identical for both dispatch kinds.
  const advanced = false;
  // DispatchAction.tripId is a plain string column (no FK), so a TripRequest id
  // is a valid value for it — the audit trail covers both dispatch kinds. A
  // logging failure must never fail the decline itself.
  await prisma.dispatchAction
    .create({ data: { driverId, tripId: tripRequestId, action: 'DECLINED' } })
    .catch(() => {});
  return { declined: true, advanced };
}

module.exports = { createRequest, cancelRequest, acceptTripRequest, declineTripRequest };
