'use strict';

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const env = require('../config/env');
const logger = require('../utils/logger');

/**
 * Firebase Admin SDK initialisation.
 *
 * Two credential paths are supported (first match wins):
 *
 * 1. JSON key file  — drop `firebase-service-account.json` in the project root.
 *    Download from: Firebase Console → Project Settings → Service Accounts
 *    → Generate new private key.
 *    Add to .gitignore — never commit this file.
 *
 * 2. Environment variables — set in .env / hosting secret manager:
 *      FIREBASE_PROJECT_ID    e.g. eyego-12345
 *      FIREBASE_CLIENT_EMAIL  e.g. firebase-adminsdk-xxx@eyego-12345.iam.gserviceaccount.com
 *      FIREBASE_PRIVATE_KEY   full PEM key (escape \n as \\n in .env)
 *
 * NOTE: google-services.json is the Android CLIENT config (for receiving FCM in the
 * app). The server needs the Admin SDK service account key (separate file/credentials).
 */
let firebaseReady = false;

function tryInitFromFile() {
  const keyPath = path.join(__dirname, '../../firebase-service-account.json');
  if (!fs.existsSync(keyPath)) return false;
  try {
    const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    logger.info('Firebase Admin initialized from firebase-service-account.json');
    return true;
  } catch (err) {
    logger.warn('firebase-service-account.json found but invalid:', err.message);
    return false;
  }
}

function tryInitFromEnv() {
  const privateKey = (env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const hasValidKey =
    privateKey.includes('BEGIN PRIVATE KEY') && privateKey.length > 200;
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !hasValidKey) return false;
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: env.FIREBASE_PROJECT_ID,
        privateKey,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
      }),
    });
    logger.info('Firebase Admin initialized from environment variables');
    return true;
  } catch (err) {
    logger.warn('Firebase Admin init failed (invalid env credentials):', err.message);
    return false;
  }
}

if (!admin.apps.length) {
  firebaseReady = tryInitFromFile() || tryInitFromEnv();
  if (!firebaseReady) {
    logger.warn(
      'Firebase Admin init skipped — push notifications disabled. ' +
      'To enable: drop firebase-service-account.json in eyego-api/ root, ' +
      'or set FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY in .env'
    );
  }
}

async function sendPush(fcmToken, title, body, data = {}) {
  if (!fcmToken || !firebaseReady) return null;

  try {
    const result = await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      android: {
        priority: 'high',
        notification: { channelId: 'eyego_default', sound: 'default' },
      },
      apns: {
        payload: { aps: { sound: 'default', badge: 1 } },
      },
    });
    return result;
  } catch (err) {
    // Don't crash on push errors — they're non-critical
    logger.warn('Push notification failed', { fcmToken: fcmToken.slice(0, 20), error: err.message });
    return null;
  }
}

async function sendMulticastPush(fcmTokens, title, body, data = {}) {
  const validTokens = fcmTokens.filter(Boolean);
  if (!validTokens.length || !firebaseReady) return null;

  try {
    const result = await admin.messaging().sendEachForMulticast({
      tokens: validTokens,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default' } } },
    });
    logger.info(`Multicast push: ${result.successCount}/${validTokens.length} delivered`);
    return result;
  } catch (err) {
    logger.warn('Multicast push failed', { error: err.message });
    return null;
  }
}

// Rider-controllable categories (apps/rider/app/profile/notification-preferences.tsx)
// stored as a JSON blob on User.notificationPrefs. Explicit `false` opts out; any
// other value (including a category that's never been touched) defaults to on.
function prefAllows(notificationPrefs, category) {
  if (!notificationPrefs) return true;
  try {
    const prefs = typeof notificationPrefs === 'string' ? JSON.parse(notificationPrefs) : notificationPrefs;
    return prefs[category] !== false;
  } catch {
    return true; // malformed prefs blob — fail open rather than silently drop notifications
  }
}

// Convenience wrappers for specific events
const notifications = {
  rideConfirmed: (token, route, departureTime, notificationPrefs, bookingId, tripId) =>
    prefAllows(notificationPrefs, 'paymentConfirmations')
      ? sendPush(token, 'Your EyeGo is confirmed!', `Departing at ${departureTime} from ${route}`, { type: 'RIDE_CONFIRMED', bookingId: bookingId || '', tripId: tripId || '' })
      : null,

  driverEnRoute: (token, driverName, etaMinutes, notificationPrefs, tripId) =>
    prefAllows(notificationPrefs, 'driverArriving')
      ? sendPush(token, 'Driver is on the way', `${driverName} is ${etaMinutes} min away`, { type: 'DRIVER_EN_ROUTE', tripId: tripId || '' })
      : null,

  driverArrived: (token, stopName, notificationPrefs, tripId, bookingId) =>
    prefAllows(notificationPrefs, 'driverArriving')
      ? sendPush(token, 'EyeGo is here!', `Your van is waiting at ${stopName}`, { type: 'DRIVER_ARRIVED', tripId: tripId || '', bookingId: bookingId || '' })
      : null,

  rideComplete: (token, savedAmount, notificationPrefs, bookingId) =>
    prefAllows(notificationPrefs, 'tripCompleted')
      ? sendPush(token, 'Ride complete', `Rate your trip. You saved GHS ${savedAmount} vs a private ride.`, { type: 'RIDE_COMPLETE', bookingId: bookingId || '' })
      : null,

  passengerJoined: (token, passengerName, seatNumber, tripId) =>
    sendPush(token, 'Someone joined your EyeGo', `${passengerName} just booked seat #${seatNumber}`, { type: 'PASSENGER_JOINED', tripId: tripId || '' }),

  lowWallet: (token, balance) =>
    sendPush(token, 'Top up your wallet', `Your balance is GHS ${balance}. Top up to keep driving.`, { type: 'LOW_WALLET' }),

  expressMode: (token, destination, tripId) =>
    sendPush(token, 'Express Mode!', `Van is full. Heading directly to ${destination}.`, { type: 'EXPRESS_MODE', tripId: tripId || '' }),

  driverApproved: (token) =>
    sendPush(token, 'You\'re approved!', 'Your EyeGo Driver account is now active. You can start accepting trips.', { type: 'DRIVER_APPROVED' }),

  chatMessage: (token, senderName, text, tripId) =>
    sendPush(token, `💬 ${senderName}`, text.length > 80 ? text.slice(0, 77) + '…' : text, { type: 'CHAT_MESSAGE', tripId: tripId || '' }),

  tripCancelledNoShow: (tokens, route, tripId) =>
    sendMulticastPush(tokens, 'Trip cancelled — driver no-show', `Your EyeGo trip (${route}) was cancelled. A full refund will be issued.`, { type: 'TRIP_CANCELLED_NO_SHOW', tripId: tripId || '' }),
};

module.exports = { sendPush, sendMulticastPush, notifications };
