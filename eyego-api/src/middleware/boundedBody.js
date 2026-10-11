'use strict';

/**
 * ONE GUARD FOR EVERY FREE-TEXT FIELD.
 *
 * The JSON limit is 5 MB (uploads are multipart, so nothing legitimate is that
 * big), and most write routes take a comment, description, note, name or
 * reason with no length check — so one field could hold megabytes, stored and
 * then served to every screen that shows it. Rather than eighty per-field
 * checks: no string over MAX_STRING, no array over MAX_ARRAY, no nesting past
 * MAX_DEPTH, anywhere in a JSON body.
 *
 * Gateways are exempt: a webhook we refuse is a payment we never record.
 */
const MAX_STRING = 10_000;
const MAX_ARRAY = 1_000;
const MAX_DEPTH = 20;
const EXEMPT = [/^\/v1\/payments\/webhook/, /^\/v1\/contact\/voice/];
// Without Cloudinary (dev), an upload comes back as a data URI and the client
// posts it straight back (map-report photoUrls). map-report.service caps it at 1.2 MB.
const INLINE_IMAGE = /^data:image\/[a-z]+;base64,/i;
const MAX_INLINE_IMAGE = 1_500_000;

function tooBig(value, depth = 0) {
  if (depth > MAX_DEPTH) return 'nested too deeply';
  if (typeof value === 'string') {
    const max = INLINE_IMAGE.test(value) ? MAX_INLINE_IMAGE : MAX_STRING;
    return value.length > max ? `a text field over ${max} characters` : null;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY) return `a list over ${MAX_ARRAY} items`;
    for (const v of value) { const r = tooBig(v, depth + 1); if (r) return r; }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) { const r = tooBig(v, depth + 1); if (r) return r; }
  }
  return null;
}

function boundedBody(req, res, next) {
  if (!req.body || typeof req.body !== 'object' || EXEMPT.some((re) => re.test(req.path))) return next();
  const problem = tooBig(req.body);
  if (!problem) return next();
  return res.status(413).json({ success: false, code: 'PAYLOAD_TOO_LARGE', message: `That request has ${problem}.` });
}

/**
 * …and no unbounded pages. A dozen list endpoints read `?limit=` straight into
 * `take`, so `limit=1000000` was one request that pulled a whole table. The
 * admin console clamps its own (and exports large pages on purpose).
 */
const MAX_PAGE_SIZE = 100;
function boundedPaging(req, res, next) {
  if (req.path.startsWith('/v1/admin')) return next();
  if (req.query.limit !== undefined) {
    const n = parseInt(req.query.limit, 10);
    req.query.limit = String(Number.isFinite(n) ? Math.min(Math.max(n, 1), MAX_PAGE_SIZE) : 20);
  }
  if (req.query.page !== undefined) {
    const n = parseInt(req.query.page, 10);
    req.query.page = String(Number.isFinite(n) && n > 0 ? Math.min(n, 10_000) : 1);
  }
  next();
}

module.exports = { boundedBody, boundedPaging, tooBig, MAX_STRING, MAX_PAGE_SIZE };
