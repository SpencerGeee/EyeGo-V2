'use strict';

const prisma = require('../config/database');
const logger = require('../utils/logger');

/**
 * Durable timers — the outbox / "LATE table" pattern.
 *
 * WHAT THIS REPLACES. Dispatch used to arm its offer timeouts with
 * `setTimeout` against a module-level `Map`. Two consequences, both fatal:
 *
 *   1. Every deploy, crash or restart silently dropped every in-flight timer.
 *      A rider mid-search was left on a spinner with no server-side actor
 *      alive to advance or fail their cascade — forever.
 *   2. A second API instance was impossible. Each process would run its own
 *      copy of the same cascade for the same ride.
 *
 * HOW THIS FIXES IT. A timer is a row. It is written INSIDE the same
 * transaction as the state change that arms it, so a timer can never exist
 * for a transition that rolled back, and a transition can never commit
 * without its follow-up being durable. A pool of workers claims due rows with
 * `FOR UPDATE SKIP LOCKED`, so N instances share the work without ever
 * double-running a task.
 *
 * IDEMPOTENCY. `@@unique([type, dedupeKey])` is the natural key. Arming
 * "offer timeout for trip X attempt 3" twice is a no-op rather than two
 * firings. Cancelling is by the same key.
 */

/** How long a claimed-but-unfinished task may sit before another worker may retake it. */
const CLAIM_LEASE_MS = 60_000;
/** Attempts before a task is parked as FAILED rather than retried forever. */
const MAX_ATTEMPTS = 5;

/** Registered handlers, keyed by task type. See registerHandler(). */
const handlers = new Map();

/**
 * Register the function that runs when a task of `type` comes due.
 * Handlers must be idempotent: at-least-once delivery is the contract.
 *
 * @param {string} type
 * @param {(task: object) => Promise<void>} handler
 */
function registerHandler(type, handler) {
  handlers.set(type, handler);
}

/**
 * Arm a timer inside an existing transaction.
 *
 * ALWAYS prefer this over the standalone `enqueue` when the timer belongs to a
 * state change — passing the same `tx` is what makes "commit the transition and
 * arm its timer" a single atomic fact.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{type: string, dedupeKey: string, runAt: Date, tripId?: string|null, payload?: object}} spec
 */
async function enqueueTx(tx, { type, dedupeKey, runAt, tripId = null, payload = {} }) {
  return tx.scheduledTask.upsert({
    where: { type_dedupeKey: { type, dedupeKey } },
    create: { type, dedupeKey, runAt, tripId, payload, status: 'PENDING' },
    // Re-arming an existing key resets it rather than creating a duplicate:
    // "the offer for this trip now expires at T" is a single fact.
    update: { runAt, tripId, payload, status: 'PENDING', claimedAt: null, claimedBy: null, attempts: 0 },
  });
}

/**
 * Arm a timer outside a transaction. Use only when nothing else is being
 * written. Wakes the scheduler so the new deadline is honoured to the second
 * rather than on the next idle cycle.
 */
async function enqueue(spec) {
  const row = await enqueueTx(prisma, spec);
  wake();
  return row;
}

/**
 * Disarm a timer. Safe to call for a key that was never armed.
 * Cancelled rather than deleted so the history of what was armed survives.
 */
async function cancelTx(tx, type, dedupeKey) {
  const res = await tx.scheduledTask.updateMany({
    where: { type, dedupeKey, status: { in: ['PENDING', 'CLAIMED'] } },
    data: { status: 'CANCELLED' },
  });
  return res.count > 0;
}

async function cancel(type, dedupeKey) {
  return cancelTx(prisma, type, dedupeKey);
}

/** Disarm every live timer belonging to a trip — used when a trip goes terminal. */
async function cancelAllForTripTx(tx, tripId) {
  const res = await tx.scheduledTask.updateMany({
    where: { tripId, status: { in: ['PENDING', 'CLAIMED'] } },
    data: { status: 'CANCELLED' },
  });
  return res.count;
}

/**
 * Claim up to `limit` due tasks for this worker.
 *
 * `SKIP LOCKED` is the whole point: two workers running this query at the same
 * instant get disjoint sets instead of one blocking on the other, so adding
 * instances adds throughput. Raw SQL because Prisma has no way to express it.
 */
async function claimDue(workerId, limit) {
  const leaseCutoff = new Date(Date.now() - CLAIM_LEASE_MS);
  const rows = await prisma.$queryRaw`
    UPDATE "ScheduledTask" t
       SET status      = 'CLAIMED',
           "claimedAt" = NOW(),
           "claimedBy" = ${workerId},
           attempts    = t.attempts + 1
     WHERE t.id IN (
       SELECT s.id
         FROM "ScheduledTask" s
        WHERE s."runAt" <= NOW()
          AND ( s.status = 'PENDING'
             OR (s.status = 'CLAIMED' AND s."claimedAt" < ${leaseCutoff}) )
        ORDER BY s."runAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
     )
    RETURNING t.id, t.type, t."dedupeKey", t."tripId", t.payload, t.attempts;
  `;
  return rows;
}

async function markDone(id) {
  await prisma.scheduledTask.update({ where: { id }, data: { status: 'DONE' } });
}

async function markFailed(id, err, attempts) {
  const exhausted = attempts >= MAX_ATTEMPTS;
  await prisma.scheduledTask.update({
    where: { id },
    data: {
      // Not exhausted → back to PENDING with exponential backoff so a
      // transient failure (Redis blip, Mapbox 503) retries instead of
      // silently disappearing the way the old setTimeout did.
      status: exhausted ? 'FAILED' : 'PENDING',
      claimedAt: null,
      claimedBy: null,
      runAt: exhausted ? undefined : new Date(Date.now() + Math.min(2 ** attempts, 60) * 1000),
      lastError: String(err && err.message ? err.message : err).slice(0, 500),
    },
  });
  if (exhausted) {
    logger.error(`ScheduledTask ${id} exhausted after ${attempts} attempts: ${err?.message}`);
  }
}

/** Run one poll cycle. Returns how many tasks were executed. */
async function tick(workerId, limit = 25) {
  let tasks;
  try {
    tasks = await claimDue(workerId, limit);
  } catch (err) {
    logger.error(`ScheduledTask claim failed: ${err.message}`);
    return 0;
  }

  let ran = 0;
  for (const task of tasks) {
    const handler = handlers.get(task.type);
    if (!handler) {
      logger.warn(`ScheduledTask ${task.id}: no handler for type ${task.type}`);
      await markFailed(task.id, new Error(`no handler for ${task.type}`), MAX_ATTEMPTS);
      continue;
    }
    try {
      await handler(task);
      await markDone(task.id);
      ran += 1;
    } catch (err) {
      await markFailed(task.id, err, task.attempts);
    }
  }
  return ran;
}

/** When is the next task actually due? Cheap: one row off the [status, runAt] index. */
async function nextDueAt() {
  const row = await prisma.scheduledTask.findFirst({
    where: { status: 'PENDING' },
    orderBy: { runAt: 'asc' },
    select: { runAt: true },
  });
  return row?.runAt ?? null;
}

let running = false;
let wakeUp = null;

/**
 * Wake the scheduler early.
 *
 * Called right after arming a timer, so a 20-second offer timeout is scheduled
 * to the second rather than waiting out whatever sleep the loop happened to be
 * in. Safe to call when the loop is not sleeping.
 */
function wake() {
  if (wakeUp) wakeUp();
}

/** Sleep, but interruptibly. */
function sleep(ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      wakeUp = null;
      resolve();
    }, ms);
    if (t.unref) t.unref();
    wakeUp = () => {
      clearTimeout(t);
      wakeUp = null;
      resolve();
    };
  });
}

/**
 * Start the worker.
 *
 * SLEEP UNTIL DUE, don't poll. The first version ran `tick()` on a fixed 1s
 * `setInterval`, which is the obvious thing and is wrong for two reasons:
 *
 *   - It issues ~86,400 claim queries a day whether or not anything is
 *     scheduled. Against a serverless Postgres that bills compute-time and
 *     scales to zero when idle (Neon, Aurora Serverless), a once-a-second
 *     query means the database NEVER idles — it quietly burns a monthly
 *     allowance in about a week on a system carrying no traffic at all.
 *   - It is pure latency noise on every request from a region far from the
 *     database.
 *
 * Instead: ask when the next task is due (one indexed row), sleep until then,
 * and let `wake()` cut the sleep short when something new is armed. Idle cost
 * drops to one cheap query per `idleMs`, and timing gets *more* precise rather
 * than less, because a task due in 300ms is run in 300ms instead of on the
 * next tick boundary.
 *
 * @param {object}  opts
 * @param {number}  opts.minSleepMs  floor, so a burst cannot spin the loop hot
 * @param {number}  opts.idleMs      cap, bounding how long a task armed by
 *                                   ANOTHER instance can sit unnoticed
 */
function startWorker({
  minSleepMs = 100,
  idleMs = 15_000,
  workerId = `w-${process.pid}`,
  limit = 25,
} = {}) {
  if (running) return;
  running = true;

  (async function loop() {
    while (running) {
      let ran = 0;
      try {
        ran = await tick(workerId, limit);
      } catch (err) {
        logger.warn(`ScheduledTask tick failed: ${err.message}`);
      }

      // Work found means there may be more behind it — go straight round again
      // rather than sleeping with a backlog.
      if (ran > 0) continue;

      let waitMs = idleMs;
      try {
        const due = await nextDueAt();
        if (due) waitMs = Math.min(Math.max(due.getTime() - Date.now(), minSleepMs), idleMs);
      } catch {
        // Can't see the queue — back off rather than hammering a sick database.
      }
      await sleep(waitMs);
    }
  })();

  logger.info(`ScheduledTask worker started (${workerId}, sleeps until due, idle cap ${idleMs}ms)`);
}

function stopWorker() {
  running = false;
  wake();
}

module.exports = {
  registerHandler,
  enqueue,
  enqueueTx,
  wake,
  nextDueAt,
  cancel,
  cancelTx,
  cancelAllForTripTx,
  tick,
  startWorker,
  stopWorker,
  MAX_ATTEMPTS,
};
