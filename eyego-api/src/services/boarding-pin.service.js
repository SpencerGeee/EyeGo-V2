'use strict';

const crypto = require('crypto');
const prisma = require('../config/database');

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

module.exports = { generatePin, issuePinForBooking };
