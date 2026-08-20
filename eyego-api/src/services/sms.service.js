'use strict';

const { formatGhs } = require('../utils/money');

const AfricasTalking = require('africastalking');
const env = require('../config/env');
const logger = require('../utils/logger');

const AT = AfricasTalking({
  apiKey: env.AT_API_KEY,
  username: env.AT_USERNAME,
});

const sms = AT.SMS;

async function sendSms(to, message) {
  // In development, skip actual SMS sending — OTP is returned in the API response
  if (env.NODE_ENV === 'development') {
    logger.info('[DEV] SMS skipped', { to, message });
    return { skipped: true };
  }
  try {
    // Normalize phone to +233 format
    const phone = normalizePhone(to);
    const result = await sms.send({
      to: [phone],
      message,
      from: env.AT_SENDER_ID,
    });
    logger.info('SMS sent', { to: phone, messageId: result.SMSMessageData?.Recipients?.[0]?.messageId });
    return result;
  } catch (err) {
    logger.error('SMS send failed', { to, error: err.message });
    throw err;
  }
}

/**
 * Would `sendSms` actually put a message on the wire?
 *
 * False in development — where sends are deliberately skipped and logged — and
 * false without credentials. The SOS page reports this, because "alerting is
 * configured" and "alerting would reach someone" are different claims, and only
 * the second one matters at 3am.
 */
function isConfigured() {
  return Boolean(env.AT_API_KEY && env.AT_USERNAME) && env.NODE_ENV !== 'development';
}

async function sendOtp(phone, otp) {
  const message = `Your EyeGo code is ${otp}. Expires in 10 minutes. Do not share this code.`;
  return sendSms(phone, message);
}

// Both take PESEWAS and format here — see the note in push.service.js. An SMS
// that quotes the wrong fare is worse than most bugs: it is the number the
// rider turns up with in cash.
async function sendRideInvite(phone, tripShortId, destination, seatNumber, farePesewas, shareUrl) {
  const message = `You've been invited to an EyeGo ride!\nTo: ${destination}\nSeat: ${seatNumber}\nFare: ${formatGhs(farePesewas)}\nJoin here: ${shareUrl}`;
  return sendSms(phone, message);
}

async function sendOfflinePassengerOtp(phone, tripShortId, destination, seatNumber, fareAmountPesewas, otp) {
  const message = `EyeGo Ride #${tripShortId}\nTo: ${destination}\nSeat: ${seatNumber}\nFare: ${formatGhs(fareAmountPesewas)}\nCode: ${otp}\nShow this code to your driver.`;
  return sendSms(phone, message);
}

function normalizePhone(phone) {
  const cleaned = phone.replace(/\s+/g, '').replace(/^0/, '+233');
  if (!cleaned.startsWith('+')) return `+${cleaned}`;
  return cleaned;
}

module.exports = { sendSms, sendOtp, sendRideInvite, sendOfflinePassengerOtp, isConfigured };
