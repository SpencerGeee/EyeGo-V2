'use strict';

const crypto = require('crypto');
const prisma = require('../config/database');
const { AppError } = require('../utils/errors');
const { SEAT_OCCUPYING_STATUSES } = require('../utils/booking-status');

/**
 * "Verify My Ride" — the 4-digit code a rider shows their driver before
 * boarding.
 *
 * WHAT IT IS FOR. Getting into the wrong car is the failure this exists to
 * stop, and it is a failure that plate-matching alone does not prevent: a
 * rider glancing at a plate in the dark, at night, with three identical
 * silver vans at the kerb, will get it wrong. Making the DRIVER prove they
 * know a number only this rider can see inverts the check — the rider no
 * longer has to identify the car; the car has to identify itself.
 *
 * WHAT IT IS NOT. This is not authentication and must not be reused as any.
 * It is four digits, it is displayed openly on a phone screen, and it is
 * shown to a stranger by design. It gates one thing — marking a specific
 * booking as boarded — and its whole security value is that the code is
 * bound to one booking and dies with it.
 *
 * `crypto.randomInt` rather than `Math.random`: the numbers are small enough
 * that a predictable sequence would be guessable across concurrent riders on
 * the same trip, and a CSPRNG costs nothing here.
 */

/** Four digits, zero-padded. "0421" is a valid code and is not 421. */
function generatePin() {
  return String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

/**
 * Mint a PIN for a booking if — and only if — its rider asked for one.
 *
 * Returns the pin, or null when the rider has the setting off. Safe to call on
 * every booking path; the setting check is what keeps it from adding a step to
 * riders who never opted in.
 *
 * Takes an optional transaction client so a booking and its pin are written in
 * the same transaction as everything else — a booking that exists without the
 * pin it is supposed to have is a booking the driver cannot board.
 */
async function issuePinForBooking(tx, { bookingId, userId }) {
  const db = tx ?? prisma;
  if (!bookingId || !userId) return null;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { requireBoardingPin: true },
  });
  if (!user?.requireBoardingPin) return null;

  const boardingPin = generatePin();
  await db.booking.update({
    where: { id: bookingId },
    data: { boardingPin },
  });
  return boardingPin;
}

/**
 * NOBODY DRIVES OFF WITH AN UNVERIFIED CODE.
 *
 * BUGFIX (item 16: "I chose to start the trip without boarding and putting the
 * pin in, and it still started the ride. If there's a rider that has pin
 * enabled, the ride cannot start without the pin.")
 *
 * `boardPassenger` has checked the code since the feature was built — and
 * boarding is not on the path to IN_PROGRESS. A driver can swipe Start Ride
 * from ARRIVED_AT_PICKUP without ever opening the seat map, so Verify My Ride
 * was a step the driver could simply walk past, on a feature whose entire
 * purpose is that they cannot.
 *
 * This is the gate, in one place, called by BOTH departure paths
 * (`rides.startTrip` and `drivers.departTrip`) so they cannot drift apart.
 *
 * A rider who never turned the setting on has `boardingPin: null` and is
 * unaffected — that is everyone, by default. Only a booking that ASKED for a
 * code and has not had it entered blocks the ride, and the error names who,
 * so the driver knows which passenger to ask rather than being told "no".
 *
 * @param {import('@prisma/client').PrismaClient} db  prisma or a transaction
 * @throws {AppError} 409 BOARDING_PIN_REQUIRED
 */
async function assertAllPinsVerified(db, tripId) {
  const pending = await db.booking.findMany({
    where: {
      tripId,
      status: { in: SEAT_OCCUPYING_STATUSES },
      boardingPin: { not: null },
      pinVerifiedAt: null,
    },
    select: {
      id: true,
      seatNumber: true,
      guestName: true,
      user: { select: { name: true } },
    },
  });
  if (pending.length === 0) return;

  const who = pending
    .map((b) => b.guestName || b.user?.name || (b.seatNumber != null ? `seat ${b.seatNumber}` : null))
    .filter(Boolean);
  const names = who.length ? who.join(', ') : `${pending.length} passenger${pending.length > 1 ? 's' : ''}`;

  const err = new AppError(
    `${names} still needs to be verified. Ask for their 4-digit code and board them before starting the ride.`,
    409,
    'BOARDING_PIN_REQUIRED',
  );
  // The driver's screen jumps straight to the seat map for these rows rather
  // than making them hunt for who it meant.
  err.details = { bookingIds: pending.map((b) => b.id), count: pending.length };
  throw err;
}

/**
 * A RIDE CANNOT START WITH NOBODY IN THE CAR.
 *
 * "Gate starting a ride if no one has been boarded. Enforce the boarded
 * functionality end to end and completely."
 *
 * `BOARDED` was, until now, a label the driver could apply or not — the seat map
 * wrote it, and absolutely nothing downstream required it. So the status meant
 * whatever each driver's habits made it mean, and every consumer that reads it
 * was reading a field that was only sometimes filled in:
 *
 *   - the tracking page's "N/M boarded" pill,
 *   - the cash auto-settle at completion, which settles seats "never marked
 *     boarded" as a fallback and therefore had to treat the common case as the
 *     exception,
 *   - the no-show flow, which is defined as "they never boarded",
 *   - and Verify My Ride, whose code is entered BY boarding.
 *
 * Requiring at least one boarded seat before IN_PROGRESS is what turns it into a
 * fact. It is also the honest precondition: "start the ride" means the passenger
 * is in the vehicle, and if nobody is, the thing being started is not a ride.
 *
 * ONE seat, not all of them — a fifteen-seater picks passengers up along the
 * route, and demanding a full bus before pulling away would strand every group
 * trip at its first stop.
 *
 * @throws {AppError} 409 NOBODY_BOARDED
 */
async function assertSomeoneBoarded(db, tripId) {
  const boarded = await db.booking.count({ where: { tripId, status: 'BOARDED' } });
  if (boarded > 0) return;

  const waiting = await db.booking.count({
    where: { tripId, status: { in: SEAT_OCCUPYING_STATUSES } },
  });

  throw new AppError(
    waiting > 0
      ? 'Board your passengers first. Open the seat map and mark who is in the vehicle — the ride cannot start with an empty car.'
      : 'There is nobody on this trip to carry yet.',
    409,
    'NOBODY_BOARDED',
  );
}

/**
 * Everything that must be true before a trip may reach IN_PROGRESS.
 *
 * Both departure endpoints call THIS rather than the two checks separately, so
 * a third one added later cannot be wired into only one of them — which is
 * exactly how the PIN check came to guard boarding and not departure.
 *
 * Order matters: "board them" is the instruction that also collects the codes,
 * so a driver who has boarded nobody is told to board rather than being asked
 * for a PIN they have no way to enter yet.
 */
async function assertReadyToDepart(db, tripId) {
  await assertSomeoneBoarded(db, tripId);
  await assertAllPinsVerified(db, tripId);
}

module.exports = {
  generatePin,
  issuePinForBooking,
  assertAllPinsVerified,
  assertSomeoneBoarded,
  assertReadyToDepart,
};
