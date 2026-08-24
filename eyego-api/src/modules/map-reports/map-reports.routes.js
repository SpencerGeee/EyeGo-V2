'use strict';

const { Router } = require('express');
const { body, query, param } = require('express-validator');
const authenticate = require('../../middleware/auth');
const { authenticateDriver } = require('../../middleware/driverAuth');
const validate = require('../../middleware/validate');
// Configured allow-list + 8 MB cap. A bare `multer()` accepts any file of any
// size straight into process memory — see middleware/upload.js.
const { imageUpload } = require('../../middleware/upload');
const service = require('../../services/map-report.service');

/**
 * "Improve maps" — what riders and drivers know that the geocoder does not.
 *
 * See services/map-report.service.js for the model and the validation rules.
 * This file is deliberately thin: the six report types differ only in a payload
 * blob, and letting the router know about them would put the vocabulary in two
 * places.
 *
 * ── AUTH ────────────────────────────────────────────────────────────────────
 * Filing requires an account. Not to gate the feature — a correction is worth
 * having from anybody — but because an anonymous firehose into a moderation
 * queue is a queue nobody opens, and because a rider who files something is
 * entitled to see what happened to it.
 *
 * Drivers get their own mount below rather than sharing the rider one: the two
 * apps carry different tokens and `authenticate` would reject a driver's.
 */

const router = Router();
const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);

/** Both middlewares put the decoded JWT on `req.user` with the id in `userId`. */
const actorId = (req) => req.user.userId;

const ok = (res, data, message) => res.json({ success: true, data, message });

/** The report body, shared by the rider and driver mounts. */
const reportBody = [
  body('type').isString().isIn(service.REPORT_TYPES),
  body('lat').isFloat({ min: -90, max: 90 }),
  body('lng').isFloat({ min: -180, max: 180 }),
  body('name').optional({ nullable: true }).isString().isLength({ max: 120 }),
  body('address').optional({ nullable: true }).isString().isLength({ max: 200 }),
  body('note').optional({ nullable: true }).isString().isLength({ max: service.MAX_NOTE }),
  // Shape-checked in the service against the per-type schema — anything not
  // declared there is dropped rather than stored, so the blob cannot rot into a
  // junk drawer. Only the outer type is worth asserting here.
  body('payload').optional({ nullable: true }).isObject(),
  body('photos').optional({ nullable: true }).isArray({ max: service.MAX_PHOTOS }),
];

/**
 * What this feature accepts, in one call.
 *
 * The apps render the six forms from this rather than hardcoding the field
 * lists, so adding a report type is a server change and a deploy — not a
 * coordinated release of three clients that each believe something different
 * about what `ROAD_ISSUE` collects.
 */
router.get('/schema', (_req, res) =>
  ok(res, {
    types: service.REPORT_TYPES,
    statuses: service.REPORT_STATUSES,
    payloadShapes: service.PAYLOAD_SHAPES,
    maxPhotos: service.MAX_PHOTOS,
    maxNoteLength: service.MAX_NOTE,
  }),
);

// ── rider ────────────────────────────────────────────────────────────────────

router.post(
  '/',
  authenticate,
  reportBody,
  validate,
  h(async (req, res) => {
    const report = await service.createReport({
      userId: actorId(req),
      ...req.body,
      lat: Number(req.body.lat),
      lng: Number(req.body.lng),
    });
    res.status(201).json({ success: true, data: { report }, message: 'Thanks — we will take a look.' });
  }),
);

/**
 * ONE PHOTO, UPLOADED AS IT IS PICKED.
 *
 * Not N files on the report POST. Three reasons, in the order they matter:
 *
 *   - a failed upload does not take the written report with it — the words and
 *     the coordinate are the actionable part and must not be hostage to a
 *     picture;
 *   - the reporter learns immediately that a photo did not go through, while
 *     they are still standing where they could take another;
 *   - it is the shape every other upload in this product already has (avatar,
 *     insurance card, driver documents), so it inherits the same multer
 *     allow-list and the same 8 MB cap rather than needing its own.
 *
 * Returns the URL to put in `photos[]`. The report POST then carries strings.
 */
router.post(
  '/photo',
  authenticate,
  imageUpload.single('photo'),
  h(async (req, res) => {
    const url = await service.uploadPhoto(req.file?.buffer);
    res.status(201).json({ success: true, data: { url } });
  }),
);

/** Everything this rider has told us, and what came of it. */
router.get(
  '/mine',
  authenticate,
  [query('limit').optional().isInt({ min: 1, max: 50 }), query('cursor').optional().isString()],
  validate,
  h(async (req, res) => {
    ok(res, await service.listMine(actorId(req), { limit: req.query.limit, cursor: req.query.cursor ?? null }));
  }),
);

/**
 * What has already been said about this corner.
 *
 * Shown on the map the rider files from, so the same closed shop is not
 * reported forty times — the cheapest deduplication available, and the clearest
 * signal that these reports go somewhere.
 */
router.get(
  '/nearby',
  authenticate,
  [
    query('lat').isFloat({ min: -90, max: 90 }),
    query('lng').isFloat({ min: -180, max: 180 }),
    query('radiusKm').optional().isFloat({ min: 0.1, max: 25 }),
  ],
  validate,
  h(async (req, res) => {
    ok(res, {
      reports: await service.listNearby({
        lat: Number(req.query.lat),
        lng: Number(req.query.lng),
        radiusKm: req.query.radiusKm ? Number(req.query.radiusKm) : 2,
      }),
    });
  }),
);

// ── driver ───────────────────────────────────────────────────────────────────

/**
 * The same verb, from the app that is on the road all day.
 *
 * A driver sees more bad map data in a shift than a rider does in a year, so
 * refusing them the form would be leaving the best source of it on the table.
 * Filed with `driverId` set and `userId` null, which is how the queue tells the
 * two apart.
 */
router.post(
  '/driver',
  authenticateDriver,
  reportBody,
  validate,
  h(async (req, res) => {
    const report = await service.createReport({
      driverId: actorId(req),
      ...req.body,
      lat: Number(req.body.lat),
      lng: Number(req.body.lng),
    });
    res.status(201).json({ success: true, data: { report }, message: 'Thanks — we will take a look.' });
  }),
);

/** The same uploader, for the app that carries a driver token. */
router.post(
  '/driver/photo',
  authenticateDriver,
  imageUpload.single('photo'),
  h(async (req, res) => {
    const url = await service.uploadPhoto(req.file?.buffer);
    res.status(201).json({ success: true, data: { url } });
  }),
);

// ── shared ───────────────────────────────────────────────────────────────────

router.get(
  '/:id',
  authenticate,
  [param('id').isString()],
  validate,
  h(async (req, res) => {
    const report = await service.getReport(req.params.id);
    // A report is only visible to the person who filed it. Everything else is
    // the admin console's business — see admin.routes.js.
    if (report.userId && report.userId !== actorId(req)) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }
    return ok(res, { report });
  }),
);

module.exports = router;
