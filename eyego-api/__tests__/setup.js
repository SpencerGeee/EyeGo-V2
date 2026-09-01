'use strict';

// Jest global setup. Keep the test environment quiet and deterministic.
// Referenced by package.json -> jest.setupFilesAfterFramework.

/**
 * Load .env before anything under test requires config/redis or config/env.
 *
 * Without this, `npm test` could only ever run the pure-unit suites: the moment
 * a test reached a module that requires `config/redis` — which is most of them,
 * transitively, because settings requires it and the fare calculator requires
 * settings — Redis found no REDIS_URL and called `process.exit(1)`, killing the
 * worker mid-run. The failure looked like a broken test and was a missing
 * variable.
 *
 * The integration suites still need the docker stack up; this only makes sure
 * they are told where it is.
 */
require('dotenv').config();

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

// Default test timeout — most unit tests are fast; integration tests override locally.
jest.setTimeout(15000);
