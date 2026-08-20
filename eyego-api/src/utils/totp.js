'use strict';

const crypto = require('crypto');

/**
 * TOTP (RFC 6238) over HOTP (RFC 4226), on Node's own crypto.
 *
 * Hand-rolled rather than pulled in, because the whole algorithm is the sixty
 * lines below and every authenticator app on earth implements the same one:
 * SHA-1, 6 digits, 30-second steps. Those three parameters are not tunable
 * here on purpose — Google Authenticator and its imitators ignore anything else
 * in the otpauth:// URI, so a "configurable" implementation would simply
 * produce codes that never match.
 *
 * WHY ADMINS NEED THIS. These accounts can reprice every ride on the platform
 * and ban any user. Riders authenticate with a one-time code; until now the
 * administrators had a weaker bar than their own customers.
 */

const DIGITS = 6;
const STEP_SECONDS = 30;
/** Accept the neighbouring steps, for clock skew between phone and server. */
const DRIFT_STEPS = 1;

// ── base32 (RFC 4648, no padding) — the encoding authenticator apps expect ────

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`Invalid base32 character "${ch}" in TOTP secret`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ── the algorithm ─────────────────────────────────────────────────────────────

/** A fresh 160-bit secret — the size RFC 4226 recommends for SHA-1. */
function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

/** Which 30-second step a moment falls in. */
function stepFor(when = Date.now()) {
  return Math.floor(when / 1000 / STEP_SECONDS);
}

function codeForStep(secretBase32, step) {
  const key = base32Decode(secretBase32);

  // 8-byte big-endian counter. `writeBigUInt64BE` because a step number will
  // outlive 32 bits, and silently truncating it would break every code in 2038.
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));

  const hmac = crypto.createHmac('sha1', key).update(counter).digest();

  // Dynamic truncation (RFC 4226 §5.3): the low nibble of the last byte picks
  // which four bytes to read, so the code depends on the whole digest.
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/** The code an authenticator is showing right now. Used only by tests and the mock. */
function currentCode(secretBase32, when = Date.now()) {
  return codeForStep(secretBase32, stepFor(when));
}

/**
 * Check a submitted code.
 *
 * Returns the step it matched, or `null`. The STEP MATTERS to the caller: it
 * must be persisted and refused next time, otherwise a code stays valid for its
 * whole 30-second window and can be replayed by anyone who read it over a
 * shoulder or intercepted it once.
 *
 * @param {string} secretBase32
 * @param {string} token
 * @param {bigint|number|null} lastUsedStep the last step this account accepted
 */
function verify(secretBase32, token, lastUsedStep = null) {
  const clean = String(token ?? '').replace(/\D/g, '');
  if (clean.length !== DIGITS) return null;

  const now = stepFor();
  for (let d = -DRIFT_STEPS; d <= DRIFT_STEPS; d += 1) {
    const step = now + d;
    if (lastUsedStep != null && BigInt(step) <= BigInt(lastUsedStep)) continue; // replay
    const expected = codeForStep(secretBase32, step);
    // timingSafeEqual needs equal lengths; both are always DIGITS long here.
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return step;
  }
  return null;
}

/**
 * The otpauth:// URI an authenticator scans.
 * `issuer` appears as the account's heading in the app, so it should be the
 * product name and not the hostname.
 */
function otpauthUri({ secret, accountName, issuer = 'EyeGo Console' }) {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * Recovery codes, for the phone that fell in a gutter.
 * Returned in plain text ONCE; only bcrypt hashes are stored.
 */
function generateBackupCodes(count = 10) {
  const codes = [];
  for (let i = 0; i < count; i += 1) {
    // Grouped for legibility when read off a screen and typed into a form.
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5, 10)}`);
  }
  return codes;
}

module.exports = {
  DIGITS,
  STEP_SECONDS,
  generateSecret,
  currentCode,
  verify,
  stepFor,
  otpauthUri,
  generateBackupCodes,
};
