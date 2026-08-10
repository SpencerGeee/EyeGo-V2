'use strict';

const prisma = require('../config/database');
const { AppError, NotFoundError } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * DESTINATION MODE — "I'm going home, only send me rides heading that way."
 *
 * The rule a driver actually cares about is not "is the pickup near my route",
 * it is "will taking this leave me closer to where I am going than I am now".
 * That is what `headingTowards` answers, with two independent gates:
 *
 *   - PROGRESS. The trip's dropoff must be meaningfully closer to the driver's
 *     destination than the driver is right now. A ride that ends the same
 *     distance away has not helped, however well-aligned it looked.
 *   - DETOUR. Going to the pickup must not itself be a journey. A pickup 8 km
 *     backwards to save 3 km forwards is not on the way, and a pure bearing
 *     cone cannot tell the difference — which is why this is not a pure
 *     bearing cone.
 *
 * Rationed on purpose: see the schema note on Driver.destinationLat.
 */

const MAX_USES_PER_DAY = 2;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
/** The ride must close at least this fraction of the driver's remaining gap. */
const MIN_PROGRESS_RATIO = 0.25;
/** ...and at least this much of it in absolute terms, for short hops. */
const MIN_PROGRESS_KM = 1.5;
/** How far out of the way the pickup itself may be. */
const MAX_PICKUP_DETOUR_KM = 6;

const R_EARTH_KM = 6371;
const toRad = (d) => (d * Math.PI) / 180;

function haversineKm(aLat, aLng, bLat, bLng) {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const num = (v) => typeof v === 'number' && Number.isFinite(v);

/** Same UTC day? Used to roll the daily allowance. */
const sameDay = (a, b) =>
  !!a && !!b && a.getUTCFullYear() === b.getUTCFullYear() &&
  a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();

/**
 * Is this driver's destination session live right now?
 *
 * A set-but-expired destination is treated as no destination at all — never as
 * a reason to withhold work.
 */
function isActive(driver, now = new Date()) {
  return (
    num(driver?.destinationLat) &&
    num(driver?.destinationLng) &&
    !!driver.destinationExpiresAt &&
    driver.destinationExpiresAt.getTime() > now.getTime()
  );
}

/**
 * Would this trip take the driver towards their destination?
 *
 * Returns true when destination mode is off — an unset destination filters
 * nothing. That default matters: every failure mode here should be "the driver
 * gets offered the ride", not "the driver silently gets no work".
 */
function headingTowards(driver, trip) {
  if (!isActive(driver)) return true;

  const { destinationLat: dLat, destinationLng: dLng } = driver;
  if (!num(driver.currentLat) || !num(driver.currentLng)) return true;
  // A trip with no dropoff cannot be judged; offer it rather than hide it.
  if (!num(trip?.dropoffLat) || !num(trip?.dropoffLng)) return true;

  const gapNow = haversineKm(driver.currentLat, driver.currentLng, dLat, dLng);
  const gapAfter = haversineKm(trip.dropoffLat, trip.dropoffLng, dLat, dLng);
  const progressKm = gapNow - gapAfter;

  if (progressKm < Math.min(MIN_PROGRESS_KM, gapNow * MIN_PROGRESS_RATIO)) return false;
  if (progressKm < gapNow * MIN_PROGRESS_RATIO) return false;

  if (num(trip.pickupLat) && num(trip.pickupLng)) {
    const detourKm =
      haversineKm(driver.currentLat, driver.currentLng, trip.pickupLat, trip.pickupLng);
    if (detourKm > MAX_PICKUP_DETOUR_KM) return false;
  }

  return true;
}

/** What the driver app needs to render the control. */
function describe(driver, now = new Date()) {
  const usesToday = sameDay(driver?.destinationUsesDate, now) ? driver.destinationUsesToday ?? 0 : 0;
  return {
    active: isActive(driver, now),
    lat: driver?.destinationLat ?? null,
    lng: driver?.destinationLng ?? null,
    address: driver?.destinationAddress ?? null,
    expiresAtServerMs: driver?.destinationExpiresAt?.getTime() ?? null,
    usesToday,
    usesRemaining: Math.max(0, MAX_USES_PER_DAY - usesToday),
    maxUsesPerDay: MAX_USES_PER_DAY,
    serverNowMs: now.getTime(),
  };
}

async function getStatus(driverId) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) throw new NotFoundError('Driver');
  return describe(driver);
}

/**
 * Start a destination session. Spends one of the day's allowance.
 */
async function setDestination(driverId, { lat, lng, address }) {
  if (!num(lat) || !num(lng)) throw new AppError('A destination is required', 400, 'INVALID_DESTINATION');

  const now = new Date();
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) throw new NotFoundError('Driver');

  const usesToday = sameDay(driver.destinationUsesDate, now) ? driver.destinationUsesToday ?? 0 : 0;
  if (usesToday >= MAX_USES_PER_DAY) {
    throw new AppError(
      `You've used both destination trips for today. It resets tomorrow.`,
      429,
      'DESTINATION_LIMIT_REACHED',
    );
  }

  const updated = await prisma.driver.update({
    where: { id: driverId },
    data: {
      destinationLat: lat,
      destinationLng: lng,
      destinationAddress: address ?? null,
      destinationExpiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      destinationUsesToday: usesToday + 1,
      destinationUsesDate: now,
    },
  });

  logger.info(`Driver ${driverId} set a destination (${usesToday + 1}/${MAX_USES_PER_DAY} today)`);
  return describe(updated, now);
}

/**
 * End the session. Called when the driver clears it themselves, and by the
 * dispatch path once a destination-matched trip has been accepted — the whole
 * promise is ONE ride home, not a filtered shift.
 */
async function clearDestination(driverId, reason = 'MANUAL') {
  const updated = await prisma.driver.update({
    where: { id: driverId },
    data: { destinationLat: null, destinationLng: null, destinationAddress: null, destinationExpiresAt: null },
  }).catch((err) => {
    logger.warn(`clearDestination for ${driverId} failed: ${err.message}`);
    return null;
  });
  if (updated) logger.info(`Driver ${driverId} destination cleared (${reason})`);
  return updated ? describe(updated) : null;
}

module.exports = {
  MAX_USES_PER_DAY,
  isActive,
  headingTowards,
  describe,
  getStatus,
  setDestination,
  clearDestination,
};
