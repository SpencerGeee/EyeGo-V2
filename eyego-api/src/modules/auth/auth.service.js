'use strict';

const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const admin = require('firebase-admin');
const prisma = require('../../config/database');
const env = require('../../config/env');
const otpService = require('../../services/otp.service');
const smsService = require('../../services/sms.service');
const { AuthError, NotFoundError, AppError } = require('../../utils/errors');

function signTokens(userId, role) {
  const tokenId = uuidv4();

  const accessToken = jwt.sign(
    { userId, role, type: 'access', tokenId },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRY, jwtid: uuidv4() }
  );

  const refreshToken = jwt.sign(
    { userId, role, tokenId, type: 'refresh' },
    env.JWT_REFRESH_SECRET,
    { expiresIn: env.JWT_REFRESH_EXPIRY }
  );

  return { accessToken, refreshToken, tokenId };
}

async function storeRefreshToken(userId, driverId, role, tokenId) {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  await prisma.refreshToken.create({
    data: { tokenId, userId, driverId, role, expiresAt },
  });
}

// ─── Passenger Auth ───────────────────────────────────

async function requestPassengerOtp(phone) {
  const otp = await otpService.storeOtp(phone);
  await smsService.sendOtp(phone, otp);

  // In dev, return OTP in response so you don't need real SMS
  if (env.NODE_ENV === 'development') {
    return { message: 'OTP sent', _dev_otp: otp };
  }
  return { message: 'OTP sent to your phone' };
}

async function verifyPassengerOtp(phone, inputOtp) {
  await otpService.verifyOtp(phone, inputOtp);

  let user = await prisma.user.findUnique({ where: { phone } });
  const isNewUser = !user;

  if (!user) {
    user = await prisma.user.create({
      data: { phone, name: '', authProvider: 'PHONE' },
    });
  }

  if (!user.isActive) throw new AuthError('Your account has been deactivated');

  const { accessToken, refreshToken, tokenId } = signTokens(user.id, 'PASSENGER');
  await storeRefreshToken(user.id, null, 'PASSENGER', tokenId);

  return { accessToken, refreshToken, isNewUser, user };
}

async function handleGoogleAuth(idToken) {
  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(idToken);
  } catch (_) {
    throw new AppError('Invalid identity token', 401, 'INVALID_IDENTITY_TOKEN');
  }

  const { email, name, picture, uid } = decoded;

  let user = await prisma.user.findFirst({
    where: {
      OR: [
        { phone: `google_${uid}` },
        ...(email ? [{ email }] : [])
      ]
    }
  });
  const isNewUser = !user;

  if (!user) {
    user = await prisma.user.create({
      data: { email, name: name || '', profilePhoto: picture, authProvider: 'GOOGLE', phone: `google_${uid}` },
    });
  }

  const { accessToken, refreshToken, tokenId } = signTokens(user.id, 'PASSENGER');
  await storeRefreshToken(user.id, null, 'PASSENGER', tokenId);

  return { accessToken, refreshToken, isNewUser, user };
}

async function handleAppleAuth(idToken) {
  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(idToken);
  } catch (_) {
    throw new AppError('Invalid identity token', 401, 'INVALID_IDENTITY_TOKEN');
  }

  const { email, name, uid } = decoded;

  let user = await prisma.user.findFirst({
    where: {
      OR: [
        { phone: `apple_${uid}` },
        ...(email ? [{ email }] : [])
      ]
    }
  });
  const isNewUser = !user;

  if (!user) {
    user = await prisma.user.create({
      data: { email, name: name || '', authProvider: 'APPLE', phone: `apple_${uid}` },
    });
  }

  const { accessToken, refreshToken, tokenId } = signTokens(user.id, 'PASSENGER');
  await storeRefreshToken(user.id, null, 'PASSENGER', tokenId);

  return { accessToken, refreshToken, isNewUser, user };
}

async function refreshPassengerToken(token) {
  const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] });
  if (decoded.type !== 'refresh' || decoded.role !== 'PASSENGER') throw new AuthError('Invalid refresh token');

  const stored = await prisma.refreshToken.findUnique({ where: { tokenId: decoded.tokenId } });
  if (!stored || stored.revokedAt) throw new AuthError('Refresh token revoked');
  if (stored.expiresAt < new Date()) throw new AuthError('Refresh token expired');

  // Rotate: revoke old, issue new
  await prisma.refreshToken.update({ where: { tokenId: decoded.tokenId }, data: { revokedAt: new Date() } });

  const { accessToken, refreshToken, tokenId } = signTokens(decoded.userId, 'PASSENGER');
  await storeRefreshToken(decoded.userId, null, 'PASSENGER', tokenId);

  return { accessToken, refreshToken };
}

async function logout(tokenId) {
  await prisma.refreshToken.updateMany({
    where: { tokenId },
    data: { revokedAt: new Date() },
  });
}

// ─── Driver Auth ───────────────────────────────────

async function requestDriverOtp(phone) {
  const otp = await otpService.storeOtp(`driver:${phone}`);
  await smsService.sendOtp(phone, otp);

  if (env.NODE_ENV === 'development') {
    return { message: 'OTP sent', _dev_otp: otp };
  }
  return { message: 'OTP sent to your phone' };
}

async function verifyDriverOtp(phone, inputOtp) {
  await otpService.verifyOtp(`driver:${phone}`, inputOtp);

  let driver = await prisma.driver.findUnique({ where: { phone } });
  const isNewDriver = !driver;

  if (!driver) {
    driver = await prisma.driver.create({
      data: {
        phone,
        name: '',
        // Auto-approve in development so new drivers can go online immediately
        status: env.NODE_ENV === 'development' ? 'ACTIVE' : 'PENDING_REVIEW',
      },
    });
  }

  const { accessToken, refreshToken, tokenId } = signTokens(driver.id, 'DRIVER');
  await storeRefreshToken(null, driver.id, 'DRIVER', tokenId);

  return { accessToken, refreshToken, isNewDriver, driver };
}

async function refreshDriverToken(token) {
  const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] });
  if (decoded.type !== 'refresh' || decoded.role !== 'DRIVER') throw new AuthError('Invalid refresh token');

  const stored = await prisma.refreshToken.findUnique({ where: { tokenId: decoded.tokenId } });
  if (!stored || stored.revokedAt) throw new AuthError('Refresh token revoked');
  if (stored.expiresAt < new Date()) throw new AuthError('Refresh token expired');

  await prisma.refreshToken.update({ where: { tokenId: decoded.tokenId }, data: { revokedAt: new Date() } });

  const { accessToken, refreshToken, tokenId } = signTokens(decoded.userId, 'DRIVER');
  await storeRefreshToken(null, decoded.userId, 'DRIVER', tokenId);

  return { accessToken, refreshToken };
}

module.exports = {
  requestPassengerOtp, verifyPassengerOtp,
  handleGoogleAuth, handleAppleAuth,
  refreshPassengerToken, refreshDriverToken,
  requestDriverOtp, verifyDriverOtp,
  logout,
};
