'use strict';

const prisma = require('../../config/database');
const env = require('../../config/env');
const logger = require('../../utils/logger');
const { v4: uuidv4 } = require('uuid');
const { NotFoundError, AppError, ForbiddenError } = require('../../utils/errors');

/**
 * ── NUMBER-MASKED CALLING (Africa's Talking Voice) ──────────────────────────
 *
 * Uber's model: neither side ever sees the other's number. The caller taps
 * Call; AT rings the CALLER from EyeGo's virtual number; when they answer, AT
 * asks our callback what to do and we answer `<Dial>` to the other party, again
 * presenting the virtual number. So both phones show EyeGo, never each other.
 *
 * On when AT_VOICE_NUMBER is set (the account's AT_API_KEY / AT_USERNAME are
 * already configured for SMS) and the AT dashboard's voice callback points at
 * POST /v1/contact/voice. Off, `initiateCall` answers mode DIRECT with the
 * number and the apps dial it as they always have.
 */
const maskedCallingOn = () => !!env.AT_VOICE_NUMBER;
const SESSION_TTL_MS = 3 * 60 * 1000;

let voice = null;
function atVoice() {
  if (!voice) voice = require('africastalking')({ apiKey: env.AT_API_KEY, username: env.AT_USERNAME }).VOICE;
  return voice;
}

/** Who is calling whom on this trip, with both real numbers (never returned when masked). */
async function resolveParties({ callerId, callerRole, tripId, calleeRole, calleeBookingId }) {
  if (!tripId) throw new AppError('tripId is required', 400);
  if (!['DRIVER', 'PASSENGER'].includes(callerRole) || !['DRIVER', 'PASSENGER'].includes(calleeRole) || callerRole === calleeRole) {
    throw new AppError('A call is between the driver and a passenger', 400);
  }
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      driver: { select: { id: true, name: true, phone: true } },
      bookings: {
        where: { status: { in: ['CONFIRMED', 'BOARDED', 'PAID', 'COMPLETED', 'SEAT_HELD'] } },
        select: { id: true, userId: true, guestName: true, guestPhone: true, user: { select: { name: true, phone: true } } },
      },
    },
  });
  if (!trip || !trip.driver) throw new NotFoundError('Trip');

  if (callerRole === 'DRIVER') {
    if (callerId !== trip.driverId) throw new ForbiddenError('Caller is not the driver of this trip');
    const b = (calleeBookingId && trip.bookings.find((x) => x.id === calleeBookingId || x.userId === calleeBookingId)) || trip.bookings[0];
    if (!b) throw new AppError('No passengers on this trip', 400);
    return {
      calleeId: b.userId ?? b.id,
      callerPhone: trip.driver.phone,
      // A guest booking: the traveller's number, not the booker's.
      calleePhone: b.guestPhone ?? b.user?.phone ?? null,
      counterpartName: b.guestName ?? b.user?.name ?? 'Passenger',
    };
  }
  const mine = trip.bookings.find((b) => b.userId === callerId);
  if (!mine) throw new ForbiddenError('Caller is not a passenger on this trip');
  return {
    calleeId: trip.driverId,
    callerPhone: mine.user?.phone ?? null,
    calleePhone: trip.driver.phone,
    counterpartName: trip.driver.name,
  };
}

async function initiateCall(input) {
  const p = await resolveParties(input);
  if (!p.calleePhone) throw new AppError('There is no number to call for this person — use the chat.', 409, 'NO_NUMBER');

  const relayToken = uuidv4().replace(/-/g, '').slice(0, 16);
  const session = await prisma.callSession.create({
    data: { tripId: input.tripId, callerId: input.callerId, calleeId: p.calleeId, relayToken, status: 'INITIATED' },
  });

  if (!maskedCallingOn()) {
    return { sessionId: session.id, mode: 'DIRECT', phone: p.calleePhone, counterpartName: p.counterpartName };
  }
  if (!p.callerPhone) throw new AppError('We have no number on your account to ring.', 409, 'NO_CALLER_NUMBER');
  try {
    await atVoice().call({ callFrom: env.AT_VOICE_NUMBER, callTo: [p.callerPhone], clientRequestId: relayToken });
  } catch (err) {
    logger.warn('[contact] AT voice call failed', { error: String(err?.message ?? err) });
    await prisma.callSession.update({ where: { id: session.id }, data: { status: 'ENDED', endedAt: new Date() } }).catch(() => {});
    throw new AppError('We couldn’t start the call — try again, or use the chat.', 502, 'CALL_FAILED');
  }
  return {
    sessionId: session.id,
    mode: 'CALLBACK',
    counterpartName: p.counterpartName,
    message: `We're calling you now — answer to be connected to ${p.counterpartName}. Your numbers stay private.`,
  };
}

const xml = (body) => `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;

/**
 * AT's voice callback: the caller answered — bridge them to the other side.
 * Public (AT posts form fields). Answers only a session that is fresh, still
 * INITIATED, and named by its unguessable relay token.
 */
async function voiceCallback(body = {}) {
  const token = String(body.clientRequestId ?? '');
  const session = token
    ? await prisma.callSession.findUnique({ where: { relayToken: token } })
    : null;
  if (String(body.isActive) === '0') {
    if (session) await prisma.callSession.update({ where: { id: session.id }, data: { status: 'ENDED', endedAt: new Date() } }).catch(() => {});
    return xml('');
  }
  if (!session || session.status !== 'INITIATED' || Date.now() - session.createdAt.getTime() > SESSION_TTL_MS) {
    return xml('<Say>Sorry, this call can no longer be connected.</Say>');
  }
  const caller = await prisma.driver.findUnique({ where: { id: session.callerId }, select: { id: true } });
  const p = await resolveParties({
    callerId: session.callerId,
    callerRole: caller ? 'DRIVER' : 'PASSENGER',
    calleeRole: caller ? 'PASSENGER' : 'DRIVER',
    tripId: session.tripId,
    calleeBookingId: session.calleeId, // the passenger the driver chose
  }).catch(() => null);
  if (!p?.calleePhone) return xml('<Say>Sorry, we could not reach them. Please use the chat.</Say>');
  await prisma.callSession.update({ where: { id: session.id }, data: { status: 'CONNECTED' } }).catch(() => {});
  return xml(`<Dial phoneNumbers="${p.calleePhone.replace(/[^+\d]/g, '')}" callerId="${env.AT_VOICE_NUMBER}" record="false"/>`);
}

async function endCall(sessionId, userId) {
  const session = await prisma.callSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new NotFoundError('CallSession');
  if (session.callerId !== userId && session.calleeId !== userId) {
    throw new ForbiddenError('Not part of this call');
  }

  return prisma.callSession.update({
    where: { id: sessionId },
    data: { status: 'ENDED', endedAt: new Date() },
  });
}

module.exports = { initiateCall, endCall, voiceCallback, maskedCallingOn, resolveParties };
