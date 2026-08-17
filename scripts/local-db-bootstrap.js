#!/usr/bin/env node
'use strict';

/**
 * Bring the local Postgres + Redis up and make them usable, in one command.
 *
 *   node scripts/local-db-bootstrap.js              # schema only (empty database)
 *   node scripts/local-db-bootstrap.js --from-neon  # schema + a copy of Neon's data
 *   node scripts/local-db-bootstrap.js --seed       # schema + prisma/seed.js
 *
 * WHY --from-neon IS USUALLY WHAT YOU WANT. A fresh database has no driver
 * account, no approved vehicle, no rider, no wallet balance and no
 * PlatformSettings rows. "Start testing right away" is not possible on one —
 * you would spend an hour re-registering a driver and waiting for approval
 * before you could send a single trip request. Copying the data down means the
 * same accounts you have been testing with keep working, at loopback speed.
 *
 * NOTHING HERE TOUCHES NEON. The dump is read-only; your hosted database is
 * left exactly as it is, so switching back is a matter of restoring three lines
 * in eyego-api/.env.
 *
 * No local Postgres client is needed — `pg_dump` and `pg_restore` are run
 * inside the postgres:18 container, which is the only place a matching client
 * version is guaranteed to exist.
 */

const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const API = path.join(ROOT, 'eyego-api');
const ENV_DOCKER = path.join(ROOT, '.env.docker');
const API_ENV = path.join(API, '.env');
const BACKUP_DIR = path.join(ROOT, 'backups');

const args = new Set(process.argv.slice(2));
const FROM_NEON = args.has('--from-neon');
const SEED = args.has('--seed');

const log = (msg) => console.log(`\n\x1b[36m▸ ${msg}\x1b[0m`);
const ok = (msg) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const warn = (msg) => console.log(`  \x1b[33m!\x1b[0m ${msg}`);

function die(msg) {
  console.error(`\n\x1b[31m✗ ${msg}\x1b[0m\n`);
  process.exit(1);
}

function sh(cmd, opts = {}) {
  return execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });
}

function shQuiet(cmd, opts = {}) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], cwd: ROOT, ...opts })
    .toString()
    .trim();
}

/**
 * Block for `ms`, without a shell.
 *
 * `timeout /t` on Windows insists on a real console for stdin, and execSync
 * always redirects it — the command exits 1 with "Input redirection is not
 * supported" before it ever sleeps. Atomics.wait needs no subprocess at all,
 * and behaves the same on every platform.
 */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Read a KEY=VALUE file without pulling in dotenv. */
function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

// ── 1. Preconditions ────────────────────────────────────────────────────────

log('Checking Docker');
try {
  shQuiet('docker --version');
} catch {
  die('Docker is not installed, or not on PATH. Install Docker Desktop, then reopen this terminal.');
}
try {
  shQuiet('docker info');
} catch {
  die('Docker is installed but not running. Start Docker Desktop and wait for the whale icon to settle, then re-run.');
}
ok('Docker is running');

if (!fs.existsSync(ENV_DOCKER)) {
  die('.env.docker is missing. Copy .env.docker.example to .env.docker and set the two passwords.');
}
const dockerEnv = readEnvFile(ENV_DOCKER);
const PGUSER = dockerEnv.POSTGRES_USER || 'eyego';
const PGDB = dockerEnv.POSTGRES_DB || 'eyego';
const PGPASS = dockerEnv.POSTGRES_PASSWORD;
const REDISPASS = dockerEnv.REDIS_PASSWORD;
const PGPORT = dockerEnv.POSTGRES_PORT || '5432';
const REDISPORT = dockerEnv.REDIS_PORT || '6379';
if (!PGPASS || PGPASS.startsWith('change-me')) die('Set a real POSTGRES_PASSWORD in .env.docker.');
if (!REDISPASS || REDISPASS.startsWith('change-me')) die('Set a real REDIS_PASSWORD in .env.docker.');

// ── 2. Containers ───────────────────────────────────────────────────────────

log('Starting Postgres and Redis');
sh('docker compose --env-file .env.docker up -d');

log('Waiting for both to report healthy');
const deadline = Date.now() + 120_000;
for (;;) {
  let pg = '';
  let rd = '';
  try {
    pg = shQuiet('docker inspect -f "{{.State.Health.Status}}" eyego-postgres');
    rd = shQuiet('docker inspect -f "{{.State.Health.Status}}" eyego-redis');
  } catch {
    /* containers not up yet */
  }
  if (pg === 'healthy' && rd === 'healthy') break;
  if (Date.now() > deadline) {
    die('Containers did not become healthy in 2 minutes. Check `docker compose logs`.');
  }
  sleep(2000);
}
ok('Postgres and Redis are healthy');

// ── 3. The API's .env ───────────────────────────────────────────────────────

const LOCAL_DB = `postgresql://${PGUSER}:${PGPASS}@127.0.0.1:${PGPORT}/${PGDB}`;
const LOCAL_REDIS = `redis://default:${REDISPASS}@127.0.0.1:${REDISPORT}`;

log('Pointing eyego-api/.env at the local containers');
if (!fs.existsSync(API_ENV)) {
  die('eyego-api/.env not found. Nothing to rewrite — create it from .env.example first.');
}

const original = fs.readFileSync(API_ENV, 'utf8');
const neonUrls = {};
for (const key of ['DATABASE_URL', 'DIRECT_URL', 'REDIS_URL']) {
  const m = new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, 'm').exec(original);
  if (m) neonUrls[key] = m[1].trim().replace(/^["']|["']$/g, '');
}

if (neonUrls.DATABASE_URL && neonUrls.DATABASE_URL.includes('127.0.0.1')) {
  ok('Already pointing at localhost — leaving eyego-api/.env alone');
} else {
  // Keep a copy. This file holds every secret the API has; it is not something
  // to rewrite without a way back.
  const backup = `${API_ENV}.neon-backup`;
  if (!fs.existsSync(backup)) {
    fs.writeFileSync(backup, original);
    ok(`Backed up your current .env to ${path.relative(ROOT, backup)}`);
  }

  // Comment the old values out rather than deleting them — switching back to
  // Neon should be uncommenting three lines, not finding them again.
  let next = original;
  for (const key of ['DATABASE_URL', 'DIRECT_URL', 'REDIS_URL']) {
    next = next.replace(new RegExp(`^(\\s*${key}\\s*=.*)$`, 'gm'), '# [was hosted] $1');
  }
  next +=
    `\n\n# ── Local containers (docker-compose.yml) ────────────────────────────\n` +
    `# Same value for both: there is no pooler in front of this Postgres, which\n` +
    `# is exactly the case prisma/schema.prisma describes for DIRECT_URL.\n` +
    `DATABASE_URL="${LOCAL_DB}"\n` +
    `DIRECT_URL="${LOCAL_DB}"\n` +
    `# redis:// not rediss:// — nothing to encrypt on loopback.\n` +
    `REDIS_URL="${LOCAL_REDIS}"\n`;
  fs.writeFileSync(API_ENV, next);
  ok('Rewrote DATABASE_URL, DIRECT_URL and REDIS_URL (old values kept, commented)');
}

// ── 4. Schema ───────────────────────────────────────────────────────────────

log('Creating the schema from Prisma migrations');
sh('node node_modules/prisma/build/index.js migrate deploy', { cwd: API });
sh('node node_modules/prisma/build/index.js generate', { cwd: API });
ok('Schema is up to date');

// ── 5. Data ─────────────────────────────────────────────────────────────────

if (FROM_NEON) {
  /**
   * Dump through the DIRECT endpoint, never the pooled one.
   *
   * Neon's pooler is transaction-mode, and pg_dump needs session-level state it
   * cannot provide — the same constraint prisma/schema.prisma documents for
   * migrations. Your .env already carries the right host in DIRECT_URL, so use
   * that in preference to deriving it; stripping "-pooler" from DATABASE_URL
   * happens to produce the same string today but is an assumption about their
   * hostname format, and this is a fallback rather than the first choice.
   */
  const source = neonUrls.DIRECT_URL || neonUrls.DATABASE_URL;
  if (!source || source.includes('127.0.0.1')) {
    die('Could not find your hosted DATABASE_URL/DIRECT_URL to copy from. It should be in eyego-api/.env.neon-backup.');
  }
  const directSource = source.replace('-pooler', '');

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dumpName = `neon-${stamp}.dump`;

  log('Dumping the hosted database (read-only — Neon is not modified)');
  // Written to a mounted volume rather than piped through stdout: this is a
  // binary custom-format dump, and Windows shells corrupt binary pipes.
  execFileSync(
    'docker',
    [
      'run', '--rm',
      '-v', `${BACKUP_DIR}:/backups`,
      'postgres:18-alpine',
      'pg_dump', '--no-owner', '--no-privileges', '--format=custom',
      '-f', `/backups/${dumpName}`,
      directSource,
    ],
    { stdio: 'inherit' },
  );
  ok(`Dumped to ${path.relative(ROOT, path.join(BACKUP_DIR, dumpName))}`);

  log('Restoring the data into the local database');
  sh(`docker compose --env-file .env.docker cp "${path.join(BACKUP_DIR, dumpName)}" postgres:/tmp/restore.dump`);
  // --data-only: Prisma already built the schema above, and its migration
  // history stays authoritative that way. --disable-triggers so foreign keys do
  // not fight the insert order.
  try {
    sh(
      `docker compose --env-file .env.docker exec -T postgres ` +
        `pg_restore --data-only --disable-triggers --no-owner --exit-on-error ` +
        `-U ${PGUSER} -d ${PGDB} /tmp/restore.dump`,
    );
  } catch {
    warn('pg_restore reported errors. Row counts below will tell you whether it mattered.');
  }
  ok('Data restored');
} else if (SEED) {
  log('Seeding');
  sh('node prisma/seed.js', { cwd: API });
  ok('Seeded');
} else {
  warn('Empty database — no driver, no rider, no vehicle, no platform settings.');
  warn('Re-run with --from-neon to copy your existing test data, or --seed for fresh fixtures.');
}

// ── 6. Prove it ─────────────────────────────────────────────────────────────

log('Verifying');
const counts = shQuiet(
  `docker compose --env-file .env.docker exec -T postgres psql -U ${PGUSER} -d ${PGDB} -At -c ` +
    `"SELECT (SELECT count(*) FROM \\"User\\")||' users, '||(SELECT count(*) FROM \\"Driver\\")||' drivers, '||(SELECT count(*) FROM \\"Trip\\")||' trips, '||(SELECT count(*) FROM \\"Booking\\")||' bookings'"`,
);
ok(counts);

log('Measuring the round trip that started all this');
const probe = `
const p = require('./src/config/database');
(async () => {
  await p.$queryRaw\`SELECT 1\`;
  let t = Date.now();
  for (let i = 0; i < 20; i++) await p.$queryRaw\`SELECT 1\`;
  const simple = (Date.now() - t) / 20;
  t = Date.now();
  for (let i = 0; i < 5; i++)
    await p.$transaction(async (tx) => {
      for (let j = 0; j < 4; j++) await tx.$queryRaw\`SELECT 1\`;
    });
  const txn = (Date.now() - t) / 5;
  console.log('  query: ' + simple.toFixed(2) + ' ms   (Neon was 281 ms)');
  console.log('  4-query transaction: ' + txn.toFixed(2) + ' ms   (Neon was 1557 ms)');
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
`;
fs.writeFileSync(path.join(API, '.probe.tmp.js'), probe);
try {
  sh('node .probe.tmp.js', { cwd: API });
} finally {
  fs.unlinkSync(path.join(API, '.probe.tmp.js'));
}

console.log(`
\x1b[32mReady.\x1b[0m

  Start the API:      cd eyego-api && npm run dev
  Inspect the data:   cd eyego-api && npm run db:studio

  Back to Neon:       restore eyego-api/.env.neon-backup over eyego-api/.env
  Stop the databases: docker compose --env-file .env.docker down
  Wipe them:          docker compose --env-file .env.docker down -v   (deletes all local data)
`);
