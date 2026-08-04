'use strict';

const prisma = require('../config/database');
const { LIVE_STATUSES } = require('./trip-state.service');
const { peekRouteForTrip } = require('./route-geometry.service');

/**
 * The one shape both apps read a ride in.
 *
 * Rider and driver used to assemble "the current ride" from whatever queries
 * each screen happened to run — a booking here, a trip there, a dispatch
 * progress event somewhere else — so the two apps could and did hold
 * different pictures of the same ride at the same time.
 *
 * There is now exactly one serializer. `GET /v1/me/active-trip`,
 * `GET /v1/driver/state`, the replay endpoint and every `trip:event` push all
 * emit this shape, so "what the client knows" is a pure function of
 * `(status, version)` and nothing else.
 */

/** Everything the serializer needs; used by every caller so shapes can't drift. */
const TRIP_INCLUDE = Object.freeze({
  driver: {
    select: {
      id: true,
      name: true,
      phone: true,
      profilePhoto: true,
      currentLat: true,
      currentLng: true,
      currentHeading: true,
    },
  },
  vehicle: {
    select: { id: true, plateNumber: true, make: true, model: true, year: true, tier: true },
  },
  route: { select: { id: true, name: true, originName: true, destinationName: true, distanceKm: true } },
  bookings: {
    select: {
      id: true,
      userId: true,
      seatNumber: true,
      fareAmountPesewas: true,
      paymentMethod: true,
      paymentStatus: true,
      status: true,
      guestName: true,
      guestPhone: true,
      pickupLat: true,
      pickupLng: true,
      pickupAddress: true,
    },
  },
});

/**
 * @param {object} trip  a Trip loaded with TRIP_INCLUDE
 * @param {{forUserId?: string, forDriverId?: string}} [viewer]
 */
function buildTripSnapshot(trip, viewer = {}) {
  if (!trip) return null;
  const { forUserId = null, path = null } = viewer;

  const myBooking = forUserId
    ? (trip.bookings || []).find((b) => b.userId === forUserId) || null
    : null;

  return {
    // ── identity + the two fields that make every client decision total ──
    tripId: trip.id,
    shortId: trip.shortId,
    status: trip.status,
    // The arbiter. A client that already holds >= this version discards the
    // payload; that single rule is what removes the poll-vs-socket race.
    version: trip.version,
    // Every countdown on both apps renders against this, never Date.now(),
    // so a device with a skewed clock cannot show a different timer.
    serverNowMs: Date.now(),

    isOnDemand: !trip.routeId,
    tier: trip.tier,

    pickup: {
      lat: trip.pickupLat,
      lng: trip.pickupLng,
      address: trip.pickupAddress,
    },
    // Destination is a property of the ride now, not of a Route. `route` is
    // only populated for the group/bus product.
    dropoff: {
      lat: trip.dropoffLat,
      lng: trip.dropoffLng,
      address: trip.dropoffAddress ?? trip.route?.destinationName ?? null,
    },

    driver: trip.driver
      ? {
          id: trip.driver.id,
          name: trip.driver.name,
          phone: trip.driver.phone,
          photo: trip.driver.profilePhoto,
          lat: trip.driver.currentLat,
          lng: trip.driver.currentLng,
          heading: trip.driver.currentHeading,
        }
      : null,
    vehicle: trip.vehicle
      ? {
          plate: trip.vehicle.plateNumber,
          make: trip.vehicle.make,
          model: trip.vehicle.model,
          year: trip.vehicle.year,
          tier: trip.vehicle.tier,
        }
      : null,
    route: trip.route
      ? { id: trip.route.id, name: trip.route.name, distanceKm: trip.route.distanceKm }
      : null,

    // ── The line on the map ──────────────────────────────────────────────
    // The road geometry for whichever leg is live, computed once by the
    // server (route-geometry.service.js) and handed to both apps. Every
    // screen used to call Mapbox Directions itself, so the rider and the
    // driver drew different lines for one ride and the line was re-fetched
    // from scratch on every navigation. Null until the driver's first
    // location fix has produced one, and null for statuses with no leg.
    path: path
      ? {
          leg: path.leg,
          geometry: path.geometry,
          distanceKm: path.distanceKm,
          durationMin: path.durationMin,
          computedAt: path.computedAt,
        }
      : null,

    seats: { confirmed: trip.confirmedSeats, max: trip.maxSeats },

    // Every number in here is an INTEGER NUMBER OF PESEWAS, hence the suffixes.
    // The client formats with `formatGhs` and never does arithmetic on them —
    // a client that adds up fares has to pick a rounding rule, and it will pick
    // a different one from the server that issues the receipt.
    fare: {
      basePesewas: trip.baseFarePesewas,
      perKmPesewas: trip.perKmRatePesewas,
      // Not money: a dimensionless multiplier, so no suffix and no rounding.
      surge: trip.surgeMultiplier,
      // The rider's own money for this ride. Null for a driver viewing it.
      amountPesewas: myBooking ? myBooking.fareAmountPesewas : null,
      paymentMethod: myBooking ? myBooking.paymentMethod : null,
      paymentStatus: myBooking ? myBooking.paymentStatus : null,
    },
    booking: myBooking
      ? { id: myBooking.id, status: myBooking.status, seatNumber: myBooking.seatNumber }
      : null,

    timestamps: {
      requestedAt: trip.requestedAt,
      assignedAt: trip.assignedAt,
      departureTime: trip.departureTime,
      departedAt: trip.departedAt,
      arrivedAt: trip.arrivedAt,
      completedAt: trip.completedAt,
      cancelledAt: trip.cancelledAt,
    },
    cancellation: trip.cancelledAt
      ? { by: trip.cancelledBy, reason: trip.cancellationReason }
      : null,
    redispatchCount: trip.redispatchCount,
  };
}

/**
 * Serialize, with the cached route line attached.
 *
 * `peek`, never `compute`: rendering a snapshot must not be able to block on a
 * Mapbox round trip, and must not be a way for a client to spend Directions
 * quota by refreshing. The line is produced by the driver's location pipeline;
 * this only hands over whatever that has most recently published.
 */
async function buildTripSnapshotWithPath(trip, viewer = {}) {
  if (!trip) return null;
  let path = null;
  try {
    path = await peekRouteForTrip(trip);
  } catch {
    // A snapshot without a line is still a correct snapshot.
  }
  return buildTripSnapshot(trip, { ...viewer, path });
}

/** Load + serialize in one call. */
async function loadTripSnapshot(tripId, viewer = {}) {
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, include: TRIP_INCLUDE });
  return buildTripSnapshotWithPath(trip, viewer);
}

/**
 * The rider's current ride, if any.
 *
 * A rider is on a trip either because they requested it (on-demand) or because
 * they hold a live booking on it (group/bus). Both are checked, so a rider who
 * joined a friend's group trip rehydrates the same way an on-demand rider does.
 */
async function findActiveTripForUser(userId) {
  const trip = await prisma.trip.findFirst({
    where: {
      status: { in: LIVE_STATUSES },
      OR: [
        { requesterId: userId },
        {
          bookings: {
            some: {
              userId,
              status: { in: ['PENDING', 'SEAT_HELD', 'CONFIRMED', 'PAID', 'BOARDED'] },
            },
          },
        },
      ],
    },
    orderBy: { createdAt: 'desc' },
    include: TRIP_INCLUDE,
  });
  return trip;
}

/** The driver's current ride, if any. */
async function findActiveTripForDriver(driverId) {
  return prisma.trip.findFirst({
    where: { driverId, status: { in: LIVE_STATUSES } },
    orderBy: { createdAt: 'desc' },
    include: TRIP_INCLUDE,
  });
}

module.exports = {
  TRIP_INCLUDE,
  buildTripSnapshot,
  buildTripSnapshotWithPath,
  loadTripSnapshot,
  findActiveTripForUser,
  findActiveTripForDriver,
};
