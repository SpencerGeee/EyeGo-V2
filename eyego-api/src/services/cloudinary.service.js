'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cloudinary = require('cloudinary').v2;
const env = require('../config/env');

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true,
});

/**
 * IS THERE A REAL IMAGE HOST BEHIND THIS?
 *
 * `uploadBuffer` below silently degrades to a base64 `data:` URI when the
 * credentials are absent or still say "placeholder", which is what makes local
 * development work without an account. That fallback is fine for an avatar —
 * one string on one row — and it is NOT fine everywhere: a caller storing four
 * photos per row needs to know it is about to write megabytes of base64 into
 * Postgres rather than a 60-character URL.
 *
 * So the condition is exported rather than left implicit inside the uploader.
 * Callers that care can branch; callers that do not keep the old behaviour.
 */
const PLACEHOLDER = /^(your|changeme|placeholder|pla|xxx|todo|<)/i;

function hasCloudinary() {
  const name = env.CLOUDINARY_CLOUD_NAME;
  return !!name && !PLACEHOLDER.test(name);
}

/**
 * All three credentials, all real. `hasCloudinary()` only ever asked about the
 * cloud name, so an `.env` with a real name and a placeholder API key looked
 * configured, and every upload failed at the provider instead of falling back.
 */
function isConfigured() {
  return (
    hasCloudinary() &&
    !!env.CLOUDINARY_API_KEY &&
    !PLACEHOLDER.test(env.CLOUDINARY_API_KEY) &&
    !!env.CLOUDINARY_API_SECRET &&
    !PLACEHOLDER.test(env.CLOUDINARY_API_SECRET)
  );
}

/** Where the no-Cloudinary fallback puts bytes. Served at `/uploads`. */
const LOCAL_UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

/** Magic-number sniff — the extension is only cosmetic, but a wrong one confuses caches. */
function guessExtension(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.length > 12 && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (buf.length > 4 && buf.slice(0, 4).toString('ascii') === '%PDF') return 'pdf';
  return 'jpg';
}

async function uploadImage(filePath, options = {}) {
  const result = await cloudinary.uploader.upload(filePath, {
    folder: options.folder || 'eyego',
    transformation: options.transformation || [{ quality: 'auto', fetch_format: 'auto' }],
    ...options,
  });
  return result.secure_url;
}

async function uploadBuffer(buffer, options = {}) {
  /**
   * DEV WITH REAL CREDENTIALS NOW UPLOADS FOR REAL — INTO ITS OWN FOLDER.
   *
   * The old condition was `NODE_ENV === 'development' || …`, so a machine with
   * working Cloudinary credentials still took the offline path and every upload
   * came back as a `data:` URI. That is not a usable stand-in: those URIs get
   * written into `profilePhoto`, which `assertAssetUrl` exists to keep image
   * data out of, and which is echoed on every trip, booking and manifest
   * payload — a 700 KB avatar on a Ghanaian mobile connection, in dev, right
   * where a device build is being tested.
   *
   * The original worry — a laptop filling the production Cloudinary account
   * with junk — is real and is answered by the folder rather than by refusing to
   * upload: dev assets go under `dev/`, where they can be swept in one action.
   */
  if (!isConfigured()) {
    /**
     * NO CLOUDINARY ACCOUNT? STORE IT HERE AND SERVE IT OURSELVES.
     *
     * The old fallback returned a `data:` URI, and the caller wrote that
     * straight into `Driver.profilePhoto` / `User.profilePhoto` — the exact
     * thing `utils/asset-url.js` exists to keep out of those columns, because
     * they are echoed on every trip, booking and manifest payload. One avatar
     * became three quarters of a megabyte on every response that mentioned the
     * person. It also cannot round-trip: `updateProfile` runs `assertAssetUrl`
     * and rejects a `data:` URI, so a photo uploaded this way could never be
     * saved again through the ordinary edit path.
     *
     * Writing the bytes to `uploads/` and returning an `http(s)` URL to them
     * makes the fallback behave like the real thing: a short URL, a cacheable
     * asset, and a value every other layer already accepts. Good enough to
     * develop and sideload against; Cloudinary still takes over the moment real
     * credentials exist.
     */
    if (buffer && Buffer.isBuffer(buffer)) {
      const { publicBaseUrl } = require('../utils/publicUrl');
      const ext = guessExtension(buffer);
      const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
      // Flat directory on purpose: the name is random, nothing enumerates it,
      // and a nested tree would need the same mkdir dance per upload.
      fs.mkdirSync(LOCAL_UPLOAD_DIR, { recursive: true });
      fs.writeFileSync(path.join(LOCAL_UPLOAD_DIR, name), buffer);
      return `${publicBaseUrl()}/uploads/${name}`;
    }
    const genders = ['men', 'women'];
    const randomGender = genders[Math.floor(Math.random() * genders.length)];
    const randomId = Math.floor(Math.random() * 99) + 1;
    return `https://randomuser.me/api/portraits/${randomGender}/${randomId}.jpg`;
  }
  // Dev uploads are namespaced so a laptop cannot pollute the production tree.
  const folder = `${env.NODE_ENV === 'production' ? '' : 'dev/'}${options.folder || 'eyego'}`;
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      {
        resource_type: 'image',
        transformation: [{ quality: 'auto', fetch_format: 'auto' }],
        ...options,
        // Last, so the dev namespace cannot be overwritten by a caller's folder.
        folder,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result.secure_url);
      }
    ).end(buffer);
  });
}

async function deleteImage(publicId) {
  return cloudinary.uploader.destroy(publicId);
}

module.exports = { uploadImage, uploadBuffer, deleteImage, hasCloudinary, isConfigured, LOCAL_UPLOAD_DIR, cloudinary };
