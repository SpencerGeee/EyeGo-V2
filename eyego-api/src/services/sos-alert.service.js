'use strict';

const prisma = require('../config/database');
const redis = require('../config/redis');
const settings = require('../config/settings');
const pushService = require('./push.service');
const smsService = require('./sms.service');
const mapboxService = require('./mapbox.service');
const logger = require('../utils/logger');

/**
 * Getting a panic alert in front of a human.
 *
 * WHAT WAS WRONG. The fan-out existed — `admin:fcm_tokens` is a Redis set read
 * at both places an SosEvent is created — but the only endpoint that puts a
 * token INTO that set is `POST /admin/fcm-token`, a mobile-only registration
 * the web console never calls. So on a normal deployment the set is empty, and
 * a panic alert reached nobody at all until somebody happened to refresh the
 * SOS page. For a safety feature that is the whole thing failing quietly.
 *
 * THREE CHANNELS NOW, deliberately independent, because the failure of any one
 * of them must not be the failure of all:
 *
 *   1. SMS to an on-call roster (`SOS_ONCALL_PHONES`). The only channel that
 *      wakes someone at 3am, and the only one that works when the console is
 *      closed and nobody has the app. This is the important one.
 *   2. FCM to any registered admin device — unchanged, still best-effort.
 *   3. The console queue itself, which polls.
 *
 * Everything here is best-effort and non-throwing: an SMS provider outage must
 * never prevent the SosEvent row from being written, because the row is the
 * durable part and the alert is not.
 */

/** Where the trip is, in words, for people who cannot open a map. */
async function describeLocation(lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number') return 'location unknown';
  const place = await mapboxService.placeNameFor(lat, lng).catch(() => null);
  // The coordinates go in regardless — a name is friendlier, but a responder
  // pasting numbers into Google Maps is what actually finds someone.
  return place ? `${place} (${lat.toFixed(5)}, ${lng.toFixed(5)})` : `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function onCallNumbers() {
  const raw = settings.get('SOS_ONCALL_PHONES') || '';
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\+?\d{7,15}$/.test(s));
}

/**
 * Raise the alarm for an SOS event that has just been written.
 *
 * @param {object} event  the persisted SosEvent
 * @returns {Promise<object>} what actually went out, for the caller to log
 */
async function dispatchAlert(event) {
  const result = { sms: { sent: 0, failed: 0, recipients: [] }, push: { sent: 0 }, errors: [] };

  try {
    const [trip, rider, driverRaiser] = await Promise.all([
      prisma.trip.findUnique({
        where: { id: event.tripId },
        select: {
          shortId: true, status: true,
          driver: { select: { name: true, phone: true } },
          vehicle: { select: { plateNumber: true } },
        },
      }),
      prisma.user.findUnique({ where: { id: event.userId }, select: { name: true, phone: true } }),
      // Either party can hit the button, so the id may be a driver's.
      prisma.driver.findUnique({ where: { id: event.userId }, select: { name: true, phone: true } }),
    ]);

    const raiser = rider ?? driverRaiser;
    const who = raiser ? `${raiser.name} (${raiser.phone})` : 'unknown person';
    const role = rider ? 'rider' : driverRaiser ? 'driver' : 'someone';
    const where = await describeLocation(event.lat, event.lng);
    const tripCode = trip?.shortId ?? event.tripId.slice(0, 8);
    const vehicle = trip?.vehicle?.plateNumber ? ` veh ${trip.vehicle.plateNumber}` : '';
    const driverPart = trip?.driver ? ` Driver ${trip.driver.name} ${trip.driver.phone}.` : '';

    // Kept tight: an SMS is 160 characters per segment and this one must lead
    // with the fact that it is an emergency, not with a greeting.
    const sms =
      `EyeGo SOS: ${role} ${who} on trip ${tripCode}${vehicle}. ` +
      `At ${where}.${driverPart} Call them now.`;

    if (settings.get('SOS_SMS_ALERTS_ENABLED') !== false) {
      const numbers = onCallNumbers();
      if (!numbers.length) {
        logger.warn('[sos] no on-call numbers configured — SMS alerting is off. Set SOS_ONCALL_PHONES.');
      }
      // Sequential, not Promise.all: the SMS provider rate-limits, and a
      // rejected burst would drop alerts that a slower loop delivers.
      for (const number of numbers) {
        try {
          await smsService.sendSms(number, sms);
          result.sms.sent += 1;
          result.sms.recipients.push(number);
        } catch (err) {
          result.sms.failed += 1;
          result.errors.push(`sms:${number}:${err.message}`);
          logger.error('[sos] on-call SMS failed', { number, error: err.message });
        }
      }
    }

    try {
      const tokens = await redis.smembers('admin:fcm_tokens').catch(() => []);
      if (tokens.length) {
        await pushService.sendMulticastPush(
          tokens,
          'SOS raised',
          `${role} ${raiser?.name ?? ''} — trip ${tripCode}. ${where}`,
          { type: 'SOS', sosId: event.id, tripId: event.tripId },
        );
        result.push.sent = tokens.length;
      }
    } catch (err) {
      result.errors.push(`push:${err.message}`);
    }

    logger.warn('[sos] ALERT RAISED', {
      sosId: event.id, tripId: event.tripId, tripCode,
      smsSent: result.sms.sent, smsFailed: result.sms.failed, pushSent: result.push.sent,
    });
  } catch (err) {
    // Never rethrow. The event row is already saved; failing here would only
    // turn a delivery problem into a lost alert.
    result.errors.push(`fatal:${err.message}`);
    logger.error('[sos] alert dispatch failed', { sosId: event?.id, error: err.message });
  }

  return result;
}

/**
 * Is the escalation path actually wired up?
 * Surfaced on the console's SOS page so an empty roster is visible BEFORE the
 * emergency rather than discovered during one.
 */
async function alertingHealth() {
  const numbers = onCallNumbers();
  const tokens = await redis.smembers('admin:fcm_tokens').catch(() => []);
  const smsEnabled = settings.get('SOS_SMS_ALERTS_ENABLED') !== false;

  return {
    smsEnabled,
    onCallCount: numbers.length,
    // Masked: the console shows that someone is on call without printing a
    // personal mobile number on a shared screen.
    onCallMasked: numbers.map((n) => `${n.slice(0, 4)}···${n.slice(-3)}`),
    pushDeviceCount: tokens.length,
    smsConfigured: smsService.isConfigured ? smsService.isConfigured() : undefined,
    /** True when at least one channel would actually reach a person. */
    reachable: (smsEnabled && numbers.length > 0) || tokens.length > 0,
  };
}

module.exports = { dispatchAlert, alertingHealth, onCallNumbers };
