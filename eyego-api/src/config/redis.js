'use strict';

const Redis = require('ioredis');
const logger = require('../utils/logger');

/**
 * Redis. Required. No fallback.
 *
 * WHAT WAS HERE BEFORE. A ~330-line `InMemoryRedis` shim that this module
 * silently swapped in whenever the real Redis was unreachable. It looked like
 * resilience. It was the opposite:
 *
 *   - Its own comments recorded that `SET ... NX` originally always succeeded,
 *     so the payment double-charge lock and the Paystack webhook dedup lock
 *     "gave zero protection whenever Redis is down" — while the service kept
 *     reporting healthy.
 *   - A per-process Map cannot be a distributed lock, a shared dispatch state,
 *     or a Socket.IO adapter. With two instances the fallback does not degrade
 *     the guarantee, it deletes it, silently, per process.
 *   - A misconfigured production deploy therefore came up green and started
 *     double-charging.
 *
 * Redis now holds dispatch cascade state, the driver GEO supply index, the
 * Socket.IO adapter and the money locks. There is no honest way to serve
 * traffic without it, so a bad connection is a startup failure, loudly, rather
 * than a correctness failure, quietly.
 *
 * Local dev: `docker compose up -d` in eyego-api/.
 */

const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  logger.error(
    'FATAL: REDIS_URL is not set. Redis holds dispatch state, the driver supply ' +
      'index, the Socket.IO adapter and the payment locks — the API cannot serve ' +
      'traffic without it. Run `docker compose up -d` (eyego-api/) for local dev.',
  );
  process.exit(1);
}

// Hosted Redis (Upstash, Redis Cloud, Elasticache in-transit-encryption) all
// require TLS, which ioredis enables from the `rediss://` scheme. A plain
// `redis://` URL against Upstash produces the confusing failure where the TCP
// socket opens and logs "Redis connected", and then every command times out —
// because the server is waiting for a TLS handshake that never comes.
if (/^redis:\/\//.test(REDIS_URL) && /upstash\.io|redislabs\.com|cache\.amazonaws\.com/.test(REDIS_URL)) {
  logger.warn(
    'REDIS_URL uses redis:// against a hosted provider that requires TLS. ' +
      'Use rediss:// (two s) or every command will time out after connecting.',
  );
}

const client = new Redis(REDIS_URL, {
  connectTimeout: 10_000,
  // Commands queue rather than failing while a reconnect is in flight, and
  // they are never abandoned. See the note on duplicate() below: a retry limit
  // here turns a transient blip into unhandled rejections.
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  retryStrategy: (times) => Math.min(times * 200, 5000),
});

let everConnected = false;

client.on('connect', () => {
  everConnected = true;
  logger.info('Redis connected');
});

client.on('error', (err) => {
  logger.error(`Redis error: ${err.message}`);
});

client.on('end', () => {
  logger.warn('Redis connection closed');
});

/**
 * Startup gate. Called from server.js before the HTTP listener binds, so the
 * process never advertises readiness on a box that cannot reach Redis.
 */
async function assertReady(timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const pong = await client.ping();
      if (pong === 'PONG') return true;
    } catch {
      /* retry below */
    }
    if (Date.now() > deadline) {
      logger.error(
        `FATAL: Redis at ${REDIS_URL.replace(/:[^:@/]*@/, ':***@')} did not answer PING ` +
          `within ${timeoutMs}ms. Refusing to start — see src/config/redis.js for why ` +
          'there is no in-memory fallback.',
      );
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

// Captured before we shadow it below — `module.exports` IS the client, so
// assigning our wrapper to `.duplicate` would otherwise make it call itself.
const nativeDuplicate = client.duplicate.bind(client);

/**
 * A second connection — pub/sub and the Socket.IO adapter each need their own.
 *
 * `maxRetriesPerRequest: null` is deliberate and is what Socket.IO's own docs
 * require. A subscriber connection must never give up on a command: with a
 * retry limit, a few seconds of network wobble makes ioredis reject every
 * queued command with `MaxRetriesPerRequestError`, and because the adapter
 * does not attach catch handlers those surface as unhandled rejections and
 * take the process down — losing every connected rider and driver over a blip
 * that would have healed on its own.
 */
function duplicate() {
  const dup = nativeDuplicate({ maxRetriesPerRequest: null, enableOfflineQueue: true });
  dup.on('error', (err) => logger.error(`Redis (duplicate) error: ${err.message}`));
  return dup;
}

module.exports = client;
module.exports.assertReady = assertReady;
module.exports.duplicate = duplicate;
module.exports.hasConnected = () => everConnected;
