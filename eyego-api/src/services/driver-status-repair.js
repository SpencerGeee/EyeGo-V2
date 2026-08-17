'use strict';

const prisma = require('../config/database');
const logger = require('../utils/logger');
const { DRIVER_STATUSES, normalizeDriverStatus } = require('../utils/driver-status');

/**
 * One-shot repair of `Driver.status` values that do not compare equal to the
 * literals the rest of the system tests against.
 *
 * Runs at boot, before the socket server or the task worker come up, so no
 * request can read a dirty row after this returns. It is deliberately a sweep
 * rather than a migration: migration SQL is gitignored here and some tables were
 * created directly against the dev database, so a repair that is safe to run on
 * every boot is worth more than one that has to be applied exactly once.
 *
 * Anything that cannot be mapped is LEFT ALONE and logged loudly. Guessing at an
 * unrecognised status is how a suspended driver gets quietly reactivated — the
 * one outcome worse than the bug this fixes.
 */
async function run() {
  let rows;
  try {
    rows = await prisma.driver.findMany({
      where: { status: { notIn: [...DRIVER_STATUSES] } },
      select: { id: true, status: true },
    });
  } catch (err) {
    // A repair is not worth refusing to boot over. The write-path guard is the
    // load-bearing half of this fix; this sweep is cleanup.
    logger.error('Driver.status repair could not read rows', { err: err?.message });
    return { scanned: 0, repaired: 0, unmappable: 0 };
  }

  if (rows.length === 0) return { scanned: 0, repaired: 0, unmappable: 0 };

  let repaired = 0;
  const unmappable = [];

  for (const row of rows) {
    const canonical = normalizeDriverStatus(row.status);
    if (!canonical) {
      unmappable.push({ id: row.id, status: row.status });
      continue;
    }
    try {
      await prisma.driver.update({ where: { id: row.id }, data: { status: canonical } });
      repaired += 1;
      logger.warn('Repaired Driver.status', { driverId: row.id, from: row.status, to: canonical });
    } catch (err) {
      logger.error('Failed to repair Driver.status', { driverId: row.id, err: err?.message });
    }
  }

  if (unmappable.length > 0) {
    // Worth an alarm, not a silent skip: every one of these drivers is invisible
    // to dispatch right now and nobody would otherwise find out.
    logger.error(
      `Driver.status: ${unmappable.length} row(s) hold a value nothing recognises. ` +
        'These drivers cannot be dispatched to until ops corrects them.',
      { rows: unmappable },
    );
  }

  logger.info(`Driver.status repair: ${repaired} repaired, ${unmappable.length} unmappable.`);
  return { scanned: rows.length, repaired, unmappable: unmappable.length };
}

module.exports = { run };
