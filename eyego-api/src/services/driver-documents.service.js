'use strict';

const prisma = require('../config/database');
const logger = require('../utils/logger');

/**
 * ── DRIVER COMPLIANCE PAPERWORK ─────────────────────────────────────────────
 *
 * The rules about which documents a driver must hold, when they expire, and
 * what happens when they do.
 *
 * The gap this closes: `Driver.documentReview` records a STATUS per document
 * and no dates. A licence verified in January is still "VERIFIED" in December,
 * whatever the certificate says, and insurance and roadworthiness had no
 * representation at all. The platform could therefore dispatch a rider into a
 * car with lapsed insurance and would have no record that anything was wrong.
 * The exposure there is the operator's, not the driver's.
 *
 * ── WHY EXPIRY IS ENFORCED AT go-online AND NOT AT DISPATCH ─────────────────
 *
 * Both would work. Going online is the better place because it is the moment
 * the driver is present, looking at the app, and able to do something about it
 * — they can photograph a new certificate there and then. Refusing at dispatch
 * instead means a driver sits online for an hour wondering why no offers
 * arrive, which is the same outcome delivered as a mystery.
 *
 * ── WHY A MISSING DATE IS NOT AN EXPIRED ONE ────────────────────────────────
 *
 * `expiresAt` is nullable and null passes. Every driver already on the platform
 * predates this table, and treating "we never recorded a date" as "expired"
 * would put the entire existing fleet offline on deploy. The dates arrive as
 * drivers re-upload; the gate tightens on its own as they do.
 */

/** Everything the platform knows how to hold. */
const DOCUMENT_TYPES = [
  'DRIVERS_LICENSE',
  'GHANA_CARD',
  'INSURANCE',
  'ROADWORTHINESS',
  'VEHICLE_REGISTRATION',
];

/**
 * The ones that stop a driver going online when expired.
 *
 * A Ghana Card is identity and does not lapse in a way that makes driving
 * unsafe or uninsured, so it is not here — it is checked for verification by
 * the existing gate, which is the right check for it. These three are the ones
 * where an out-of-date document means the car should not be carrying paying
 * passengers today.
 */
const EXPIRY_ENFORCED_TYPES = ['DRIVERS_LICENSE', 'INSURANCE', 'ROADWORTHINESS'];

/** Human labels, used in the copy a driver actually reads. */
const LABELS = {
  DRIVERS_LICENSE: "driver's licence",
  GHANA_CARD: 'Ghana Card',
  INSURANCE: 'insurance certificate',
  ROADWORTHINESS: 'roadworthiness certificate',
  VEHICLE_REGISTRATION: 'vehicle registration',
};

/** Warn at these thresholds, once each, before the document lapses. */
const WARN_DAYS = [30, 7];

const DAY_MS = 24 * 60 * 60 * 1000;

function isExpired(doc, now = new Date()) {
  // No date recorded is not an expiry. See the module note.
  if (!doc?.expiresAt) return false;
  return new Date(doc.expiresAt).getTime() < now.getTime();
}

function daysUntil(doc, now = new Date()) {
  if (!doc?.expiresAt) return null;
  return Math.ceil((new Date(doc.expiresAt).getTime() - now.getTime()) / DAY_MS);
}

/**
 * Every expiring document this driver holds that has lapsed.
 *
 * Returns an array rather than the first hit, so the driver is told about all
 * of it at once. Being sent away to fix one certificate, coming back, and being
 * refused for a second is how a compliance gate turns into a support ticket.
 */
async function expiredDocumentsFor(driverId, now = new Date()) {
  const docs = await prisma.driverDocument.findMany({
    where: { driverId, type: { in: EXPIRY_ENFORCED_TYPES } },
    select: { type: true, expiresAt: true, status: true },
  });
  return docs.filter((d) => isExpired(d, now));
}

/**
 * The go-online check. Throws when anything required has lapsed.
 *
 * `AppError` is required lazily to keep this module loadable by scripts that
 * have no express context.
 */
async function assertDocumentsCurrent(driverId, now = new Date()) {
  const expired = await expiredDocumentsFor(driverId, now);
  if (expired.length === 0) return;

  const { AppError } = require('../utils/errors');
  const names = expired.map((d) => LABELS[d.type] ?? d.type);
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

  throw new AppError(
    `Your ${list} ${names.length === 1 ? 'has' : 'have'} expired. Upload a current copy to go back online.`,
    403,
    'DOCUMENTS_EXPIRED',
  );
}

/**
 * Documents falling due, for the nightly warning sweep.
 *
 * Buckets rather than a single "expiring soon" list, because a driver 30 days
 * out and a driver 7 days out need different words and different urgency.
 */
async function documentsExpiringWithin(days, now = new Date()) {
  const until = new Date(now.getTime() + days * DAY_MS);
  return prisma.driverDocument.findMany({
    where: {
      type: { in: EXPIRY_ENFORCED_TYPES },
      expiresAt: { gte: now, lte: until },
    },
    select: {
      id: true,
      driverId: true,
      type: true,
      expiresAt: true,
      driver: { select: { id: true, name: true, fcmToken: true } },
    },
  });
}

/**
 * Tell drivers their paperwork is about to lapse.
 *
 * Runs nightly. Idempotent enough to run more than once a day: a driver whose
 * document falls in the same bucket gets the same message, and push is
 * best-effort by nature, so the cost of a duplicate is one extra notification
 * rather than a corrupted state.
 */
async function runExpiryWarnings(now = new Date()) {
  const pushService = require('./push.service');
  let sent = 0;
  const seen = new Set();

  // Tightest bucket first, so a document that is 7 days out gets the urgent
  // wording rather than the relaxed 30-day one.
  for (const days of [...WARN_DAYS].sort((a, b) => a - b)) {
    const due = await documentsExpiringWithin(days, now);

    for (const doc of due) {
      if (seen.has(doc.id)) continue;
      seen.add(doc.id);

      const token = doc.driver?.fcmToken;
      if (!token) continue;

      const label = LABELS[doc.type] ?? doc.type;
      const remaining = daysUntil(doc, now);

      const ok = await pushService
        .sendPush(
          token,
          'Your paperwork is expiring',
          remaining <= 0
            ? `Your ${label} expires today. Upload a current copy to stay online.`
            : `Your ${label} expires in ${remaining} day${remaining === 1 ? '' : 's'}. Upload a current copy to stay online.`,
          { type: 'DOCUMENT_EXPIRING', documentType: doc.type },
        )
        .then(() => true)
        .catch(() => false);

      if (ok) sent += 1;
    }
  }

  if (seen.size > 0) {
    logger.info(`[documents] expiry sweep: ${seen.size} due, ${sent} drivers notified`);
  }
  return { due: seen.size, notified: sent };
}

module.exports = {
  DOCUMENT_TYPES,
  EXPIRY_ENFORCED_TYPES,
  LABELS,
  WARN_DAYS,
  isExpired,
  daysUntil,
  expiredDocumentsFor,
  assertDocumentsCurrent,
  documentsExpiringWithin,
  runExpiryWarnings,
};
