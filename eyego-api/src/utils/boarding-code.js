/**
 * Walk-up boarding code (Q10): short, shown on/inside the bus, typed by a rider
 * standing at a stop. No 0/O/1/I/L so it reads off a sticker in sunlight.
 * New per trip, so yesterday's code buys nothing today.
 */
const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function newBoardingCode(length = 4) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

/** Riders type it however they like: case and spaces don't matter. */
function normalizeBoardingCode(raw) {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

module.exports = { newBoardingCode, normalizeBoardingCode, ALPHABET };
