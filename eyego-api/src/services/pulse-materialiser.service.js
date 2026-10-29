'use strict';

/**
 * PULSE SCHEDULES BECOME TRIPS (B4).
 *
 * Admin "Pulse schedules" were display-only: nothing ever turned a row into a
 * bus a rider could book. Every few minutes this publishes the next departures
 * of each active schedule that names a driver, through the ordinary
 * `createTrip` (so corridor price pinning, boarding code, vehicle checks and
 * every other publish rule apply). Departures are dedup'd on
 * (pulseScheduleId, departureTime), so a restart or a second instance never
 * publishes one twice.
 */
const prisma = require('../config/database');
const logger = require('../utils/logger');

const DAY_CODES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
// How far ahead a departure is published, so riders can find and book it.
const HORIZON_MS = 3 * 60 * 60 * 1000;

/** Days a schedule runs, as JS getUTCDay() numbers. Reads "MON,TUE" and legacy "[1,2]". */
function scheduleDays(raw) {
  const out = new Set();
  const text = String(raw ?? '').trim();
  if (text.startsWith('[')) {
    try {
      for (const d of JSON.parse(text)) if (Number.isInteger(d) && d >= 0 && d <= 6) out.add(d);
    } catch { /* unreadable → runs on no day */ }
    return out;
  }
  for (const code of text.split(',')) {
    const i = DAY_CODES.indexOf(code.trim().toUpperCase());
    if (i >= 0) out.add(i);
  }
  return out;
}

/**
 * The departures of one schedule in (now, now + horizon].
 * ponytail: Ghana is UTC+0 all year, so "06:30" is 06:30Z — add a zone column
 * if the platform ever runs outside GMT.
 */
function departuresWithin(schedule, now = new Date(), horizonMs = HORIZON_MS) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(schedule.departureTime ?? ''));
  if (!m) return [];
  const days = scheduleDays(schedule.daysOfWeek);
  const out = [];
  for (let offset = 0; offset <= 1; offset += 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset, Number(m[1]), Number(m[2])));
    if (d > now && d.getTime() - now.getTime() <= horizonMs && days.has(d.getUTCDay())) out.push(d);
  }
  return out;
}

async function materialisePulseSchedules(now = new Date()) {
  const schedules = await prisma.pulseSchedule.findMany({
    where: { isActive: true, driverId: { not: null } },
    select: { id: true, routeId: true, tier: true, departureTime: true, daysOfWeek: true, maxSeats: true, driverId: true },
  });
  const trips = require('../modules/trips/trips.service');
  let published = 0;
  for (const s of schedules) {
    for (const dep of departuresWithin(s, now)) {
      const exists = await prisma.trip.findFirst({ where: { pulseScheduleId: s.id, departureTime: dep }, select: { id: true } });
      if (exists) continue;
      try {
        await trips.createTrip(s.driverId, {
          routeId: s.routeId,
          departureTime: dep.toISOString(),
          tier: s.tier,
          availableSeats: s.maxSeats,
          pulseScheduleId: s.id,
        });
        published += 1;
      } catch (err) {
        // A driver without an active vehicle (or any other publish rule) skips
        // this departure only; the rest of the schedule is unaffected.
        logger.warn(`[pulse] ${s.id} @ ${dep.toISOString()} not published: ${err?.message ?? err}`);
      }
    }
  }
  return { published };
}

module.exports = { scheduleDays, departuresWithin, materialisePulseSchedules };
