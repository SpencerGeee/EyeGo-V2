'use strict';

/**
 * "IMPROVE MAPS" — the inbox for what riders know and the geocoder does not.
 *
 * A shop that moved. A road that is one-way now. A gate that is always locked,
 * so the pin drops on the wrong side of a wall. A junction the router keeps
 * sending cars the wrong way round. None of it reaches us today, and the same
 * bad pickup point costs a driver five minutes every single time somebody
 * books it.
 *
 * Yango, Google Maps and Waze all take this feedback in-app for the same
 * reason: the people standing on the street corner are the only ones who can
 * say what is on it.
 *
 * ── ONE TABLE, SIX FORMS ────────────────────────────────────────────────────
 *
 * The six report types share everything that matters operationally — who filed
 * it, where, when, what happened to it — and differ only in the handful of
 * fields each form collects. Six tables would mean six admin queues and six
 * copies of the same status plumbing. So: one row, one `payload` blob, and this
 * file is the only place that knows what belongs in that blob per type.
 *
 * ── WHAT IS AND IS NOT VALIDATED ────────────────────────────────────────────
 *
 * The coordinate is mandatory and is bounded to Ghana. A report with no
 * location is not actionable, and one outside the operating area is either a
 * mistake or noise — both are better refused at the door than triaged by a
 * human later.
 *
 * The free text is NOT interpreted. It is a person describing a street; the
 * moment we start parsing it we are inventing map data rather than collecting
 * evidence. It is length-capped and stored.
 */

const prisma = require('../config/database');
const logger = require('../utils/logger');
const { AppError, NotFoundError } = require('../utils/errors');

/** The six things a rider can tell us. */
const REPORT_TYPES = Object.freeze([
  /** A place that is not on the map at all. */
  'ADD_PLACE',
  /** A place that is on the map but wrong — name, category, hours, closed. */
  'EDIT_PLACE',
  /** The pin is in the wrong spot, or the address text is wrong. */
  'EDIT_ADDRESS',
  /** Something physical worth drawing: an entrance, a barrier, a speed bump. */
  'ADD_OBJECT',
  /** The road itself: closed, one-way, flooded, under construction. */
  'ROAD_ISSUE',
  /** Anything else, in the rider's own words. */
  'COMMENT',
]);

const REPORT_STATUSES = Object.freeze([
  'PENDING',
  'IN_REVIEW',
  'ACCEPTED',
  'REJECTED',
  'DUPLICATE',
]);

/**
 * The extra fields each form collects, and the values they may take.
 *
 * `null` for a type means "no structured payload, the note is the report".
 * Anything not listed here is dropped rather than stored: a client that starts
 * sending a new field must come with a server that knows what to do with it,
 * or the blob becomes a junk drawer nobody can query.
 */
const PAYLOAD_SHAPES = Object.freeze({
  ADD_PLACE: {
    /** Free text — a rider's category, not an ontology. */
    category: { type: 'string', max: 60 },
    /** "Open 9–5", "closed Sundays". Deliberately not parsed into a schedule. */
    hours: { type: 'string', max: 120 },
    phone: { type: 'string', max: 30 },
  },
  EDIT_PLACE: {
    /** What it is called now, if the rider knows. */
    correctName: { type: 'string', max: 120 },
    category: { type: 'string', max: 60 },
    /** PERMANENTLY_CLOSED | TEMPORARILY_CLOSED | MOVED | WRONG_NAME | OTHER */
    issue: { type: 'enum', values: ['PERMANENTLY_CLOSED', 'TEMPORARILY_CLOSED', 'MOVED', 'WRONG_NAME', 'WRONG_CATEGORY', 'OTHER'] },
  },
  EDIT_ADDRESS: {
    correctAddress: { type: 'string', max: 200 },
    /** Where the rider says the pin SHOULD be, when they moved it. */
    correctedLat: { type: 'number' },
    correctedLng: { type: 'number' },
  },
  ADD_OBJECT: {
    /** ENTRANCE | BARRIER | SPEED_BUMP | TRAFFIC_LIGHT | PARKING | STOP | OTHER */
    object: { type: 'enum', values: ['ENTRANCE', 'BARRIER', 'SPEED_BUMP', 'TRAFFIC_LIGHT', 'PARKING', 'STOP', 'PEDESTRIAN_CROSSING', 'OTHER'] },
  },
  ROAD_ISSUE: {
    /** CLOSED | ONE_WAY | WRONG_DIRECTION | FLOODED | CONSTRUCTION | POTHOLE | OTHER */
    issue: { type: 'enum', values: ['CLOSED', 'ONE_WAY', 'WRONG_DIRECTION', 'FLOODED', 'CONSTRUCTION', 'POTHOLE', 'NO_ENTRY', 'OTHER'] },
    /** Whether it is happening right now or is permanent. */
    duration: { type: 'enum', values: ['TEMPORARY', 'PERMANENT', 'UNKNOWN'] },
  },
  COMMENT: null,
});

/** EyeGo operates in Ghana. A report outside it is noise, not data. */
const GHANA_BOUNDS = { minLat: 4.5, maxLat: 11.5, minLng: -3.5, maxLng: 1.5 };

const withinGhana = (lat, lng) =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  lat >= GHANA_BOUNDS.minLat &&
  lat <= GHANA_BOUNDS.maxLat &&
  lng >= GHANA_BOUNDS.minLng &&
  lng <= GHANA_BOUNDS.maxLng;

/**
 * Keep only the fields this type declares, coerced to the declared kind.
 *
 * Returns `null` rather than `{}` for a type with no shape, so the column
 * stays NULL instead of holding an empty object that means the same thing.
 */
function sanitizePayload(type, raw) {
  const shape = PAYLOAD_SHAPES[type];
  if (!shape || !raw || typeof raw !== 'object') return null;

  const out = {};
  for (const [key, spec] of Object.entries(shape)) {
    const value = raw[key];
    if (value == null) continue;
    if (spec.type === 'string') {
      const s = String(value).trim();
      if (s) out[key] = s.slice(0, spec.max);
    } else if (spec.type === 'number') {
      const n = Number(value);
      if (Number.isFinite(n)) out[key] = n;
    } else if (spec.type === 'enum') {
      const s = String(value).trim().toUpperCase();
      if (spec.values.includes(s)) out[key] = s;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** At most this many photos per report — the storage bill is not free. */
const MAX_PHOTOS = 4;

/**
 * ── WHAT COUNTS AS A PHOTO URL ──────────────────────────────────────────────
 *
 * `https://…` is the real answer: a Cloudinary URL the moderation console and
 * the reporter can both open, sixty characters on the row.
 *
 * `data:image/…` is the DEVELOPMENT answer, and it is here reluctantly.
 * `cloudinary.uploadBuffer` degrades to a base64 data URI whenever credentials
 * are absent or `NODE_ENV=development` — that is what makes the avatar and
 * insurance-card uploads work on a laptop with no Cloudinary account, and
 * refusing it here would make photos the one part of this feature that cannot
 * be tested locally.
 *
 * The cost has to be bounded, though. Four phone photos as base64 is several
 * megabytes in one Postgres row, and `listForAdmin` selects whole rows. So a
 * data URI is accepted only up to `MAX_INLINE_PHOTO_BYTES`, and only ever
 * arrives from our own upload endpoint — a client cannot post one directly
 * because `createReport` applies the same rule to whatever it is given.
 */
const MAX_INLINE_PHOTO_BYTES = 1_200_000;

function isUsablePhotoUrl(u) {
  if (typeof u !== 'string') return false;
  if (/^https?:\/\//.test(u)) return u.length <= 2048;
  if (/^data:image\/(jpeg|jpg|png|webp|heic|heif);base64,/i.test(u)) {
    return u.length <= MAX_INLINE_PHOTO_BYTES;
  }
  return false;
}

/**
 * Put one photo somewhere both the reporter and an operator can see it.
 *
 * Returns the URL to store. Uploaded ONE AT A TIME as the reporter picks them,
 * rather than as N parts of the report POST, for three reasons:
 *
 *   - the report body stays small JSON, so a failed upload does not take the
 *     written report with it;
 *   - the reporter finds out immediately that a photo did not go through,
 *     while they are still standing where they can take another;
 *   - it matches every other upload in this product (avatar, insurance card,
 *     driver documents), which all post a single file to their own endpoint.
 *
 * A photo of a sign settles most of these reports in one glance, which is why
 * it is worth a round trip.
 */
async function uploadPhoto(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new AppError('No photo was received.', 400, 'NO_FILE');
  }
  const cloudinary = require('./cloudinary.service');
  const url = await cloudinary.uploadBuffer(buffer, {
    folder: 'eyego/map-reports',
    // Capped rather than left at the original: a report photo is read on a
    // phone and in a console list, and a 12-megapixel original is bytes nobody
    // looks at. `limit` never upscales, so a small photo is untouched.
    transformation: [{ width: 1600, crop: 'limit', quality: 'auto', fetch_format: 'auto' }],
  });

  if (!isUsablePhotoUrl(url)) {
    /**
     * The offline fallback produced something too large to store — a big photo
     * on a machine with no Cloudinary account. Say so rather than silently
     * dropping it at `createReport`, which is where a rider would discover
     * their picture had vanished with no explanation.
     */
    logger.warn('Map report photo could not be stored', {
      configured: cloudinary.hasCloudinary(),
      length: typeof url === 'string' ? url.length : null,
    });
    throw new AppError(
      cloudinary.hasCloudinary()
        ? 'That photo could not be stored. Try a smaller one.'
        : 'Photo storage is not configured on this server. Send the report without a photo.',
      503,
      'PHOTO_STORAGE_UNAVAILABLE',
    );
  }
  return url;
}
/** The rider's own words. Long enough to describe a junction, short enough to read. */
const MAX_NOTE = 1000;

/**
 * How many reports one account may file in a day.
 *
 * Not primarily anti-abuse — a rider who files fifteen genuine corrections is
 * the best thing that can happen to this dataset. It is a cap on a stuck client
 * or a scripted flood turning the moderation queue into something nobody opens.
 */
const DAILY_LIMIT = 30;

async function createReport({ userId = null, driverId = null, type, lat, lng, name, address, note, payload, photos }) {
  const kind = String(type ?? '').trim().toUpperCase();
  if (!REPORT_TYPES.includes(kind)) {
    throw new AppError(`Unknown report type: ${type}`, 400, 'UNKNOWN_REPORT_TYPE');
  }

  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!withinGhana(latitude, longitude)) {
    throw new AppError(
      'That location is outside the area EyeGo covers. Move the pin and try again.',
      400,
      'OUT_OF_BOUNDS',
    );
  }

  /**
   * A COMMENT with no words is not a report.
   *
   * Every other type carries structure that stands on its own — a road issue
   * with a coordinate and an enum is actionable without prose. A comment is
   * nothing but the prose, so an empty one would create a row an operator opens
   * and closes for no reason.
   */
  const body = typeof note === 'string' ? note.trim().slice(0, MAX_NOTE) : null;
  if (kind === 'COMMENT' && !body) {
    throw new AppError('Tell us what you noticed.', 400, 'NOTE_REQUIRED');
  }

  if (userId) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await prisma.mapReport.count({ where: { userId, createdAt: { gte: since } } });
    if (recent >= DAILY_LIMIT) {
      throw new AppError(
        "You've sent a lot of map reports today. Try again tomorrow — we're working through them.",
        429,
        'REPORT_LIMIT',
      );
    }
  }

  const report = await prisma.mapReport.create({
    data: {
      type: kind,
      status: 'PENDING',
      lat: latitude,
      lng: longitude,
      name: typeof name === 'string' ? name.trim().slice(0, 120) || null : null,
      address: typeof address === 'string' ? address.trim().slice(0, 200) || null : null,
      note: body,
      payload: sanitizePayload(kind, payload),
      // Same rule the upload endpoint enforces — see `isUsablePhotoUrl`. A
      // client cannot smuggle an arbitrary string (or a 10 MB data URI) in by
      // posting it here instead of going through the uploader.
      photos: Array.isArray(photos) ? photos.filter(isUsablePhotoUrl).slice(0, MAX_PHOTOS) : [],
      userId,
      driverId,
    },
  });

  logger.info('Map report filed', { id: report.id, type: kind, lat: latitude, lng: longitude, userId, driverId });
  return report;
}

/** Everything this person has told us, newest first. */
async function listMine(userId, { limit = 30, cursor = null } = {}) {
  const rows = await prisma.mapReport.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(Number(limit) || 30, 1), 50),
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    select: {
      id: true, type: true, status: true, lat: true, lng: true,
      name: true, address: true, note: true, photos: true,
      reviewNote: true, reviewedAt: true, createdAt: true,
    },
  });
  return { reports: rows, nextCursor: rows.length > 0 ? rows[rows.length - 1].id : null };
}

/**
 * The moderation queue.
 *
 * Ordered oldest-first within a status on purpose: a queue worked newest-first
 * starves its own tail, and the report that has been waiting longest is the one
 * whose reporter is most likely to conclude that nobody read it.
 */
async function listForAdmin({ status = null, type = null, limit = 50, page = 1 } = {}) {
  const where = {};
  if (status && REPORT_STATUSES.includes(status)) where.status = status;
  if (type && REPORT_TYPES.includes(type)) where.type = type;

  const take = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

  const [reports, total, pending] = await Promise.all([
    prisma.mapReport.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      take,
      skip,
      include: { user: { select: { id: true, name: true, phone: true } } },
    }),
    prisma.mapReport.count({ where }),
    prisma.mapReport.count({ where: { status: 'PENDING' } }),
  ]);

  return { reports, total, page: Math.max(Number(page) || 1, 1), totalPages: Math.ceil(total / take), pendingCount: pending };
}

async function getReport(id) {
  const report = await prisma.mapReport.findUnique({
    where: { id },
    include: { user: { select: { id: true, name: true, phone: true } } },
  });
  if (!report) throw new NotFoundError('Map report');
  return report;
}

/**
 * Move a report through the queue.
 *
 * `reviewNote` is required for a REJECTED or DUPLICATE verdict and optional
 * otherwise: a rejection with no reason is indistinguishable from a report that
 * was never read, both to the rider and to the next operator who opens it.
 */
async function review(id, { status, reviewNote, reviewedById }) {
  const next = String(status ?? '').trim().toUpperCase();
  if (!REPORT_STATUSES.includes(next)) {
    throw new AppError(`Unknown status: ${status}`, 400, 'UNKNOWN_STATUS');
  }
  const note = typeof reviewNote === 'string' ? reviewNote.trim().slice(0, 500) : null;
  if ((next === 'REJECTED' || next === 'DUPLICATE') && !note) {
    throw new AppError('Say why — the reporter and the next reviewer both need it.', 400, 'REVIEW_NOTE_REQUIRED');
  }

  const existing = await prisma.mapReport.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new NotFoundError('Map report');

  return prisma.mapReport.update({
    where: { id },
    data: {
      status: next,
      reviewNote: note,
      reviewedById: reviewedById ?? null,
      // IN_REVIEW is somebody picking it up, not a verdict — the timestamp is
      // when it was DECIDED, so a claim must not stamp it.
      reviewedAt: next === 'IN_REVIEW' || next === 'PENDING' ? null : new Date(),
    },
  });
}

/**
 * Reports near a point, for the map the rider files them on.
 *
 * Shows what has already been said about a corner so the same closed shop is
 * not reported forty times — which is both the cheapest deduplication available
 * and the clearest signal to a rider that these go somewhere.
 *
 * A bounding box rather than a radius: this is a display query over a small
 * table, and a box is one index range scan where a true radius is arithmetic
 * over every row.
 */
async function listNearby({ lat, lng, radiusKm = 2, limit = 50 }) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];

  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.max(0.2, Math.cos((latitude * Math.PI) / 180)));

  return prisma.mapReport.findMany({
    where: {
      lat: { gte: latitude - dLat, lte: latitude + dLat },
      lng: { gte: longitude - dLng, lte: longitude + dLng },
      // A rejected report is not evidence of anything and would only mislead
      // the next rider into thinking the corner is already handled.
      status: { in: ['PENDING', 'IN_REVIEW', 'ACCEPTED'] },
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(Number(limit) || 50, 1), 100),
    select: { id: true, type: true, status: true, lat: true, lng: true, name: true, createdAt: true },
  });
}

module.exports = {
  REPORT_TYPES,
  REPORT_STATUSES,
  PAYLOAD_SHAPES,
  MAX_PHOTOS,
  MAX_NOTE,
  MAX_INLINE_PHOTO_BYTES,
  withinGhana,
  isUsablePhotoUrl,
  uploadPhoto,
  createReport,
  listMine,
  listNearby,
  listForAdmin,
  getReport,
  review,
};
