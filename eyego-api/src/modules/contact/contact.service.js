'use strict';

const prisma = require('../../config/database');
const env = require('../../config/env');
const { v4: uuidv4 } = require('uuid');
const { NotFoundError, AppError, ForbiddenError } = require('../../utils/errors');

/**
 * Initiate an anonymized contact relay between a rider and driver.
 *
 * Creates a CallSession and returns a masked relay placeholder (for sandbox,
 * returns a CONTACT_RELAY_NUMBER from env with a note). In production this
 * would hook into Twilio Proxy / Africa's Talking voice API.
 */
async function initiateCall({ callerId, callerRole, tripId, calleeRole }) {
  if (!tripId) throw new AppError('tripId is required', 400);
  if (!['DRIVER', 'PASSENGER'].includes(callerRole)) {
    throw new AppError('callerRole must be DRIVER or PASSENGER', 400);
  }
  if (!['DRIVER', 'PASSENGER'].includes(calleeRole)) {
    throw new AppError('calleeRole must be DRIVER or PASSENGER', 400);
  }
  if (callerRole === calleeRole) {
    throw new AppError('Caller and callee must be different roles', 400);
  }

  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      driver: { select: { id: true, name: true } },
      bookings: {
        where: { status: { in: ['CONFIRMED', 'BOARDED', 'PAID', 'COMPLETED'] } },
        select: { userId: true, id: true },
      },
    },
  });
  if (!trip) throw new NotFoundError('Trip');

  // Resolve callee ID and counterpart name
  let calleeId;
  let counterpartName;

  if (calleeRole === 'DRIVER') {
    calleeId = trip.driverId;
    counterpartName = trip.driver.name;
  } else {
    // Find the caller (if driver) or find any rider (if passenger calling driver)
    if (callerRole === 'DRIVER') {
      // Driver calls passenger — return first confirmed rider's name
      const firstBooking = trip.bookings[0];
      if (!firstBooking) throw new AppError('No active passengers on this trip', 400);
      calleeId = firstBooking.userId;
      const rider = await prisma.user.findUnique({
        where: { id: firstBooking.userId },
        select: { name: true },
      });
      counterpartName = rider?.name ?? 'Passenger';
    } else {
      // Passenger calls driver — just get driver ID
      calleeId = trip.driverId;
      counterpartName = trip.driver.name;
    }
  }

  // Verify caller is legitimately on this trip
  if (callerRole === 'DRIVER' && callerId !== trip.driverId) {
    throw new ForbiddenError('Caller is not the driver of this trip');
  }
  if (callerRole === 'PASSENGER') {
    const isOnTrip = trip.bookings.some((b) => b.userId === callerId);
    if (!isOnTrip) throw new ForbiddenError('Caller is not a passenger on this trip');
  }

  const relayToken = uuidv4().replace(/-/g, '').slice(0, 16);
  const relayNumber = env.CONTACT_RELAY_NUMBER || '+233000000000'; // placeholder

  const session = await prisma.callSession.create({
    data: {
      tripId,
      callerId,
      calleeId,
      relayToken,
      status: 'INITIATED',
    },
  });

  return {
    sessionId: session.id,
    relayToken: session.relayToken,
    relayNumber,
    counterpartName,
    callInstruction: `Call ${relayNumber} and enter code ${session.relayToken.slice(0, 6)} to connect (sandbox — real PSTN requires Twilio / Africa's Talking)`,
  };
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

module.exports = { initiateCall, endCall };
