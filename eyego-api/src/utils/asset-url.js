'use strict';

const { AppError } = require('./errors');

/**
 * Guards the free-string image columns — `User.profilePhoto`, `Driver.profilePhoto`
 * and friends — against being handed the image itself.
 *
 * WHAT WENT WRONG. Nothing validated these columns, so a client could PATCH a
 * base64 `data:` URI straight into one, and one did: a live account carried a
 * 723 KB data URI in `User.profilePhoto`. Because the column is read back out
 * as `avatarUrl` on trip, booking and manifest payloads, that single row put
 * three quarters of a megabyte into every response that mentioned the rider —
 * on a phone, on Ghanaian mobile data. In the admin console it was worse still:
 * the riders list inlined it twice (once in the `<img>`, once in the RSC
 * payload) and shipped a 1.5 MB page for twelve rows. Fifty such riders would
 * be a 70 MB page.
 *
 * These columns hold a URL to an uploaded asset. That is all they have ever
 * been for; it simply was never said out loud.
 */

/** Generous enough for any signed CDN URL, far below any inlined image. */
const MAX_ASSET_URL_LENGTH = 2048;

function assertAssetUrl(value, field = 'image') {
  if (value === null || value === undefined || value === '') return value;

  if (typeof value !== 'string') {
    throw new AppError(`${field} must be a URL string`, 400, 'INVALID_ASSET_URL');
  }

  const url = value.trim();

  if (/^data:/i.test(url)) {
    throw new AppError(
      `${field} must be a URL to an uploaded image, not the image itself. ` +
        'Upload it first and send the returned URL.',
      400,
      'INLINE_IMAGE_REJECTED',
    );
  }

  if (url.length > MAX_ASSET_URL_LENGTH) {
    throw new AppError(
      `${field} URL is too long (${url.length} characters, limit ${MAX_ASSET_URL_LENGTH})`,
      400,
      'INVALID_ASSET_URL',
    );
  }

  // http(s) only. A `javascript:` or `blob:` value in a column that is rendered
  // into an <img src> in the console is not something to find out about later.
  if (!/^https?:\/\//i.test(url)) {
    throw new AppError(`${field} must be an http(s) URL`, 400, 'INVALID_ASSET_URL');
  }

  return url;
}

/** True when a stored value is unsafe to inline — used to skip rendering it. */
function isInlineAsset(value) {
  return typeof value === 'string' && /^data:/i.test(value.trim());
}

module.exports = { assertAssetUrl, isInlineAsset, MAX_ASSET_URL_LENGTH };
