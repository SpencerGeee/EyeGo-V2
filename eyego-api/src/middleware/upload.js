'use strict';

/**
 * The one configured multer instance for the whole API.
 *
 * Both upload sites (rider avatar + insurance card, driver documents) used a
 * bare `multer()`, which accepts ANY file of ANY size into process memory.
 * Two reachable consequences, for anyone holding a normal account token:
 *
 *   1. No `fileFilter` — a shell script posted as `avatar` was accepted and
 *      passed to the image pipeline. The E2E suite confirmed the 2xx.
 *   2. No `limits` — multer's default storage is MemoryStorage, so the entire
 *      body is buffered inside the API process before any handler runs. One
 *      large POST is an out-of-memory kill on the server.
 *
 * Every upload in this product is a photograph, so the filter is an allow-list
 * of image mime types (not the client-controlled file extension), and 8 MB sits
 * comfortably above a phone camera JPEG.
 */

const multer = require('multer');

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const imageUpload = multer({
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      // `statusCode` is the property errorHandler reads — `status` is ignored
      // and would have fallen through to a 500 for a plainly-invalid upload.
      const err = new Error('Please upload a photo (JPEG, PNG, WebP or HEIC).');
      err.statusCode = 400;
      err.code = 'UNSUPPORTED_MEDIA_TYPE';
      err.isOperational = true;
      return cb(err);
    }
    cb(null, true);
  },
});

module.exports = { imageUpload, ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES };
