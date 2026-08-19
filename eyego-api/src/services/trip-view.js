'use strict';

const prisma = require('../config/database');
const { LIVE_STATUSES } = require('./trip-state.service');
const { peekRouteForTrip } = require('./route-geometry.service');
const { SEAT_OCCUPYING_STATUSES } = require('../utils/booking-status');
const supply = require('./supply-index.service');
const env = require('../config/env');

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
  /**
   * The route's own endpoints, which the snapshot falls back to for a group/bus
   * trip — those trips carry NULL pickup/dropoff on the Trip row because the
   * geography belongs to the Route.
   *
   * The four coordinate columns were missing from this select while the
   * serializer below already read `trip.route.destLat` / `destLng`. Prisma
   * simply does not return an unselected column, so those reads were
   * `undefined` and the destination fell through to `null` — a group trip
   * published a snapshot with no destination pin at all, and the rider's map
   * drew a route line that stopped in mid-air. `originName` was selected but
   * never consulted, which is the other half of the same bug: the activity list
   * rendered "Unknown → Unknown" for every group trip.
   */
  route: {
    select: {
      id: true, name: true,
      originName: true, destinationName: true,
      originLat: true, originLng: true,
      destLat: true, destLng: true,
      distanceKm: true,
    },
  },
  /**
   * The ride group, so the DRIVER's snapshot can say "these seats belong to one
   * party and the whole trip is paid for".
   *
   * BUGFIX ("when a rider pays for the entire trip the driver app doesn't show
   * that the seats are mapped to that group, or that the trip is paid"). The
   * covered seats were real bookings all along — but with the group nowhere in
   * the payload the driver's seat map had no way to tell twelve strangers apart
   * from one host with eleven guests, and no way to tell that the money was in.
   */
  group: {
    select: {
      id: true,
      isCoverAll: true,
      leadPassengerId: true,
      leadPassenger: { select: { id: true, name: true } },
    },
  },
  bookings: {
    /**
     * SEAT-OCCUPYING ROWS ONLY.
     *
     * Unfiltered, this handed every consumer the trip's cancelled history too:
     * `fare.amountPesewas` summed released holds and cover-all-off rows into the
     * rider's total, and the seat data carried passengers who are not coming.
     * Same predicate as every other occupancy query — see utils/booking-status.js.
     */
    where: { status: { in: SEAT_OCCUPYING_STATUSES } },
    select: {
      id: true,
      userId: true,
      seatNumber: true,
      fareAmountPesewas: true,
      paymentMethod: true,
      paymentStatus: true,
      status: true,
      // Distinguishes a seat the group's host BOUGHT from the seat they SIT
      // in, so the snapshot can sum their money without also claiming they are
      // four passengers.
      isCoveredByLead: true,
      // Part of the money, so part of the payload: a total whose own line items
      // are missing is a total the rider cannot check.
      heavyCargo: true,
      deviationSurchargePesewas: true,
      guestName: true,
      guestPhone: true,
      pickupLat: true,
      pickupLng: true,
      pickupAddress: true,
      /**
       * THE RIDE CODE — SELECTED HERE, PROJECTED ONLY ONTO `myBooking`.
       *
       * BUGFIX ("the pin code for the verification is still not showing on the
       * rider app"). The projection below has read `myBooking.boardingPin`
       * since the feature was built, and these three columns were never in the
       * select — so it read `undefined` on every snapshot and the rider's card
       * rendered its own "no pin" branch forever. The socket-frame gap was the
       * second half of the bug; this was the first.
       *
       * Safe to select and NOT safe to project blindly: only the `myBooking`
       * block hands the digits out, and `myBooking` is resolved from
       * `forUserId`, so a driver's snapshot never has one. Anything that starts
       * projecting raw booking rows must strip these.
       */
      boardingPin: true,
      pinVerifiedAt: true,
      pinRequestedAt: true,
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
 * Statuses where a driver is attached and expected to be reporting a position.
 * Outside these there is no link to lose: nobody is driving toward anyone.
 */
const ACTIVE_LINK_STATUSES = new Set([
  'DRIVER_ASSIGNED',
  'DRIVER_EN_ROUTE',
  'ARRIVED_AT_PICKUP',
  'IN_PROGRESS',
]);

/**
 * @param {object} trip  a Trip loaded with TRIP_INCLUDE
 * @param {{forUserId?: string, forDriverId?: string}} [viewer]
 */
function buildTripSnapshot(trip, viewer = {}) {
  if (!trip) return null;
  const { forUserId = null, path = null, driverLinkLostSinceMs } = viewer;

  /**
   * Every seat this viewer is paying for, not just the first one found.
   *
   * A rider who chose "I'll pay for everyone" owns one booking per covered
   * seat (see bookings.service `syncCoveredSeatsTx`). `find` returned whichever
   * of those Prisma happened to order first and the tracking page then showed
   * ONE seat's fare — reported as "I'm paying for everyone but the tracking
   * page says 4.80". Their own seat stays the identity of the ride; the money
   * is the sum across all of them.
   */
  const allBookings = trip.bookings || [];
  /**
   * Seats this viewer is settling.
   *
   * BUGFIX ("I paid for everyone, the hub totalled 36, the tracking page said
   * 8"). Under cover-all the host also settles any seat a joiner had already
   * taken before the switch went on — that is what `initiatePayment` charges for
   * and what `confirmPayment` marks paid. Counting only rows with the host's own
   * userId therefore showed a number smaller than the one they were charged.
   * Same predicate as bookings.service `getTripFareForRider`, deliberately.
   */
  const isCoverAllLead = !!(
    forUserId && trip.group?.isCoverAll && trip.group.leadPassengerId === forUserId
  );
  const myBookings = forUserId
    ? allBookings.filter(
        (b) => b.userId === forUserId || (isCoverAllLead && b.status === 'SEAT_HELD'),
      )
    : [];
  // Prefer the seat they actually sit in over one they merely bought.
  const myBooking =
    myBookings.find((b) => b.userId === forUserId && !b.isCoveredByLead) ??
    myBookings.find((b) => b.userId === forUserId) ??
    myBookings[0] ??
    null;
  const myFarePesewas = myBookings.length
    ? myBookings.reduce((n, b) => n + (b.fareAmountPesewas || 0), 0)
    : null;
  const mySeatsPaidFor = myBookings.length;
  const myCargoSurchargePesewas = myBookings.reduce(
    (n, b) => n + (b.heavyCargo ? env.HEAVY_LOAD_SURCHARGE_PESEWAS : 0),
    0,
  );
  const myDeviationSurchargePesewas = myBookings.reduce(
    (n, b) => n + (b.deviationSurchargePesewas || 0),
    0,
  );

  /** A seat with money behind it: paid outright, or a confirmed cash seat. */
  const isSettled = (b) =>
    b.paymentStatus === 'PAID' || ['CONFIRMED', 'BOARDED', 'COMPLETED'].includes(b.status);
  const paidSeatCount = allBookings.filter((b) => b.paymentStatus === 'PAID').length;
  const settledSeatCount = allBookings.filter(isSettled).length;

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
     *
     * BUGFIX 2 ("on the activity page every trip just says Unknown"). The
     * trip-level branch read `trip.pickupLat/Lng/Address` and stopped there. A
     * group/bus trip has all three NULL — its geography is the Route's — so
     * every such trip serialized a pickup of `{null, null, null}` and both apps
     * printed their "Unknown" placeholder. The dropoff below already knew to
     * fall back to the route; the pickup never did.
     */
    pickup:
      myBooking && myBooking.pickupLat != null && myBooking.pickupLng != null
        ? {
            lat: myBooking.pickupLat,
            lng: myBooking.pickupLng,
            address: myBooking.pickupAddress ?? trip.pickupAddress ?? trip.route?.originName ?? null,
          }
        : {
            lat: trip.pickupLat ?? trip.route?.originLat ?? null,
            lng: trip.pickupLng ?? trip.route?.originLng ?? null,
            address: trip.pickupAddress ?? trip.route?.originName ?? null,
          },
    // Destination is a property of the ride now, not of a Route. `route` is
    // only populated for the group/bus product — and for THOSE trips the
    // coordinates live on the route, not on the trip.
    //
    // The address already fell back to the route; the coordinates did not, so
    // a group trip published `{lat: null, lng: null}` and the rider's map had
    // nothing to put a destination pin on — the route line simply stopped in
    // mid-air. `legEndpoints` in route-geometry.service.js has always consulted
    // both; this is the same rule, applied to the snapshot.
    dropoff: {
      lat: trip.dropoffLat ?? trip.route?.destLat ?? null,
      lng: trip.dropoffLng ?? trip.route?.destLng ?? null,
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

    // `paid`/`settled` are derived from the booking rows, not from the
    // `confirmedSeats` counter, so a driver reading this cannot be told a seat is
    // sold by a counter that a held-then-abandoned booking nudged.
    seats: {
      confirmed: trip.confirmedSeats,
      max: trip.maxSeats,
      occupied: allBookings.length,
      paid: paidSeatCount,
      settled: settledSeatCount,
    },

    /**
     * WHO IS PAYING FOR WHOM — the driver's answer to a van full of one party.
     *
     * Present only when a ride group exists. `coverAll` means one passenger is
     * settling the seats in `seatNumbers`; `settled` is true once every one of
     * them has money behind it, which is the "the whole trip is paid" the driver
     * needs before departing on a single passenger's word.
     */
    group: trip.group
      ? (() => {
          const leadSeats = allBookings.filter(
            (b) => b.userId === trip.group.leadPassengerId || b.isCoveredByLead,
          );
          const covered = trip.group.isCoverAll ? allBookings : leadSeats;
          return {
            id: trip.group.id,
            coverAll: !!trip.group.isCoverAll,
            leadUserId: trip.group.leadPassengerId,
            leadName: trip.group.leadPassenger?.name ?? null,
            seatCount: covered.length,
            seatNumbers: covered
              .map((b) => b.seatNumber)
              .filter((n) => n != null)
              .sort((a, b) => a - b),
            totalPesewas: covered.reduce((n, b) => n + (b.fareAmountPesewas || 0), 0),
            settledSeatCount: covered.filter(isSettled).length,
            settled: covered.length > 0 && covered.every(isSettled),
            paymentMethod: covered[0]?.paymentMethod ?? null,
          };
        })()
      : null,

    // Every number in here is an INTEGER NUMBER OF PESEWAS, hence the suffixes.
    // The client formats with `formatGhs` and never does arithmetic on them —
    // a client that adds up fares has to pick a rounding rule, and it will pick
    // a different one from the server that issues the receipt.
    fare: {
      basePesewas: trip.baseFarePesewas,
      perKmPesewas: trip.perKmRatePesewas,
      // Not money: a dimensionless multiplier, so no suffix and no rounding.
      surge: trip.surgeMultiplier,
      // The rider's own money for this ride — SUMMED across every seat they
      // are paying for, so a host covering the group sees the group's total
      // and not one seat of it. Null for a driver viewing it.
      amountPesewas: myFarePesewas,
      /** How many seats that total covers. 1 for an ordinary rider. */
      seatsPaidFor: mySeatsPaidFor || null,
      /**
       * The per-seat price implied by the total, with the extras taken back out.
       *
       * BUGFIX ("the receipt says one seat at 8 cedis; it was 36 and the seat is
       * 3"). Every receipt that showed a unit price read it off a separately
       * computed `trip.farePerSeatPesewas`, so a total that carried a surcharge
       * disagreed with its own unit price. Derived FROM the total here: seats ×
       * this + the surcharges below is the total, by construction.
       */
      perSeatPesewas:
        mySeatsPaidFor > 0
          ? Math.round(
              (myFarePesewas - myCargoSurchargePesewas - myDeviationSurchargePesewas) /
                mySeatsPaidFor,
            )
          : null,
      cargoSurchargePesewas: myCargoSurchargePesewas,
      deviationSurchargePesewas: myDeviationSurchargePesewas,
      paymentMethod: myBooking ? myBooking.paymentMethod : null,
      paymentStatus: myBooking ? myBooking.paymentStatus : null,
    },
    booking: myBooking
      ? {
          id: myBooking.id,
          status: myBooking.status,
          seatNumber: myBooking.seatNumber,
          /**
           * "Verify My Ride" — the code the rider shows their driver.
           *
           * Sits on `myBooking`, which is resolved from `forUserId`, so it is
           * only ever present in the snapshot built FOR the rider who owns the
           * booking. The driver's snapshot has no `myBooking` at all, which is
           * the point: a driver who could read the code would not have to be
           * told it, and the whole check would prove nothing.
           *
           * Dropped once verified so the rider's screen stops showing a code
           * that has already been used.
           */
          boardingPin: myBooking.pinVerifiedAt ? null : myBooking.boardingPin ?? null,
          pinVerified: !!myBooking.pinVerifiedAt,
          /**
           * THE DRIVER IS ASKING, RIGHT NOW — and this is the copy that
           * survives a backgrounded app.
           *
           * `BOARDING_PIN_REQUESTED` rides an unsequenced socket frame, so it
           * cannot be replayed; a rider switching back from the driver app on
           * the same handset was never told. Carrying the ask on the snapshot
           * means every path that rebuilds the trip — cold start, foreground
           * hydrate, reconnect, plain refetch — raises the sheet.
           *
           * Suppressed once verified, for the same reason `boardingPin` is: a
           * code already used is not a code to show.
           */
          pinRequestedAtMs:
            myBooking.pinVerifiedAt || !myBooking.pinRequestedAt
              ? null
              : new Date(myBooking.pinRequestedAt).getTime(),
        }
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

    /**
     * `null` = the driver is reporting, `number` = silent since that instant,
     * `undefined` = we could not tell, keep whatever you had. Only the
     * with-path builder can answer it; the plain builder leaves it undefined so
     * a cheap snapshot never claims a driver is fine when it never looked.
     */
    driverLinkLostSinceMs,
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

  /**
   * IS THE DRIVER'S PHONE STILL REPORTING? — on the snapshot, not only in a
   * frame you had to be awake for.
   *
   * BUGFIX ("when the rider app says driver signal lost, the only way to get it
   * back is to close the app and open it again").
   *
   * `DRIVER_LINK_LOST` / `DRIVER_LINK_RESTORED` are published with no trip seq,
   * so the trip channel cannot replay either of them. The rider's flag was
   * therefore raised and lowered by frames alone, and a missed RESTORED left a
   * permanent warning that only a fresh store — i.e. a restart — could clear.
   *
   * Presence is a Redis key with a TTL, so this is one cheap membership check
   * and it is the same source `driver-link-watch` reads. Putting it on the
   * snapshot means every hydrate, foreground and reconnect settles the question
   * from the server's own current answer.
   *
   * `undefined` on failure rather than `false`, deliberately: a Redis blip must
   * read as "no opinion" so the client keeps whatever it had, not as "the driver
   * is fine" (which would hide a real outage) and not as "the driver is gone"
   * (which would tell every rider at once that they had lost their driver).
   */
  let driverLinkLostSinceMs;
  if (trip.driverId && ACTIVE_LINK_STATUSES.has(trip.status)) {
    try {
      const present = await supply.whichArePresent([trip.driverId]);
      driverLinkLostSinceMs = present.has(trip.driverId)
        ? null
        : new Date(trip.updatedAt ?? Date.now()).getTime();
    } catch {
      driverLinkLostSinceMs = undefined;
    }
  } else {
    // No driver attached, or the ride is over — there is no link to lose.
    driverLinkLostSinceMs = null;
  }

  return buildTripSnapshot(trip, { ...viewer, path, driverLinkLostSinceMs });
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
