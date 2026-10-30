'use strict';

/**
 * Demand by place and hour, and operator-priced corridors (client 2026-10-29,
 * item 9 + D5). "Start on the highest-demand corridors — Madina ↔ La Paz,
 * Kasoa → Madina — and work out where demand peaks at stops. Admin needs to see
 * this." Grouping is done in SQL; nothing is summed in JS.
 */
const prisma = require('../../config/database');
const { ok, created } = require('../../utils/response');
const { AppError, NotFoundError } = require('../../utils/errors');

const clampDays = (v) => Math.min(90, Math.max(1, parseInt(v, 10) || 7));

/**
 * GET /admin/demand?days=7
 *   cells     — searches that found NO bus, by ~1 km origin cell × hour of week
 *   stops     — seats booked by boarding stop (what is already selling)
 *   corridors — seats booked per corridor-priced trip corridor
 */
async function getDemand(req, res) {
  const days = clampDays(req.query.days);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const [cells, stops, corridors] = await Promise.all([
    prisma.$queryRaw`
      SELECT ROUND("originLat"::numeric, 2)::float AS lat, ROUND("originLng"::numeric, 2)::float AS lng,
             ROUND("destLat"::numeric, 2)::float AS "destLat", ROUND("destLng"::numeric, 2)::float AS "destLng",
             "hourOfWeek" AS "hourOfWeek", COUNT(*)::int AS searches
      FROM "DemandSignal" WHERE "createdAt" >= ${since}
      GROUP BY 1, 2, 3, 4, 5 ORDER BY searches DESC LIMIT 200`,
    prisma.$queryRaw`
      SELECT vs.id, vs.name, vs.landmark, vs.lat, vs.lng, COUNT(b.id)::int AS bookings, COALESCE(SUM(b.seats), 0)::int AS seats
      FROM "Booking" b JOIN "VirtualStop" vs ON vs.id = b."pickupStopId"
      WHERE b."createdAt" >= ${since} AND b.status IN ('CONFIRMED','PAID','BOARDED','COMPLETED')
      GROUP BY vs.id, vs.name, vs.landmark, vs.lat, vs.lng ORDER BY seats DESC LIMIT 100`,
    prisma.$queryRaw`
      SELECT c.id, c.name, c."seatPricePesewas", COUNT(DISTINCT t.id)::int AS trips, COALESCE(SUM(b.seats), 0)::int AS seats
      FROM "Corridor" c
      LEFT JOIN "Trip" t ON t."corridorId" = c.id AND t."createdAt" >= ${since}
      LEFT JOIN "Booking" b ON b."tripId" = t.id AND b.status IN ('CONFIRMED','PAID','BOARDED','COMPLETED')
      GROUP BY c.id ORDER BY seats DESC`,
  ]);
  ok(res, { days, cells, stops, corridors });
}

async function listCorridors(_req, res) {
  ok(res, { corridors: await prisma.corridor.findMany({ orderBy: { name: 'asc' } }) });
}

function corridorData(body, { partial = false } = {}) {
  const out = {};
  const num = (k, min, max) => {
    if (body[k] === undefined) { if (!partial) throw new AppError(`${k} is required`, 400, 'VALIDATION'); return; }
    const v = Number(body[k]);
    if (!Number.isFinite(v) || v < min || v > max) throw new AppError(`${k} is out of range`, 400, 'VALIDATION');
    out[k] = v;
  };
  if (body.name !== undefined || !partial) {
    const name = String(body.name ?? '').trim().slice(0, 80);
    if (!name) throw new AppError('name is required', 400, 'VALIDATION');
    out.name = name;
  }
  num('originLat', -90, 90); num('originLng', -180, 180); num('destLat', -90, 90); num('destLng', -180, 180);
  if (body.radiusKm !== undefined) num('radiusKm', 0.2, 20);
  // Cedis at the edge, pesewas inside (money convention).
  if (body.seatPriceGhs !== undefined || !partial) {
    const ghs = Number(body.seatPriceGhs);
    if (!Number.isFinite(ghs) || ghs <= 0 || ghs > 2000) throw new AppError('seatPriceGhs must be a price in cedis', 400, 'VALIDATION');
    out.seatPricePesewas = Math.round(ghs * 100);
  }
  if (body.isActive !== undefined) out.isActive = Boolean(body.isActive);
  return out;
}

async function createCorridor(req, res) {
  created(res, { corridor: await prisma.corridor.create({ data: corridorData(req.body ?? {}) }) }, 'Corridor created');
}

/** Editing a corridor never reprices a trip already published — the price is pinned on the trip. */
async function updateCorridor(req, res) {
  const exists = await prisma.corridor.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!exists) throw new NotFoundError('Corridor');
  const corridor = await prisma.corridor.update({ where: { id: req.params.id }, data: corridorData(req.body ?? {}, { partial: true }) });
  ok(res, { corridor }, 'Corridor updated — new trips use it; published trips keep their price');
}

/** Y2: an operator names a stop's landmark ("after the footbridge"). */
async function updateStop(req, res) {
  const { updateVirtualStop } = require('./admin.service');
  const stop = await updateVirtualStop(req.params.id, { name: req.body?.name, landmark: req.body?.landmark });
  ok(res, { stop }, 'Stop updated');
}

module.exports = { getDemand, listCorridors, createCorridor, updateCorridor, updateStop };
