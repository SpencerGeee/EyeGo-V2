'use strict';

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
function hasCloudinary() {
  const name = env.CLOUDINARY_CLOUD_NAME;
  return !!name && !/^(your|changeme|placeholder|xxx)/i.test(name);
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
  // Kept as-is deliberately: the `development` clause means a dev machine WITH
  // real credentials still takes the offline path, which is what stops local
  // testing filling a production Cloudinary account with junk. `hasCloudinary()`
  // above is the narrower question — "are credentials configured at all" — for
  // callers that need to size their storage decision on it.
  if (env.NODE_ENV === 'development' || env.CLOUDINARY_CLOUD_NAME === 'placeholder' || !env.CLOUDINARY_CLOUD_NAME) {
    if (buffer && Buffer.isBuffer(buffer)) {
      return `data:image/jpeg;base64,${buffer.toString('base64')}`;
    }
    const genders = ['men', 'women'];
    const randomGender = genders[Math.floor(Math.random() * genders.length)];
    const randomId = Math.floor(Math.random() * 99) + 1;
    return `https://randomuser.me/api/portraits/${randomGender}/${randomId}.jpg`;
  }
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      {
        folder: options.folder || 'eyego',
        resource_type: 'image',
        transformation: [{ quality: 'auto', fetch_format: 'auto' }],
        ...options,
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

module.exports = { uploadImage, uploadBuffer, deleteImage, hasCloudinary, cloudinary };
