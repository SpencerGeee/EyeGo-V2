'use strict';

const redis = require('../config/redis');
const { AppError } = require('./errors');

/**
 * One request at a time per key. The check-then-create paths with no unique
 * constraint behind them (a dispute, a lost-item report, a map report) each
 * read "nothing open yet" and then wrote — so a double tap read it twice and
 * filed twice, pushing the other party twice. The second request now gets a
 * 409 while the first is still running; once it is done, the service's own
 * "already open" check answers.
 *
 * Fails open: with Redis down the work still runs, unguarded, as before.
 */
async function singleFlight(key, fn, ttlSeconds = 15) {
  const k = `single-flight:${key}`;
  let got = 'OK';
  try { got = await redis.set(k, '1', 'EX', ttlSeconds, 'NX'); } catch { /* fail open */ }
  if (!got) throw new AppError('Already on it — one moment.', 409, 'REQUEST_IN_FLIGHT');
  try {
    return await fn();
  } finally {
    redis.del(k).catch(() => {});
  }
}

module.exports = { singleFlight };
