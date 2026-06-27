'use strict';

const cloudinary = require('cloudinary').v2;
const env = require('../config/env');

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true,
});

async function uploadImage(filePath, options = {}) {
  const result = await cloudinary.uploader.upload(filePath, {
    folder: options.folder || 'eyego',
    transformation: options.transformation || [{ quality: 'auto', fetch_format: 'auto' }],
    ...options,
  });
  return result.secure_url;
}

async function uploadBuffer(buffer, options = {}) {
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

module.exports = { uploadImage, uploadBuffer, deleteImage, cloudinary };
