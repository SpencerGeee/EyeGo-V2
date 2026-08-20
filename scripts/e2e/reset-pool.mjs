/**
 * Drain the local dispatch pool of drivers this harness left behind.
 *
 * Every run creates a driver, puts it in the Redis geo-set, and — before the
 * suites learned to sign out in `finally` — left it there. The cascade offers
 * to each candidate in turn with a ~20 s window apiece, so a box that has run
 * the suite a dozen times makes the next run wait several minutes for its own
 * driver's turn. That reads as "dispatch is broken" and is not.
 *
 * LOCAL ONLY. It empties the whole pool, so it refuses anything that is not
 * plainly a local Redis.
 *
 *   node scripts/e2e/reset-pool.mjs
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

// `ioredis` lives in the API's own node_modules, not the workspace root.
const require = createRequire(new URL('../../eyego-api/package.json', import.meta.url));
const Redis = require('ioredis');

const envText = readFileSync(new URL('../../eyego-api/.env', import.meta.url), 'utf8');
const REDIS_URL =
  (envText.match(/^REDIS_URL=(.*)$/m)?.[1] ?? 'redis://127.0.0.1:6379').trim().replace(/^["']|["']$/g, '');

if (!/127\.0\.0\.1|localhost/.test(REDIS_URL)) {
  console.error(`Refusing to drain ${REDIS_URL} — this is a local-development tool.`);
  process.exit(1);
}

const redis = new Redis(REDIS_URL);
const GEO_KEY = 'supply:drivers:geo';

const ids = await redis.zrange(GEO_KEY, 0, -1);
if (ids.length === 0) {
  console.log('pool already empty');
} else {
  const pipeline = redis.pipeline();
  pipeline.del(GEO_KEY);
  for (const id of ids) {
    pipeline.del(`supply:presence:${id}`);
    pipeline.del(`supply:meta:${id}`);
  }
  await pipeline.exec();
  console.log(`drained ${ids.length} driver(s) from the local dispatch pool`);
}

await redis.quit();
