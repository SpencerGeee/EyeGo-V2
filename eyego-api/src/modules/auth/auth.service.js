'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const admin = require('firebase-admin');
const prisma = require('../../config/database');
const env = require('../../config/env');
const otpService = require('../../services/otp.service');
const smsService = require('../../services/sms.service');
const { AuthError, NotFoundError, AppError } = require('../../utils/errors');

function signTokens(userId, role, tokenId = uuidv4()) {

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

// A rotated refresh token stays usable this long. It must outlive the client's
// own retry loop (packages/api client.ts: 15 s timeout x3 + 1 s/2 s backoff ≈ 48 s):
// at 15 s, a refresh whose RESPONSE was lost (the server already rotated) retried
// at ~16 s with the old token, got 401, and logged the driver out mid-trip.
// Logout deletes the row instead, so this window never revives a signed-out session.
const REFRESH_GRACE_MS = 60000;

/**
 * A ROTATION MUST BE REPLAYABLE.
 *
 * The successor's tokenId is a pure function of the token it replaces. On a
 * slow network the server rotates, the client's 15 s timeout fires first, and
 * the client keeps the OLD token (agent run 45902035048: rotated at 23:32:30,
 * old token presented at 23:45:35, 13 min past the grace window -> 401 -> the
 * rider was signed out mid-search). A revoked token whose successor has never
 * itself been rotated is exactly that lost response, so it re-issues the same
 * successor. A stolen predecessor dies the moment the real client refreshes once.
 */
function successorId(tokenId) {
  return crypto.createHmac('sha256', env.JWT_REFRESH_SECRET).update(tokenId).digest('hex').slice(0, 36);
}

async function rotateRefreshToken(stored, ownerId, role) {
  const nextId = successorId(stored.tokenId);
  if (stored.revokedAt) {
    const next = await prisma.refreshToken.findUnique({ where: { tokenId: nextId } });
    const lostResponse = next && !next.revokedAt && next.expiresAt > new Date();
    // Grace window kept for tokens rotated before successors were deterministic.
    if (!lostResponse && Date.now() - stored.revokedAt.getTime() > REFRESH_GRACE_MS) {
      throw new AuthError('Refresh token revoked');
    }
  } else {
    await prisma.refreshToken.updateMany({ where: { tokenId: stored.tokenId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
  const { accessToken, refreshToken } = signTokens(ownerId, role, nextId);
  // Upsert: two racing refreshes of one token both land on the same successor row.
  await prisma.refreshToken.upsert({
    where: { tokenId: nextId },
    create: {
      tokenId: nextId,
      userId: role === 'PASSENGER' ? ownerId : null,
      driverId: role === 'DRIVER' ? ownerId : null,
      role,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
    update: {},
  });
  return { accessToken, refreshToken };
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
  if (!stored) throw new AuthError('Refresh token revoked');
  if (stored.expiresAt < new Date()) throw new AuthError('Refresh token expired');

  /**
   * RE-READ THE ACCOUNT. A REFRESH IS A NEW GRANT, NOT A RENEWAL.
   *
   * `verifyPassengerOtp` checks `isActive` at sign-in and nothing checked it
   * again, so an account deactivated or deleted afterwards kept minting fresh
   * 15-minute access tokens off its refresh token for the next thirty days.
   * "Delete my account" did not even sign the phone out.
   */
  const account = await prisma.user.findUnique({
    where: { id: decoded.userId },
    select: { isActive: true },
  });
  if (!account || !account.isActive) throw new AuthError('Your account has been deactivated');

  return rotateRefreshToken(stored, decoded.userId, 'PASSENGER');
}

async function logout(tokenId) {
  // Delete, not revoke: a revoked row is still honoured for REFRESH_GRACE_MS.
  await prisma.refreshToken.deleteMany({ where: { tokenId } });
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
  if (!stored) throw new AuthError('Refresh token revoked');
  if (stored.expiresAt < new Date()) throw new AuthError('Refresh token expired');

  // Same rule as the passenger path above: a refresh is a fresh grant, so the
  // row is re-read. A driver whose account was deleted or disabled by an admin
  // otherwise kept minting access tokens for the life of the refresh token.
  const account = await prisma.driver.findUnique({
    where: { id: decoded.userId },
    select: { status: true },
  });
  if (!account || account.status === 'DISABLED') {
    throw new AuthError('Your account has been deactivated');
  }

  return rotateRefreshToken(stored, decoded.userId, 'DRIVER');
}

module.exports = {
  requestPassengerOtp, verifyPassengerOtp,
  handleGoogleAuth, handleAppleAuth,
  refreshPassengerToken, refreshDriverToken,
  requestDriverOtp, verifyDriverOtp,
  logout,
};
