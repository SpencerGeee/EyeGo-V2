'use strict';

/**
 * THE canonical set of values `Driver.status` may hold.
 *
 * WHY THIS FILE EXISTS. The column is a free-form `String` and roughly fifteen
 * places compare it to the literal `'ACTIVE'` — `driver-availability.js` (the
 * single eligibility authority), `driverAuth`, the go-online gate, the admin
 * fleet counts. Every one of those comparisons is exact, so a row holding
 * `'Active'`, `'ACTIVE '` or the plausible-but-wrong `'APPROVED'` is not an
 * error anywhere: the driver simply stops being offered work, appears offline
 * to dispatch, and nothing in the logs says why. That is the worst shape a bug
 * can have — no exception, no type error, no signal, and the driver blames the
 * app.
 *
 * A Prisma enum would be the textbook fix, and eventually is the right one. It
 * is not this change: migration SQL is gitignored in this repo and several
 * tables were created directly against the dev database, so a schema migration
 * carries more risk right now than the bug it closes. What actually kills the
 * failure mode is making it impossible to STORE a value that does not compare
 * equal — normalise on the way in, reject what cannot be normalised, and clean
 * up whatever the database already holds at boot.
 *
 * When the enum migration does happen, these constants become its members and
 * `normalizeDriverStatus` becomes the backfill.
 */

const DRIVER_STATUS = Object.freeze({
  /** Signed up, documents not yet reviewed. Cannot go online. */
  PENDING_REVIEW: 'PENDING_REVIEW',
  /** Approved. THE value dispatch eligibility is keyed on. */
  ACTIVE: 'ACTIVE',
  /** Temporarily barred by ops. Reversible. */
  SUSPENDED: 'SUSPENDED',
  /** Application refused. Terminal unless ops re-opens it. */
  REJECTED: 'REJECTED',
  /** Driver-initiated departure. */
  DEACTIVATED: 'DEACTIVATED',
});

const DRIVER_STATUSES = Object.freeze(Object.values(DRIVER_STATUS));

/**
 * Values that have meant "approved" at some point in this codebase's life, or
 * that a human would plausibly type into an admin field meaning it.
 *
 * `APPROVED` is here because it is the single most dangerous one: it is what the
 * per-document review uses, so anyone reading the documents code and then
 * writing the driver row reaches for it, and it is wrong.
 */
const ALIASES = Object.freeze({
  APPROVED: DRIVER_STATUS.ACTIVE,
  VERIFIED: DRIVER_STATUS.ACTIVE,
  ACTIVATED: DRIVER_STATUS.ACTIVE,
  ENABLED: DRIVER_STATUS.ACTIVE,
  PENDING: DRIVER_STATUS.PENDING_REVIEW,
  UNDER_REVIEW: DRIVER_STATUS.PENDING_REVIEW,
  IN_REVIEW: DRIVER_STATUS.PENDING_REVIEW,
  BANNED: DRIVER_STATUS.SUSPENDED,
  BLOCKED: DRIVER_STATUS.SUSPENDED,
  DECLINED: DRIVER_STATUS.REJECTED,
  DISABLED: DRIVER_STATUS.DEACTIVATED,
  INACTIVE: DRIVER_STATUS.DEACTIVATED,
});

/**
 * Best-effort canonicalisation. Returns null when the input cannot be mapped —
 * callers decide whether that is a 400 or a row to leave alone.
 *
 * Whitespace and case are handled first because those are the two ways a value
 * ends up wrong without anybody making a decision: a trailing space pasted from
 * a spreadsheet, or a title-cased value typed by hand.
 */
function normalizeDriverStatus(raw) {
  if (typeof raw !== 'string') return null;
  const key = raw.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (!key) return null;
  if (DRIVER_STATUSES.includes(key)) return key;
  return ALIASES[key] ?? null;
}

/**
 * Write-path guard. Throws rather than storing something dispatch will silently
 * ignore — an admin who mistypes gets a 400 they can see, instead of a driver
 * who quietly stops receiving work.
 */
function assertDriverStatus(raw) {
  const status = normalizeDriverStatus(raw);
  if (!status) {
    const err = new Error(
      `Invalid driver status ${JSON.stringify(raw)}. Expected one of: ${DRIVER_STATUSES.join(', ')}.`,
    );
    err.statusCode = 400;
    err.code = 'INVALID_DRIVER_STATUS';
    throw err;
  }
  return status;
}

/** The one question the rest of the system actually asks. Tolerant on read. */
const isActiveDriverStatus = (raw) => normalizeDriverStatus(raw) === DRIVER_STATUS.ACTIVE;

module.exports = {
  DRIVER_STATUS,
  DRIVER_STATUSES,
  normalizeDriverStatus,
  assertDriverStatus,
  isActiveDriverStatus,
};
