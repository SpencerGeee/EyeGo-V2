'use strict';

const prisma = require('../config/database');
const redis = require('../config/redis');
const settings = require('../config/settings');
const logger = require('../utils/logger');
const { AppError } = require('../utils/errors');

/**
 * ── DRIVER FATIGUE CAP ───────────────────────────────────────────────────────
 *
 * Uber's rule, because tired drivers crash: after DRIVER_MAX_ONLINE_HOURS (12)
 * of online time without a real break, a driver must go offline for
 * DRIVER_REQUIRED_BREAK_HOURS (6). A trip in progress is always finished first.
 *
 * The streak is read off OnlineSession, walking back from the latest session:
 * sessions separated by less than a full break count as one stretch. A stale
 * session left open by a killed app ends where the next one began.
 *
 *   - goOnline refuses a driver whose stretch is used up (FATIGUE_BREAK), with
 *     the time they can come back;
 *   - the 5-minute sweep warns once an hour before the cap, and takes a capped
 *     driver offline the moment they are not on a trip.
 */
const HOUR = 3_600_000;
const BUSY = ['DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'IN_PROGRESS'];

function limits() {
  const maxH = Number(settings.get('DRIVER_MAX_ONLINE_HOURS') ?? 12);
  const breakH = Number(settings.get('DRIVER_REQUIRED_BREAK_HOURS') ?? 6);
  return { maxMs: maxH * HOUR, breakMs: Math.max(1, breakH) * HOUR, off: !(maxH > 0) };
}

/** Pure: the current stretch from sessions sorted newest first. */
function streakOf(sessions, now, breakMs) {
  let streakMs = 0;
  let lastEnd = null;
  let nextStart = null; // the session after this one (newer)
  for (const s of sessions) {
    const start = new Date(s.startTime).getTime();
    // Open and newest = still online; open and older = died before the next began.
    const end = s.endTime ? new Date(s.endTime).getTime() : (nextStart ?? now.getTime());
    if (lastEnd == null) lastEnd = end;
    if (nextStart != null && nextStart - end >= breakMs) break; // a real break: the stretch starts after it
    streakMs += Math.max(0, Math.min(end, nextStart ?? end) - start);
    nextStart = start;
  }
  // Offline for a full break since the last session: rested, the stretch is over.
  if (lastEnd != null && now.getTime() - lastEnd >= breakMs) streakMs = 0;
  return { streakMs, lastEnd };
}

async function fatigueOf(driverId, now = new Date()) {
  const { maxMs, breakMs, off } = limits();
  if (off) return null;
  const sessions = await prisma.onlineSession.findMany({
    where: { driverId, startTime: { gte: new Date(now.getTime() - 3 * (maxMs + breakMs)) } },
    select: { startTime: true, endTime: true },
    orderBy: { startTime: 'desc' },
    take: 200,
  });
  const { streakMs, lastEnd } = streakOf(sessions, now, breakMs);
  const capped = streakMs >= maxMs;
  const restedAt = capped && lastEnd != null ? new Date(lastEnd + breakMs) : null;
  return { streakMs, maxMs, capped, restedAt: restedAt && restedAt > now ? restedAt : null };
}

/** The go-online gate. */
async function assertRested(driverId, now = new Date()) {
  const f = await fatigueOf(driverId, now);
  if (!f?.restedAt) return;
  const at = f.restedAt.toISOString().slice(11, 16); // Ghana is UTC+0
  const err = new AppError(
    `You've been online ${Math.round(f.maxMs / HOUR)} hours. Take a break — you can go online again at ${at}.`,
    403,
    'FATIGUE_BREAK',
  );
  err.details = { restedAt: f.restedAt.toISOString() };
  throw err;
}

/** Every 5 min: warn an hour before the cap; take capped, idle drivers offline. */
async function runFatigueSweep(now = new Date()) {
  const { maxMs, off } = limits();
  if (off) return { warned: 0, rested: 0 };
  const push = require('./push.service');
  const online = await prisma.driver.findMany({ where: { isOnline: true }, select: { id: true, fcmToken: true }, take: 2000 });
  let warned = 0;
  let rested = 0;
  for (const d of online) {
    const f = await fatigueOf(d.id, now);
    if (!f) continue;
    if (f.capped) {
      const busy = await prisma.trip.count({ where: { driverId: d.id, status: { in: BUSY } } });
      if (busy) continue; // finish the trip first; the next sweep catches them
      await require('../modules/drivers/drivers.service').goOffline(d.id);
      const restedAt = f.restedAt ?? new Date(now.getTime() + limits().breakMs);
      push
        .sendPush(d.fcmToken, 'Time for a break', `You've been online ${Math.round(maxMs / HOUR)} hours, so we've taken you offline. You can go online again at ${restedAt.toISOString().slice(11, 16)}.`, { type: 'FATIGUE_BREAK' })
        .catch(() => {});
      rested += 1;
    } else if (f.streakMs >= maxMs - HOUR) {
      const fresh = await redis.set(`fatigue:warn:${d.id}`, '1', 'EX', 2 * 3600, 'NX').catch(() => null);
      if (!fresh) continue;
      push
        .sendPush(d.fcmToken, 'One hour left before a break', `You've been online ${Math.floor(f.streakMs / HOUR)} hours. After ${Math.round(maxMs / HOUR)} you'll need a rest.`, { type: 'FATIGUE_WARNING' })
        .catch(() => {});
      warned += 1;
    }
  }
  if (warned || rested) logger.info(`[fatigue] warned ${warned}, rested ${rested}`);
  return { warned, rested };
}

module.exports = { streakOf, fatigueOf, assertRested, runFatigueSweep };
