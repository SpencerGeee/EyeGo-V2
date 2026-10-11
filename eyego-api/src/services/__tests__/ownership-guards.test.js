'use strict';

/**
 * The ownership class (2026-10-11 hunt): every check here once let a caller act
 * on, or read, something that was not theirs.
 */
jest.mock('../../config/database', () => ({
  booking: { findFirst: jest.fn() },
  trip: { findUnique: jest.fn() },
}));

const prisma = require('../../config/database');
const { canSeeTrip } = require('../../graphql/resolvers');
const { resolveParties } = require('../../modules/contact/contact.service');

const trip = { id: 't1', driverId: 'd1', requesterId: 'u1' };

describe('GraphQL canSeeTrip', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lets the owning driver in — the token says userId, never driverId', async () => {
    expect(await canSeeTrip({ userId: 'd1', role: 'DRIVER' }, trip)).toBe(true);
    expect(await canSeeTrip({ userId: 'd2', role: 'DRIVER' }, trip)).toBe(false);
  });

  it('lets the requester in without a booking lookup', async () => {
    expect(await canSeeTrip({ userId: 'u1', role: 'PASSENGER' }, trip)).toBe(true);
    expect(prisma.booking.findFirst).not.toHaveBeenCalled();
  });

  it('asks for a LIVE seat, not any booking row', async () => {
    prisma.booking.findFirst.mockResolvedValue(null);
    expect(await canSeeTrip({ userId: 'u9', role: 'PASSENGER' }, trip)).toBe(false);
    const { where } = prisma.booking.findFirst.mock.calls[0][0];
    expect(where).toMatchObject({ tripId: 't1', userId: 'u9' });
    expect(Object.keys(where).length).toBeGreaterThan(2); // the seat-occupying filter is there
  });

  it('refuses anonymous callers and unknown trips', async () => {
    expect(await canSeeTrip(null, trip)).toBe(false);
    expect(await canSeeTrip({ userId: 'u1', role: 'PASSENGER' }, null)).toBe(false);
  });
});

describe('masked calling — live trips only', () => {
  it('refuses a call on an ended trip, so old riders’ numbers cannot be pulled', async () => {
    prisma.trip.findUnique.mockResolvedValue({
      ...trip, status: 'COMPLETED', driver: { id: 'd1', name: 'Kofi', phone: '+233200000009' },
      bookings: [{ id: 'b1', userId: 'u1', user: { name: 'Ama', phone: '+233200000001' } }],
    });
    await expect(
      resolveParties({ callerId: 'd1', callerRole: 'DRIVER', calleeRole: 'PASSENGER', tripId: 't1' }),
    ).rejects.toMatchObject({ code: 'TRIP_ENDED' });
  });
});
