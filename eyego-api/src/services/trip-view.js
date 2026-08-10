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
 * Statuses where one party may legitimately phone the other: a driver is
 * attached and the ride has not finished. Deliberately excludes every terminal
 * status — the ride is over, so the reason to have the number is too.
 */
const CONTACTABLE_STATUSES = new Set([
  'DRIVER_ASSIGNED',
  'DRIVER_EN_ROUTE',
  'ARRIVED_AT_PICKUP',
  'IN_PROGRESS',
  // The group/bus product attaches a driver well before departure, and a rider
  // with a seat on a scheduled bus has a real reason to call about the pickup.
  'SCHEDULED',
  'FILLING',
  'CONFIRMED',
]);

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

    /**
     * BUGFIX ("on the rider tracking page the pickup point is shown as the
     * placeholder pickup, but the destination is correctly showing the one i
     * put there").
     *
     * This read the TRIP's pickup unconditionally. For a group/bus trip that
     * is the driver's route origin — a generic point the rider never chose —
     * while the rider's own pickup lives on THEIR booking, which they set on
     * the invite/seat screen and which the deviation surcharge is charged
     * against. So the panel showed a stranger's kerb next to the rider's real
     * destination, which is why only one of the two looked wrong.
     *
     * A rider is shown where THEY are being collected; the trip's own pickup
     * remains the answer for the driver (no `forUserId`) and for any rider who
     * never set one. `TRIP_INCLUDE` already selects these three booking fields.
     */
    pickup:
      myBooking && myBooking.pickupLat != null && myBooking.pickupLng != null
        ? {
            lat: myBooking.pickupLat,
            lng: myBooking.pickupLng,
            address: myBooking.pickupAddress ?? trip.pickupAddress,
          }
        : {
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
          /**
           * The driver's REAL personal number, so it is scoped to the window
           * where calling them is a legitimate thing to do.
           *
           * It used to be on every snapshot unconditionally. That meant a
           * rider kept their driver's personal mobile number in the app after
           * the ride ended — and, because every `trip:event` carries the whole
           * snapshot, in the replayable event log as well. A ride-hailing
           * platform handing out a driver's private number permanently, from a
           * single trip, is the thing number masking exists to prevent.
           *
           * Proper masking needs a telephony relay (see
           * modules/contact/contact.service.js — the CallSession model and the
           * endpoints are built, but `initiateCall` returns a sandbox
           * placeholder until Twilio Proxy or Africa's Talking is
           * provisioned). Until then, direct dial during a live ride is the
           * right trade — a rider who cannot reach their driver at the kerb is
           * a worse safety outcome than an exposed number — but there is no
           * argument at all for keeping it afterwards.
           */
          phone: CONTACTABLE_STATUSES.has(trip.status) ? trip.driver.phone : null,
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

    /**
     * Who is actually riding, when the booker is not the passenger.
     *
     * Null for an ordinary ride. Populated when the trip was booked on someone
     * else's behalf, so the driver's screen can say "picking up Ama" rather
     * than the account holder's name, and the booker's own screen can confirm
     * whose ride they are watching. Read from the trip's bookings rather than
     * `myBooking`, because for the DRIVER there is no `myBooking` at all.
     */
    passenger: (() => {
      const withGuest = (trip.bookings ?? []).find(
        (b) => b.guestName && !['CANCELLED'].includes(b.status),
      );
      return withGuest
        ? { name: withGuest.guestName, phone: withGuest.guestPhone ?? null }
        : null;
    })(),

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
