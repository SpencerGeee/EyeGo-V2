'use strict';

const prisma = require('../../config/database');
const env = require('../../config/env');
const cloudinaryService = require('../../services/cloudinary.service');
const otpService = require('../../services/otp.service');
const smsService = require('../../services/sms.service');
const pushService = require('../../services/push.service');
// One reputation model for both sides of the market — see the note at the top
// of services/standing.service.js.
const standingService = require('../../services/standing.service');
const { NotFoundError, AppError, InsufficientWalletError, ForbiddenError, ValidationError } = require('../../utils/errors');
const { assertAssetUrl } = require('../../utils/asset-url');
const { isWithinGhana } = require('../../services/mapbox.service');
const { generateTripReceipt, refundBookingForDriverCancellation } = require('../cancellation/cancellation.service');
const redis = require('../../config/redis');
const logger = require('../../utils/logger');
const { estimateFare, calculateFare, haversineKm } = require('../trips/fare.calculator');
const { haversineMeters } = require('../../utils/geo');
const ratingIntegrity = require('../../services/rating-integrity.service');
const { seatOccupyingWhere, departureCountedWhere, livePassengerWhere } = require('../../utils/booking-status');
const { isDriverAvailable } = require('../../services/driver-availability');
const supply = require('../../services/supply-index.service');
const routeGeometry = require('../../services/route-geometry.service');
const tripPublisher = require('../../services/trip-events.publisher');
const {
  expireStaleTrips,
  liveUnstartedTripFilter,
  liveInFlightTripFilter,
} = require('../../services/stale-trips');
const { percentOf, formatGhs, assertPesewas, wholePesewas } = require("../../utils/money");

// ─── Trip status machine ─────────────────────────────────────────────────────
// The four driver-driven transitions used to be unguarded `trip.update`s: any
// of them would happily overwrite any status, so a stale client (offline queue
// replay, double-tap, a screen resumed from the background) could walk a trip
// backwards — e.g. push IN_PROGRESS back to DRIVER_EN_ROUTE and re-notify every
// rider that the driver had "started the trip" again.
//
// Note there is no DISPATCHED→CONFIRMED→start hop for on-demand rides: those
// trips are created at DRIVER_EN_ROUTE the moment the driver accepts (see
// trip-request.service.js), so `startTrip` — the app's "Start Trip" button —
// only ever applies to a trip that was genuinely scheduled ahead of time.
// SUPERSEDED. This local four-row table was one of several private copies of
// "what may follow what", each slightly different, none enforced by the
// database and none of them consulted by the other services that also wrote
// Trip.status. The authoritative table is TRANSITIONS in
// services/trip-state.service.js, it covers every status and every actor, and
// `applyTransition` is the only thing that may perform the write.
//
// Kept only as the idempotency helper below, which is genuinely useful: a
// retried request for a transition the trip has already made should be a
// no-op success, not a 409 and a duplicate push notification.
const tripState = require('../../services/trip-state.service');
const dispatchCascade = require('../../services/dispatch-cascade.service');

/**
 * Assert `trip` may move to `next`. Idempotent: re-issuing the transition a
 * trip is already in is a no-op success (returns false, "nothing to do"), so
 * retried requests don't 409 or fire duplicate push notifications.
 */
/**
 * Wallet-transaction types that represent money the driver EARNED.
 *
 * `EARNINGS_CREDIT` is credited to the wallet (online-paid fares).
 * `CASH_EARNING` is a ledger-only record of cash handed over in person — it must
 * never touch the balance, but it is real income and every earnings report has to
 * include it. Reading `EARNINGS_CREDIT` alone is what made a cash-working
 * driver's chart and totals read as zero. See the CASH_EARNING block in
 * `arriveTrip`.
 *
 * `TRIP_EARNING` is what the OTHER completion path writes
 * (trips.service.completeTrip, reached via the `driver:arrived` socket event), and
 * it was never in this aggregation either — so which code path finished the trip
 * silently decided whether it showed up in the driver's earnings at all.
 */
const EARNING_TYPES = ['EARNINGS_CREDIT', 'TRIP_EARNING', 'CASH_EARNING'];

/**
 * Idempotency gate in front of the real state machine.
 *
 * Returns false ("nothing to do") when the trip is already where the caller
 * wants it, so an offline-queue replay or a double-tap does not 409 and does
 * not re-fire push notifications. Anything else is delegated to the one
 * authoritative table — this function no longer decides legality itself.
 */
function needsTransition(trip, next) {
  if (trip.status === next) return false;
  tripState.assertTransition(trip.status, next, tripState.ACTOR.DRIVER);
  return true;
}

// Attach the same per-person estimate that the rider home screen shows,
// so both apps display consistent pricing for the same trip.
// Uses stored baseFarePesewas/perKmRatePesewas so pricing reflects the rates set at trip creation.
function attachFarePerSeat(trip) {
  const distanceKm = trip.route?.distanceKm ?? 0;
  // BUGFIX (reported as "the driver app said ₵80 per seat and the rider app said
  // ₵40 for the same trip"): this used to divide the trip cost by
  //   clamp(trip.availableSeats ?? confirmedSeats ?? maxSeats, min 4, max maxSeats)
  // `availableSeats` is not a column on Trip, so it was always undefined; a fresh
  // trip then fell through to `confirmedSeats` = 0, which the `Math.max(_, 4)`
  // turned into 4. Every driver-facing per-seat price was therefore
  // totalCost / 4, while riders (trips.service, bookings.service) all divide by
  // `maxSeats` — a 2× discrepancy on an 8-seater, exactly as reported.
  //
  // `maxSeats` is the capacity the driver chose for the trip and is the ONLY
  // denominator anywhere else in the system. There is now no second formula.
  const seatCount = trip.maxSeats ?? 1;
  const fareInfo = calculateFare({
    tier: trip.tier ?? 'ECO',
    distanceKm,
    seatCount,
    doorstepPickup: trip.doorstepPickup ?? false,
    heavyLoad: trip.heavyLoad ?? false,
    surgeMultiplier: trip.surgeMultiplier ?? 1.0,
    storedBaseFarePesewas: trip.baseFarePesewas,
    storedPerKmRatePesewas: trip.perKmRatePesewas,
  });
  return scrubBookingSecrets({
    ...trip,
    farePerSeatPesewas: fareInfo.farePerPersonPesewas,
    commissionRate: fareInfo.commissionRate,
    driverEarningsPerSeatPesewas: fareInfo.driverEarningsPerSeatPesewas,
  });
}

/**
 * THE DRIVER MAY NOT READ THE CODE THEY ARE SUPPOSED TO BE TOLD.
 *
 * "Verify My Ride" only proves anything because the DRIVER has to demonstrate
 * they were told the number — a driver who can read it off their own screen has
 * verified nothing, and the whole check becomes theatre. `trip-view.js` gets
 * this right for the socket snapshot; this REST path did not. The driver's trip
 * query includes booking rows with no `select`, so every column came back,
 * `boardingPin` among them.
 *
 * The driver's app still needs to KNOW a code will be asked for — that is what
 * lets the seat sheet warn them before they are refused — so the fact survives
 * as a boolean and the secret does not.
 */
function scrubBookingSecrets(trip) {
  if (!trip || !Array.isArray(trip.bookings)) return trip;
  return {
    ...trip,
    bookings: trip.bookings.map(({ boardingPin, ...b }) => ({
      ...b,
      requiresBoardingPin: !!boardingPin && !b.pinVerifiedAt,
    })),
  };
}

/**
 * SAY WHOSE SEATS THESE ARE, AND WHETHER THE MONEY IS IN.
 *
 * BUGFIX ("when a rider chooses to pay for the entire trip, the driver app
 * doesn't show that the seats are mapped to that group or that the whole trip is
 * paid"). The covered seats were real booking rows the whole time, but nothing in
 * the driver's payload said they belonged to one party — so twelve seats bought
 * by one host were indistinguishable from twelve strangers, and there was no
 * field anywhere that meant "this trip is settled".
 *
 * Mirrors `groupSummary` in services/trip-view.js: same rule, same words, so the
 * REST payload and the socket snapshot cannot tell the driver different things.
 * `settled` is deliberately not `paymentStatus === 'PAID'` alone — a confirmed
 * cash seat is owed to the driver in hand, which is settled from the platform's
 * point of view and is exactly what a group host paying cash produces.
 */
function attachGroupSummary(trip) {
  if (!trip) return trip;
  const bookings = trip.bookings ?? [];
  const isSettled = (b) =>
    b.paymentStatus === 'PAID' || ['CONFIRMED', 'BOARDED', 'COMPLETED'].includes(b.status);

  const paidSeatCount = bookings.filter((b) => b.paymentStatus === 'PAID').length;
  const settledSeatCount = bookings.filter(isSettled).length;

  /**
   * WHAT WAS ACTUALLY SOLD, AND THE UNIT PRICE THAT MATCHES IT.
   *
   * BUGFIX ("the trip-complete receipt says one seat at 8 cedis; the ride was 36
   * and the seat is 3"). Both numbers on that line were computed independently of
   * the money: the count came from "not cancelled" (so a held-and-abandoned seat
   * counted as a passenger) and the unit price came from
   * `trip.farePerSeatPesewas`, a separate derivation that cannot see a surcharge
   * sitting on a booking row.
   *
   * Sold seats are settled seats. The unit price is the gross with the per-booking
   * surcharges taken back out, so `seatCount × perSeatPesewas + surchargesPesewas
   * === grossPesewas` holds by construction and the receipt cannot contradict
   * itself again.
   */
  const sold = bookings.filter(isSettled);
  const grossPesewas = sold.reduce((n, b) => n + (b.fareAmountPesewas || 0), 0);
  const surchargesPesewas = sold.reduce(
    (n, b) =>
      n +
      (b.deviationSurchargePesewas || 0) +
      (b.heavyCargo ? env.HEAVY_LOAD_SURCHARGE_PESEWAS : 0),
    0,
  );
  const soldSummary = {
    seatCount: sold.length,
    grossPesewas,
    surchargesPesewas,
    perSeatPesewas: sold.length > 0 ? Math.round((grossPesewas - surchargesPesewas) / sold.length) : null,
    commissionPesewas: sold.reduce(
      (n, b) =>
        n +
        (b.commissionAmountPesewas != null
          ? b.commissionAmountPesewas
          : percentOf(b.fareAmountPesewas || 0, env.PLATFORM_COMMISSION)),
      0,
    ),
  };

  let group = null;
  if (trip.group) {
    const covered = trip.group.isCoverAll
      ? bookings
      : bookings.filter((b) => b.isCoveredByLead || b.userId === trip.group.leadPassengerId);
    group = {
      id: trip.group.id,
      coverAll: !!trip.group.isCoverAll,
      leadUserId: trip.group.leadPassengerId,
      leadName: trip.group.leadPassenger?.name ?? null,
      seatCount: covered.length,
      seatNumbers: covered.map((b) => b.seatNumber).filter((n) => n != null).sort((a, b) => a - b),
      totalPesewas: covered.reduce((n, b) => n + (b.fareAmountPesewas || 0), 0),
      settledSeatCount: covered.filter(isSettled).length,
      settled: covered.length > 0 && covered.every(isSettled),
      paymentMethod: covered[0]?.paymentMethod ?? null,
    };
  }

  return { ...trip, group, paidSeatCount, settledSeatCount, sold: soldSummary };
}

async function getMe(driverId) {
  const [driver, totalTrips, ratingAgg] = await Promise.all([
    prisma.driver.findUnique({
      where: { id: driverId },
      select: {
        id: true, phone: true, name: true, profilePhoto: true, dateOfBirth: true,
        status: true, isOnline: true, walletBalancePesewas: true,
        ghanaCardNumber: true, createdAt: true, preferences: true,
        emergencyContact: true,
        vehicles: { where: { isActive: true } },
      },
    }),
    prisma.trip.count({ where: { driverId, status: 'COMPLETED' } }),
    // Chronic low-raters are excluded from the average — see
    // services/rating-integrity.service.js.
    prisma.driverRating.aggregate({
      where: await ratingIntegrity.ratingWhere({ driverId }),
      _avg: { stars: true },
      _count: { stars: true },
    }),
  ]);
  if (!driver) throw new NotFoundError('Driver');
  // updatePreferences() writes navigationApp/theme into the preferences JSON
  // blob, but getMe() never read it back — the client's local cache of these
  // settings was the only copy that ever displayed, so a reinstall silently
  // lost them even though the account had them saved all along.
  const { preferences: preferencesJson, emergencyContact: emergencyContactJson, ...driverFields } = driver;
  const preferences = preferencesJson ? JSON.parse(preferencesJson) : {};
  /**
   * AND THE SAME FOR THE EMERGENCY CONTACT.
   *
   * BUGFIX, exactly the defect the note above describes — left unfixed for the
   * one field where it matters most. `(profile)/safety.tsx` reads
   * `driver.emergencyContact` from the LOCAL store and writes it back there
   * after saving; nothing ever re-read it from the server, and `getMe` did not
   * even select the column. So a driver who reinstalled, or signed in on a new
   * phone, saw an empty Emergency Contact field for an account that had one
   * saved all along — and this is the person SMS'd when they hit SOS
   * (`sos-alert.service`). Either they re-enter it, or they believe there is
   * one when the screen says there is not.
   */
  let emergencyContact = null;
  if (emergencyContactJson) {
    try {
      emergencyContact = JSON.parse(emergencyContactJson);
    } catch {
      // A malformed blob is not worth failing the whole profile read over; the
      // screen shows an empty field, which is what it did before anyway.
      emergencyContact = null;
    }
  }
  return {
    ...driverFields,
    ...preferences,
    emergencyContact,
    avatarUrl: driver.profilePhoto,
    totalTrips,
    // null when no ratings yet — frontend shows "New" instead of a number
    rating: ratingAgg._avg.stars ?? null,
    ratingCount: ratingAgg._count.stars ?? 0,
    totalEarned: driver.walletBalancePesewas,
    isActive: driver.status === 'ACTIVE',
    profileComplete: !!(driver.name && driver.profilePhoto),
  };
}

async function updateProfile(driverId, data) {
  // Anything not on this list is DROPPED, which is correct for a PATCH a client
  // controls — but silently dropping vehicle details is how the driver app's
  // onboarding form spent its whole life posting a car nobody ever stored. A
  // caller aiming at the wrong endpoint now hears about it.
  const misdirected = Object.keys(data || {}).filter((k) => /^vehicle/i.test(k));
  if (misdirected.length) {
    throw new ValidationError(
      `Vehicle details are not part of the driver profile (${misdirected.join(', ')}). ` +
        'Submit them to POST /v1/driver/verify instead.',
    );
  }

  const allowed = {};
  if (data.name) allowed.name = data.name;
  if (data.dateOfBirth) allowed.dateOfBirth = data.dateOfBirth;
  // A URL to an uploaded image, never the image itself — see utils/asset-url.
  if (data.profilePhoto) allowed.profilePhoto = assertAssetUrl(data.profilePhoto, 'profilePhoto');
  return prisma.driver.update({ where: { id: driverId }, data: allowed });
}

async function updateFcmToken(driverId, fcmToken) {
  return prisma.driver.update({ where: { id: driverId }, data: { fcmToken } });
}

/** The three tiers the fare card prices. Mirror of the pricing groups in config/settings.js. */
const VEHICLE_TIERS = ['ECO', 'COMFORT', 'PREMIUM'];
/** A vehicle a driver may register: a private car at the low end, a 14-seat minibus at the top. */
const MIN_SEATER_COUNT = 2;
const MAX_SEATER_COUNT = 20;

/**
 * The driver's own submission of the details their account cannot work without.
 *
 * This is the ONLY path by which a Vehicle row comes into existence for a driver
 * who signed up through the app, and for a long time nothing called it: the
 * onboarding screen PATCHed the vehicle fields onto `/driver/me` instead, where
 * `updateProfile`'s allow-list silently dropped every one of them. The mutation
 * returned 200, onboarding advanced, and the driver ended up approved with no
 * vehicle — which `createTrip` and `claimReassignedTrip` reject outright
 * (`NO_VEHICLE`) and `matcher.service` filters out of every tier-matched
 * dispatch. A driver in that state can go online and never legally take a ride.
 *
 * Written to be re-runnable, because onboarding is a form a driver can back out
 * of and return to: the same plate submitted twice updates the row rather than
 * failing on the unique constraint.
 */
async function completeVerification(driverId, data) {
  const { name, ghanaCardNumber, vehicle } = data || {};

  if (!vehicle || typeof vehicle !== 'object') {
    throw new ValidationError('Vehicle details are required.');
  }

  const plateNumber = String(vehicle.plateNumber || '').trim().toUpperCase();
  const make = String(vehicle.make || '').trim();
  const model = String(vehicle.model || '').trim();
  const year = Number(vehicle.year);
  const seaterCount = Number(vehicle.seaterCount);
  const tier = String(vehicle.tier || '').trim().toUpperCase();
  const colour = vehicle.colour ? String(vehicle.colour).trim() : null;

  if (!plateNumber) throw new ValidationError('A plate number is required.');
  if (!make || !model) throw new ValidationError('Vehicle make and model are required.');
  const thisYear = new Date().getFullYear();
  if (!Number.isInteger(year) || year < 1980 || year > thisYear + 1) {
    throw new ValidationError(`Enter a vehicle year between 1980 and ${thisYear + 1}.`);
  }
  if (!Number.isInteger(seaterCount) || seaterCount < MIN_SEATER_COUNT || seaterCount > MAX_SEATER_COUNT) {
    throw new ValidationError(`Seat count must be between ${MIN_SEATER_COUNT} and ${MAX_SEATER_COUNT}.`);
  }
  if (!VEHICLE_TIERS.includes(tier)) {
    throw new ValidationError(`Vehicle class must be one of ${VEHICLE_TIERS.join(', ')}.`);
  }

  // `plateNumber` is globally unique, so a typo that collides with a car
  // somebody else registered has to say so rather than surface as a raw P2002.
  const plateOwner = await prisma.vehicle.findUnique({
    where: { plateNumber },
    select: { id: true, driverId: true },
  });
  if (plateOwner && plateOwner.driverId !== driverId) {
    throw new AppError(
      'That plate number is already registered to another driver. Contact support if this is your vehicle.',
      409,
      'PLATE_ALREADY_REGISTERED',
    );
  }

  return prisma.$transaction(async (tx) => {
    const driverData = {};
    if (name) driverData.name = String(name).trim();
    if (ghanaCardNumber) driverData.ghanaCardNumber = String(ghanaCardNumber).trim();

    const driver = Object.keys(driverData).length
      ? await tx.driver.update({ where: { id: driverId }, data: driverData })
      : await tx.driver.findUniqueOrThrow({ where: { id: driverId } });

    const vehicleData = { make, model, year, seaterCount, tier, colour };

    if (plateOwner) {
      // Same plate, same driver — they came back through onboarding and edited
      // a field. Re-verification is deliberate: the admin approved a specific
      // car, so changing its details puts it back in the queue.
      await tx.vehicle.update({
        where: { id: plateOwner.id },
        data: { ...vehicleData, isActive: true, isVerified: false },
      });
    } else {
      // A driver re-registering under a NEW plate has replaced their car. The
      // old row is retired rather than deleted so completed trips keep pointing
      // at the vehicle that actually ran them.
      await tx.vehicle.updateMany({ where: { driverId, isActive: true }, data: { isActive: false } });
      await tx.vehicle.create({ data: { driverId, plateNumber, ...vehicleData } });
    }

    return tx.driver.findUnique({
      where: { id: driver.id },
      include: { vehicles: { where: { isActive: true } } },
    });
  });
}

async function addVehicle(driverId, data) {
  return prisma.vehicle.create({
    data: { driverId, ...data },
  });
}

async function goOnline(driverId, lat, lng) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) throw new NotFoundError('Driver');
  if (driver.status !== 'ACTIVE') throw new ForbiddenError('Your account must be approved before going online');

  // Clear out trips this driver created but never ran before they start taking
  // dispatch. Without this, one abandoned trip keeps them permanently "busy"
  // in driver-availability's filter and no rider request ever reaches them —
  // going online is exactly the moment that must be true again.
  await expireStaleTrips(prisma, { driverId });

  // Document verification gating — previously goOnline() never checked this despite
  // the app's own copy claiming unverified documents block "full trip access."
  if (env.NODE_ENV !== 'development') {
    const docs = await getDocuments(driverId);
    const required = docs.filter((d) => d.type === 'DRIVERS_LICENSE' || d.type === 'GHANA_CARD');
    const notVerified = required.find((d) => d.status !== 'VERIFIED');
    if (notVerified) {
      throw new AppError(
        `Your ${notVerified.type === 'GHANA_CARD' ? 'Ghana Card' : 'driver\'s license'} must be verified before you can go online.`,
        403,
        'DOCUMENTS_NOT_VERIFIED',
      );
    }
  }

  if (driver.walletBalancePesewas < 0) {
    throw new AppError(
      `Account suspended — ${formatGhs(Math.abs(driver.walletBalancePesewas))} outstanding. Top up your wallet to go back online.`,
      402,
      'NEGATIVE_WALLET_BALANCE'
    );
  }

  // Rating & acceptance-rate enforcement — the driver terms screen warns that a
  // pattern of low ratings/declines "may affect your driver level or trigger a
  // review," but nothing previously enforced it. Mirror the document/wallet gates
  // above: block going online (rather than silently suspending) once a driver has
  // enough history to judge fairly.
  if (env.NODE_ENV !== 'development') {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [ratingAgg, accepted, declined] = await Promise.all([
      // The go-online rating gate must judge a driver on ratings that mean
      // something: a rider who 1-stars every trip cannot be what pushes a driver
      // below the threshold and off the platform.
      prisma.driverRating.aggregate({
        where: await ratingIntegrity.ratingWhere({ driverId }),
        _avg: { stars: true },
        _count: { stars: true },
      }),
      prisma.dispatchAction.count({ where: { driverId, action: 'ACCEPTED', createdAt: { gte: thirtyDaysAgo } } }),
      prisma.dispatchAction.count({ where: { driverId, action: 'DECLINED', createdAt: { gte: thirtyDaysAgo } } }),
    ]);

    if (ratingAgg._count.stars >= 5 && (ratingAgg._avg.stars ?? 5) < 3.5) {
      throw new AppError(
        'Your rating has fallen below the minimum required to accept trips. Contact support to appeal.',
        403,
        'RATING_TOO_LOW',
      );
    }

    const totalDispatches = accepted + declined;
    if (totalDispatches >= 10 && accepted / totalDispatches < 0.3) {
      throw new AppError(
        'Your acceptance rate is too low to go online. Accept more of your dispatched trips to restore access.',
        403,
        'ACCEPTANCE_RATE_TOO_LOW',
      );
    }
  }

  if (lat && lng && !isWithinGhana(lat, lng) && env.NODE_ENV !== 'development') {
    throw new AppError('Location outside of Ghana. Please check your GPS.', 400, 'INVALID_LOCATION');
  }

  const [updated] = await prisma.$transaction([
    prisma.driver.update({
      where: { id: driverId },
      data: { isOnline: true, currentLat: lat, currentLng: lng },
    }),
    // Start an online session for real hour tracking
    prisma.onlineSession.create({
      data: { driverId, startTime: new Date() },
    }),
  ]);

  // Publish location to Redis
  if (lat && lng) {
    await redis.set(`driver:${driverId}:location`, JSON.stringify({ lat, lng, heading: 0, speed: 0 }), 'EX', 3600);
    /**
     * Enter the dispatch pool NOW, not on the first location ping.
     *
     * `supply-index.service.js` documents this as intended behaviour — "a
     * driver is in the index from the moment they are eligible, not from their
     * first ping" — but nothing implemented it. The gap is a real one on a
     * cold start: the driver app's first GPS fix can be several seconds after
     * the toggle flips, and a rider requesting inside that window found no
     * supply and got NO_DRIVERS_FOUND with drivers sitting right there.
     */
    await supply.upsertDriver(driverId, lat, lng);
    // Legacy set, still read by the admin live map, heatmap and redispatch.
    await redis.geoadd('drivers:online', lng, lat, driverId).catch(() => {});
  }

  // Riders who are ALREADY searching do not learn about this driver on their
  // own — a cascade builds its candidate list from the supply that existed when
  // the request was made. Reported as "I requested a trip, then switched the
  // driver online, and the dispatch never arrived". Fire-and-forget: a driver
  // going online must never fail because someone else's search misbehaved.
  setImmediate(() => {
    dispatchCascade
      .notifySupplyAvailable(driverId)
      .catch((err) => logger.warn(`Supply wake-up failed for ${driverId}: ${err.message}`));
  });

  return updated;
}

async function goOffline(driverId) {
  const [updated] = await prisma.$transaction([
    prisma.driver.update({
      where: { id: driverId },
      data: { isOnline: false },
    }),
    // Close the most recent active online session
    prisma.onlineSession.updateMany({
      where: { driverId, endTime: null },
      data: { endTime: new Date() },
    }),
  ]);
  await redis.del(`driver:${driverId}:location`);
  // Leave the pool immediately rather than lingering for the presence TTL —
  // going offline is an explicit "stop sending me work", and 90 seconds of
  // offers after it is 90 seconds of offers the driver will decline, which
  // counts against the acceptance rate that gates going online at all.
  await supply.removeDriver(driverId);
  await redis.zrem('drivers:online', driverId).catch(() => {});
  return updated;
}

async function getActiveTrip(driverId) {
  // BUGFIX (phantom "Resume Trip" on a fresh install): this matched SCHEDULED
  // and FILLING with no time bound at all, so a trip the driver created and
  // abandoned days ago was still offered as resumable — including after the
  // app was deleted and sideloaded again, which is how it was reported. Sweep
  // those to EXPIRED first, then only accept an unstarted trip whose departure
  // is still within the grace window. Trips actually under way
  // (CONFIRMED → IN_PROGRESS) are unaffected: they stay resumable forever,
  // which is the whole point of the banner.
  await expireStaleTrips(prisma, { driverId });

  const trip = await prisma.trip.findFirst({
    where: {
      driverId,
      OR: [
        // Time-bounded: a started trip nothing has reported on for hours is
        // abandoned, not resumable. See liveInFlightTripFilter — the unbounded
        // status list that used to be here is why a midnight trip was still
        // offered as resumable the next afternoon.
        liveInFlightTripFilter(),
        liveUnstartedTripFilter(),
      ],
    },
    include: {
      route: { include: { virtualStops: { where: { isActive: true }, orderBy: { sequence: 'asc' } } } },
      vehicle: true,
      // Who is paying for whom — see attachGroupSummary.
      group: { include: { leadPassenger: { select: { id: true, name: true } } } },
      bookings: {
        where: { ...seatOccupyingWhere() },
        include: { user: { select: { id: true, name: true, phone: true, profilePhoto: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  return trip ? attachGroupSummary(attachFarePerSeat(trip)) : null;
}

async function getAllTrips(driverId) {
  const trips = await prisma.trip.findMany({
    where: { driverId },
    include: {
      route: true,
      vehicle: true,
      group: { include: { leadPassenger: { select: { id: true, name: true } } } },
      bookings: {
        where: { ...seatOccupyingWhere() },
        // `isCoveredByLead`/`userId`/`paymentMethod` are what tell a seat the
        // group's host bought apart from a seat somebody booked themselves —
        // without them the trip-complete receipt could only count rows, which is
        // how "one seat at 8 cedis" was printed for a 36-cedi twelve-seat ride.
        select: {
          id: true, userId: true, seatNumber: true, fareAmountPesewas: true,
          commissionAmountPesewas: true, paymentStatus: true, paymentMethod: true,
          status: true, isOffline: true, isCoveredByLead: true, heavyCargo: true,
          deviationSurchargePesewas: true, guestName: true,
          user: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { departureTime: 'asc' },
  });
  // Compute farePerSeatPesewas using the same estimateFare formula the rider home screen uses
  return trips.map((t) => attachGroupSummary(attachFarePerSeat(t)));
}

async function devActivate(driverId) {
  // Guard: dev-only endpoint
  if (env.NODE_ENV !== 'development') {
    throw new ForbiddenError('This endpoint is only available in development');
  }

  const minBalance = env.DRIVER_REQUIRED_WALLET_TO_GO_ONLINE_PESEWAS ?? 20;
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: { id: true, walletBalancePesewas: true },
  });
  if (!driver) throw new NotFoundError('Driver');

  const currentBalance = driver.walletBalancePesewas ?? 0;
  const topUp = currentBalance < minBalance ? minBalance - currentBalance : 0;

  // Atomically update status + wallet, and record the transaction
  return prisma.$transaction(async (tx) => {
    const updated = await tx.driver.update({
      where: { id: driverId },
      data: {
        status: 'ACTIVE',
        ...(topUp > 0 && { walletBalancePesewas: { increment: topUp } }),
      },
    });

    if (topUp > 0) {
      await tx.walletTransaction.create({
        data: {
          driverId,
          type: 'TOP_UP',
          amountPesewas: topUp,
          description: 'Dev-activate wallet top-up',
          balanceBeforePesewas: currentBalance,
          balanceAfterPesewas: currentBalance + topUp,
        },
      });
    }

    return updated;
  });
}
async function getTripHistory(driverId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  const [trips, total] = await Promise.all([
    prisma.trip.findMany({
      where: { driverId, status: { in: ['COMPLETED', 'CANCELLED'] } },
      include: { route: true, bookings: { select: { id: true, fareAmountPesewas: true, paymentStatus: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.trip.count({ where: { driverId, status: { in: ['COMPLETED', 'CANCELLED'] } } }),
  ]);
  return { trips, total, page, totalPages: Math.ceil(total / limit) };
}

/**
 * PRESENCE OVER HTTP — the second way into the dispatch pool.
 *
 * "On the admin dispatch page the driver shows as not dispatchable and it's
 * only socket. Is there another way to connect the driver apart from the
 * socket?"
 *
 * There was not, and that was a single point of failure for the whole platform.
 * `supply.upsertDriver` — the only thing that puts a driver in the Redis geo-set
 * `matcher.service` searches, and the only thing that refreshes the 90-second
 * presence key — was called from exactly two places: `goOnline`, once, and the
 * `driver:location_update` socket handler. So a driver whose websocket was
 * refused, blocked by a captive portal or carrier proxy, or simply dropped
 * without reconnecting, aged out of the pool 90 seconds later and became
 * invisible to dispatch while their app cheerfully showed them as online.
 *
 * This is the fallback: the same write, reachable over plain HTTP with the same
 * bearer token. It is deliberately NOT a replacement — the socket is still how
 * an offer REACHES a driver, and this endpoint says so in its response — but a
 * driver who can make an HTTP request can now stay dispatchable, and the app can
 * beat this on a slow timer whenever the socket is not connected.
 *
 * Returns the same eligibility verdict the admin dispatch panel computes, so
 * the driver app can tell the driver why they are not getting trips instead of
 * leaving them to guess.
 */
async function recordPresence(driverId, { lat, lng, heading = 0, speed = 0 } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new AppError('A valid location is required.', 400, 'INVALID_LOCATION');
  }
  // Same rule as `goOnline` above and as the socket's location handler — a
  // driver must never get two different answers about the same coordinate. The
  // development exemption matches `goOnline`'s, so a simulator location does not
  // make half the platform untestable.
  if (!isWithinGhana(lat, lng) && env.NODE_ENV !== 'development') {
    throw new AppError(
      'Location outside Ghana — you will not appear online or receive trip requests until GPS reports a location inside Ghana.',
      400,
      'GEO_OUT_OF_BOUNDS',
    );
  }

  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: { id: true, isOnline: true, status: true, requestsPaused: true },
  });
  if (!driver) throw new NotFoundError('Driver');

  // Offline is a decision, not a network condition. Refreshing presence for a
  // driver who has deliberately gone offline would put them back in the pool.
  if (!driver.isOnline) {
    return { inPool: false, reason: 'You are offline.', dispatchable: false };
  }

  const payload = JSON.stringify({ lat, lng, heading, speed, timestamp: Date.now() });
  const [supplyResult] = await Promise.all([
    supply.upsertDriver(driverId, lat, lng),
    redis.set(`driver:${driverId}:location`, payload, 'EX', 3600).catch(() => {}),
    redis.geoadd('drivers:online', lng, lat, driverId).catch(() => {}),
    // Same channel name the socket handler publishes on (driver.socket.js's
    // LOCATION_UPDATE_CHANNEL) — riders subscribe to it by driver id, so an
    // HTTP-kept-alive driver still moves on a rider's map.
    redis.publish(`driver:${driverId}:location`, payload).catch(() => {}),
    // The admin live map reads this channel; a driver kept alive over HTTP
    // should still move on it.
    redis
      .publish(
        'admin:driver_locations',
        JSON.stringify({ driverId, lat, lng, heading, speed, timestamp: Date.now() }),
      )
      .catch(() => {}),
    prisma.driver
      .update({ where: { id: driverId }, data: { currentLat: lat, currentLng: lng, currentHeading: heading } })
      .catch(() => {}),
  ]);

  /**
   * REJOINING OVER HTTP IS STILL REJOINING.
   *
   * BUGFIX ("i request on the rider app, switch back to the driver app on the
   * same phone, and nothing shows"). The socket handler treats the
   * absent→present edge as a dispatch event and re-runs any parked search
   * (`notifySupplyAvailable`); this endpoint — the one path that works when the
   * socket is dead, which is EXACTLY the same-handset case — did not. So a
   * driver whose presence key expired while they were in the rider app came
   * back into the pool silently, and the search that had already walked past
   * them never looked again.
   *
   * Gated on the edge, like the socket, so a driver beating this every 25 s
   * pays for it once per absence rather than once per beat.
   */
  if (supplyResult?.rejoined) {
    // Lazily required: the cascade reaches back into the socket layer through
    // trip-events.publisher, and a top-level require would close that loop at
    // module load.
    require('../../services/dispatch-cascade.service')
      .notifySupplyAvailable(driverId)
      .catch(() => {});
  }

  const { explainIneligible } = require('../../services/driver-availability');
  const [ineligible] = await explainIneligible(prisma, [driverId]).catch(() => []);

  return {
    inPool: true,
    rejoined: !!supplyResult?.rejoined,
    presenceTtlSeconds: supply.PRESENCE_TTL_SECONDS,
    dispatchable: !ineligible,
    reason: ineligible?.reason ?? null,
    /**
     * Presence is not delivery. This refresh keeps the driver in the candidate
     * pool, but the OFFER itself is emitted to their socket room (and, failing
     * that, an FCM data push). A driver polling this endpoint with no socket is
     * findable but not reachable, and the app should say so rather than let them
     * believe HTTP alone is enough.
     */
    note: 'Presence refreshed. Offers still arrive over the socket or a push notification.',
  };
}

async function arriveAtPickup(driverId, tripId) {
  // The ownership `findFirst` that used to open this function is gone —
  // `requireDriverId` performs the same check inside the transaction, off the
  // row the state machine already reads. See applyTransitionTx: it removes a
  // full database round trip from the path between the driver's tap and the
  // rider's screen, and it closes a small race the outside-the-transaction
  // check had.
  //
  // Was a bare `prisma.trip.update({ status: 'ARRIVED_AT_PICKUP' })` behind a
  // local, advisory guard. Now the one guarded write path: legality, actor
  // permission, version CAS, TripEvent and the realtime fan-out in one call.
  const { trip: updated } = await tripState.applyTransition(tripId, 'ARRIVED_AT_PICKUP', {
    actor: tripState.ACTOR.DRIVER,
    actorId: driverId,
    requireDriverId: driverId,
  });

  // The "your driver has arrived" push is NOT sent here any more. It is sent by
  // services/trip-notify.service.js off the committed transition above, so that
  // every route to ARRIVED_AT_PICKUP — this one, the REST ride endpoints, an
  // admin correction — notifies the rider identically. A push written next to
  // one of several callers is a push the other callers silently don't send.
  return updated;
}

async function getTripById(driverId, tripId) {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, driverId },
    include: {
      route: { include: { virtualStops: { where: { isActive: true }, orderBy: { sequence: 'asc' } } } },
      vehicle: true,
      bookings: {
        where: { ...seatOccupyingWhere() },
        include: {
          // `id` IS LOAD-BEARING. Both driver screens that list passengers key
          // off it, and neither could ever see anybody without it:
          //
          //   chat/[id].tsx        .filter(b => [...].includes(b.status) && b.user?.id)
          //   rate-passengers/[id] .filter(b => b.status !== 'CANCELLED' && b.user?.id)
          //
          // Omitting it from the select meant `b.user` arrived as
          // `{ name, phone, profilePhoto }` with no id, so BOTH filters rejected
          // every booking and both screens rendered their empty states:
          // "No passengers yet" on a trip with riders aboard (so the rider's
          // private chat message had nobody to be addressed to), and
          // "No passengers to rate" after a completed trip with two passengers.
          // rate-passengers also posts the rating against this id, so the screen
          // could not have worked even if it had rendered.
          user: { select: { id: true, name: true, phone: true, profilePhoto: true } },
        },
      },
    },
  });
  if (!trip) throw new NotFoundError('Trip');
  return attachFarePerSeat(trip);
}

// Statuses from which a dispatched trip may still be accepted by its driver.
// Once a trip leaves this set (cancelled, completed, already in progress, or
// already confirmed) the dispatch is stale and must be rejected.
const ACCEPTABLE_DISPATCH_STATUSES = ['SCHEDULED', 'FILLING'];

/**
 * ONE VERB FOR "I'LL TAKE THIS TRIP", WHATEVER KIND OF TRIP IT IS.
 *
 * BUGFIX — "I clicked on the accept button, it said failed to accept."
 *
 * There are three ways a driver can come to hold a trip, and each has its own
 * endpoint with its own preconditions:
 *
 *   - `acceptDispatch`  — the trip is ALREADY assigned to this driver
 *                         (`driverId` matches) and sits at SCHEDULED/FILLING.
 *   - `rides.acceptRide` — the cascade is offering it; `driverId` is still
 *                         NULL and the trip sits at MATCHING.
 *   - `claimReassignedTrip` — a previous driver bailed; REASSIGNING,
 *                         first-claim-wins.
 *
 * The driver app had to guess which one applied from a `kind` string passed
 * through navigation params — and the dispatch list, which is where most taps
 * come from, passed no params at all. So every tap defaulted to
 * `acceptDispatch`, whose very first line is `findFirst({ id, driverId })`. On
 * a cascade offer `driverId` is NULL, that returns nothing, and the driver got
 * a 404 rendered as "Failed to accept trip."
 *
 * The trip row already knows which case it is. Nothing about that decision
 * belonged on the client.
 */
async function claimTrip(driverId, tripId) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { id: true, driverId: true, status: true },
  });
  if (!trip) throw new NotFoundError('Trip');

  if (trip.status === 'REASSIGNING') {
    return claimReassignedTrip(driverId, tripId);
  }

  if (trip.driverId === driverId && ACCEPTABLE_DISPATCH_STATUSES.includes(trip.status)) {
    return acceptDispatch(driverId, tripId);
  }

  if (trip.driverId == null && trip.status === 'MATCHING') {
    // Lazy require: rides.service pulls in the cascade, which pulls in this
    // module. Resolving it at call time rather than load time keeps the cycle
    // from biting during startup.
    const rides = require('../rides/rides.service');
    await rides.acceptRide(driverId, tripId);
    // acceptRide answers with a summary; the dispatch controller and the app
    // both expect a trip-shaped object, so hand back the row it landed on.
    return prisma.trip.findUnique({ where: { id: tripId } });
  }

  if (trip.driverId && trip.driverId !== driverId) {
    throw new AppError('Another driver already took this trip.', 409, 'DISPATCH_UNAVAILABLE');
  }
  throw new AppError('This dispatch has expired or already been claimed.', 409, 'DISPATCH_UNAVAILABLE');
}

async function acceptDispatch(driverId, tripId) {
  const trip = await prisma.trip.findFirst({ where: { id: tripId, driverId } });
  if (!trip) throw new NotFoundError('Trip');

  // Atomic, guarded transition: only confirm if the trip is still in an
  // acceptable pre-dispatch state. The conditional updateMany makes concurrent
  // accepts race-safe — the first writer wins and any later/expired accept sees
  // count === 0 and is rejected with 409 (the client handles 409/410 by
  // navigating away with a "dispatch unavailable" message). The ACCEPTED action
  // is only recorded when the claim actually succeeds.
  if (!ACCEPTABLE_DISPATCH_STATUSES.includes(trip.status)) {
    throw new AppError('This dispatch has expired or already been claimed.', 409, 'DISPATCH_UNAVAILABLE');
  }

  let result;
  try {
    // The hand-rolled conditional updateMany is gone. `applyTransition` does the
    // same compare-and-swap — conditioned on status AND version — and adds the
    // legality check, the append-only event and the version bump the old write
    // could not produce. The audit row is written in the same transaction, so a
    // claim can never commit without its DispatchAction (or vice versa).
    result = await prisma.$transaction(async (tx) =>
      tripState.applyTransitionTx(tx, tripId, 'CONFIRMED', {
        actor: tripState.ACTOR.DRIVER,
        actorId: driverId,
        expectedVersion: trip.version,
        sideEffects: async (innerTx) => {
          await innerTx.dispatchAction.create({ data: { driverId, tripId, action: 'ACCEPTED' } });
        },
      }),
    );
  } catch (err) {
    if (err.code === 'VERSION_CONFLICT' || err.code === 'ILLEGAL_TRANSITION') {
      throw new AppError('This dispatch has expired or already been claimed.', 409, 'DISPATCH_UNAVAILABLE');
    }
    throw err;
  }

  tripState.publishCommitted(result);
  return result.trip;
}

/**
 * "No thanks" — routed the same way `claimTrip` routes an accept.
 *
 * Declining a cascade offer is not the same operation as declining a trip
 * already assigned to you: the first advances the cascade to the next
 * candidate and leaves the trip at MATCHING, the second releases a trip you
 * hold. `declineDispatch` only ever knew how to do the second, so passing on
 * an offer from the dispatch list 404'd exactly like accepting one did.
 */
async function declineTrip(driverId, tripId) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { id: true, driverId: true, status: true },
  });
  if (!trip) throw new NotFoundError('Trip');

  if (trip.driverId == null && ['MATCHING', 'REASSIGNING'].includes(trip.status)) {
    const rides = require('../rides/rides.service');
    await rides.declineRide(driverId, tripId);
    return prisma.trip.findUnique({ where: { id: tripId } });
  }
  return declineDispatch(driverId, tripId);
}

async function declineDispatch(driverId, tripId) {
  const trip = await prisma.trip.findFirst({ where: { id: tripId, driverId } });
  if (!trip) throw new NotFoundError('Trip');
  // Declining an assigned trip releases it. For an on-demand ride that means
  // REASSIGNING — the same trip goes back to dispatch keeping its id, receipt
  // and share link. Only a trip nobody else can take is cancelled outright.
  const canRedispatch = !trip.routeId && trip.status !== 'REASSIGNING';
  const target = canRedispatch ? 'REASSIGNING' : 'CANCELLED';

  const result = await prisma.$transaction(async (tx) =>
    tripState.applyTransitionTx(tx, tripId, target, {
      actor: canRedispatch ? tripState.ACTOR.SYSTEM : tripState.ACTOR.DRIVER,
      actorId: driverId,
      payload: { declinedBy: driverId },
      data: canRedispatch
        ? { driverId: null, vehicleId: null, assignedAt: null, redispatchCount: { increment: 1 } }
        : { cancelledBy: tripState.ACTOR.DRIVER, cancellationReason: 'DRIVER_DECLINED' },
      sideEffects: async (innerTx) => {
        await innerTx.dispatchAction.create({ data: { driverId, tripId, action: 'DECLINED' } });
      },
    }),
  );
  tripState.publishCommitted(result);

  if (canRedispatch) {
    // Excluded so the driver who just passed cannot immediately be re-offered it.
    dispatchCascade
      .startCascade(tripId, { kind: 'REASSIGNMENT', excludeDriverId: driverId })
      .catch((err) => logger.warn(`Redispatch after decline failed for ${tripId}: ${err.message}`));
  }
  return result.trip;
}

async function uploadDocument(driverId, file, type) {
  if (!file || !file.buffer) throw new AppError('No file provided', 400);
  if (!type) throw new AppError('Document type is required', 400);

  const result = await cloudinaryService.uploadBuffer(file.buffer, {
    folder: `eyego/drivers/${driverId}/documents`,
    resource_type: 'image',
    public_id: `${type.toLowerCase()}_${Date.now()}`,
  });
  const url = result.secure_url;

  const fieldMap = {
    DRIVERS_LICENSE: 'licensePhoto',
    PROFILE_PHOTO: 'profilePhoto',
    GHANA_CARD: 'ghanaCardPhoto',
  };

  const field = fieldMap[type];
  if (field) {
    // New/re-uploaded documents go to PENDING review, not straight to VERIFIED —
    // previously any photo present flipped status to VERIFIED with zero human review.
    const current = await prisma.driver.findUnique({ where: { id: driverId }, select: { documentReview: true } });
    let review = {};
    try { review = current?.documentReview ? JSON.parse(current.documentReview) : {}; } catch { /* reset on malformed data */ }
    review[type] = { status: 'PENDING', reviewedAt: null, rejectionReason: null };

    await prisma.driver.update({
      where: { id: driverId },
      data: { [field]: url, documentReview: JSON.stringify(review) },
    });
  }

  return { url, type, status: 'PENDING' };
}

/**
 * How close the driver has to be to the pickup point for starting the trip to
 * mean "I am here" rather than "I am coming".
 *
 * A driver who creates a trip does it FROM their pickup point, and when they
 * are already standing on it, telling every rider "your driver is on the way"
 * is simply false — there is no journey to watch, the ETA counts down to a
 * number that is already zero, and the rider waits for an arrival that has
 * happened. 150 m is tight enough that a driver a street away is still "on the
 * way" and loose enough to survive ordinary urban GPS drift.
 */
const PICKUP_ARRIVAL_RADIUS_M = parseInt(process.env.PICKUP_ARRIVAL_RADIUS_M, 10) || 150;

async function startTrip(driverId, tripId) {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, driverId },
    // `bookings` is what lets `effectivePickup` see a lone joiner's own moved
    // pin. Without it the arrival check below measures the driver against the
    // trip's original pickup, and a driver standing exactly on the rider's
    // chosen point is told they are still "heading to pickup".
    include: {
      bookings: {
        where: { ...seatOccupyingWhere() },
        select: { pickupLat: true, pickupLng: true },
      },
    },
  });
  if (!trip) throw new NotFoundError('Trip');

  // Where the driver actually is, as of their last ping.
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: { name: true, currentLat: true, currentLng: true },
  });

  /**
   * "At the pickup" is a fact about geography, not about which button was
   * tapped. Unknown location falls through to EN_ROUTE: claiming the driver
   * has arrived on the strength of a missing coordinate is the one error here
   * that strands a rider waiting at the kerb.
   *
   * Measured against `effectivePickup`, NOT `trip.pickupLat/Lng` — a rider who
   * moved their own pin from the group hub page is collected from the point they
   * chose (and is surcharged for it), so that point is what "already there"
   * means. Measuring against the trip's original pickup is what produced
   * "heading to pickup" for a driver parked exactly where the rider asked.
   * `metersFromPickup` returns null when either end is unknown, which keeps the
   * same fall-through-to-EN_ROUTE behaviour the note above describes.
   */
  const metersToPickup = routeGeometry.metersFromPickup(trip, driver);
  const atPickup = metersToPickup != null && metersToPickup <= PICKUP_ARRIVAL_RADIUS_M;

  /**
   * ARRIVED_AT_PICKUP is only reachable FROM DRIVER_EN_ROUTE — see the
   * transition table in trip-state.service.js. A scheduled or confirmed trip
   * cannot jump straight to it, and trying would throw out of
   * `assertTransition` and fail the driver's swipe.
   *
   * So a driver who is already standing on the pickup point walks both edges:
   * en route, then arrived. Both are real events with real timestamps, which
   * is what the rider's tracking screen and the receipt both replay, and the
   * walk collapses to a single hop for the common case where the trip is
   * already DRIVER_EN_ROUTE.
   */
  const path = atPickup ? ['DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP'] : ['DRIVER_EN_ROUTE'];
  const target = path[path.length - 1];

  /**
   * BUGFIX (#29 — "the rider tracking page does nothing and no polyline is
   * shown").
   *
   * This used to `return trip` the moment no transition was needed, and a
   * dispatched ride is created at DRIVER_EN_ROUTE the instant the driver
   * accepts (see the note at the top of this file). So for every dispatched
   * trip the driver's swipe hit that early return: no event was published, no
   * push went out, and — the visible part — `warmRouteForTrip` never ran, so
   * the rider's tracking map had no geometry to draw and sat on an empty
   * screen under a status that had not changed.
   *
   * Starting is now always an event, even when the status is already right.
   * The transition is conditional; the route warm and the publish are not.
   */
  let updated = trip;
  for (const step of path) {
    // Re-checked per hop: the first transition bumps `version`, and passing the
    // original one to the second would fail its own optimistic-concurrency
    // guard. `needsTransition` also skips a hop the trip is already on, which
    // is what makes the two-step walk collapse to one for a dispatched ride.
    if (!needsTransition(updated, step)) continue;
    ({ trip: updated } = await tripState.applyTransition(tripId, step, {
      actor: tripState.ACTOR.DRIVER,
      actorId: driverId,
      expectedVersion: updated.version,
    }));
  }

  // The live leg just became `toPickup` and its cache is empty. Compute it
  // before answering, so the client's refetch on success already has a line and
  // an ETA instead of a blank map and "Calculating ETA..." until the driver's
  // next GPS ping. Awaited deliberately: it costs one Directions call (~300ms)
  // and it is the difference between the swipe feeling instant and feeling
  // stuck. Never throws — see warmRouteForTrip.
  //
  // ...and then TELL everyone. Computing it only filled the cache, which serves
  // the next client to ASK; nobody watching the trip was pushed anything, so the
  // rider's screen kept the "Calculating ETA" it had just been reset to until the
  // driver physically moved 50 m. See publishRouteForTrip.
  tripPublisher.publishRouteForTrip(tripId, await routeGeometry.warmRouteForTrip(tripId));

  // Push notifications — non-blocking
  setImmediate(async () => {
    try {
      const bookings = await prisma.booking.findMany({
        where: { tripId, status: 'CONFIRMED', paymentStatus: 'PAID' },
        include: { user: { select: { fcmToken: true } } },
      });
      const tokens = bookings.map(b => b.user?.fcmToken).filter(Boolean);
      if (tokens.length) {
        // Say the true thing. A driver standing on the pickup point who sends
        // "is on the way" tells every rider to keep waiting indoors.
        await pushService.sendMulticastPush(
          tokens,
          atPickup ? 'Your driver is at the pickup point' : 'Driver is on the way',
          atPickup
            ? `${driver?.name ?? 'Your driver'} is waiting at the pickup point`
            : `${driver?.name ?? 'Your driver'} is driving to the pickup point`,
          { type: target, tripId },
        );
      }
    } catch (_) {}
  });

  return updated;
}

async function departTrip(driverId, tripId, { acknowledgeUnderMinimum = false } = {}) {
  const trip = await prisma.trip.findFirst({ where: { id: tripId, driverId } });
  if (!trip) throw new NotFoundError('Trip');
  if (!needsTransition(trip, 'IN_PROGRESS')) return trip;

  /**
   * DEPARTING UNDER MINIMUM OCCUPANCY IS A DECISION, NOT AN ACCIDENT.
   *
   * The group fare is `(base + perKm × km) × surge / maxSeats` — `maxSeats` is
   * the denominator, so a seat on a 15-seater is priced as a fifteenth of the
   * journey. That is correct when the bus is full and brutal when it is not: a
   * driver who departs with one passenger drives the entire route for one
   * fifteenth of its fare, and absorbs the whole shortfall themselves.
   *
   * `MIN_OCCUPANCY_TO_DEPART` existed but only ever gated auto-CONFIRM — nothing
   * consulted it at departure, so this was reachable in one tap with no warning
   * anywhere. The driver found out what it cost them at the end of the trip.
   *
   * Blocking departure outright is the wrong answer: sometimes one paying
   * passenger and a schedule to keep genuinely is the right call, and only the
   * driver can weigh that. So it is refused ONCE, with the numbers, and the app
   * re-sends with `acknowledgeUnderMinimum` if the driver still wants to go.
   * The acknowledgement is recorded on the transition, so "why did this trip run
   * at a loss" is answerable later instead of guessed at.
   *
   * On-demand rides price the whole vehicle and have no seat minimum, so this
   * applies to group trips only.
   */
  /**
   * A PRIVATE HIRE HAS NO EMPTY SEATS TO WAIT FOR.
   *
   * BUGFIX ("swiping to start the trip doesn't work — something is broken past
   * 'at pickup point'").
   *
   * This was `trip.maxSeats > 1`, and on an on-demand ride `maxSeats` is the
   * PARTY SIZE, not seats on sale: a rider who taps the stepper up to three
   * gets a trip with `maxSeats: 3` and exactly ONE booking, because they hired
   * the whole car for their party. The gate below then counted one booking
   * against a four-seat minimum, refused the departure with 409
   * BELOW_MIN_OCCUPANCY, and the driver — standing at the kerb with all three
   * passengers already in the car — was asked whether they really wanted to
   * "depart with empty seats". Tapping "Keep waiting", which is the honest
   * answer to a question that made no sense, left the ride unable to start at
   * all. Cash made it worse: a cash booking is not counted, so a solo party of
   * three read as zero passengers.
   *
   * `requesterId` is the fact that separates the two products — it is set when
   * a RIDER hails a car and null when a DRIVER publishes a trip for strangers
   * to book seats on (see the model note in schema.prisma). Only the latter has
   * an occupancy to be under.
   */
  const isPrivateHire = trip.requesterId != null;
  const isGroupTrip = !isPrivateHire && trip.maxSeats > 1;
  // Read per call, never captured — an operator changing this in /config must
  // take effect on the next departure, not the next deploy.
  const minToDepart =
    require('../../config/settings').get('MIN_OCCUPANCY_TO_DEPART') ?? env.MIN_OCCUPANCY_TO_DEPART;

  /**
   * COUNT PASSENGERS, NOT PAYMENTS.
   *
   * This first read `trip.confirmedSeats`, which is wrong in the one direction
   * that matters: `confirmedSeats` is incremented only when money settles or the
   * driver adds a cash passenger. Cash is the majority payment method here, and
   * a rider who books a seat in the app and pays the driver on boarding leaves
   * it untouched — so a fully sold fifteen-seater reads 0, and the gate below
   * refuses to let a FULL bus depart. Exactly backwards from its purpose.
   *
   * `departureCountedWhere()` asks the question this check actually means:
   * bookings that are committed (CONFIRMED/PAID/BOARDED), regardless of who has
   * paid yet. See the note in utils/booking-status.js for why that is also not
   * `seatOccupyingWhere()` — that set includes unpaid holds, which would let an
   * empty bus depart on the strength of seats about to age out.
   */
  const occupancy = isGroupTrip
    ? await prisma.booking.count({ where: { tripId, ...departureCountedWhere() } })
    : 0;
  if (isGroupTrip && !acknowledgeUnderMinimum && occupancy < minToDepart) {
    const err = new AppError(
      `This trip has ${occupancy} of ${minToDepart} seats needed to break even. ` +
        'Departing now means you earn only what those seats paid.',
      409,
      'BELOW_MIN_OCCUPANCY',
    );
    // The app renders the confirm sheet from these, so the numbers it shows are
    // the server's, not a second copy computed on the phone.
    err.details = { confirmedSeats: occupancy, minOccupancy: minToDepart, maxSeats: trip.maxSeats };
    throw err;
  }
  // `departedAt` is stamped by the state machine's own timestampsFor(), so the
  // clock that records a milestone is the same one that records the event.
  const { trip: updated } = await tripState.applyTransition(tripId, 'IN_PROGRESS', {
    actor: tripState.ACTOR.DRIVER,
    actorId: driverId,
    expectedVersion: trip.version,
    // Only when it actually happened, so the event log distinguishes "departed
    // under minimum, driver accepted the shortfall" from an ordinary departure.
    payload:
      isGroupTrip && occupancy < minToDepart
        ? { departedUnderMinimum: true, confirmedSeats: occupancy, minOccupancy: minToDepart }
        : undefined,
  });

  // Departing switches the live leg from `toPickup` to `toDropoff`, whose cache
  // has never been written. Compute it now rather than leaving both apps with
  // no route line and no ETA until the next location ping — and publish it, or
  // the recompute only benefits whoever asks next. See startTrip.
  tripPublisher.publishRouteForTrip(tripId, await routeGeometry.warmRouteForTrip(tripId));

  // Departure push moved to trip-notify.service.js — see arriveAtPickup above.
  // Note this one also only reached bookings that were CONFIRMED *and* PAID, so
  // a cash rider was never told their own trip had started.
  return updated;
}

async function arriveTrip(driverId, tripId) {
  const result = await prisma.$transaction(async (tx) => {
    const trip = await tx.trip.findFirst({
      where: { id: tripId, driverId },
      include: {
        // Include both PAID (MoMo/card) and PENDING (cash) bookings — drivers collect cash in person
        bookings: { where: { ...seatOccupyingWhere(), paymentStatus: { in: ['PAID', 'PENDING'] } } },
      },
    });
    if (!trip) throw new NotFoundError('Trip');

    // Idempotency guard: if already completed (e.g. mutation retry, or the
    // socket `driver:arrived` path already ran), bail before crediting again.
    // Without this, the active-screen `retry: 1` mutation could double-credit
    // the driver's wallet.
    if (trip.status === 'COMPLETED') {
      return { trip, totalEarningsPesewas: 0, alreadyCompleted: true, transition: null };
    }
    // A trip can only be completed from IN_PROGRESS — nothing may jump the
    // queue from e.g. ARRIVED_AT_PICKUP and settle fares for a ride that never
    // departed. (The COMPLETED short-circuit above keeps retries idempotent,
    // so this only ever rejects genuinely out-of-order calls.)
    // Close trip. Inside the caller's transaction so the status change, the
    // cash settlement and the driver's wallet credit below either all land or
    // none do — the reason `applyTransitionTx` exists.
    const transition = await tripState.applyTransitionTx(tx, tripId, 'COMPLETED', {
      actor: tripState.ACTOR.DRIVER,
      actorId: driverId,
      expectedVersion: trip.version,
    });

    // ── Auto-settle any still-unpaid CASH bookings ───────────────────────
    // Mirrors the same fix in trips.service.js completeTrip — "Mark Boarded"
    // is a manual per-seat driver action that's easy to skip, which would
    // otherwise leave a cash booking's paymentStatus stuck at PENDING
    // forever even though the trip is over and the rider paid in person.
    const unsettledCash = await tx.booking.findMany({
      where: {
        tripId,
        paymentMethod: 'CASH',
        paymentStatus: { not: 'PAID' },
        /**
         * BUGFIX ("the earnings page showed 'cash commission auto settled on
         * arrival — 1 seat(s) not marked boarded'; i don't know if it's a bug or
         * a symptom of the seat that was marked on the select-seat page but
         * nobody actually booked").
         *
         * It was a bug, and the reading was right. This used to exclude only
         * CANCELLED and NO_SHOW, which let SEAT_HELD and PENDING through — a
         * SEAT_HELD row is a fifteen-minute hold on a seat, not a passenger. So
         * a checkout that was abandoned (or a ghost hold left behind by a failed
         * booking attempt) was auto-settled as though someone had ridden and
         * paid cash, and the driver's wallet was DEBITED the commission on a
         * fare they never collected.
         *
         * Auto-settlement exists for one case: a rider who genuinely travelled
         * and paid cash, where the driver simply never tapped "Mark Boarded".
         * That rider's booking is CONFIRMED, PAID or BOARDED. A hold that never
         * became one of those is not a fare, and there is nothing to settle.
         */
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
        const driverBeforeSettle = await tx.driver.findUnique({ where: { id: driverId }, select: { walletBalancePesewas: true } });
        await tx.driver.update({
          where: { id: driverId },
          data: { walletBalancePesewas: { decrement: totalCommissionOwed } },
        });
        await tx.walletTransaction.create({
          data: {
            driverId,
            type: 'COMMISSION_DEDUCTION',
            amountPesewas: totalCommissionOwed,
            description: `Cash commission auto-settled on arrival — ${unsettledCash.length} seat(s) not marked boarded`,
            balanceBeforePesewas: driverBeforeSettle?.walletBalancePesewas ?? 0,
            balanceAfterPesewas: (driverBeforeSettle?.walletBalancePesewas ?? 0) - totalCommissionOwed,
            tripId,
          },
        });
      }
    }

    /**
     * Close the bookings that were actually RIDDEN.
     *
     * BUGFIX ("I opened the group hub and closed the app without paying, and the
     * driver still saw a paid passenger in their earnings"). This promoted every
     * non-terminal row — SEAT_HELD included — to COMPLETED, and a COMPLETED
     * booking is a passenger who travelled as far as every receipt, seat map and
     * earnings figure is concerned. The group hub creates a hold the moment it
     * mounts, so an abandoned invite became a completed fare on the driver's
     * receipt with nobody in the seat and no money anywhere.
     *
     * A hold is a reservation with a timer on it. When the trip ends without it
     * ever being paid for, the honest outcome is EXPIRED with the seat given
     * back — `seatNumber: null`, or the row keeps blocking @@unique([tripId,
     * seatNumber]) for the life of the trip.
     */
    await tx.booking.updateMany({
      where: { tripId, status: { in: ['PENDING', 'SEAT_HELD'] } },
      data: { status: 'EXPIRED', seatNumber: null },
    });
    await tx.booking.updateMany({
      where: { tripId, status: { in: ['CONFIRMED', 'PAID', 'BOARDED'] } },
      data: { status: 'COMPLETED' },
    });

    // Credit driver earnings — ONLY for online-paid bookings (MoMo/card/wallet).
    // Cash bookings (paymentStatus PENDING, paid in hand) already had commission
    // debited at boarding and the driver keeps the cash directly, so crediting the
    // wallet too would double-pay. Match completeTrip's PAID-only filter.
    const ONLINE_METHODS = ['MOMO_MTN', 'MOMO_TELECEL', 'MOMO_AIRTELTIGO', 'CARD', 'WALLET'];
    const onlinePaidBookings = trip.bookings.filter(
      (b) => b.paymentStatus === 'PAID' && ONLINE_METHODS.includes(b.paymentMethod),
    );
    // Per booking: take the commission, the driver keeps the remainder. Doing
    // it as `fare - commission` rather than `fare * 0.85` means the two halves
    // provably add back to the fare, which is what makes the platform's revenue
    // and the driver's earnings reconcile against the same rides.
    const safeEarnings = onlinePaidBookings.reduce(
      (acc, b) => acc + (b.fareAmountPesewas - percentOf(b.fareAmountPesewas, env.PLATFORM_COMMISSION)),
      0,
    );
    if (safeEarnings > 0) {
      const driver = await tx.driver.findUnique({ where: { id: driverId } });
      await tx.driver.update({
        where: { id: driverId },
        data: { walletBalancePesewas: { increment: safeEarnings } },
      });
      await tx.walletTransaction.create({
        data: {
          driverId,
          type: 'EARNINGS_CREDIT',
          amountPesewas: safeEarnings,
          description: `Earnings from Trip #${trip.shortId}`,
          balanceBeforePesewas: driver.walletBalancePesewas,
          balanceAfterPesewas: driver.walletBalancePesewas + safeEarnings,
          tripId,
        },
      });
    }

    // ── Cash earnings: recorded for REPORTING only ───────────────────────
    // BUGFIX ("the earnings page always has a blank chart even though sales have
    // been made or a commission has been deducted"): every earnings surface —
    // this app's chart, the /earnings summary, shift totals — reads wallet
    // transactions of type EARNINGS_CREDIT. Cash trips deliberately never create
    // one (the driver is handed the money directly; only commission is debited,
    // which is why a COMMISSION_DEDUCTION row was visible while earnings showed
    // zero). A cash-only driver therefore saw GHS 0, 0 trips and a flat chart
    // forever, with no way to tell it apart from having done no work.
    //
    // This writes a DISTINCT type with balanceBeforePesewas === balanceAfterPesewas: it moves
    // no money and is not part of the wallet balance, it exists so cash income is
    // reportable. Every existing aggregate filters on an explicit type, so no
    // balance or payout calculation can pick this up by accident — the reporting
    // queries opt into it by name.
    const cashBookings = trip.bookings.filter((b) => b.paymentMethod === 'CASH');
    const cashEarnings = cashBookings.reduce(
      (acc, b) => acc + (b.fareAmountPesewas - percentOf(b.fareAmountPesewas, env.PLATFORM_COMMISSION)),
      0,
    );
    if (cashEarnings > 0) {
      const balanceNow = (await tx.driver.findUnique({
        where: { id: driverId }, select: { walletBalancePesewas: true },
      }))?.walletBalancePesewas ?? 0;
      await tx.walletTransaction.create({
        data: {
          driverId,
          type: 'CASH_EARNING',
          amountPesewas: cashEarnings,
          description: `Cash collected in person — Trip #${trip.shortId}`,
          // Equal on purpose: no wallet movement, reporting only.
          balanceBeforePesewas: balanceNow,
          balanceAfterPesewas: balanceNow,
          tripId,
        },
      });
    }

    return { trip, totalEarningsPesewas: safeEarnings, transition };
  });

  // Post-commit fan-out. Both apps learn the trip is over from the same event,
  // carrying the same version — rather than the rider finding out via a push
  // notification and the driver via a REST response, which is how the two
  // could disagree about whether the ride had ended.
  if (result.transition) tripState.publishCommitted(result.transition);

  // ── Quest progress ── RIDES_COUNT and EARNINGS, so the driver's Quests tab
  // advances after a completed ride.
  //
  // POST-COMMIT, deliberately. This used to run inside the transaction above,
  // where its serial round trips ate the 5s interactive-transaction budget and
  // expired the whole thing — the driver tapped "Mark as arrived", the trip
  // and the wallet credit were rolled back, and the app said the trip could
  // not be updated. Quest counters are not money and are not worth coupling to
  // a ride's atomicity; if this fails the ride is still correctly settled.
  if (!result.alreadyCompleted) {
    setImmediate(async () => {
      const { incrementProgress } = require('../quests/quests.service');
      try {
        await incrementProgress(driverId, 'RIDES_COUNT', 1);
        if (result.totalEarningsPesewas > 0) {
          await incrementProgress(driverId, 'EARNINGS', result.totalEarningsPesewas);
        }
      } catch (err) {
        logger.warn(`Quest progress for driver ${driverId} after trip ${tripId} failed: ${err.message}`);
      }
    });
  }

  // Generate receipts for PAID bookings — non-blocking, runs after transaction commits
  setImmediate(async () => {
    const paidBookings = result.trip.bookings.filter(b => b.paymentStatus === 'PAID');
    await Promise.all(paidBookings.map(b => generateTripReceipt(b.id).catch(() => {})));
  });

  // Completion push moved to trip-notify.service.js — see arriveAtPickup above.
  // It was also the wrong notification: `driverArrived` announces arrival at the
  // PICKUP, so a rider being dropped off was told their driver had arrived to
  // collect them.
  return result;
}

async function addOfflinePassenger(driverId, tripId, { phone, seatNumber }) {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, driverId },
    include: { route: true },
  });
  if (!trip) throw new NotFoundError('Trip');

  // Calculate correct per-seat fare
  const fareInfo = calculateFare({
    tier: trip.tier ?? 'ECO',
    distanceKm: trip.route?.distanceKm ?? 0,
    seatCount: trip.maxSeats,
    storedBaseFarePesewas: trip.baseFarePesewas,
    storedPerKmRatePesewas: trip.perKmRatePesewas,
  });
  const seatFare = fareInfo.farePerPersonPesewas;
  const commissionAmountPesewas = percentOf(seatFare, env.PLATFORM_COMMISSION);

  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (driver.walletBalancePesewas < commissionAmountPesewas) throw new InsufficientWalletError();

  // Atomically check seat contention + create booking inside a transaction
  // to prevent overbooking when two drivers add offline passengers concurrently
  const existing = await prisma.booking.findFirst({
    where: { tripId, seatNumber, ...seatOccupyingWhere() },
  });
  if (existing) throw new AppError('Seat already taken', 409, 'SEAT_TAKEN');

  const otp = otpService.generateOfflineOtp();
  const otpExp = otpService.offlineOtpExpiry();

  const booking = await prisma.$transaction(async (tx) => {
    // Re-check seat inside the tx to catch concurrent creates
    const conflict = await tx.booking.findFirst({
      where: { tripId, seatNumber, ...seatOccupyingWhere() },
    });
    if (conflict) throw new AppError('Seat already taken', 409, 'SEAT_TAKEN');

    return tx.booking.create({
      data: {
        tripId,
        seatNumber,
        fareAmountPesewas: seatFare, // correct per-seat fare
        commissionAmountPesewas,
        paymentMethod: 'CASH',
        paymentStatus: 'PENDING',
        isOffline: true,
        offlinePhone: phone,
        offlineOtp: otp,
        offlineOtpExp: otpExp,
        status: 'SEAT_HELD',
        /**
         * THE HOLD NOW HAS A DEADLINE.
         *
         * BUGFIX ("I chose add rider → phone + OTP, picked the number and the
         * seat but didn't go through with the OTP, and it's still showing that
         * the seat is reserved").
         *
         * SEAT_HELD is in SEAT_OCCUPYING_STATUSES, so this row counted against
         * capacity from the instant it was written — and nothing ever wrote it
         * back. `offlineOtpExp` existed but only gated whether the CODE still
         * worked; an expired code left a permanently reserved seat behind it.
         * Sharing the OTP's own expiry keeps one deadline rather than two that
         * can disagree: when the code dies, so does the seat.
         */
        holdExpiresAt: otpExp,
      },
    });
  });

  // Send SMS
  await smsService.sendOfflinePassengerOtp(
    phone,
    trip.shortId.slice(0, 8).toUpperCase(),
    'your destination',
    seatNumber,
    seatFare,
    otp
  );

  if (process.env.NODE_ENV === 'development') {
    return { booking, _dev_otp: otp };
  }
  return { booking };
}

async function addCashNoPhone(driverId, tripId, { seatNumber }) {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, driverId },
    include: { route: true },
  });
  if (!trip) throw new NotFoundError('Trip');

  // Calculate correct per-seat fare using the same formula riders see
  const fareInfo = calculateFare({
    tier: trip.tier ?? 'ECO',
    distanceKm: trip.route?.distanceKm ?? 0,
    seatCount: trip.maxSeats,
    storedBaseFarePesewas: trip.baseFarePesewas,
    storedPerKmRatePesewas: trip.perKmRatePesewas,
  });
  const seatFare = fareInfo.farePerPersonPesewas;
  const commissionAmountPesewas = percentOf(seatFare, env.PLATFORM_COMMISSION);

  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (driver.walletBalancePesewas < commissionAmountPesewas) throw new InsufficientWalletError();

  // Deduct commission immediately — seat check + booking creation inside the tx
  // to prevent concurrent overbooking from two driver taps. BUGFIX: the balance
  // check above happens BEFORE this transaction, so two concurrent cash-boarding
  // requests could both pass it and both decrement, pushing the wallet negative.
  // updateMany + gte re-checks the balance atomically at decrement time, same
  // pattern as wallet.service.js's withdraw().
  return prisma.$transaction(async (tx) => {
    const conflict = await tx.booking.findFirst({
      where: { tripId, seatNumber, ...seatOccupyingWhere() },
    });
    if (conflict) throw new AppError('Seat already taken', 409, 'SEAT_TAKEN');

    const debited = await tx.driver.updateMany({
      where: { id: driverId, walletBalancePesewas: { gte: commissionAmountPesewas } },
      data: { walletBalancePesewas: { decrement: commissionAmountPesewas } },
    });
    if (debited.count === 0) throw new InsufficientWalletError();

    const booking = await tx.booking.create({
      data: {
        tripId, seatNumber,
        fareAmountPesewas: seatFare, // correct per-seat fare, not raw base fare
        commissionAmountPesewas,
        paymentMethod: 'CASH',
        paymentStatus: 'PAID',
        isOffline: true,
        offlineOtpVerified: true,
        status: 'BOARDED',
      },
    });

    await tx.walletTransaction.create({
      data: {
        driverId, type: 'COMMISSION_DEDUCTION',
        amountPesewas: commissionAmountPesewas,
        description: `Cash passenger commission — Seat ${seatNumber} Trip #${trip.shortId}`,
        balanceBeforePesewas: driver.walletBalancePesewas,
        balanceAfterPesewas: driver.walletBalancePesewas - commissionAmountPesewas,
        tripId,
      },
    });

    await tx.trip.update({ where: { id: tripId }, data: { confirmedSeats: { increment: 1 } } });

    // `driverApi.addCashPassenger` is typed `ApiResponse<{ bookingId }>` and the
    // controller answered `ok(res, null)` — a field the declared contract
    // promises and the server never sent. Harmless only because the one call
    // site happens to ignore the payload.
    return { bookingId: booking.id };
  });
}

/**
 * Give the seat back — the driver changed their mind at the OTP step.
 *
 * BUGFIX, the other half of the leaked seat. The expiry sweep below is the
 * backstop for a driver who walks away; this is for the far commoner case where
 * they simply back out of the screen. Waiting out an OTP window to reclaim a
 * seat the driver has already abandoned is not a fix, it is a delay.
 *
 * Idempotent and narrow: it only ever touches an UNVERIFIED offline hold on this
 * driver's own trip, so a double tap, a late retry, or a passenger who verified
 * in the meantime all resolve to "nothing to release" rather than to a cancelled
 * paying passenger.
 */
async function releaseOfflineHold(driverId, tripId, bookingId) {
  const released = await prisma.booking.updateMany({
    where: {
      id: bookingId,
      tripId,
      trip: { driverId },
      isOffline: true,
      offlineOtpVerified: false,
      status: 'SEAT_HELD',
    },
    data: {
      status: 'CANCELLED',
      cancelledAt: new Date(),
      cancellationReason: 'OTP_ABANDONED',
      // `seatOccupyingWhere` counts the STATUS, but a null seat is what makes
      // the seat map redraw — see the release rule in the booking invariants.
      seatNumber: null,
      holdExpiresAt: null,
    },
  });
  return { released: released.count > 0 };
}

async function verifyOfflineOtp(driverId, tripId, { bookingId, otp }) {
  // BUGFIX: this used `include: { trip: { where: { driverId } } }`. Prisma only
  // accepts `where` inside an include for to-MANY relations — `Booking.trip` is
  // to-one, so the client rejected the query with a PrismaClientValidationError
  // before it ever reached the database. Every "Phone + OTP" verification the
  // driver attempted returned a 500, which is why the flow never worked.
  // Verified against the generated client on 2026-07-28. The ownership check
  // belongs in the top-level `where` as a relation filter anyway.
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, tripId, trip: { driverId } },
    include: { trip: true },
  });
  if (!booking) throw new NotFoundError('Booking');
  if (!booking.offlineOtp || booking.offlineOtp !== otp) {
    throw new AppError('Invalid OTP', 400, 'OTP_INVALID');
  }
  if (booking.offlineOtpExp < new Date()) throw new AppError('OTP expired', 400, 'OTP_EXPIRED');

  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (driver.walletBalancePesewas < booking.commissionAmountPesewas) throw new InsufficientWalletError();

  // BUGFIX: same TOCTOU race as addCashNoPhone above — decrement via
  // updateMany + gte so a concurrent double-tap can't both pass a pre-tx
  // balance check and push the wallet negative.
  return prisma.$transaction(async (tx) => {
    const debited = await tx.driver.updateMany({
      where: { id: driverId, walletBalancePesewas: { gte: booking.commissionAmountPesewas } },
      data: { walletBalancePesewas: { decrement: booking.commissionAmountPesewas } },
    });
    if (debited.count === 0) throw new InsufficientWalletError();

    await tx.booking.update({
      where: { id: bookingId },
      // Clearing the deadline is what turns a provisional hold into a real seat.
      // Leaving it set would let the sweeper cancel a boarded, paid passenger.
      data: { offlineOtpVerified: true, status: 'BOARDED', paymentStatus: 'PAID', holdExpiresAt: null },
    });

    await tx.walletTransaction.create({
      data: {
        driverId, type: 'COMMISSION_DEDUCTION',
        amountPesewas: booking.commissionAmountPesewas,
        description: `Offline passenger commission — Seat ${booking.seatNumber}`,
        balanceBeforePesewas: driver.walletBalancePesewas,
        balanceAfterPesewas: driver.walletBalancePesewas - booking.commissionAmountPesewas,
        tripId,
      },
    });

    await tx.trip.update({ where: { id: tripId }, data: { confirmedSeats: { increment: 1 } } });
  });
}

/**
 * Pause or resume incoming offers.
 *
 * Writes one boolean. Eligibility itself is decided in driver-availability.js,
 * which is the ONLY source of truth for who can be offered a trip — putting the
 * decision anywhere else is how busy drivers started seeing offers again.
 */
async function setRequestsPaused(driverId, paused) {
  await prisma.driver.update({
    where: { id: driverId },
    data: { requestsPaused: !!paused },
  });
  return { paused: !!paused };
}

async function boardPassenger(driverId, tripId, bookingId, { pin = null } = {}) {
  // Same invalid `include: { trip: { where } }` as verifyOfflineOtp above —
  // Prisma rejected it outright, so boarding any passenger 500'd. See the note
  // there; ownership is expressed as a relation filter instead.
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, tripId, trip: { driverId } },
    include: { trip: true },
  });
  if (!booking) throw new NotFoundError('Booking');

  /**
   * "VERIFY MY RIDE" — the PIN gate.
   *
   * Enforced HERE, in the service, rather than in the driver's UI, because a
   * check that lives only on the client is not a security feature: this is the
   * single call that puts a passenger aboard, so it is the only place the
   * guarantee can actually hold.
   *
   * Only bookings that HAVE a pin are gated. A rider who never turned the
   * setting on has `boardingPin: null` and boards exactly as before, so this
   * cannot strand the drivers and riders who never asked for it.
   *
   * Compared as trimmed strings: the pin is stored as text (leading zeroes are
   * real — "0421" is not 421) and the driver's keypad sends text.
   */
  if (booking.boardingPin && !booking.pinVerifiedAt) {
    const supplied = typeof pin === 'string' ? pin.trim() : '';
    if (!supplied) {
      throw new AppError(
        'This rider has ride verification on. Ask them for their 4-digit code.',
        400,
        'PIN_REQUIRED',
      );
    }
    if (supplied !== booking.boardingPin) {
      throw new AppError(
        "That code doesn't match. Check the rider is showing you the code for this trip.",
        400,
        'PIN_INCORRECT',
      );
    }
    await prisma.booking.update({
      where: { id: bookingId },
      data: { pinVerifiedAt: new Date() },
    });
  }

  // In-app riders who chose CASH never trigger a payment webhook, so unlike
  // card/MoMo bookings their commission is never deducted at confirmPayment
  // time. Deduct it here at boarding — mirrors addCashNoPhone/verifyOfflineOtp,
  // which do the same for driver-added offline passengers. Without this the
  // driver's wallet never moves for a cash trip (no debit at boarding, no
  // credit at completion since completeTrip intentionally skips cash bookings
  // to avoid double-paying commission already collected here).
  if (booking.paymentMethod === 'CASH' && booking.paymentStatus !== 'PAID') {
    const driver = await prisma.driver.findUnique({ where: { id: driverId } });
    if (driver.walletBalancePesewas < booking.commissionAmountPesewas) throw new InsufficientWalletError();

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'BOARDED', paymentStatus: 'PAID' },
      });

      await tx.driver.update({
        where: { id: driverId },
        data: { walletBalancePesewas: { decrement: booking.commissionAmountPesewas } },
      });

      await tx.walletTransaction.create({
        data: {
          driverId, type: 'COMMISSION_DEDUCTION',
          amountPesewas: booking.commissionAmountPesewas,
          description: `Cash passenger commission — Seat ${booking.seatNumber}`,
          balanceBeforePesewas: driver.walletBalancePesewas,
          balanceAfterPesewas: driver.walletBalancePesewas - booking.commissionAmountPesewas,
          tripId,
        },
      });

      return updated;
    });
    announceBoarding(tripId, bookingId);
    return result;
  }

  const updated = await prisma.booking.update({ where: { id: bookingId }, data: { status: 'BOARDED' } });
  announceBoarding(tripId, bookingId);
  return updated;
}

/**
 * TELL THE RIDER THEY ARE ABOARD.
 *
 * BUGFIX — "I just marked a passenger as boarded but on their tracking page it
 * still shows waiting to fill up and nothing shows they've been boarded."
 *
 * Boarding wrote `Booking.status = 'BOARDED'` and told nobody. It is not a TRIP
 * transition — the trip is still FILLING, correctly, because the other seats
 * have not boarded — so none of the trip-event machinery fired, and the rider's
 * tracking screen had no reason to re-read anything. The one person for whom
 * the fact was most important was the last to hear it.
 *
 * `publishSeatUpdate` is the right carrier: it already sends every live booking
 * row, `status` included, to the trip's passenger room, and the rider's
 * tracking screen already subscribes to it for the seat map. The push is for
 * the phone that is in a pocket rather than on the tracking screen.
 *
 * Fire-and-forget on purpose. A passenger is physically in the vehicle by this
 * point; a broadcast that fails must not un-board them.
 */
function announceBoarding(tripId, bookingId) {
  tripPublisher.publishSeatUpdate(tripId).catch((err) =>
    logger.warn(`Boarding broadcast failed for ${tripId}: ${err.message}`),
  );
  (async () => {
    const b = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        seatNumber: true,
        user: { select: { fcmToken: true } },
        trip: { select: { route: { select: { destinationName: true } }, dropoffAddress: true } },
      },
    });
    const token = b?.user?.fcmToken;
    if (!token) return;
    const where = b.trip?.route?.destinationName ?? b.trip?.dropoffAddress ?? 'your destination';
    await pushService.sendPush(
      token,
      "You're on board",
      `Seat ${b.seatNumber ?? ''} confirmed. Next stop ${where}.`.replace('  ', ' '),
      { type: 'PASSENGER_BOARDED', tripId, bookingId },
    );
  })().catch(() => {});
}

// Statuses where riders are matched/waiting but nobody has boarded yet — a
// driver bailing here should hand the trip to another driver, not strand the
// riders back at square one with a cancellation+refund. Once IN_PROGRESS
// (someone's actually in the vehicle) a straight cancel is the right call —
// redispatching mid-ride doesn't make sense.
const REDISPATCHABLE_STATUSES = ['CONFIRMED', 'FILLING', 'DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP'];

async function cancelTrip(driverId, tripId, { reason, note } = {}) {
  const trip = await prisma.trip.findFirst({ where: { id: tripId, driverId } });
  if (!trip) throw new NotFoundError('Trip');
  if (['COMPLETED', 'CANCELLED'].includes(trip.status)) {
    throw new AppError('Trip cannot be cancelled in its current state', 400, 'INVALID_STATUS');
  }

  if (REDISPATCHABLE_STATUSES.includes(trip.status)) {
    const activeBookingCount = await prisma.booking.count({
      where: { tripId, ...livePassengerWhere() },
    });
    if (activeBookingCount > 0) {
      return redispatchTrip(driverId, trip, { reason, note });
    }
  }

  const updatedTrip = await prisma.$transaction(async (tx) => {
    const bookingsToCancel = await tx.booking.findMany({
      where: { tripId, ...livePassengerWhere() },
    });

    for (const booking of bookingsToCancel) {
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: 'CANCELLED',
          seatNumber: null,
          cancelledAt: new Date(),
          cancellationReason: reason || 'DRIVER_CANCELLED',
        },
      });
      // Rider isn't at fault when the driver cancels — always a full refund, no fee.
      if (booking.paymentStatus === 'PAID') {
        await refundBookingForDriverCancellation(
          tx,
          booking,
          reason ? `Driver cancelled trip: ${reason}` : 'Driver cancelled trip',
        );
      }
    }

    // Seat release, refunds and the status change are one atomic fact. They
    // used to be a transaction that ended in a raw `trip.update` — so the
    // cancellation could commit without ever producing an event for the rider
    // to observe, and the rider's app only found out on its next poll.
    return tripState.applyTransitionTx(tx, tripId, 'CANCELLED', {
      actor: tripState.ACTOR.DRIVER,
      actorId: driverId,
      payload: { reason, note },
      data: {
        cancelledBy: tripState.ACTOR.DRIVER,
        cancellationReason: reason || 'DRIVER_CANCELLED',
      },
    });
  });

  tripState.publishCommitted(updatedTrip);
  logger.info('Driver cancelled trip', { driverId, tripId, reason, note });

  return updatedTrip.trip;
}

// Driver bailed on a trip riders are already matched/waiting on
// (REDISPATCHABLE_STATUSES). Instead of cancelling+refunding, keep the
// bookings intact, put the trip back through dispatch, and let the driver it
// lands on take over exactly where it was.
//
// WHAT THIS USED TO DO, AND WHY IT WAS WRONG. It ran its own dispatch: a raw
// `geosearch` against `drivers:online` (a DIFFERENT key from the dispatch pool,
// `supply:drivers:geo`), then a multicast FCM plus a `trip:assigned` frame to up
// to TWELVE drivers at once. Four invariants died in those forty lines:
//
//   - "Exactly one driver holds an offer at a time" (13). Twelve did, so twelve
//     drivers raced to claim one trip and eleven got a 409 on a card they had
//     already tapped.
//   - "An offer is never replayed; recovery goes through GET /rides/driver/state"
//     (12). No `dispatch:offer:driver:*` key was ever written, so a phone that
//     was asleep for the frame could not find the offer by any route at all.
//   - "The dispatch pool is the Redis geo-set + presence key" (11). Reading
//     `drivers:online` meant a driver whose presence had expired — a dead phone —
//     was still a candidate.
//   - "trip-notify owns notifications" (16). It sent its own rider push, on top
//     of the one `trip-notify` already sends for REASSIGNING, so riders got the
//     same news twice.
//
// It also had no offer TTL, no re-sweep and no search timeout, so a redispatch
// nobody accepted simply sat there forever.
//
// The cascade already does every one of those things correctly, and
// `rides.service#driverCancel` — the on-demand version of this exact event —
// already delegates to it. Now both do.
async function redispatchTrip(cancellingDriverId, trip, { reason, note } = {}) {
  // Detaching the driver here is what makes this a redispatch rather than a
  // cancel-and-recreate: the trip keeps its id, its bookings, its receipt and
  // its share link. `driverId` being nullable is the whole reason this edge
  // can exist at all — under the old NOT NULL column it could not.
  await tripState.applyTransition(trip.id, 'REASSIGNING', {
    actor: tripState.ACTOR.SYSTEM,
    actorId: cancellingDriverId,
    payload: { reason, note, previousDriverId: cancellingDriverId },
    data: {
      driverId: null,
      vehicleId: null,
      assignedAt: null,
      redispatchCount: { increment: 1 },
    },
  });
  const updated = await prisma.trip.findUnique({
    where: { id: trip.id },
    include: { route: true, bookings: { where: { ...seatOccupyingWhere() }, include: { user: { select: { fcmToken: true } } } } },
  });

  /**
   * `CANCELLED`, not `DECLINED` — the two are different acts and the cascade
   * now treats them differently.
   *
   * A DECLINE (or a timed-out offer) is re-offerable on a later sweep: the usual
   * cause is a driver who was not looking at their phone, and re-offering is the
   * behaviour a bug fix earlier this month deliberately restored. Abandoning a
   * trip you already ACCEPTED is not that, and `startCascade` reads these rows to
   * make sure a redispatch never hands the trip back to anyone who has already
   * walked away from it — however many times it has been redispatched.
   *
   * Durable rather than Redis-only, so the exclusion survives a deploy, a Redis
   * flush and the `clearState()` that every restart performs.
   */
  await prisma.dispatchAction.create({
    data: { driverId: cancellingDriverId, tripId: trip.id, action: 'CANCELLED' },
  }).catch(() => {});

  logger.info('Driver cancelled trip pre-boarding — redispatching', { cancellingDriverId, tripId: trip.id, reason, note });

  // ONE dispatch path. The cancelling driver is excluded so the trip they just
  // dropped cannot be handed straight back to them.
  //
  // Kicked out of band for the same reason `POST /v1/rides` does it: running a
  // cascade inline made the request take ~14 s against a 15 s client timeout,
  // and the client retry then manufactured a ghost trip. The riders' apps learn
  // about REASSIGNING from the transition above, which has already committed, so
  // nothing user-facing is waiting on this.
  setImmediate(() => {
    dispatchCascade
      .startCascade(trip.id, { kind: 'REASSIGNMENT', excludeDriverId: cancellingDriverId })
      .catch((err) => logger.error('Redispatch cascade failed to start', { tripId: trip.id, err: err?.message }));
  });

  return updated;
}

// A nearby driver claims a trip that's up for redispatch (see
// redispatchTrip above). Atomic first-claim-wins, same pattern as
// acceptDispatch — resumes the trip exactly where it left off
// (DRIVER_EN_ROUTE) under the new driver.
async function claimReassignedTrip(driverId, tripId) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) throw new NotFoundError('Driver');
  if (!driver.isOnline) throw new AppError('You must be online to accept trips', 400, 'DRIVER_OFFLINE');

  // Server-side backstop for the busy-driver rule. Even if a stale dispatch
  // card is still on screen from before the driver took another trip, they
  // cannot claim a second one.
  if (!(await isDriverAvailable(prisma, driverId))) {
    throw new AppError('Finish your current trip before accepting another.', 409, 'DRIVER_BUSY');
  }

  const vehicle = await prisma.vehicle.findFirst({ where: { driverId, isActive: true } });
  if (!vehicle) throw new AppError('No active vehicle registered. Add a vehicle before accepting trips.', 400, 'NO_VEHICLE');

  let transition;
  const result = await prisma.$transaction(async (tx) => {
    try {
      // Same first-claim-wins guarantee, now expressed once in the state
      // machine (status + version CAS) instead of hand-rolled here, and it
      // produces the TripEvent the waiting riders' apps react to.
      transition = await tripState.applyTransitionTx(tx, tripId, 'DRIVER_EN_ROUTE', {
        actor: tripState.ACTOR.DRIVER,
        actorId: driverId,
        data: { driverId, vehicleId: vehicle.id },
        payload: { claimedFrom: 'REASSIGNING' },
      });
    } catch (err) {
      if (err.code === 'VERSION_CONFLICT' || err.code === 'ILLEGAL_TRANSITION') {
        throw new AppError('This trip has already been reassigned to another driver.', 409, 'REASSIGNMENT_UNAVAILABLE');
      }
      throw err;
    }

    await tx.dispatchAction.create({ data: { driverId, tripId, action: 'ACCEPTED' } });

    return tx.trip.findUnique({
      where: { id: tripId },
      include: {
        route: true,
        bookings: { where: { ...seatOccupyingWhere() }, include: { user: { select: { fcmToken: true } } } },
      },
    });
  });

  tripState.publishCommitted(transition);

  setImmediate(async () => {
    for (const b of result.bookings) {
      if (b.user?.fcmToken) {
        pushService.sendPush(
          b.user.fcmToken,
          'New driver on the way',
          'A new driver has been matched to your trip and is heading your way.',
          { type: 'TRIP_REASSIGNED', tripId },
        ).catch(() => {});
      }
    }
  });

  return result;
}

// ═══════════════════════════════════════════════════════════════════
// ACCOUNT DELETION
// ═══════════════════════════════════════════════════════════════════

/**
 * DELETE MY ACCOUNT — see the longer note on `users.service.deactivateAccount`,
 * which this mirrors.
 *
 * The identity is erased and the rows stay: a driver's completed trips are a
 * rider's receipts and a platform's ledger, and deleting them would leave both
 * hanging. What was missing here is the same thing that was missing on the
 * rider side — revoking the refresh tokens. Without it the anonymised account
 * kept minting fresh access tokens for the life of its refresh token, so
 * "delete my account" did not even log the phone out.
 *
 * Taking them out of the dispatch pool matters too: an anonymised driver left
 * in the Redis geo-set is still a candidate every matcher run considers.
 */
async function deleteMe(driverId) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) throw new NotFoundError('Driver');

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.driver.update({
      where: { id: driverId },
      data: {
        name: '[Deleted Account]',
        phone: `deleted_${driverId.slice(0, 12)}`,
        status: 'DISABLED',
        isOnline: false,
        fcmToken: null,
        currentLat: null,
        currentLng: null,
      },
    });

    await tx.refreshToken.updateMany({
      where: { driverId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return updated;
  });

  await supply.removeDriver(driverId).catch((err) => {
    logger.warn(`[deleteMe] could not drop driver ${driverId} from the supply index: ${err.message}`);
  });

  return result;
}

// ═══════════════════════════════════════════════════════════════════
// TRIP REPORT
// ═══════════════════════════════════════════════════════════════════

/**
 * "Show me your code" — raise the rider's Verify My Ride popup.
 *
 * The digits never leave the rider's own snapshot; this only tells their app
 * that now is the moment. Returns whether a pin is actually outstanding so the
 * driver's app can skip straight to boarding when there is nothing to verify —
 * a rider who never turned the setting on must not cost the driver a keypad.
 */
async function requestBoardingPin(driverId, tripId, bookingId) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, tripId, trip: { driverId } },
    select: {
      id: true,
      boardingPin: true,
      pinVerifiedAt: true,
      user: { select: { fcmToken: true } },
    },
  });
  if (!booking) throw new NotFoundError('Booking');

  const required = !!booking.boardingPin && !booking.pinVerifiedAt;
  if (!required) return { required: false };

  /**
   * WRITE THE ASK DOWN BEFORE ANNOUNCING IT.
   *
   * BUGFIX ("the pin code for the verification is still not showing on the
   * rider app when I switch from the driver app to the rider app").
   *
   * `publishBoardingPinRequested` emits with `seq: null` — deliberately, it is
   * not a lifecycle transition — which means the sequenced trip channel has
   * nothing to replay it from. The socket frame is therefore the ONLY copy, and
   * a rider whose app was backgrounded (the same-handset case, every time)
   * never receives it and has no way to discover it afterwards.
   *
   * A column fixes that for every path at once: the snapshot carries it, so
   * cold start, foreground hydrate, socket replay and an ordinary refetch all
   * raise the sheet. The socket frame stays as the fast path for a rider who
   * is already looking at the screen.
   */
  await prisma.booking
    .update({ where: { id: bookingId }, data: { pinRequestedAt: new Date() } })
    .catch(() => {});

  tripPublisher.publishBoardingPinRequested(tripId, bookingId);
  // The socket is the fast path; the push is what reaches a rider whose screen
  // is off — which, standing at the kerb with a driver waiting, is most of them.
  if (booking.user?.fcmToken) {
    pushService
      .sendPush(
        booking.user.fcmToken,
        'Show your ride code',
        'Your driver is asking for your 4-digit code to confirm you are in the right vehicle.',
        { type: 'BOARDING_PIN', tripId, bookingId },
      )
      .catch(() => {});
  }
  return { required: true };
}

/**
 * REPORT A PASSENGER — A NAMED ONE.
 *
 * BUGFIX ("on the my trips page, when you click report passenger it should
 * dynamically and accurately distinguish and allow the user to select which
 * passenger they want to report — at the moment it just assumes it's one
 * person").
 *
 * The report row named only the trip. On a fourteen-seat van that is not a
 * report about anybody: nothing downstream could attach it to a rider, so a
 * passenger could be reported on every trip they took and their standing would
 * never move — which is also why "if a rider reports a driver their standing
 * should diminish" had no counterpart in the other direction.
 *
 * `bookingId` is what the driver picks (a seat on this trip); the rider behind
 * it is resolved HERE rather than trusted from the client, because a client that
 * can name the reported user can report anybody.
 *
 * A trip-level report (nothing selected) is still allowed — property damage
 * found after everyone has left has no seat to pin it to — so both columns stay
 * nullable and the caller may omit them.
 */
async function reportTrip(driverId, tripId, { type, details, bookingId = null }) {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, driverId },
    select: { id: true },
  });
  if (!trip) throw new NotFoundError('Trip');

  let reportedUserId = null;
  if (bookingId) {
    // Must be a seat on THIS trip, on a trip belonging to THIS driver. Both
    // halves matter: without the first a driver could report a stranger's
    // booking, without the second they could report a trip that is not theirs.
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, tripId },
      select: { id: true, userId: true },
    });
    if (!booking) throw new NotFoundError('Booking');
    reportedUserId = booking.userId ?? null;
  }

  return prisma.tripReport.create({
    data: {
      tripId,
      driverId,
      bookingId: bookingId || null,
      reportedUserId,
      type,
      details: details || null,
    },
  });
}

// Derives a notification history from the driver's own trips/bookings — mirrors
// the rider notifications module's "no separate Notification model needed"
// pattern. Backfills what a driver missed while the app was fully killed (the
// live socket-driven notifications store only catches events while connected).
async function getNotifications(driverId, limit = 30) {
  const take = Math.min(parseInt(limit, 10) || 30, 50);

  const trips = await prisma.trip.findMany({
    where: { driverId, status: { in: ['COMPLETED', 'CANCELLED'] } },
    include: {
      route: { select: { originName: true, destinationName: true } },
      bookings: { where: { paymentStatus: 'PAID' }, select: { id: true, fareAmountPesewas: true, seatNumber: true, updatedAt: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take,
  });

  const notifications = trips.flatMap((trip) => {
    const dest = trip.route?.destinationName ?? 'your destination';
    const items = [];

    if (trip.status === 'COMPLETED') {
      items.push({
        id: `${trip.id}:completed`,
        type: 'COMPLETED',
        title: 'Trip completed',
        body: `Your trip to ${dest} is complete.`,
        tripId: trip.id,
        createdAt: (trip.arrivedAt ?? trip.updatedAt).toISOString(),
      });
    } else if (trip.status === 'CANCELLED') {
      items.push({
        id: `${trip.id}:cancelled`,
        type: 'INFO',
        title: 'Trip cancelled',
        body: `Your trip to ${dest} was cancelled.`,
        tripId: trip.id,
        createdAt: trip.updatedAt.toISOString(),
      });
    }

    for (const b of trip.bookings) {
      items.push({
        id: `${b.id}:paid`,
        type: 'PAYMENT_CONFIRMED',
        title: 'Payment confirmed',
        body: `${formatGhs(b.fareAmountPesewas)} paid for Seat #${b.seatNumber} on your trip to ${dest}.`,
        tripId: trip.id,
        createdAt: b.updatedAt.toISOString(),
      });
    }

    return items;
  });

  notifications.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return { notifications: notifications.slice(0, take) };
}

// ─────────────────────────────────────────────────────────────────
// PENDING TRIP-REQUEST POLL FALLBACK
// Socket/FCM dispatch is fire-and-forget and racy; this REST endpoint lets the
// driver app reliably POLL for on-demand requests it may be eligible for.
// ─────────────────────────────────────────────────────────────────
async function getPendingTripRequests(driverId, { lat, lng } = {}) {
  const { haversineKm } = require('../trips/fare.calculator');
  // Same radius the cascade uses, read from the runtime settings so the two can
  // never disagree about how far "nearby" is.
  const DISPATCH_RADIUS_KM = require('../../config/settings').get('DISPATCH_RADIUS_KM') ?? 8;
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

  // BUSY-DRIVER LEAK FIX: this poll had no eligibility check at all, so even
  // when the push/socket dispatch paths correctly skipped a busy driver, that
  // driver's app polled this endpoint every few seconds and rendered the
  // dispatch card anyway — which is exactly the "I'm on my own trip and it
  // still shows me other riders" symptom. A driver who is offline, not
  // approved, or already engaged now gets an empty list, full stop.
  if (!(await isDriverAvailable(prisma, driverId))) return [];

  const requests = await prisma.tripRequest.findMany({
    where: {
      status: { in: ['PENDING', 'DISPATCHED'] },
      createdAt: { gte: fiveMinAgo },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { user: { select: { name: true } } },
  });

  const hasCoords = typeof lat === 'number' && typeof lng === 'number' && !Number.isNaN(lat) && !Number.isNaN(lng);

  const requestOffers = requests
    .filter((r) => {
      // CASCADE SCOPING: dispatch is now sequential — exactly one driver holds a
      // given request at a time (services/dispatch-cascade.service.js). This
      // poll used to hand every recent PENDING/DISPATCHED request to every
      // driver who asked, which re-created the old free-for-all broadcast behind
      // the cascade's back: a driver the cascade had already passed over, or had
      // not reached yet, could poll their way into an offer and steal it.
      //
      // While a cascade is live for a request, only its current holder sees it.
      // A request with NO live cascade (server restarted mid-flight, or it was
      // created before this shipped) falls through to the distance filter so it
      // is still claimable rather than stranded.
      // No cascade check here any more. Scheduled TripRequests are broadcast,
      // not cascaded — the 20-second exclusive offer only applies to live
      // on-demand rides, which are Trip rows dispatched through modules/rides
      // and delivered over the `trip:event` channel rather than this poll.
      if (!hasCoords) return true; // no driver coords → return all recent pending
      if (r.pickupLat == null || r.pickupLng == null) return true; // can't filter → include
      return haversineKm(lat, lng, r.pickupLat, r.pickupLng) <= DISPATCH_RADIUS_KM;
    })
    .map((r) => ({
      tripId: r.id, // this is the tripRequest id — accept via /trip-requests/:id/accept
      kind: 'REQUEST',
      routeOrigin: r.user?.name ? `${r.user.name}'s pickup` : 'Rider pickup',
      routeDestination: r.destination,
      departureTime: r.scheduledAt,
      seatCount: r.seatCount,
      pickupLat: r.pickupLat,
      pickupLng: r.pickupLng,
    }));

  // Trips a driver bailed on pre-boarding (see redispatchTrip) — reliability
  // backstop for the socket-pushed 'trip:assigned' event, same reasoning as
  // the REQUEST poll above. Excludes the driver who just cancelled it.
  const reassignments = await prisma.trip.findMany({
    where: { status: 'REASSIGNING', driverId: { not: driverId } },
    orderBy: { updatedAt: 'desc' },
    take: 20,
    include: { route: true, bookings: { where: { ...seatOccupyingWhere() }, select: { id: true } } },
  });
  const reassignmentOffers = reassignments
    .filter((t) => {
      if (!hasCoords) return true;
      if (t.pickupLat == null || t.pickupLng == null) return true;
      return haversineKm(lat, lng, t.pickupLat, t.pickupLng) <= DISPATCH_RADIUS_KM;
    })
    .map((t) => ({
      tripId: t.id, // this is the trip id — accept via drivers/trips/:id/claim-reassignment
      kind: 'REASSIGNMENT',
      routeOrigin: 'Pickup nearby',
      routeDestination: t.route?.destinationName,
      departureTime: t.departureTime,
      seatCount: t.bookings.length,
      pickupLat: t.pickupLat,
      pickupLng: t.pickupLng,
    }));

  return [...reassignmentOffers, ...requestOffers];
}

// Upcoming scheduled trips this driver is matched to (their own SCHEDULED/FILLING
// trips with a future departure). ScheduledRideIntent has no driver link until it
// is matched onto a Trip, so driver-facing "scheduled awareness" is the trips the
// driver owns that haven't departed yet.
async function getUpcomingScheduledTrips(driverId) {
  const trips = await prisma.trip.findMany({
    where: {
      driverId,
      status: { in: ['SCHEDULED', 'FILLING'] },
      departureTime: { gte: new Date() },
    },
    orderBy: { departureTime: 'asc' },
    take: 50,
    include: {
      route: { select: { originName: true, destinationName: true, originLat: true, originLng: true, destLat: true, destLng: true } },
      _count: { select: { bookings: { where: { ...seatOccupyingWhere() } } } },
    },
  });

  return trips.map((t) => ({
    tripId: t.id,
    kind: 'SCHEDULED',
    status: t.status,
    routeOrigin: t.route?.originName ?? null,
    routeDestination: t.route?.destinationName ?? null,
    departureTime: t.departureTime,
    seatCount: t.maxSeats,
    confirmedSeats: t.confirmedSeats,
    bookedSeats: t._count.bookings,
    pickupLat: t.pickupLat ?? t.route?.originLat ?? null,
    pickupLng: t.pickupLng ?? t.route?.originLng ?? null,
  }));
}

module.exports = {
  getMe, updateProfile, updateFcmToken, completeVerification, addVehicle,
  goOnline, goOffline, getActiveTrip, getTripHistory, getAllTrips, devActivate,
  getNotifications,
  startTrip, departTrip, arriveAtPickup, arriveTrip, cancelTrip, recordPresence,
  getTripById, acceptDispatch, claimTrip, declineDispatch, declineTrip, uploadDocument, reviewDocument,
  addOfflinePassenger, addCashNoPhone, verifyOfflineOtp, releaseOfflineHold, boardPassenger, requestBoardingPin, setRequestsPaused,
  getPerformance, getRatings, getDocuments, updateEmergencyContact, updatePreferences, ratePassenger,
  setDestinationFilter, getDestinationFilter, deleteDestinationFilter,
  startShift, endShift, getCurrentShift, getShiftHistory,
  getEarningsBreakdown, getWalletTransactions,
  getSupportTickets, createSupportTicket, replyToTicket,
  scheduleInspection, getInspections,
  deleteMe, reportTrip,
  getPendingTripRequests, getUpcomingScheduledTrips, claimReassignedTrip,
};

// ── Rate passenger (driver rates rider after trip) ────────────────
async function ratePassenger(driverId, bookingId, { stars, comment }) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { trip: true },
  });
  if (!booking) throw new NotFoundError('Booking');
  if (!booking.trip || booking.trip.driverId !== driverId) throw new ForbiddenError('Not your trip');
  if (!booking.userId) throw new AppError('Cannot rate offline passenger', 400);
  if (booking.trip.status !== 'COMPLETED') throw new AppError('Can only rate after trip completion', 400, 'TRIP_NOT_COMPLETED');

  const s = Number(stars);
  if (isNaN(s) || s < 1 || s > 5) {
    throw new AppError('Stars must be between 1 and 5', 400);
  }

  const rating = await prisma.passengerRating.upsert({
    where: {
      driverId_tripId_userId: {
        driverId,
        tripId: booking.tripId,
        userId: booking.userId,
      },
    },
    update: { stars: s, comment: comment ?? undefined },
    create: {
      driverId,
      userId: booking.userId,
      tripId: booking.tripId,
      stars: s,
      comment,
    },
  });

  // ── Push notification to rider ───────────────────────────────────
  setImmediate(async () => {
    try {
      const pushService = require('../../services/push.service');
      // Fetch the passenger's FCM token separately — booking.trip query doesn't load driver relation
      const passenger = await prisma.user.findUnique({ where: { id: booking.userId }, select: { fcmToken: true } });
      if (passenger?.fcmToken) {
        await pushService.sendPush(
          passenger.fcmToken,
          '✨ Your driver rated you!',
          `Your driver gave you ${s} star${s !== 1 ? 's' : ''}`,
          { type: 'PASSENGER_RATING', tripId: booking.tripId, stars: String(s) },
        );
      }
    } catch (err) {
      // Non-blocking
    }
  });

  return { rating };
}

// ── Performance stats ──────────────────────────────────────────────
async function getPerformance(driverId) {
  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [
    totalTrips, completedTrips, cancelledTrips, weekTrips, weekEarnings,
    acceptedDispatches, declinedDispatches, onlineSessions,
  ] = await Promise.all([
    prisma.trip.count({ where: { driverId } }),
    prisma.trip.count({ where: { driverId, status: 'COMPLETED' } }),
    prisma.trip.count({ where: { driverId, status: 'CANCELLED' } }),
    prisma.trip.count({ where: { driverId, createdAt: { gte: weekAgo } } }),
    prisma.walletTransaction.aggregate({
      // Cash fares included — see EARNING_TYPES.
      where: { driverId, type: { in: EARNING_TYPES }, createdAt: { gte: weekAgo } },
      _sum: { amountPesewas: true },
    }),
    // Real dispatch tracking
    prisma.dispatchAction.count({ where: { driverId, action: 'ACCEPTED', createdAt: { gte: weekAgo } } }),
    prisma.dispatchAction.count({ where: { driverId, action: 'DECLINED', createdAt: { gte: weekAgo } } }),
    // Real online session hours
    prisma.onlineSession.findMany({
      where: { driverId, startTime: { gte: weekAgo } },
      select: { startTime: true, endTime: true },
    }),
  ]);

  // Calculate real acceptance rate
  const totalDispatches = acceptedDispatches + declinedDispatches;
  const acceptanceRate = totalDispatches > 0
    ? Math.round((acceptedDispatches / totalDispatches) * 100)
    : null;

  // Calculate real online hours this week
  const onlineHoursThisWeek = onlineSessions.reduce((total, session) => {
    const end = session.endTime ?? now;
    const hours = (end.getTime() - session.startTime.getTime()) / (1000 * 60 * 60);
    return total + hours;
  }, 0);

  return {
    acceptanceRate,
    completionRate: totalTrips > 0 ? Math.round((completedTrips / totalTrips) * 100) : 100,
    cancellationRate: totalTrips > 0 ? Math.round((cancelledTrips / totalTrips) * 100) : 0,
    onlineHoursThisWeek: Math.round(onlineHoursThisWeek * 10) / 10,
    tripsThisWeek: weekTrips,
    earningsThisWeek: weekEarnings._sum.amountPesewas ?? 0,
    level: completedTrips >= 100 ? 'PLATINUM' : completedTrips >= 50 ? 'GOLD' : completedTrips >= 20 ? 'SILVER' : 'BRONZE',
    weeklyGoal: 20,
    weeklyGoalProgress: weekTrips,
  };
}

// Canonical compliment tags the rider app lets riders attach to a rating
// (apps/rider/app/ride/[id]/rate-tip.tsx). They're sent as a comma-joined
// prefix on the free-text comment (e.g. "Punctual, Friendly — great driver!"),
// so we count real occurrences here instead of returning made-up numbers.
const COMPLIMENT_TAGS = [
  { label: 'Punctual', icon: 'time-outline' },
  { label: 'Safe Driver', icon: 'shield-checkmark-outline' },
  { label: 'Clean Vehicle', icon: 'sparkles-outline' },
  { label: 'Friendly', icon: 'happy-outline' },
  { label: 'Helpful', icon: 'heart-outline' },
  { label: 'Smooth Ride', icon: 'car-sport-outline' },
];

// ── Ratings ────────────────────────────────────────────────────────
async function getRatings(driverId) {
  // The headline average and the star breakdown both exclude chronic low-raters
  // so the two agree with each other and with what riders are shown. The recent
  // list is unfiltered on purpose: a driver should still be able to read every
  // comment left about them, including the ones that don't count.
  const countableWhere = await ratingIntegrity.ratingWhere({ driverId });
  const [aggregate, allRatings, recent] = await Promise.all([
    prisma.driverRating.aggregate({ where: countableWhere, _avg: { stars: true }, _count: true }),
    prisma.driverRating.findMany({ where: countableWhere, select: { stars: true, comment: true } }),
    prisma.driverRating.findMany({
      where: { driverId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { user: { select: { name: true } } },
    }),
  ]);

  // Build star breakdown
  const breakdown = [5, 4, 3, 2, 1].map((stars) => {
    const count = allRatings.filter((r) => r.stars === stars).length;
    return {
      stars,
      count,
      percentage: allRatings.length > 0 ? Math.round((count / allRatings.length) * 100) : 0,
    };
  });

  // Real compliment counts — how many ratings' comment text mentions each tag.
  const compliments = COMPLIMENT_TAGS.map(({ label, icon }) => ({
    label,
    icon,
    count: allRatings.filter((r) => r.comment?.includes(label)).length,
  })).filter((c) => c.count > 0);

  /**
   * The driver's own standing, on the same terms a rider's is measured.
   *
   * `average` above is the all-time filtered mean and stays as it is — it is
   * the number the ratings screen has always shown. `standing` adds what the
   * behaviour system actually acts on: a recency-weighted rating, reliability
   * from completions vs abandoned trips, and upheld disputes. "If a rider
   * reports a driver, their standing should diminish" is this field — an upheld
   * dispute drops the band, and the band is what every consumer keys off.
   *
   * Non-fatal, like everywhere else standing is read: a ratings screen must
   * still render if the rollup fails.
   */
  const standing = await standingService.driverStanding(driverId).catch(() => null);

  return {
    average: aggregate._avg.stars ?? 5.0,
    total: aggregate._count,
    standing,
    breakdown,
    compliments,
    recent: recent.map((r) => ({
      tripId: r.tripId,
      stars: r.stars,
      comment: r.comment || undefined,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

// ── Documents ──────────────────────────────────────────────────────
async function getDocuments(driverId) {
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: { ghanaCardPhoto: true, licensePhoto: true, profilePhoto: true, documentReview: true },
  });
  if (!driver) throw new NotFoundError('Driver');

  let review = {};
  try { review = driver.documentReview ? JSON.parse(driver.documentReview) : {}; } catch { /* ignore malformed data */ }

  const statusFor = (type, hasPhoto) => {
    if (!hasPhoto) return 'MISSING';
    // Grandfather photos uploaded before this review system existed — otherwise every
    // already-active driver would be retroactively gated offline pending re-review.
    // Only uploads made through the (now PENDING-by-default) upload flow have a
    // review entry at all, so its absence here specifically means "predates review."
    return review[type]?.status ?? 'VERIFIED';
  };

  const docs = [
    { id: 'license', type: 'DRIVERS_LICENSE', status: statusFor('DRIVERS_LICENSE', !!driver.licensePhoto), url: driver.licensePhoto ?? undefined, rejectionReason: review.DRIVERS_LICENSE?.rejectionReason ?? undefined },
    { id: 'ghana_card', type: 'GHANA_CARD', status: statusFor('GHANA_CARD', !!driver.ghanaCardPhoto), url: driver.ghanaCardPhoto ?? undefined, rejectionReason: review.GHANA_CARD?.rejectionReason ?? undefined },
    { id: 'profile', type: 'PROFILE_PHOTO', status: statusFor('PROFILE_PHOTO', !!driver.profilePhoto), url: driver.profilePhoto ?? undefined, rejectionReason: review.PROFILE_PHOTO?.rejectionReason ?? undefined },
  ];
  return docs;
}

/**
 * Admin approve/reject a specific driver document. Previously there was no
 * per-document review path at all — status was a binary present→VERIFIED.
 */
/** The only documents that exist. getDocuments() reads exactly these keys. */
const REVIEWABLE_DOCUMENT_TYPES = ['DRIVERS_LICENSE', 'GHANA_CARD', 'PROFILE_PHOTO'];

async function reviewDocument(driverId, type, { approve, rejectionReason } = {}) {
  /**
   * `type` comes straight off the URL and was written into the JSON blob
   * unchecked, so POST /drivers/:id/documents/banana/review answered 200
   * "Document approved", stored a `banana` key nobody reads, and wrote an
   * audit row saying a compliance document had been reviewed. The document
   * itself stayed exactly as it was. An approval that approves nothing while
   * claiming otherwise is worse than an error, because the queue looks done.
   */
  if (!REVIEWABLE_DOCUMENT_TYPES.includes(type)) {
    throw new AppError(
      `Unknown document type "${type}". Expected one of: ${REVIEWABLE_DOCUMENT_TYPES.join(', ')}`,
      400,
      'UNKNOWN_DOCUMENT_TYPE',
    );
  }

  const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { documentReview: true } });
  if (!driver) throw new NotFoundError('Driver');

  let review = {};
  try { review = driver.documentReview ? JSON.parse(driver.documentReview) : {}; } catch { /* reset on malformed data */ }

  review[type] = {
    status: approve ? 'VERIFIED' : 'REJECTED',
    reviewedAt: new Date().toISOString(),
    rejectionReason: approve ? null : (rejectionReason || 'Document rejected by review team'),
  };

  await prisma.driver.update({ where: { id: driverId }, data: { documentReview: JSON.stringify(review) } });
  return review[type];
}

// ── Emergency contact ───────────────────────────────────────────────
async function updateEmergencyContact(driverId, data) {
  const { name, phone, relationship } = data;
  if (!name || !phone) throw new AppError('Name and phone are required', 400);

  const driver = await prisma.driver.update({
    where: { id: driverId },
    data: { emergencyContact: JSON.stringify({ name, phone, relationship: relationship || null }) },
    select: { emergencyContact: true },
  });
  return JSON.parse(driver.emergencyContact);
}

// ── Preferences ─────────────────────────────────────────────────────
async function updatePreferences(driverId, data) {
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: { preferences: true },
  });

  const currentPrefs = driver?.preferences ? JSON.parse(driver.preferences) : {};
  const merged = { ...currentPrefs, ...data };

  await prisma.driver.update({
    where: { id: driverId },
    data: { preferences: JSON.stringify(merged) },
  });
  return merged;
}

// ═══════════════════════════════════════════════════════════════════
// DESTINATION FILTER
// ═══════════════════════════════════════════════════════════════════

async function setDestinationFilter(driverId, { destLat, destLng, destName }) {
  if (!destLat || !destLng || !destName) {
    throw new AppError('Destination coordinates and name are required', 400);
  }
  const filter = await prisma.driverDestinationPreference.upsert({
    where: { driverId },
    update: { destLat, destLng, destName, isActive: true },
    create: { driverId, destLat, destLng, destName },
  });
  return filter;
}

async function getDestinationFilter(driverId) {
  const filter = await prisma.driverDestinationPreference.findUnique({
    where: { driverId },
  });
  return filter ?? null;
}

async function deleteDestinationFilter(driverId) {
  await prisma.driverDestinationPreference.deleteMany({ where: { driverId } });
  return { success: true };
}

// ═══════════════════════════════════════════════════════════════════
// SHIFT TRACKING
// ═══════════════════════════════════════════════════════════════════

async function startShift(driverId) {
  // End any active shift first
  await prisma.driverShift.updateMany({
    where: { driverId, status: 'ACTIVE' },
    data: {
      status: 'ENDED',
      endTime: new Date(),
    },
  });

  const shift = await prisma.driverShift.create({
    data: {
      driverId,
      startTime: new Date(),
      status: 'ACTIVE',
    },
  });
  return shift;
}

async function endShift(driverId) {
  const shift = await prisma.driverShift.findFirst({
    where: { driverId, status: 'ACTIVE' },
    orderBy: { startTime: 'desc' },
  });
  if (!shift) throw new AppError('No active shift found', 400);

  // Calculate shift earnings from trips completed during the shift
  const completedTrips = await prisma.walletTransaction.aggregate({
    where: {
      driverId,
      // Cash fares count toward a shift's earnings too — see EARNING_TYPES.
      type: { in: EARNING_TYPES },
      createdAt: { gte: shift.startTime },
    },
    _sum: { amountPesewas: true },
    _count: { amountPesewas: true },
  });

  const updated = await prisma.driverShift.update({
    where: { id: shift.id },
    data: {
      status: 'ENDED',
      endTime: new Date(),
      earningsPesewas: completedTrips._sum.amountPesewas ?? 0,
      tripsCount: completedTrips._count.amountPesewas ?? 0,
    },
  });
  return updated;
}

async function getCurrentShift(driverId) {
  const shift = await prisma.driverShift.findFirst({
    where: { driverId, status: 'ACTIVE' },
    orderBy: { startTime: 'desc' },
  });
  if (!shift) return null;

  // Update live earnings/trip count
  const completedTrips = await prisma.walletTransaction.aggregate({
    where: {
      driverId,
      // Cash fares count toward a shift's earnings too — see EARNING_TYPES.
      type: { in: EARNING_TYPES },
      createdAt: { gte: shift.startTime },
    },
    _sum: { amountPesewas: true },
    _count: { amountPesewas: true },
  });

  const hoursElapsed = (Date.now() - new Date(shift.startTime).getTime()) / (1000 * 60 * 60);

  return {
    ...shift,
    earningsPesewas: completedTrips._sum.amountPesewas ?? 0,
    tripsCount: completedTrips._count.amountPesewas ?? 0,
    hoursElapsed: Math.round(hoursElapsed * 10) / 10,
    hourlyRatePesewas: hoursElapsed > 0
      ? wholePesewas((completedTrips._sum.amountPesewas ?? 0) / hoursElapsed)
      : 0,
  };
}

async function getShiftHistory(driverId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  const [shifts, total] = await Promise.all([
    prisma.driverShift.findMany({
      where: { driverId },
      orderBy: { startTime: 'desc' },
      skip,
      take: limit,
    }),
    prisma.driverShift.count({ where: { driverId } }),
  ]);
  return { shifts, total, page, totalPages: Math.ceil(total / limit) };
}

// ═══════════════════════════════════════════════════════════════════
// EARNINGS BREAKDOWN
// ═══════════════════════════════════════════════════════════════════

async function getEarningsBreakdown(driverId, period = 'week') {
  const now = new Date();
  let startDate;

  switch (period) {
    case 'day':
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'week':
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 7);
      break;
    case 'month':
      startDate = new Date(now);
      startDate.setMonth(startDate.getMonth() - 1);
      break;
    case 'year':
      startDate = new Date(now);
      startDate.setFullYear(startDate.getFullYear() - 1);
      break;
    default:
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 7);
  }

  const [earningsAgg, tipsAgg, deductionsAgg, tripsData, dailyRows] = await Promise.all([
    // EARNINGS_CREDIT (online-paid, wallet-credited) + CASH_EARNING (collected in
    // person, ledger-only). Counting only the former reported zero earnings and
    // zero trips for any driver working cash fares — see the CASH_EARNING note in
    // arriveTrip for why cash cannot be a wallet credit.
    prisma.walletTransaction.aggregate({
      where: { driverId, type: { in: EARNING_TYPES }, createdAt: { gte: startDate } },
      _sum: { amountPesewas: true },
      _count: true,
    }),
    prisma.walletTransaction.aggregate({
      where: { driverId, type: 'TIP', createdAt: { gte: startDate } },
      _sum: { amountPesewas: true },
    }),
    prisma.walletTransaction.aggregate({
      where: { driverId, type: { in: ['COMMISSION_DEDUCTION', 'WITHDRAWAL'] }, createdAt: { gte: startDate } },
      _sum: { amountPesewas: true },
    }),
    prisma.trip.findMany({
      where: { driverId, status: 'COMPLETED', createdAt: { gte: startDate } },
      select: { id: true, shortId: true, createdAt: true, baseFarePesewas: true },
      orderBy: { createdAt: 'desc' },
    }),
    /**
     * Daily breakdown.
     *
     * BUGFIX: this was a `$queryRaw` against `wallet_transactions`, selecting
     * `created_at`, `amount` and `driver_id`. None of those exist. The model has
     * no `@@map`, so Postgres holds it as `"WalletTransaction"` with quoted
     * camelCase columns, and the money column is `amountPesewas`, not `amount`.
     * Every call to this endpoint answered `relation "wallet_transactions" does
     * not exist` — a 500 for the whole breakdown, not just the daily part.
     *
     * Grouped in JS rather than re-written as SQL: the row set is one driver's
     * earning rows over at most a year, and hand-written identifiers are exactly
     * what drifted from the schema in the first place. Prisma's own query cannot.
     */
    prisma.walletTransaction.findMany({
      where: { driverId, type: { in: EARNING_TYPES }, createdAt: { gte: startDate } },
      select: { amountPesewas: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const byDay = new Map();
  for (const row of dailyRows) {
    const date = row.createdAt.toISOString().slice(0, 10);
    const acc = byDay.get(date) ?? { date, earnings: 0, trips: 0 };
    acc.earnings += row.amountPesewas ?? 0;
    acc.trips += 1;
    byDay.set(date, acc);
  }
  const dailyBreakdown = [...byDay.values()].sort((a, b) => (a.date < b.date ? 1 : -1));

  return {
    totalEarningsPesewas: earningsAgg._sum.amountPesewas ?? 0,
    totalTrips: earningsAgg._count ?? 0,
    totalTips: tipsAgg._sum.amountPesewas ?? 0,
    totalDeductions: deductionsAgg._sum.amountPesewas ?? 0,
    netEarnings: (earningsAgg._sum.amountPesewas ?? 0) - (deductionsAgg._sum.amountPesewas ?? 0),
    averagePerTripPesewas: earningsAgg._count > 0
      ? wholePesewas((earningsAgg._sum.amountPesewas ?? 0) / earningsAgg._count)
      : 0,
    dailyBreakdown: Array.isArray(dailyBreakdown) ? dailyBreakdown : [],
    recentTrips: tripsData.slice(0, 10),
    period,
  };
}

async function getWalletTransactions(driverId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  const [transactions, total] = await Promise.all([
    prisma.walletTransaction.findMany({
      where: { driverId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.walletTransaction.count({ where: { driverId } }),
  ]);

  // WalletTransaction only stores a scalar tripId (no relation), so batch-fetch
  // shortIds separately instead of an invalid Prisma `include`.
  const tripIds = [...new Set(transactions.map((tx) => tx.tripId).filter(Boolean))];
  const trips = tripIds.length
    ? await prisma.trip.findMany({ where: { id: { in: tripIds } }, select: { id: true, shortId: true } })
    : [];
  const shortIdByTripId = new Map(trips.map((t) => [t.id, t.shortId]));

  return {
    transactions: transactions.map((tx) => ({
      id: tx.id,
      type: tx.type,
      amountPesewas: tx.amountPesewas,
      description: tx.description,
      balanceBeforePesewas: tx.balanceBeforePesewas,
      balanceAfterPesewas: tx.balanceAfterPesewas,
      tripShortId: tx.tripId ? (shortIdByTripId.get(tx.tripId) ?? null) : null,
      createdAt: tx.createdAt.toISOString(),
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
}

// ═══════════════════════════════════════════════════════════════════
// SUPPORT TICKETS (Driver-side)
// ═══════════════════════════════════════════════════════════════════

async function createSupportTicket(driverId, { subject, category, description }) {
  if (!subject || !description) {
    throw new AppError('Subject and description are required', 400);
  }

  // Create a user entry for the driver if one doesn't exist
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) throw new NotFoundError('Driver');

  // Find or create a user record for this driver
  let user = await prisma.user.findUnique({ where: { phone: driver.phone } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        phone: driver.phone,
        name: driver.name || 'Driver',
      },
    });
  }

  return prisma.$transaction(async (tx) => {
    const ticket = await tx.supportTicket.create({
      data: {
        userId: user.id,
        driverId,
        subject,
        category: category || 'GENERAL',
        status: 'OPEN',
        priority: 'MEDIUM',
      },
    });

    await tx.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        senderId: user.id,
        senderRole: 'USER',
        text: description,
      },
    });

    return ticket;
  });
}

async function getSupportTickets(driverId) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { phone: true } });
  if (!driver) throw new NotFoundError('Driver');

  const user = await prisma.user.findUnique({ where: { phone: driver.phone } });

  // Two sources, combined: (1) the driver's own tickets, matched by a rider
  // account sharing their phone number — the original (fragile) mechanism;
  // (2) tickets actually filed by riders ABOUT this driver's trips, via the
  // dedicated driverId column that submitDispute now populates. Previously
  // only (1) was queried, so a rider's dispute about a driver's trip was
  // invisible on the driver's side unless they coincidentally shared a phone
  // number with that rider's account.
  const tickets = await prisma.supportTicket.findMany({
    where: {
      OR: [
        ...(user ? [{ userId: user.id }] : []),
        { driverId },
      ],
    },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, text: true, senderRole: true, createdAt: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  return { tickets };
}

async function replyToTicket(driverId, ticketId, { message }) {
  if (!message) throw new AppError('Message is required', 400);

  const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { phone: true } });
  if (!driver) throw new NotFoundError('Driver');

  const user = await prisma.user.findUnique({ where: { phone: driver.phone } });

  /**
   * A DRIVER MAY ANSWER EVERY TICKET THEY CAN SEE.
   *
   * `getSupportTickets` above deliberately returns two sets — tickets the
   * driver raised (matched through a rider account that shares their phone
   * number) AND tickets riders filed ABOUT this driver's trips, via the
   * `driverId` column. This function only ever matched the first set, and threw
   * `NotFoundError('User account')` outright for a driver with no rider account
   * at all. So a driver could open a dispute raised against them, read it, and
   * find that replying failed — which is the whole of "on the driver app you
   * can view extra details on my tickets" being unusable.
   *
   * `senderId` is a free-form String column with no foreign key (see the
   * schema), which is exactly why it can carry a driver id when there is no
   * user account behind the driver.
   */
  const ticket = await prisma.supportTicket.findFirst({
    where: {
      id: ticketId,
      OR: [...(user ? [{ userId: user.id }] : []), { driverId }],
    },
  });
  if (!ticket) throw new NotFoundError('Ticket');

  return prisma.$transaction(async (tx) => {
    await tx.ticketMessage.create({
      data: {
        ticketId,
        // The driver's own rider account when they have one (so their replies
        // group with anything they wrote from the rider app), else the driver.
        senderId: user?.id ?? driverId,
        senderRole: user && ticket.userId === user.id ? 'USER' : 'DRIVER',
        text: message,
      },
    });

    await tx.supportTicket.update({
      where: { id: ticketId },
      data: { status: 'OPEN', updatedAt: new Date() },
    });
  });
}

// ═══════════════════════════════════════════════════════════════════
// VEHICLE INSPECTION SCHEDULING
// ═══════════════════════════════════════════════════════════════════

async function scheduleInspection(driverId, { vehicleId, scheduledDate, notes }) {
  if (!vehicleId || !scheduledDate) {
    throw new AppError('Vehicle and scheduled date are required', 400);
  }

  // Verify vehicle belongs to driver
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, driverId },
  });
  if (!vehicle) throw new NotFoundError('Vehicle');

  const inspection = await prisma.vehicleInspection.create({
    data: {
      vehicleId,
      driverId,
      scheduledDate: new Date(scheduledDate),
      status: 'SCHEDULED',
      notes: notes || null,
    },
  });

  return inspection;
}

async function getInspections(driverId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  const [inspections, total] = await Promise.all([
    prisma.vehicleInspection.findMany({
      where: { driverId },
      include: { vehicle: { select: { plateNumber: true, make: true, model: true } } },
      orderBy: { scheduledDate: 'desc' },
      skip,
      take: limit,
    }),
    prisma.vehicleInspection.count({ where: { driverId } }),
  ]);

  return { inspections, total, page, totalPages: Math.ceil(total / limit) };
}
