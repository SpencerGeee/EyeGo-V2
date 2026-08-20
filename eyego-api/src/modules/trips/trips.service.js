'use strict';

const { formatGhs, percentOf, assertPesewas } = require('../../utils/money');

const prisma = require('../../config/database');
const env = require('../../config/env');
const { calculateFare, estimateFare, haversineKm } = require('./fare.calculator');
const { availableDriverWhere } = require('../../services/driver-availability');
const { NotFoundError, ConflictError, ForbiddenError, AppError } = require('../../utils/errors');
const { v4: uuidv4 } = require('uuid');
const surgeService = require('./surge.service');
const pushService = require('../../services/push.service');
const pubSub = require('../../graphql/pubsub');
const logger = require('../../utils/logger');
const mapboxService = require('../../services/mapbox.service');
const ratingIntegrity = require('../../services/rating-integrity.service');
const tripState = require('../../services/trip-state.service');
const { seatOccupyingWhere } = require('../../utils/booking-status');
const routeGeometry = require('../../services/route-geometry.service');

async function createTrip(driverId, data) {
  const {
    routeId, vehicleId: requestedVehicleId, departureTime, doorstepPickup, pickupLat, pickupLng, pickupAddress, heavyLoad, availableSeats,
    // Ad-hoc pickup/destination — the group/on-demand booking model: the driver sets an exact
    // map pickup point and destination for THIS trip instead of picking from a predefined route.
    originLat, originLng, originName, destLat, destLng, destinationName,
  } = data;
  const tier = data.tier || 'ECONOMY';

  // Auto-select vehicle: use provided vehicleId or fall back to driver's first active vehicle
  let vehicle;
  if (requestedVehicleId) {
    vehicle = await prisma.vehicle.findFirst({ where: { id: requestedVehicleId, driverId, isActive: true } });
  } else {
    vehicle = await prisma.vehicle.findFirst({ where: { driverId, isActive: true } });
  }

  // DEV MODE: auto-seed a trial vehicle + activate driver if missing
  if (!vehicle && env.NODE_ENV === 'development') {
    const devPlate = `DEV-${driverId.slice(0, 8).toUpperCase()}`;
    const [devVehicle] = await prisma.$transaction(async (tx) => {
      // Activate driver + top up wallet to minimum
      const minBalance = env.DRIVER_REQUIRED_WALLET_TO_GO_ONLINE_PESEWAS ?? 20;
      const driver = await tx.driver.findUnique({ where: { id: driverId }, select: { id: true, walletBalancePesewas: true, status: true } });
      if (driver) {
        const currentBalance = driver.walletBalancePesewas ?? 0;
        const topUp = currentBalance < minBalance ? minBalance - currentBalance : 0;
        const updates = { status: 'ACTIVE' };
        if (topUp > 0) {
          updates.walletBalancePesewas = { increment: topUp };
        }
        await tx.driver.update({ where: { id: driverId }, data: updates });
        if (topUp > 0) {
          await tx.walletTransaction.create({
            data: {
              driverId,
              type: 'TOP_UP',
              amountPesewas: topUp,
              description: 'Dev-createTrip wallet top-up',
              balanceBeforePesewas: currentBalance,
              balanceAfterPesewas: currentBalance + topUp,
            },
          });
        }
      }

      // Remove any previously created dev vehicles for this driver to avoid plateNumber conflict
      await tx.vehicle.deleteMany({ where: { driverId, plateNumber: { startsWith: 'DEV-' } } });

      // Create trial vehicle
      return Promise.all([
        tx.vehicle.create({
          data: {
            driverId,
            plateNumber: devPlate,
            make: 'Toyota',
            model: 'Hiace',
            year: 2024,
            seaterCount: 14,
            tier: 'ECO',
            isVerified: true,
            isActive: true,
          },
        }),
      ]);
    });
    vehicle = devVehicle;
  }

  if (!vehicle) throw new AppError('No vehicle registered. Please add a vehicle in your profile before publishing a trip.', 400, 'NO_VEHICLE');

  /**
   * THE SEAT COUNT THE DRIVER CHOSE, OR A REFUSAL — NEVER A SILENT DOWNGRADE.
   *
   * BUGFIX ("on the driver app i chose 14 seats but on the tracking page it's
   * showing just 12"). `maxSeats` was written as
   *
   *   (availableSeats > 0 && availableSeats <= vehicle.seaterCount)
   *     ? availableSeats : vehicle.seaterCount
   *
   * so a request for 14 against a vehicle row that says 12 fell through the
   * ternary and published a 12-seat trip, with a 201 and no mention of it. The
   * driver's own create screen caps its stepper at the vehicle's capacity, but it
   * defaults to 14 while that query is in flight and whenever the driver has no
   * ACTIVE vehicle row to read it from — so the two sides disagree exactly when
   * the vehicle record is the thing that is wrong.
   *
   * A 12-seater genuinely cannot carry 14, so the capacity stays authoritative;
   * what changes is that exceeding it is now an error the driver can see and act
   * on (fix the vehicle record) rather than a number that quietly changed under
   * them after they published. Everything downstream — the per-seat fare
   * denominator, the seat map, the rider listing — is derived from `maxSeats`,
   * which is why a wrong one cannot be allowed through quietly.
   */
  if (availableSeats != null) {
    const requested = Number(availableSeats);
    if (!Number.isInteger(requested) || requested < 1) {
      throw new AppError('Seat count must be a whole number of at least 1.', 400, 'INVALID_SEAT_COUNT');
    }
    if (requested > vehicle.seaterCount) {
      throw new AppError(
        `You selected ${requested} seats but ${vehicle.plateNumber ?? 'your vehicle'} is registered as a ` +
          `${vehicle.seaterCount}-seater. Update the vehicle in your profile, or publish ${vehicle.seaterCount} seats.`,
        400,
        'SEATS_EXCEED_VEHICLE',
      );
    }
  }

  if (!routeId && (originLat == null || originLng == null || destLat == null || destLng == null)) {
    throw new AppError('Pickup and destination locations are required.', 400, 'MISSING_LOCATION');
  }
  if (routeId) {
    const existingRoute = await prisma.route.findUnique({ where: { id: routeId } });
    if (!existingRoute) throw new NotFoundError('Route');
  }

  /**
   * THE RATES THIS TRIP IS LOCKED TO — FROM THE CARD THAT ACTUALLY PRICES IT.
   *
   * These two columns are the price lock: whatever is stamped here is what
   * `calculateFare` uses for the life of the trip, so a rider mid-booking cannot
   * be re-priced by an operator retuning the console. They therefore have to be
   * the rates the calculator READS, and it now reads the on-demand tier card for
   * group trips too (see the note above `calculateFare`). Stamping the retired
   * shared-trip knobs here would have locked every new group trip to the old
   * two-part model and made the new card unreachable.
   *
   * `settings.get` rather than `env.*`: these are runtime-tunable, and a trip
   * created after an operator changed a rate should carry the changed rate.
   */
  const normalizedTier = tier === 'COMFORT' ? 'COMFORT' : tier === 'PREMIUM' ? 'PREMIUM' : 'ECO';
  const settings = require('../../config/settings');
  const baseFarePesewas = settings.get(`RIDE_${normalizedTier}_START_FARE_PESEWAS`);
  const perKmRatePesewas = settings.get(`RIDE_${normalizedTier}_PER_KM_PESEWAS`);

  // Record supply and get surge multiplier — use the trip's real origin (ad-hoc
  // pickup point) when there's no separate doorstep-pickup override.
  const surgeLat = pickupLat ?? originLat;
  const surgeLng = pickupLng ?? originLng;
  let surgeMultiplier = 1.0;
  if (surgeLat && surgeLng) {
    await surgeService.recordSupply(surgeLat, surgeLng, driverId);
    surgeMultiplier = await surgeService.getSurgeMultiplier(surgeLat, surgeLng);
  }

  // Ad-hoc distance is resolved BEFORE the transaction — it is an outbound HTTP
  // call and must never run inside a serializable transaction.
  //
  // BUGFIX (the ₵700-vs-₵350 fare split between the two apps): this used to be a
  // haversine straight line between the two pins, while the driver's create-trip
  // preview priced the ROAD distance it had already fetched for the route line.
  // Road distance is 1.3–2× the straight line, so the preview and the persisted
  // trip disagreed by that factor and every downstream fare inherited it.
  // `roadDistanceKm` is now the single answer to "how far is it".
  let adHocDistanceKm = null;
  if (!routeId) {
    const resolved = await mapboxService.roadDistanceKm(originLat, originLng, destLat, destLng);
    adHocDistanceKm = Math.max(resolved.distanceKm, 0.1);
  }

  // Ad-hoc route + Trip creation wrapped in one transaction: if Trip.create fails for any
  // reason (bad departureTime, DB error), the just-created ad-hoc Route row rolls back with
  // it instead of being left as a permanent orphan — Route.isAdHoc rows should exist 1:1 with
  // a live Trip, since nothing else in the app (admin included) ever reads/reuses one.
  const trip = await prisma.$transaction(async (tx) => {
    let route;
    if (routeId) {
      route = await tx.route.findUnique({ where: { id: routeId } });
    } else {
      // Ad-hoc trip: driver set an exact pickup + destination on the map instead of choosing
      // from a predefined route. Reuses the Route/Trip relation as-is (no Trip schema change) —
      // same pattern trip-request.service.js already uses for rider-initiated on-demand requests.
      const distanceKm = adHocDistanceKm ?? Math.max(haversineKm(originLat, originLng, destLat, destLng), 0.1);
      route = await tx.route.create({
        data: {
          name: `${originName ?? 'Pickup'} → ${destinationName ?? 'Destination'}`,
          originName: originName ?? 'Pickup point',
          destinationName: destinationName ?? 'Destination',
          originLat, originLng, destLat, destLng,
          distanceKm,
          isAdHoc: true,
        },
      });
    }

    return tx.trip.create({
      data: {
        driverId,
        vehicleId: vehicle.id,
        routeId: route.id,
        tier: normalizedTier,
        departureTime: new Date(departureTime),
        doorstepPickup: doorstepPickup || false,
        pickupLat, pickupLng, pickupAddress,
        heavyLoad: heavyLoad || false,
        baseFarePesewas,
        perKmRatePesewas,
        surgeMultiplier,
        // Validated above, so this is the driver's own number whenever they sent
        // one — no fall-through that changes it behind their back.
        maxSeats: availableSeats != null ? Number(availableSeats) : vehicle.seaterCount,
        status: 'SCHEDULED',
      },
      include: { route: true, vehicle: true, driver: { select: { name: true, profilePhoto: true } } },
    });
  });

  // Attach farePerSeatPesewas + totalTripCostPesewas immediately so the driver app shows the
  // same per-seat price the rider will see — no waiting for the next refetch.
  // Always use maxSeats as the denominator: that is the capacity the driver
  // chose for this trip and must match what riders see on the listing.
  const fareInfo = estimateFare({
    tier: trip.tier,
    distanceKm: trip.route?.distanceKm ?? 0,
    doorstepPickup: trip.doorstepPickup,
    heavyLoad: trip.heavyLoad,
    surgeMultiplier: trip.surgeMultiplier,
    storedBaseFarePesewas: trip.baseFarePesewas,
    storedPerKmRatePesewas: trip.perKmRatePesewas,
    availableSeats: trip.maxSeats,
  });
  trip.farePerSeatPesewas = fareInfo.farePerPersonPesewas;
  trip.totalTripCostPesewas = fareInfo.totalTripCostPesewas;

  // NO DISPATCH HERE. This creates a driver-owned group/bus trip — the driver
  // is already attached, so there is nobody to dispatch to.
  //
  // What used to be here was `setImmediate(() => dispatchToNearbyDrivers(trip))`:
  // the SECOND dispatch path. It broadcast to five drivers at once with no
  // rider-facing progress, so which experience a rider got depended on which
  // booking flow created the trip — one of them gave "driver 2 of 8, 20s left",
  // the other gave a silent spinner. It was also unawaited, so if it threw, the
  // request had already returned 200 and nothing ever dispatched, with no error
  // anywhere. On-demand dispatch is now the single path in modules/rides.
  return trip;
}

// Driver phone is deliberately excluded from every other trip/booking query
// (privacy — trip listings are visible to any rider browsing, not just those
// booked). The chat call button needs a real number to dial, so expose it
// through a narrow, auth-gated lookup instead: only a rider with an active
// booking on THIS trip can resolve it.
async function getTripDriverPhone(tripId, userId) {
  const booking = await prisma.booking.findFirst({
    where: { tripId, userId, status: { notIn: ['CANCELLED', 'NO_SHOW'] } },
  });
  if (!booking) throw new AppError('You do not have an active booking on this trip', 403, 'NOT_BOOKED');
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, select: { driver: { select: { phone: true } } } });
  if (!trip?.driver?.phone) throw new NotFoundError('Driver contact');
  return trip.driver.phone;
}

/** Statuses at which a trip is still a public, joinable listing. */
const PUBLICLY_VISIBLE_TRIP_STATUSES = ['SCHEDULED', 'FILLING'];

/**
 * Trip detail.
 *
 * PRIVACY FIX (item: "riders and drivers confined to their own environments"):
 * this took only an id and returned everything to any authenticated caller.
 * Because ids are the same cuids the client already holds, any rider could
 * read ANY trip — including one already under way for somebody else — and the
 * payload handed over the driver's live GPS coordinates plus every booking's
 * `userId`, `guestName`, seat and payment status. Enumerating other people's
 * rides and watching their driver move required nothing but a trip id.
 *
 * Access is now: the trip is a public listing anyone may browse, OR the caller
 * is actually on it (has a live booking). Anything else 404s — deliberately
 * "not found" rather than "forbidden", so the endpoint can't be used to probe
 * which trip ids exist. Co-passenger identities and driver telemetry are only
 * attached for callers who are genuinely on the trip.
 *
 * @param {string} id
 * @param {string|null} viewerUserId authenticated rider's id (controller supplies it)
 */
async function getTrip(id, viewerUserId = null) {
  const trip = await prisma.trip.findUnique({
    where: { id },
    include: {
      route: { include: { virtualStops: { where: { isActive: true }, orderBy: { sequence: 'asc' } } } },
      vehicle: true,
      // `currentHeading` matters as much as the coordinates: without it the
      // rider's vehicle marker renders pointing due north until the SECOND live
      // socket fix arrives (the client can only derive a bearing once it has two
      // positions), so the car sat on the map facing the wrong way.
      driver: {
        select: {
          id: true, name: true, profilePhoto: true,
          currentLat: true, currentLng: true, currentHeading: true,
        },
      },
      bookings: {
        where: { ...seatOccupyingWhere() },
        // `fareAmountPesewas` is what was actually charged. It is the only
        // record of an on-demand ride's price — see the fare block below — so
        // it has to be selected here, before the privacy remap strips the
        // bookings down for a browsing stranger.
        select: {
          id: true, seatNumber: true, status: true, paymentStatus: true,
          userId: true, isOffline: true, guestName: true, fareAmountPesewas: true,
        },
      },
    },
  });
  if (!trip) throw new NotFoundError('Trip');

  // Captured, then removed from the payload again: it is needed for the
  // aggregate below, and nothing on the wire should gain a per-passenger price
  // it did not have before — on a shared trip a promo or a deviation surcharge
  // makes those differ, and one passenger does not get to read another's.
  const chargedFaresPesewas = trip.bookings.map((b) => b.fareAmountPesewas ?? 0);
  for (const b of trip.bookings) delete b.fareAmountPesewas;

  const isOnTrip = !!viewerUserId && trip.bookings.some((b) => b.userId === viewerUserId);
  const isPublicListing =
    PUBLICLY_VISIBLE_TRIP_STATUSES.includes(trip.status) && trip.route?.isActive !== false;

  if (!isOnTrip && !isPublicListing) throw new NotFoundError('Trip');

  if (!isOnTrip) {
    // Browsing a listing needs seat occupancy, not who is in those seats, and
    // certainly not where the driver physically is right now.
    trip.bookings = trip.bookings.map((b) => ({
      id: b.id,
      seatNumber: b.seatNumber,
      status: b.status,
      isOffline: b.isOffline,
    }));
    if (trip.driver) {
      trip.driver = { ...trip.driver, currentLat: null, currentLng: null, currentHeading: null };
    }
  }

  if (trip.route) {
    // Divide by maxSeats — the fixed capacity the driver chose for this trip.
    // This keeps farePerSeatPesewas stable and identical to what the listing showed.
    const fareInfo = calculateFare({
      tier: trip.tier,
      distanceKm: trip.route.distanceKm,
      seatCount: trip.maxSeats,
      doorstepPickup: trip.doorstepPickup,
      heavyLoad: trip.heavyLoad,
      surgeMultiplier: trip.surgeMultiplier,
      storedBaseFarePesewas: trip.baseFarePesewas,
      storedPerKmRatePesewas: trip.perKmRatePesewas,
    });
    trip.farePerSeatPesewas = fareInfo.farePerPersonPesewas;
    trip.fare = fareInfo.farePerPersonPesewas; // kept for backwards-compat with older clients
    // Full trip cost — what a rider pays when they choose "I'm paying for everyone".
    trip.totalTripCostPesewas = fareInfo.totalTripCostPesewas;
  } else {
    /**
     * AN ON-DEMAND RIDE HAS NO ROUTE, BY CONSTRUCTION.
     *
     * `rides.service.requestRide` creates the Trip with `routeId: null` — that
     * is the whole point of the on-demand shape ("no driver, no vehicle, no
     * route"). This block used to read `trip.route.distanceKm` unconditionally,
     * so `GET /v1/trips/:id` threw `Cannot read properties of null` and returned
     * 500 for EVERY on-demand ride. Both of the rider screens that call it hit
     * that: `ride/[id]/chat.tsx` (so rider→driver chat could not open on a
     * normal ride at all) and Activity's tap-through to `/ride/[id]`.
     *
     * The price is not recomputed here even in principle. No distance was ever
     * stored on the Trip — only inside the seq-0 TripEvent payload — and a fare
     * re-derived from a straight line would quietly disagree with the signed
     * quote the rider was actually charged. The booking row IS the price.
     *
     * On-demand is priced as the whole car (the quote passes `seatCount: 1`),
     * so the per-seat figure and the total are the same number.
     */
    const chargedTotal = chargedFaresPesewas.reduce((sum, n) => sum + n, 0);
    trip.farePerSeatPesewas = chargedTotal;
    trip.fare = chargedTotal;
    trip.totalTripCostPesewas = chargedTotal;
  }

  /**
   * ONE ANSWER TO "HOW MANY SEATS ARE LEFT".
   *
   * BUGFIX. Four different formulas existed for this and they disagreed the
   * moment a seat was held but unpaid — which is exactly what sharing an invite
   * does, since the host holds every remaining seat:
   *
   *   graphql/dataloaders.js  maxSeats - confirmedSeats          (ignores holds)
   *   rider ride/[id].tsx     maxSeats - bookings.length         (counts holds)
   *   rider home.tsx          maxSeats - confirmedSeats - pending
   *   rider join/[token].tsx  maxSeats - confirmedSeats          (ignores holds)
   *
   * So the same trip read "0 seats left" on the booking page and "4 seats left"
   * on the home card, and a rider tapping between them watched the number
   * change.
   *
   * `trip.bookings` is already filtered to `seatOccupyingWhere()`, so its
   * length IS the occupancy — holds included, no-shows and cancellations
   * excluded. Computed once, here, and every client reads this field instead of
   * doing its own arithmetic.
   */
  trip.availableSeats = Math.max(0, trip.maxSeats - trip.bookings.length);
  trip.occupiedSeats = trip.bookings.length;

  // Attach driver's average rating
  if (trip.driver) {
    // Chronic low-raters excluded — one rating model for both apps.
    const { rating, ratingCount } = await ratingIntegrity.getDriverRating(trip.driverId);
    trip.driver.rating = rating;
    trip.driver.ratingCount = ratingCount;
  }

  return trip;
}

async function getTripByShareToken(shareToken) {
  const group = await prisma.rideGroup.findUnique({
    where: { shareToken },
    include: {
      trip: {
        include: {
          route: true,
          vehicle: true,
          driver: { select: { id: true, name: true, profilePhoto: true } },
          bookings: {
            where: { ...seatOccupyingWhere() },
            select: { seatNumber: true, status: true },
          },
        },
      },
    },
  });
  if (!group) throw new NotFoundError('Ride');

  // ── Share token expiration validation ────────────────────────────────
  // RideGroup.expiresAt is set to 2 hours after creation. If it's past expiry,
  // the invite link is dead — return a clear error so the join screen can show
  // a graceful "This invite has expired" message instead of a generic 404.
  if (group.expiresAt < new Date()) {
    throw new AppError('This invite link has expired', 410, 'INVITE_EXPIRED');
  }

  const fare = estimateFare({
    tier: group.trip.tier,
    distanceKm: group.trip.route.distanceKm,
    doorstepPickup: group.trip.doorstepPickup,
    heavyLoad: group.trip.heavyLoad,
    surgeMultiplier: group.trip.surgeMultiplier,
    storedBaseFarePesewas: group.trip.baseFarePesewas,
    storedPerKmRatePesewas: group.trip.perKmRatePesewas,
    availableSeats: group.trip.maxSeats,
  });

  // Flatten so the rider's group hub can read `trip.fare` / `trip.totalTripCostPesewas`
  // the same way every other rider screen does — single source of truth.
  group.trip.fare = fare.farePerPersonPesewas;
  group.trip.farePerSeatPesewas = fare.farePerPersonPesewas;
  group.trip.totalTripCostPesewas = fare.totalTripCostPesewas;

  // Same one derivation as getTrip and searchTrips. The invite/join screens
  // were computing `maxSeats - confirmedSeats` locally, which ignores the
  // held-but-unpaid seats the host is holding precisely BECAUSE they shared
  // this link — so the page under-reported occupancy to the people being
  // invited into the van.
  group.trip.availableSeats = Math.max(0, group.trip.maxSeats - group.trip.bookings.length);
  group.trip.occupiedSeats = group.trip.bookings.length;

  /**
   * THE ROAD, NOT A STRAIGHT LINE.
   *
   * BUGFIX ("on the invite page, when i share the link and open it in the
   * browser, the pickup and destination show a straight line and it doesn't
   * follow the road polyline").
   *
   * This returned `route.origin*` / `route.dest*` and nothing else, so the
   * invite page had no geometry and did the only thing two points allow: a
   * dashed line through whatever lay between them — buildings, water, the wrong
   * side of a motorway. Someone deciding whether to join was being shown a
   * route no vehicle can take.
   *
   * The geometry already exists: `route-geometry.service` computes and caches
   * the live leg of every trip, and an unstarted group trip (SCHEDULED /
   * FILLING) has a well-defined one — pickup to dropoff. Nothing asked for it.
   *
   * `getRouteForTrip`, not `peekRouteForTrip`: an invite link is often the FIRST
   * thing to look at this trip, so a peek would miss on a cold cache and hand
   * back the straight line again — the bug itself. This writes through, so
   * every later viewer of the same link is served from cache, which is also
   * most of the "it takes a while to load".
   *
   * Best-effort — a trip whose line cannot be drawn is still joinable, and the
   * page keeps its straight-line fallback for exactly that case.
   */
  const path = await routeGeometry
    .getRouteForTrip(group.trip, group.trip.driver ?? null)
    .catch(() => null);

  return { group, trip: group.trip, fareEstimate: fare, path };
}

/**
 * Who is sitting where on a trip.
 *
 * @param {string} tripId
 * @param {string|null} [viewerUserId] marks the viewer's own seats as `isMine`
 */
async function getSeatMap(tripId, viewerUserId = null) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { maxSeats: true, confirmedSeats: true, tier: true },
  });
  if (!trip) throw new NotFoundError('Trip');

  const bookings = await prisma.booking.findMany({
    where: { tripId, ...seatOccupyingWhere() },
    select: { seatNumber: true, status: true, userId: true, isOffline: true },
  });

  const seats = Array.from({ length: trip.maxSeats }, (_, i) => {
    const booking = bookings.find((b) => b.seatNumber === i + 1);
    if (booking) {
      // SEAT_HELD = payment not yet confirmed — show as "PENDING" so other riders
      // can see it's being considered but it's not permanently blocked.
      // CONFIRMED / COMPLETED / BOARDED = fully taken.
      const displayStatus = booking.status === 'SEAT_HELD' ? 'PENDING' : booking.status;
      return {
        number: i + 1,
        status: displayStatus,
        isOffline: booking?.isOffline || false,
        isMine: !!viewerUserId && booking.userId === viewerUserId,
      };
    }
    // A SEAT WITH NO BOOKING IS FREE. Nothing else is defensible.
    //
    // This used to fabricate occupancy for unbooked seats — `((hash(tripId) + i)
    // % maxSeats) < confirmedSeats` — inventing a passenger with no booking row
    // behind them. It is the "phantom seat" in "two seats are blocked, one is
    // genuinely the offline passenger the driver added, the other one is not."
    //
    // It also broke booking outright, because the group-hub screen reserves "the
    // first AVAILABLE seat" from this map. Phantoms ate the free seats, the
    // screen fell back to seat 1, seat 1 belonged to the offline rider, and the
    // resulting SeatTakenError surfaced as "could not reserve a seat, the trip
    // may be full" on a trip that was nearly empty.
    return {
      number: i + 1,
      status: 'AVAILABLE',
      isOffline: false,
      isMine: false,
    };
  });

  // Derived from the rows, not from the counter column: `confirmedSeats` is
  // maintained by several writers and a drifted value must not be able to paint
  // seats that nobody booked.
  const takenCount = seats.filter((s) => s.status !== 'AVAILABLE').length;

  return { seats, maxSeats: trip.maxSeats, confirmedSeats: takenCount };
}

async function getPulseSchedules() {
  const today = new Date();
  const dayOfWeek = today.getDay();

  // daysOfWeek is a JSON-encoded string column (e.g. "[1,2,3,4,5]"), not a
  // native list — Prisma's `has` filter only works on real list fields and
  // throws a validation error on every call. Filter in JS after fetch instead.
  const allActiveSchedules = await prisma.pulseSchedule.findMany({
    where: { isActive: true },
    include: {
      route: true,
      trips: {
        where: {
          departureTime: { gte: today },
          status: { in: ['SCHEDULED', 'FILLING'] },
        },
        orderBy: { departureTime: 'asc' },
        take: 1,
        include: {
          bookings: { where: { ...seatOccupyingWhere() }, select: { id: true } },
        },
      },
    },
    orderBy: { departureTime: 'asc' },
  });

  const schedules = allActiveSchedules.filter((s) => {
    try {
      const days = JSON.parse(s.daysOfWeek);
      return Array.isArray(days) && days.includes(dayOfWeek);
    } catch {
      return false;
    }
  });

  return schedules.map((s) => ({
    ...s,
    nextTrip: s.trips[0] || null,
    seatsAvailable: s.trips[0] ? s.maxSeats - (s.trips[0].bookings?.length || 0) : s.maxSeats,
  }));
}

async function searchTrips(query) {
  // BUGFIX: the client (SearchTripsParams / SelectStage.tsx) has only ever sent
  // `destinationLat`/`destinationLng` — this destructured the wrong names
  // (`destLat`/`destLng`), so the proximity filter below was silently a no-op
  // on every real request and this returned EVERY upcoming trip regardless of
  // how far it was from the rider's actual pickup/destination. Accept both
  // names so any other caller using the legacy `destLat/destLng` still works.
  const { destination, originLat, originLng, destinationLat, destinationLng, destLat, destLng, radius = 5, page = 1, limit = 50 } = query;
  const finalDestLat = destinationLat ?? destLat;
  const finalDestLng = destinationLng ?? destLng;

  // PRIVACY FIX: this listed DRIVER_EN_ROUTE and IN_PROGRESS trips, which are
  // by definition already serving a specific rider — including the private
  // one-off trips created when a driver accepts an on-demand request
  // (trip-request.service.js). Every rider's "Suggested for you" therefore
  // showed other people's live rides, and each row carried the driver's real
  // -time coordinates (see `include` below). A trip you cannot book a seat on
  // has no business in a search result: only SCHEDULED/FILLING are joinable.
  //
  // `route.isActive` is the public-listing gate. Driver-created map-pin trips
  // get an ad-hoc route that is active (and so stay listed — that is the
  // group/on-demand product); routes minted for a specific rider's request are
  // created with `isActive: false` precisely so they never surface here.
  const where = {
    status: { in: ['SCHEDULED', 'FILLING'] },
    departureTime: { gte: new Date() },
    route: { isActive: true },
  };

  if (destination) {
    // Merge, don't overwrite — reassigning `where.route` here would have
    // dropped the `isActive` public-listing gate set above and put private
    // on-demand routes back into text searches.
    where.route = {
      ...where.route,
      OR: [
        { destinationName: { contains: destination } }, // SQLite contains is case-insensitive by default in Prisma if configured, but let's just use contains
        { virtualStops: { some: { name: { contains: destination } } } }
      ]
    };
  }

  const pageNum = Math.max(1, Number(page));
  const take = Math.min(Number(limit), 100);
  const skip = (pageNum - 1) * take;
  const hasGeoFilter = originLat && originLng && finalDestLat && finalDestLng;

  const include = {
    route: { include: { virtualStops: { where: { isActive: true }, orderBy: { sequence: 'asc' } } } },
    vehicle: true,
    driver: { select: { id: true, name: true, profilePhoto: true, currentLat: true, currentLng: true } },
    bookings: {
      where: { ...seatOccupyingWhere() },
      select: { id: true, seatNumber: true, status: true },
    },
  };

  let trips, totalCount;

  if (hasGeoFilter) {
    // SQLite has no native geo query — pull a larger upcoming-trip candidate
    // pool, filter by proximity in memory, THEN paginate. Filtering AFTER a
    // DB-level skip/take (the old approach) could silently drop genuinely
    // nearby trips that just weren't in that page's date-ordered slice.
    const oLat = parseFloat(originLat);
    const oLng = parseFloat(originLng);
    const dLat = parseFloat(finalDestLat);
    const dLng = parseFloat(finalDestLng);
    const rad = parseFloat(radius);

    const candidates = await prisma.trip.findMany({
      where,
      include,
      orderBy: { departureTime: 'asc' },
      take: 500,
    });

    const filtered = candidates.filter(trip => {
      const route = trip.route;
      let originNear = haversineKm(oLat, oLng, route.originLat, route.originLng) <= rad;
      if (!originNear) {
        originNear = route.virtualStops.some(stop => haversineKm(oLat, oLng, stop.lat, stop.lng) <= rad);
      }

      let destNear = haversineKm(dLat, dLng, route.destLat, route.destLng) <= rad;
      if (!destNear) {
        destNear = route.virtualStops.some(stop => haversineKm(dLat, dLng, stop.lat, stop.lng) <= rad);
      }

      return originNear && destNear;
    });

    totalCount = filtered.length;
    trips = filtered.slice(skip, skip + take);
  } else {
    [totalCount, trips] = await Promise.all([
      prisma.trip.count({ where }),
      prisma.trip.findMany({ where, include, orderBy: { departureTime: 'asc' }, skip, take }),
    ]);
  }

  trips.forEach(trip => {
    // Always use maxSeats as the denominator so the listed price matches exactly
    // what a rider is charged when they book — eliminating the home/payment mismatch.
    const fareInfo = estimateFare({
      tier: trip.tier,
      distanceKm: trip.route.distanceKm,
      doorstepPickup: trip.doorstepPickup,
      heavyLoad: trip.heavyLoad,
      surgeMultiplier: trip.surgeMultiplier,
      storedBaseFarePesewas: trip.baseFarePesewas,
      storedPerKmRatePesewas: trip.perKmRatePesewas,
      availableSeats: trip.maxSeats,
    });
    trip.farePerSeatPesewas = fareInfo.farePerPersonPesewas;
    trip.fare = fareInfo.farePerPersonPesewas; // backwards-compat
    trip.totalTripCostPesewas = fareInfo.totalTripCostPesewas;

    /**
     * THE FIELD THE LISTING FILTERS ON, WHICH THIS ENDPOINT NEVER SENT.
     *
     * BUGFIX — the rider's trip list was ALWAYS EMPTY.
     *
     * `SelectStage` filters `(t.availableSeats ?? 0) >= minSeats` and `minSeats`
     * defaults to 1. This endpoint returned no `availableSeats` at all, so the
     * comparison was `0 >= 1` for every trip and every trip was dropped. Worse,
     * `filtersActive` is `minSeats > 1`, so the UI showed no filter badge
     * either: the rider saw a plainly empty list with nothing to explain it,
     * and searching harder could not fix it.
     *
     * (The `availableSeats` a few lines above is unrelated — that is the fare
     * DENOMINATOR passed into estimateFare, and `maxSeats` is correct there.)
     *
     * `trip.bookings` is filtered to `seatOccupyingWhere()`, so its length is
     * the real occupancy. Same derivation as `getTrip`, so the listing and the
     * detail page can no longer disagree.
     */
    trip.availableSeats = Math.max(0, trip.maxSeats - (trip.bookings?.length ?? 0));
    trip.occupiedSeats = trip.bookings?.length ?? 0;
  });

  return { trips, total: totalCount, page: Number(page), totalPages: Math.ceil(totalCount / take) };
}

async function getActiveTrip(userId) {
  const booking = await prisma.booking.findFirst({
    where: {
      userId,
      status: { in: ['CONFIRMED', 'PAID', 'BOARDED'] },
      trip: {
        status: { in: ['SCHEDULED', 'FILLING', 'DRIVER_EN_ROUTE', 'IN_PROGRESS'] }
      }
    },
    include: {        trip: {
          include: {
            route: { include: { virtualStops: { where: { isActive: true }, orderBy: { sequence: 'asc' } } } },
            vehicle: true,
            driver: { select: { id: true, name: true, profilePhoto: true, currentLat: true, currentLng: true } } // phone excluded — use contact relay
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

  if (!booking) {
    throw new NotFoundError('No active trip found');
  }

  return booking;
}

/**
 * Store (or clear) the ActivityKit push token for the rider's Live Activity
 * on a given trip. Scoped to the rider's own CONFIRMED/PAID/BOARDED booking
 * for that trip — a rider can only register a token for their own booking.
 *
 * `activityId` is the native Activity's local id (from LiveActivity.startActivity
 * on-device); it's stored mainly for debugging/log correlation, the push
 * itself only needs `pushToken`.
 */
async function saveLiveActivityToken(userId, tripId, { pushToken, activityId }) {
  const booking = await prisma.booking.findFirst({
    where: { tripId, userId, status: { in: ['CONFIRMED', 'PAID', 'BOARDED'] } },
    select: { id: true },
  });
  if (!booking) {
    throw new NotFoundError('No active booking found for this trip');
  }

  await prisma.booking.update({
    where: { id: booking.id },
    data: {
      liveActivityPushToken: pushToken || null,
      liveActivityId: activityId || null,
    },
  });

  return { bookingId: booking.id };
}

/** Clear the stored token — called once the activity ends (COMPLETED/CANCELLED/NO_SHOW). */
async function clearLiveActivityToken(bookingId) {
  return prisma.booking.update({
    where: { id: bookingId },
    data: { liveActivityPushToken: null, liveActivityId: null },
  }).catch(() => null); // non-critical — booking may already be gone/reassigned
}

async function completeTrip(tripId) {
  const completedRiderTokens = []; // populated inside the tx, pushed to after commit
  let completionTransition = null; // published after commit, never inside
  // Quest inputs, captured inside the tx and spent after commit. See the
  // post-commit block below for why quests no longer run inside it.
  let questDriverId = null;
  let questEarningsPesewas = 0;

  await prisma.$transaction(async (tx) => {
    const trip = await tx.trip.findUnique({
      where: { id: tripId },
      select: { status: true, driverId: true, departureTime: true, version: true },
    });
    if (!trip) throw new NotFoundError('Trip');
    // Idempotency guard: if already completed, return early to prevent double wallet credits
    if (trip.status === 'COMPLETED') {
      return tx.trip.findUnique({ where: { id: tripId } });
    }

    const completedAt = new Date();

    // Update trip status through the one guarded write path, in this
    // transaction, so the completion, the booking closures and the driver's
    // earnings settle or fail together.
    completionTransition = await tripState.applyTransitionTx(tx, tripId, 'COMPLETED', {
      actor: tripState.ACTOR.DRIVER,
      actorId: trip.driverId,
      expectedVersion: trip.version,
    });

    /**
     * Close the bookings that were actually RIDDEN — see the identical note in
     * drivers.service.js `arriveTrip`.
     *
     * BUGFIX ("closed the app on the group hub without paying and the driver
     * still saw a paid passenger"). SEAT_HELD was in this list, so an unpaid hold
     * — which the group hub creates the instant it opens — graduated to
     * COMPLETED, i.e. to a passenger who rode, on every receipt and earnings
     * screen. A hold that was never paid for expires and gives its seat back.
     */
    await tx.booking.updateMany({
      where: { tripId, status: { in: ['PENDING', 'SEAT_HELD'] } },
      data: { status: 'EXPIRED', seatNumber: null },
    });
    await tx.booking.updateMany({
      where: {
        tripId,
        status: { in: ['CONFIRMED', 'BOARDED', 'PAID'] },
      },
      data: { status: 'COMPLETED' },
    });

    // ── Auto-settle any still-unpaid CASH bookings ───────────────────────
    // Boarding a cash passenger (which flips paymentStatus to PAID and
    // deducts commission) is a manual per-seat driver action — easy to skip.
    // Without this, a completed trip could leave a cash booking's
    // paymentStatus stuck at PENDING forever even though the rider rode and
    // paid the driver directly, making the admin dashboard show a finished,
    // paid trip as permanently "pending" and letting the platform miss the
    // commission entirely.
    const unsettledCash = await tx.booking.findMany({
      where: {
        tripId,
        paymentMethod: 'CASH',
        paymentStatus: { not: 'PAID' },
        // Only real fares settle. Excluding just CANCELLED/NO_SHOW let
        // SEAT_HELD and PENDING holds through, and debited the driver
        // commission on seats nobody ever booked — see the long note on the
        // identical query in drivers.service.js arriveTrip.
        status: { in: ['CONFIRMED', 'PAID', 'BOARDED'] },
      },
      select: { id: true, commissionAmountPesewas: true },
    });
    if (unsettledCash.length > 0) {
      const totalCommissionOwed = unsettledCash.reduce((sum, b) => sum + (b.commissionAmountPesewas || 0), 0);
      await tx.booking.updateMany({
        where: { id: { in: unsettledCash.map((b) => b.id) } },
        data: { paymentStatus: 'PAID' },
      });
      if (totalCommissionOwed > 0) {
        const driverBeforeSettle = await tx.driver.findUnique({ where: { id: trip.driverId }, select: { walletBalancePesewas: true } });
        await tx.driver.update({
          where: { id: trip.driverId },
          data: { walletBalancePesewas: { decrement: totalCommissionOwed } },
        });
        await tx.walletTransaction.create({
          data: {
            driverId: trip.driverId,
            type: 'COMMISSION_DEDUCTION',
            amountPesewas: totalCommissionOwed,
            description: `Cash commission auto-settled at trip completion — ${unsettledCash.length} seat(s) not marked boarded`,
            balanceBeforePesewas: driverBeforeSettle?.walletBalancePesewas ?? 0,
            balanceAfterPesewas: (driverBeforeSettle?.walletBalancePesewas ?? 0) - totalCommissionOwed,
            tripId,
          },
        });
      }
    }

    // Credit driver wallet: sum fareAmountPesewas from paid+confirmed bookings, minus 15% platform fee
    const paidBookings = await tx.booking.findMany({
      where: {
        tripId,
        status: { in: ['CONFIRMED', 'COMPLETED'] },
        paymentStatus: 'PAID',
      },
      select: {
        id: true, userId: true, fareAmountPesewas: true, commissionAmountPesewas: true, paymentMethod: true, updatedAt: true,
        paymentTxs: { where: { status: 'SUCCESS' }, select: { createdAt: true }, take: 1, orderBy: { createdAt: 'desc' } },
        user: { select: { fcmToken: true, notificationPrefs: true } },
      },
    });

    for (const b of paidBookings) {
      if (b.user?.fcmToken) {
        completedRiderTokens.push({ token: b.user.fcmToken, fareAmountPesewas: b.fareAmountPesewas, notificationPrefs: b.user.notificationPrefs, bookingId: b.id });
      }
    }

    let totalNetEarnings = 0;
    let totalCommission = 0;

    if (paidBookings.length > 0) {
      // Generate per-rider Receipt records
      for (const b of paidBookings) {
        // The fallback used a hardcoded 0.15 while the rest of the platform
        // read `PLATFORM_COMMISSION` — so changing the commission rate moved
        // every figure except the one on a receipt whose booking predated the
        // commission column. One knob.
        const commission =
          b.commissionAmountPesewas != null
            ? b.commissionAmountPesewas
            : percentOf(b.fareAmountPesewas, env.PLATFORM_COMMISSION);
        const driverEarningsPesewas = b.fareAmountPesewas - commission;
        // CASH bookings already had their commission deducted at boarding
        // (or in the auto-settle step above) and the driver keeps the fare
        // cash directly — crediting the wallet with driverEarningsPesewas again
        // here would double-pay them. Still generate their receipt below.
        if (b.paymentMethod !== 'CASH') {
          totalNetEarnings += driverEarningsPesewas;
          totalCommission += commission;
        }

        const receiptNumber = `RCP-${Date.now()}-${b.id.slice(-6).toUpperCase()}`;
        await tx.receipt.create({
          data: {
            bookingId: b.id,
            userId: b.userId,
            receiptNumber,
            totalPaidPesewas: b.fareAmountPesewas,
            platformFeePesewas: commission,
            driverEarningsPesewas,
            discountAppliedPesewas: 0,
            paymentMethod: b.paymentMethod ?? 'MOMO',
            paidAt: b.paymentTxs?.[0]?.createdAt ?? b.updatedAt,
          },
        });
      }

      if (totalNetEarnings > 0) {
        // Credit driver wallet — tx.wallet does not exist; the balance is a scalar on Driver
        const driverBefore = await tx.driver.findUnique({
          where: { id: trip.driverId },
          select: { walletBalancePesewas: true },
        });
        await tx.driver.update({
          where: { id: trip.driverId },
          data: { walletBalancePesewas: { increment: totalNetEarnings } },
        });
        await tx.walletTransaction.create({
          data: {
            driverId: trip.driverId,
            type: 'TRIP_EARNING',
            amountPesewas: totalNetEarnings,
            description: `Trip earnings — ${paidBookings.length} paid seat(s)`,
            balanceBeforePesewas: driverBefore?.walletBalancePesewas ?? 0,
            balanceAfterPesewas: (driverBefore?.walletBalancePesewas ?? 0) + totalNetEarnings,
            tripId,
          },
        });
      }

      // Cash fares: reporting-only ledger row, no wallet movement.
      // The loop above deliberately EXCLUDES cash from totalNetEarnings (the
      // driver was handed the money and commission was already debited), but the
      // driver app's earnings chart and the /earnings summary are built from
      // wallet transactions — so with no row at all, a cash trip was invisible
      // there and the chart stayed blank. `balanceBeforePesewas === balanceAfterPesewas` makes
      // it explicit that this moves nothing; see EARNING_TYPES in
      // drivers.service.js for which reports opt into it.
      const cashEarningsTotal = paidBookings
        .filter((b) => b.paymentMethod === 'CASH')
        .reduce((sum, b) => sum + (b.fareAmountPesewas - (b.commissionAmountPesewas ?? 0)), 0);
      if (cashEarningsTotal > 0) {
        const balanceNow = (await tx.driver.findUnique({
          where: { id: trip.driverId }, select: { walletBalancePesewas: true },
        }))?.walletBalancePesewas ?? 0;
        await tx.walletTransaction.create({
          data: {
            driverId: trip.driverId,
            type: 'CASH_EARNING',
            amountPesewas: cashEarningsTotal,
            description: 'Cash collected in person',
            balanceBeforePesewas: balanceNow,
            balanceAfterPesewas: balanceNow,
            tripId,
          },
        });
      }

      // Generate DriverReceipt for this trip
      const driverReceiptNumber = `DRP-${Date.now()}-${tripId.slice(-6).toUpperCase()}`;
      await tx.driverReceipt.create({
        data: {
          driverId: trip.driverId,
          tripId,
          receiptNumber: driverReceiptNumber,
          totalEarningsPesewas: totalNetEarnings,
          commissionDeductedPesewas: totalCommission,
          periodStart: trip.departureTime,
          periodEnd: completedAt,
          status: 'PAID',
          paidAt: completedAt,
        },
      });
    }

    questDriverId = trip.driverId ?? null;
    questEarningsPesewas = totalNetEarnings;
  });

  // ── Quest progress: RIDES_COUNT and EARNINGS ─────────────────────────────
  // POST-COMMIT — see the same note in drivers.service.arriveTrip. Inside the
  // transaction its serial round trips were charged against the interactive
  // transaction budget and expired the whole completion.
  if (questDriverId) {
    setImmediate(async () => {
      const { incrementProgress } = require('../quests/quests.service');
      try {
        await incrementProgress(questDriverId, 'RIDES_COUNT', 1);
        if (questEarningsPesewas > 0) {
          await incrementProgress(questDriverId, 'EARNINGS', questEarningsPesewas);
        }
      } catch (err) {
        logger.warn(`Quest progress for driver ${questDriverId} failed: ${err.message}`);
      }
    });
  }

  // Post-commit fan-out on the one channel. Both apps get the same versioned
  // COMPLETED event; neither has to infer it from a push notification or a
  // refetch, which is how they used to end up disagreeing about whether the
  // ride was over.
  tripState.publishCommitted(completionTransition);

  // notifications.rideComplete was defined but never called — a backgrounded rider
  // (no live socket connection) never got a "trip complete, rate your ride" push.
  // savedAmount is a rough shared-vs-private-ride estimate for the notification copy,
  // not a precise financial figure.
  for (const { token, fareAmountPesewas, notificationPrefs, bookingId } of completedRiderTokens) {
    pushService.notifications
      .rideComplete(token, fareAmountPesewas, notificationPrefs, bookingId)
      .catch(() => {});
  }

  // Notify GraphQL subscribers of trip completion (fire-and-forget)
  pubSub.publish(`TRIP_STATUS:${tripId}`, {
    tripId,
    status: 'COMPLETED',
    driverLat: null,
    driverLng: null,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * The rider's receipt for a trip — ALL of it.
 *
 * `Receipt` is per-BOOKING, and one rider routinely has several bookings on one
 * trip: their own seat plus a seat per guest, or every seat on the vehicle when
 * they chose "I'm paying for everyone". This used `findFirst` and returned an
 * arbitrary one of them, so the receipt for a 12-seat cover-all purchase showed
 * a single seat's fare — the tail of "the trip complete page says the gross fare
 * was 1 seat at 8 cedis when the ride was 36 paid".
 *
 * Now every receipt the rider holds for this trip is summed into one figure, and
 * `seatCount` says how many seats it covers so the breakdown can be honest about
 * what the number is. Identity fields (driver, vehicle, route) come from the
 * newest receipt — they are the same trip on every row.
 */
async function getTripReceipt(tripId, userId) {
  const receipts = await prisma.receipt.findMany({
    where: {
      booking: { tripId, userId },
    },
    orderBy: { createdAt: 'desc' },
    include: {
      booking: {
        include: {
          trip: {
            include: {
              route: { select: { originName: true, destinationName: true } },
              driver: { select: { name: true, phone: true } },
              vehicle: { select: { make: true, model: true, plateNumber: true } },
            },
          },
        },
      },
    },
  });
  if (receipts.length === 0) throw new NotFoundError('Receipt not found for this trip');

  const receipt = receipts[0];
  const sum = (pick) => receipts.reduce((total, r) => total + (pick(r) || 0), 0);

  const trip = receipt.booking.trip;
  return {
    receiptNumber: receipt.receiptNumber,
    farePesewas: sum((r) => r.totalPaidPesewas),
    platformFeePesewas: sum((r) => r.platformFeePesewas),
    driverEarningsPesewas: sum((r) => r.driverEarningsPesewas),
    discountAppliedPesewas: sum((r) => r.discountAppliedPesewas),
    /** How many seats the total above covers — 1 for a normal ride, N for cover-all. */
    seatCount: receipts.length,
    /** Only meaningful when seatCount === 1; kept for older clients. */
    farePerSeatPesewas: Math.round(sum((r) => r.totalPaidPesewas) / receipts.length),
    paymentMethod: receipt.paymentMethod,
    paidAt: receipt.paidAt,
    seatNumber: receipt.booking.seatNumber,
    /** Every seat this rider paid for, so a breakdown can list them. */
    seatNumbers: receipts.map((r) => r.booking.seatNumber).filter((n) => n != null),
    origin: trip.route?.originName,
    destination: trip.route?.destinationName,
    departureTime: trip.departureTime,
    driver: trip.driver
      ? { name: trip.driver.name, phone: trip.driver.phone, vehicle: trip.vehicle }
      : null,
  };
}

async function driverNoShow(tripId, reportingUserId) {
  // Collect push data outside the transaction so we can fire after commit
  let refundedTokens = [];
  let unpaidTokens = [];
  let tripRouteLabel = 'your trip';
  let cancelTransition = null;

  const result = await prisma.$transaction(async (tx) => {
    const trip = await tx.trip.findUnique({
      where: { id: tripId },
      include: {
        /**
         * EVERY SEAT THAT IS STILL A SEAT — not just the CONFIRMED ones.
         *
         * BUGFIX (the missing refunds). `status: 'CONFIRMED'` and the refund
         * test `paymentStatus === 'PAID'` describe different columns, and the
         * rows that most need refunding fail the first one: a booking whose
         * card or MoMo payment has settled is moved to status PAID, not left at
         * CONFIRMED. So the loop below iterated a list that could not contain a
         * paid booking, and the driver-no-show refund had never once been
         * written. Cash riders were missed too, in the other direction: their
         * booking is PENDING, so they were not even notified.
         */
        bookings: {
          where: { status: { in: ['PENDING', 'SEAT_HELD', 'CONFIRMED', 'PAID', 'BOARDED'] } },
          include: { user: { select: { fcmToken: true } } },
        },
        route: { select: { originName: true, destinationName: true } },
      },
    });
    if (!trip) throw new NotFoundError('Trip');
    if (trip.driverId !== reportingUserId) {
      throw new ForbiddenError('You are not the driver assigned to this trip');
    }
    /**
     * A NO-SHOW IS SOMETHING THAT HAPPENS *BEFORE* THE RIDE.
     *
     * BUGFIX ("guard the no-show button properly so a driver can't pick a rider
     * up and then no-show en route").
     *
     * Once a passenger is in the car the ride HAPPENED, and calling it a
     * no-show would cancel their booking, refund them, and hand the driver an
     * unpaid trip they actually drove — or, read the other way, let a driver
     * carry someone and then erase the record of it. IN_PROGRESS is refused by
     * name so the driver is told which thing they are doing wrong rather than
     * being given a generic state error.
     *
     * DRIVER_ASSIGNED and ARRIVED_AT_PICKUP are added because they were missing:
     * a dispatched trip sits at one or the other for its entire pre-ride life,
     * so the action the driver could see was refused by the server for most of
     * the window in which it is the right action.
     */
    if (trip.status === 'IN_PROGRESS') {
      throw new AppError(
        'This ride is already under way — you picked the rider up. Use Cancel Trip if you cannot finish it.',
        400,
        'RIDE_ALREADY_STARTED',
      );
    }
    const NO_SHOW_ALLOWED = [
      'SCHEDULED', 'FILLING', 'CONFIRMED',
      'DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP',
    ];
    if (!NO_SHOW_ALLOWED.includes(trip.status)) {
      throw new AppError('Trip cannot be marked as driver no-show in current state', 400);
    }

    /**
     * TWO DIFFERENT THINGS TO SAY, BECAUSE TWO DIFFERENT THINGS HAPPENED.
     *
     * A rider who paid by MoMo or card has money with us and is owed it back;
     * a cash rider never paid anything and telling them about a refund would be
     * a lie that generates a support ticket. Same cancellation, same fault,
     * different sentence.
     */
    const wasPrepaid = (b) =>
      b.paymentStatus === 'PAID' && ['MOMO', 'CARD', 'WALLET'].includes(b.paymentMethod);
    refundedTokens = trip.bookings.filter(wasPrepaid).map((b) => b.user?.fcmToken).filter(Boolean);
    unpaidTokens = trip.bookings.filter((b) => !wasPrepaid(b)).map((b) => b.user?.fcmToken).filter(Boolean);
    if (trip.route?.originName && trip.route?.destinationName) {
      tripRouteLabel = `${trip.route.originName} → ${trip.route.destinationName}`;
    }

    // Cancel the trip
    cancelTransition = await tripState.applyTransitionTx(tx, tripId, 'CANCELLED', {
      actor: tripState.ACTOR.DRIVER,
      actorId: trip.driverId,
      payload: { reason: 'DRIVER_NO_SHOW' },
      data: { cancelledBy: tripState.ACTOR.DRIVER, cancellationReason: 'DRIVER_NO_SHOW' },
    });

    /**
     * Cancel the seats AND RELEASE THE SEAT NUMBERS.
     *
     * `seatNumber: null` is not cosmetic — `Booking` carries
     * `@@unique([tripId, seatNumber])`, so a cancelled row that keeps seat 3
     * makes seat 3 unbookable for the life of the trip. The same omission is
     * documented in `riderNoShow` below; this was the third exit from a booking
     * that still had it.
     */
    await tx.booking.updateMany({
      where: { tripId, status: { in: ['PENDING', 'SEAT_HELD', 'CONFIRMED', 'PAID', 'BOARDED'] } },
      data: { status: 'CANCELLED', seatNumber: null },
    });

    // Issue refund records for the bookings whose money actually moved.
    for (const booking of trip.bookings) {
      if (booking.paymentStatus === 'PAID' && ['MOMO', 'CARD', 'WALLET'].includes(booking.paymentMethod)) {
        await tx.paymentTransaction.create({
          data: {
            bookingId: booking.id,
            userId: booking.userId,
            amountPesewas: booking.fareAmountPesewas,
            status: 'REFUNDED',
            paystackRef: booking.paystackRef ?? `noshow_refund_${booking.id}`,
            gatewayResponse: 'Refunded: driver no-show',
          },
        });
      }
    }

    logger.info('Driver no-show recorded', {
      tripId, reportingUserId, refunded: refundedTokens.length, unpaid: unpaidTokens.length,
    });
    return {
      tripId,
      refundedCount: trip.bookings.filter(
        (b) => b.paymentStatus === 'PAID' && ['MOMO', 'CARD', 'WALLET'].includes(b.paymentMethod),
      ).length,
    };
  });

  // Notify affected riders — non-blocking, must not fail the response.
  // Prepaid riders are told about their money; cash riders are told the plain
  // fact, because there is no refund to promise them.
  if (refundedTokens.length > 0) {
    pushService
      .sendMulticastPush(
        refundedTokens,
        'Your driver cancelled',
        `${tripRouteLabel} will not run. You have been refunded in full — it can take a few minutes to appear.`,
        { type: 'TRIP_CANCELLED', tripId, refunded: 'true' },
      )
      .catch(() => {});
  }
  if (unpaidTokens.length > 0) {
    pushService
      .sendMulticastPush(
        unpaidTokens,
        'Your driver cancelled',
        `${tripRouteLabel} will not run, and you have not been charged. Book again to find another driver.`,
        { type: 'TRIP_CANCELLED', tripId, refunded: 'false' },
      )
      .catch(() => {});
  }

  // Notify GraphQL subscribers of trip cancellation
  pubSub.publish(`TRIP_STATUS:${tripId}`, {
    tripId,
    status: 'CANCELLED',
    driverLat: null,
    driverLng: null,
    updatedAt: new Date().toISOString(),
  });

  tripState.publishCommitted(cancelTransition);
  return result;
}

async function riderNoShow(tripId, bookingId, reportingUserId) {
  return prisma.$transaction(async (tx) => {
    const trip = await tx.trip.findUnique({ where: { id: tripId }, select: { driverId: true } });
    if (!trip) throw new NotFoundError('Trip');
    if (trip.driverId !== reportingUserId) {
      throw new ForbiddenError('You are not the driver assigned to this trip');
    }

    const booking = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundError('Booking');
    if (booking.tripId !== tripId) throw new AppError('Booking does not belong to this trip', 400);
    if (!['CONFIRMED', 'SEAT_HELD'].includes(booking.status)) {
      throw new AppError('Booking is not in a confirmable state', 400);
    }

    /**
     * Mark no-show — no refund — and RELEASE THE SEAT NUMBER.
     *
     * `seatNumber: null` is not cosmetic. `Booking` carries
     * `@@unique([tripId, seatNumber])`, so a NO_SHOW row that keeps seat 3
     * makes seat 3 unbookable for the life of the trip: the next rider to pick
     * it fails on the unique constraint, which surfaces as an opaque error on a
     * seat the map is (now correctly) drawing as free.
     *
     * `cancelBooking` already did this; the two other exits from a booking —
     * here and in cancellation.service — did not, which is why the seat came
     * back in the counts but not in reality.
     */
    await tx.booking.update({
      where: { id: bookingId },
      data: { status: 'NO_SHOW', seatNumber: null },
    });

    /**
     * Release the seat — but only if it was ever counted.
     *
     * BUGFIX. `confirmedSeats` is incremented ONLY when payment settles
     * (payments.service.js) or when the driver adds a cash passenger
     * (drivers.service.js). `bookSeat` does not increment it. This decrement
     * was unconditional while the guard above deliberately admits SEAT_HELD
     * bookings — which are, by definition, unpaid and therefore never counted.
     * Marking one of those a no-show subtracted a seat that had never been
     * added.
     *
     * The consequence runs the WRONG WAY. `availableSeats` is
     * `Math.max(0, maxSeats - confirmedSeats)`, so a negative counter produces
     * `maxSeats + n` — the trip advertises more seats than the vehicle has, and
     * the clamp only protects the harmless direction. It also skews
     * `orderBy: { confirmedSeats: 'desc' }` in the dispatch pool and the
     * MIN_OCCUPANCY_TO_DEPART check.
     *
     * Guarded exactly the way cancellation.service.js already guards its own
     * decrement, so the two agree on what they are counting.
     */
    if (booking.paymentStatus === 'PAID') {
      // `updateMany` with a `gt: 0` filter is the floor: the decrement simply
      // does not apply when there is nothing to subtract. `update` would have
      // taken the counter negative, which is the state that oversells a
      // vehicle. Defence in depth behind the PAID guard above.
      await tx.trip.updateMany({
        where: { id: tripId, confirmedSeats: { gt: 0 } },
        data: { confirmedSeats: { decrement: 1 } },
      });
    }

    logger.info('Rider no-show recorded', { tripId, bookingId });
    return { bookingId };
  });
}

// Group/on-demand pivot: riders no longer pick a fixed Route — they give a
// pickup point + free-text (or map-picked) destination, same as the on-demand
// request flow. ScheduledRideIntent.routeId is still a required FK (DB schema
// kept internal-only per the pivot), so we transparently create an ad-hoc,
// non-searchable Route row here — mirroring trip-request.service's
// acceptTripRequest — instead of asking the rider to select one.
async function scheduleTrip(userId, { destination, scheduledAt, seatCount = 1, pickupLat, pickupLng, destLat, destLng, pickupName }) {
  const departureTime = new Date(scheduledAt);
  if (isNaN(departureTime.getTime())) throw new AppError('Invalid scheduledAt date', 400);
  if (departureTime <= new Date()) throw new AppError('Scheduled time must be in the future', 400);

  // Cap how far out a rider can schedule — nothing processes intents indefinitely into the future.
  const maxAheadMs = 30 * 24 * 60 * 60 * 1000; // 30 days
  if (departureTime.getTime() - Date.now() > maxAheadMs) {
    throw new AppError('Trips can only be scheduled up to 30 days in advance', 400, 'SCHEDULE_TOO_FAR_OUT');
  }

  if (pickupLat == null || pickupLng == null) {
    throw new AppError('A pickup location is required to schedule a ride', 400, 'MISSING_PICKUP_COORDS');
  }

  let resolvedDestLat = destLat;
  let resolvedDestLng = destLng;
  if (resolvedDestLat == null || resolvedDestLng == null) {
    const mapboxService = require('../../services/mapbox.service');
    const geo = await mapboxService.forwardGeocode(destination).catch(() => null)
      ?? await mapboxService.nominatimForwardGeocode(destination).catch(() => null);
    if (geo) { resolvedDestLat = geo.lat; resolvedDestLng = geo.lng; }
  }
  if (resolvedDestLat == null || resolvedDestLng == null) {
    throw new AppError(
      `Could not determine a location for "${destination}". Please pick a destination on the map and try again.`,
      400,
      'MISSING_DEST_COORDS',
    );
  }

  // Check user doesn't already have a pending scheduled-ride intent in the same
  // time window (±30 min). Each intent now owns its own ad-hoc route, so this can
  // no longer be scoped by routeId — scope by rider + time instead.
  const windowStart = new Date(departureTime.getTime() - 30 * 60 * 1000);
  const windowEnd   = new Date(departureTime.getTime() + 30 * 60 * 1000);
  const existingIntent = await prisma.scheduledRideIntent.findFirst({
    where: { userId, status: 'PENDING', scheduledAt: { gte: windowStart, lte: windowEnd } },
  });
  if (existingIntent) {
    throw new AppError('You already have a scheduled ride around that time', 409, 'DUPLICATE_SCHEDULE');
  }

  const distanceKm = Math.max(haversineKm(pickupLat, pickupLng, resolvedDestLat, resolvedDestLng), 1);
  const route = await prisma.route.create({
    data: {
      name: `Scheduled: ${destination}`.slice(0, 120),
      originName: (pickupName || 'Pickup location').slice(0, 120),
      destinationName: destination,
      originLat: pickupLat, originLng: pickupLng,
      destLat: resolvedDestLat, destLng: resolvedDestLng,
      distanceKm,
      isActive: false, // ad-hoc route for this scheduled intent only, not publicly searchable
    },
  });

  const scheduledIntent = await prisma.scheduledRideIntent.create({
    data: {
      userId,
      routeId: route.id,
      scheduledAt: departureTime,
      seatCount,
      status: 'PENDING',
    },
  });

  return scheduledIntent;
}

/**
 * List the calling rider's scheduled ride intents (upcoming + past), newest scheduledAt first.
 */
async function getScheduledRides(userId) {
  const intents = await prisma.scheduledRideIntent.findMany({
    where: { userId },
    // Coordinates travel with the names so the rider's card can fall back to a
    // rounded lat/lng rather than the word "Unknown" for an ad-hoc route that
    // never had anything to name it. See placeLabel() in the activity screen.
    include: {
      route: {
        select: {
          originName: true, destinationName: true, distanceKm: true,
          originLat: true, originLng: true, destLat: true, destLng: true,
        },
      },
    },
    orderBy: { scheduledAt: 'desc' },
  });

  // The list screen only had a route name + seat count to show — once an intent is MATCHED
  // there's a real Trip (driver, vehicle, fare) behind it that was never surfaced, so the card
  // looked identical (and detail-less) whether it was still pending or already confirmed.
  const matchedTripIds = intents.map((i) => i.matchedTripId).filter(Boolean);
  const matchedTrips = matchedTripIds.length
    ? await prisma.trip.findMany({
        where: { id: { in: matchedTripIds } },
        select: {
          id: true,
          tier: true,
          maxSeats: true,
          baseFarePesewas: true,
          perKmRatePesewas: true,
          surgeMultiplier: true,
          doorstepPickup: true,
          heavyLoad: true,
          route: { select: { distanceKm: true } },
          driver: {
            select: {
              name: true,
              vehicles: { where: { isActive: true }, select: { make: true, model: true, plateNumber: true }, take: 1 },
            },
          },
        },
      })
    : [];
  const tripById = new Map(matchedTrips.map((t) => {
    const fare = calculateFare({
      tier: t.tier,
      distanceKm: t.route?.distanceKm ?? 0,
      seatCount: t.maxSeats,
      doorstepPickup: t.doorstepPickup,
      heavyLoad: t.heavyLoad,
      surgeMultiplier: t.surgeMultiplier,
      storedBaseFarePesewas: t.baseFarePesewas,
      storedPerKmRatePesewas: t.perKmRatePesewas,
    });
    const vehicle = t.driver?.vehicles?.[0];
    return [t.id, {
      tier: t.tier,
      farePerSeatPesewas: fare.farePerPersonPesewas,
      driverName: t.driver?.name ?? null,
      vehicleLabel: vehicle ? `${vehicle.make} ${vehicle.model} · ${vehicle.plateNumber}` : null,
    }];
  }));

  return intents.map((intent) => ({
    ...intent,
    matchedTrip: intent.matchedTripId ? tripById.get(intent.matchedTripId) ?? null : null,
  }));
}

/**
 * Cancel a rider's own pending scheduled-ride intent.
 */
async function cancelScheduledRide(userId, intentId) {
  const intent = await prisma.scheduledRideIntent.findUnique({ where: { id: intentId } });
  if (!intent) throw new NotFoundError('ScheduledRideIntent');
  if (intent.userId !== userId) throw new ForbiddenError();
  // DISPATCHED (handed off to live on-demand dispatch, no driver matched yet)
  // is still a live, cancellable intent — only MATCHED/CANCELLED/EXPIRED are
  // terminal. Previously only PENDING was accepted, so a rider whose intent
  // had already been dispatched (the common case once processScheduledRideIntents
  // runs) got a hard 400 on the one action the list screen offers them.
  if (intent.status !== 'PENDING' && intent.status !== 'DISPATCHED') {
    throw new AppError('This scheduled ride can no longer be cancelled', 400, 'INVALID_STATUS');
  }
  return prisma.scheduledRideIntent.update({ where: { id: intentId }, data: { status: 'CANCELLED' } });
}

/**
 * Periodic worker (called from server.js on an interval): processes ScheduledRideIntent
 * rows whose scheduledAt has arrived or is imminent. For each PENDING intent:
 *   1. Try to seat the rider on an existing Trip for the same route within a ±30 min window.
 *   2. If no Trip exists, hand it off to the same live on-demand dispatch used by
 *      "Request a Trip" so nearby drivers get notified close to the actual pickup time,
 *      instead of silently doing nothing (the previous behavior).
 * Intents whose scheduledAt has passed by more than 1 hour with no match are marked EXPIRED.
 */
async function processScheduledRideIntents() {
  const now = new Date();
  const lookAheadMs = 15 * 60 * 1000; // start trying to match 15 min before departure
  const dispatchHorizon = new Date(now.getTime() + lookAheadMs);

  const dueIntents = await prisma.scheduledRideIntent.findMany({
    where: { status: 'PENDING', scheduledAt: { lte: dispatchHorizon } },
    include: { route: true },
  });

  for (const intent of dueIntents) {
    try {
      const staleMs = now.getTime() - intent.scheduledAt.getTime();
      if (staleMs > 60 * 60 * 1000) {
        // Over an hour past its scheduled time with nobody having matched it — give up.
        await prisma.scheduledRideIntent.update({ where: { id: intent.id }, data: { status: 'EXPIRED' } });
        continue;
      }

      const windowStart = new Date(intent.scheduledAt.getTime() - 30 * 60 * 1000);
      const windowEnd = new Date(intent.scheduledAt.getTime() + 30 * 60 * 1000);

      const candidateTrip = await prisma.trip.findFirst({
        where: {
          routeId: intent.routeId,
          status: { in: ['SCHEDULED', 'FILLING'] },
          departureTime: { gte: windowStart, lte: windowEnd },
        },
        orderBy: { confirmedSeats: 'desc' }, // prefer filling up an already-popular trip
      });

      if (candidateTrip && candidateTrip.confirmedSeats + intent.seatCount <= candidateTrip.maxSeats) {
        const fare = calculateFare({
          tier: candidateTrip.tier,
          distanceKm: intent.route.distanceKm,
          seatCount: candidateTrip.maxSeats,
          storedBaseFarePesewas: candidateTrip.baseFarePesewas,
          storedPerKmRatePesewas: candidateTrip.perKmRatePesewas,
          surgeMultiplier: candidateTrip.surgeMultiplier,
        });

        await prisma.$transaction(async (tx) => {
          await tx.booking.create({
            data: {
              tripId: candidateTrip.id,
              userId: intent.userId,
              fareAmountPesewas: fare.farePerPersonPesewas,
              commissionAmountPesewas: fare.commissionPerSeatPesewas,
              paymentMethod: 'CASH',
              paymentStatus: 'PENDING',
              status: 'SEAT_HELD',
            },
          });
          await tx.trip.update({
            where: { id: candidateTrip.id },
            data: { confirmedSeats: { increment: intent.seatCount } },
          });
          await tx.scheduledRideIntent.update({
            where: { id: intent.id },
            data: { status: 'MATCHED', matchedTripId: candidateTrip.id },
          });
        });

        const rider = await prisma.user.findUnique({ where: { id: intent.userId }, select: { fcmToken: true } });
        if (rider?.fcmToken) {
          await pushService.sendPush(
            rider.fcmToken,
            'Scheduled ride confirmed',
            `A seat has been booked for your ${intent.route.destinationName} trip.`,
            { type: 'SCHEDULE_MATCHED', tripId: candidateTrip.id },
          ).catch(() => {});
        }

        // ── Ahead-of-time driver reminder ────────────────────────────
        // Tell the matched trip's driver a scheduled rider is joining, with the
        // departure time + pickup location, so they know to be there. Delivered
        // both as a live socket event (trip:scheduled_reminder) and FCM, since
        // the reminder may fire while the app is backgrounded.
        try {
          const driver = await prisma.driver.findUnique({
            where: { id: candidateTrip.driverId },
            select: { fcmToken: true },
          });
          const reminderPayload = {
            tripId: candidateTrip.id,
            kind: 'SCHEDULED',
            routeOrigin: intent.route.originName,
            routeDestination: intent.route.destinationName,
            departureTime: candidateTrip.departureTime?.toISOString?.() ?? null,
            seatCount: intent.seatCount,
            pickupLat: intent.route.originLat,
            pickupLng: intent.route.originLng,
          };
          try {
            const io = require('../../app').get('io');
            if (io) io.of('/driver').to(`driver:${candidateTrip.driverId}`).emit('trip:scheduled_reminder', reminderPayload);
          } catch (_) { /* socket layer optional */ }
          if (driver?.fcmToken) {
            await pushService.sendPush(
              driver.fcmToken,
              'Scheduled rider joining',
              `A rider joins your ${intent.route.destinationName} trip. Pickup at ${intent.route.originName}.`,
              { type: 'SCHEDULED_REMINDER', tripId: candidateTrip.id },
            ).catch(() => {});
          }
        } catch (remErr) {
          logger.warn('Scheduled-ride driver reminder failed (non-blocking):', remErr.message);
        }
        logger.info('Scheduled ride matched to existing trip', { intentId: intent.id, tripId: candidateTrip.id });
      } else {
        // No existing trip to seat them on — dispatch it live to nearby drivers now,
        // close to the actual pickup time, instead of leaving it unprocessed forever.
        const tripRequestService = require('./trip-request.service');
        await tripRequestService.createRequest(intent.userId, {
          destination: intent.route.destinationName,
          scheduledAt: intent.scheduledAt.toISOString(),
          seatCount: intent.seatCount,
          pickupLat: intent.route.originLat,
          pickupLng: intent.route.originLng,
          destLat: intent.route.destLat,
          destLng: intent.route.destLng,
        });
        // Mark as handed off so this worker doesn't keep re-dispatching it every
        // tick. This is NOT the same as EXPIRED — the intent is still actively
        // trying to find a driver via live dispatch, just via a different
        // mechanism now. Reusing EXPIRED here made every just-scheduled ride
        // that didn't immediately match an existing trip (the common case)
        // look identical to one that had genuinely timed out with no match —
        // the rider's scheduled-rides list showed nothing BUT "expired" rows.
        await prisma.scheduledRideIntent.update({ where: { id: intent.id }, data: { status: 'DISPATCHED' } });
        logger.info('Scheduled ride handed off to live dispatch (no matching trip)', { intentId: intent.id });
      }
    } catch (err) {
      logger.warn('Failed to process scheduled ride intent (non-blocking):', { intentId: intent.id, error: err.message });
    }
  }

  return { processed: dueIntents.length };
}

/**
 * Preview the deviation surcharge (if any) for a group-hub joiner picking their
 * own pickup point instead of the trip's main pickup — lets the rider see the
 * extra cost before committing to book at that spot.
 */
async function estimateDeviationSurcharge(tripId, lat, lng) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: {
      perKmRatePesewas: true,
      pickupLat: true, pickupLng: true, dropoffLat: true, dropoffLng: true,
      route: { select: { originLat: true, originLng: true, destLat: true, destLng: true } },
    },
  });
  if (!trip) throw new NotFoundError('Trip');

  // An on-demand trip has no Route row, and its endpoints live on the Trip
  // itself. Reading `trip.route.originLat` blind threw a 500 the moment the
  // invite screen priced a joiner's own pickup on one.
  const fromLat = trip.route ? trip.route.originLat : trip.pickupLat;
  const fromLng = trip.route ? trip.route.originLng : trip.pickupLng;
  const toLat = trip.route ? trip.route.destLat : trip.dropoffLat;
  const toLng = trip.route ? trip.route.destLng : trip.dropoffLng;
  if ([fromLat, fromLng, toLat, toLng].some((n) => typeof n !== 'number')) {
    // Nothing to measure a detour against. Say so rather than answering with a
    // surcharge derived from NaN, which would reach the rider as "GH₵ NaN".
    throw new AppError(
      'This trip has no pickup or destination coordinates yet, so a detour cannot be priced.',
      409,
      'TRIP_ROUTE_MISSING',
    );
  }

  const { detourKm, calculateDeviationSurcharge } = require('./fare.calculator');
  const extraKm = detourKm({
    fromLat, fromLng,
    viaLat: lat, viaLng: lng,
    toLat, toLng,
  });
  const surcharge = calculateDeviationSurcharge({ extraKm, perKmRatePesewas: trip.perKmRatePesewas });
  return { extraKm: Math.round(extraKm * 100) / 100, surcharge };
}

async function getTrackingData(shortId) {
  const trip = await prisma.trip.findUnique({
    where: { shortId },
    include: {
      route: { select: { id: true, name: true, originName: true, destinationName: true, originLat: true, originLng: true, destLat: true, destLng: true } },
      driver: { select: { id: true, name: true, profilePhoto: true, currentLat: true, currentLng: true, currentHeading: true } },
      vehicle: { select: { make: true, model: true, plateNumber: true, tier: true } },
    },
  });
  if (!trip) throw new NotFoundError('Trip');

  /**
   * AN ON-DEMAND RIDE HAS NO ROUTE ROW — GIVE THE PAGE ONE ANYWAY.
   *
   * `public/tracking/index.html` reads `data.route.originName`,
   * `data.route.destLng` and so on, and nothing else: the header, the two
   * address rows, the pickup/destination markers and the map's own bounds are
   * all derived from it. An on-demand trip is created with `routeId: null`
   * (rides.service.requestRide), so a rider who shared the ride they were
   * actually on — the primary product — sent their contact a page with a blank
   * header, no addresses and no pins.
   *
   * Synthesised HERE rather than fixed in the HTML so the shape the page
   * consumes has exactly one definition, and so the ended-trip branch below
   * keeps its privacy rule for free: it copies the names out of this object and
   * drops the coordinates, whichever kind of trip produced it.
   */
  const trackedRoute = trip.route ?? (
    trip.pickupLat != null || trip.dropoffLat != null
      ? {
        id: null,
        name: null,
        originName: trip.pickupAddress || 'Pickup',
        destinationName: trip.dropoffAddress || 'Destination',
        originLat: trip.pickupLat,
        originLng: trip.pickupLng,
        destLat: trip.dropoffLat,
        destLng: trip.dropoffLng,
      }
      : null
  );

  /**
   * A SHARE LINK DIES WITH THE TRIP.
   *
   * This endpoint is unauthenticated by design — that is the whole point of
   * "share my ride with my sister". But it was not lifecycle-gated, so once the
   * ride ended the link kept answering with the driver's CURRENT coordinates,
   * their photo, and their plate number. Whoever held the link — the trusted
   * contact, anyone they forwarded it to, anyone who found it in a chat
   * backup — had a permanent live tracker on that driver, for every trip they
   * drove afterwards.
   *
   * After a terminal status the page gets enough to render "this trip has
   * ended" and nothing else. No position, no vehicle, no photo.
   */
  if (!tripState.isLive(trip.status)) {
    return {
      tripId: trip.id,
      shortId: trip.shortId,
      status: trip.status,
      tier: trip.tier,
      departureTime: trip.departureTime,
      arrivedAt: trip.arrivedAt,
      // Names only. The public page needs them to say what journey this was;
      // the coordinates would place a stranger at someone's front door.
      route: trackedRoute
        ? {
            id: trackedRoute.id,
            name: trackedRoute.name,
            originName: trackedRoute.originName,
            destinationName: trackedRoute.destinationName,
          }
        : null,
      path: null,
      driver: null,
      vehicle: null,
      ended: true,
    };
  }

  /**
   * THE ROAD LINE AND THE REAL ETA.
   *
   * This payload used to carry neither, and the public page did the only two
   * things it could with what it had: it drew a two-point LineString between
   * origin and destination — a line straight through buildings, reported as
   * "the route is giving me a straight line, not following the road" — and it
   * counted down to `departureTime`, which is a completely different quantity
   * from the driver's ETA. That is the "64 mins on the web, 16 mins in the
   * apps" discrepancy: not a miscalculation, two different clocks.
   *
   * Both now come from `route-geometry`, the same service the apps read, so
   * the shared link cannot disagree with the app that produced it. `peek` —
   * not `get` — because this endpoint is unauthenticated and polled: it serves
   * whatever the trip's own traffic has already computed and never issues a
   * billable Directions call of its own.
   */
  let path = null;
  try {
    const cached = await routeGeometry.peekRouteForTrip(trip);
    if (cached) {
      path = {
        leg: cached.leg,
        geometry: cached.geometry,
        distanceKm: cached.distanceKm,
        etaMinutes: cached.durationMin != null ? Math.max(1, Math.round(cached.durationMin)) : null,
      };
    }
  } catch {
    // A missing line is a cosmetic loss; never fail the page over it.
  }

  return {
    tripId: trip.id,
    shortId: trip.shortId,
    status: trip.status,
    tier: trip.tier,
    departureTime: trip.departureTime,
    arrivedAt: trip.arrivedAt,
    route: trackedRoute,
    /**
     * The live leg: road geometry plus the ETA in minutes.
     * `leg` is 'toPickup' while the driver is fetching the rider and
     * 'toDropoff' once they are aboard — the page labels itself from it, so it
     * cannot claim "arriving at destination" while the driver is still coming.
     */
    path,
    driver: trip.driver ? {
      name: trip.driver.name,
      profilePhoto: trip.driver.profilePhoto,
      lat: trip.driver.currentLat,
      lng: trip.driver.currentLng,
      heading: trip.driver.currentHeading,
    } : null,
    vehicle: trip.vehicle,
    confirmedSeats: trip.confirmedSeats,
    maxSeats: trip.maxSeats,
  };
}

/**
 * Available drivers near a point, as bare id + position.
 *
 * Reuses the one availability rule (services/driver-availability.js) so the pins
 * a rider sees match the drivers dispatch would actually offer to — showing a
 * busy driver as an available car is worse than showing nothing.
 *
 * Positions are the drivers' last reported DB coordinates, rounded to ~11 m.
 * That is precise enough to place a car on the right street and coarse enough
 * that the endpoint cannot be used to follow an individual driver around.
 */
async function getNearbyAvailableDrivers({ lat, lng, radiusKm = 6 }) {
  const drivers = await prisma.driver.findMany({
    where: {
      ...availableDriverWhere(),
      currentLat: { not: null },
      currentLng: { not: null },
    },
    select: { id: true, currentLat: true, currentLng: true },
    take: 60,
  });

  return drivers
    .map((d) => ({
      id: d.id,
      latitude: Math.round(d.currentLat * 1e4) / 1e4,
      longitude: Math.round(d.currentLng * 1e4) / 1e4,
      distanceKm: haversineKm(lat, lng, d.currentLat, d.currentLng),
    }))
    .filter((d) => Number.isFinite(d.distanceKm) && d.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 20)
    .map(({ id, latitude, longitude }) => ({ id, latitude, longitude }));
}

module.exports = { getNearbyAvailableDrivers, createTrip, getTrip, getTripDriverPhone, getTripByShareToken, getSeatMap, getPulseSchedules, searchTrips, getActiveTrip, completeTrip, getTripReceipt, driverNoShow, riderNoShow, scheduleTrip, getTrackingData, getScheduledRides, cancelScheduledRide, processScheduledRideIntents, saveLiveActivityToken, clearLiveActivityToken, estimateDeviationSurcharge };
