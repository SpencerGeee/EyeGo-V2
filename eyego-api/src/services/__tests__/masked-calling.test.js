'use strict';

jest.mock('../../config/database', () => ({
  callSession: { findUnique: jest.fn(), update: jest.fn(async () => ({})) },
  driver: { findUnique: jest.fn() },
  trip: { findUnique: jest.fn() },
}));

const prisma = require('../../config/database');
const env = require('../../config/env');
const { voiceCallback } = require('../../modules/contact/contact.service');

const trip = {
  id: 't1', driverId: 'd1', driver: { id: 'd1', name: 'Kofi', phone: '+233200000009' },
  bookings: [{ id: 'b1', userId: 'u1', guestName: null, guestPhone: null, user: { name: 'Ama', phone: '+233200000001' } }],
};

describe('masked calling — AT voice callback', () => {
  beforeAll(() => { env.AT_VOICE_NUMBER = '+233300000000'; });
  beforeEach(() => jest.clearAllMocks());

  it('bridges a fresh session to the other party, showing EyeGo’s number', async () => {
    prisma.callSession.findUnique.mockResolvedValue({ id: 's1', tripId: 't1', callerId: 'u1', calleeId: 'd1', status: 'INITIATED', createdAt: new Date() });
    prisma.driver.findUnique.mockResolvedValue(null); // caller is a rider
    prisma.trip.findUnique.mockResolvedValue(trip);
    const out = await voiceCallback({ clientRequestId: 'tok', isActive: '1' });
    expect(out).toContain('phoneNumbers="+233200000009"');
    expect(out).toContain('callerId="+233300000000"');
  });

  it('refuses an unknown, stale or already-used token', async () => {
    prisma.callSession.findUnique.mockResolvedValue(null);
    expect(await voiceCallback({ clientRequestId: 'nope', isActive: '1' })).toContain('<Say>');
    prisma.callSession.findUnique.mockResolvedValue({ id: 's1', status: 'INITIATED', createdAt: new Date(Date.now() - 10 * 60_000) });
    expect(await voiceCallback({ clientRequestId: 'old', isActive: '1' })).not.toContain('<Dial');
    prisma.callSession.findUnique.mockResolvedValue({ id: 's1', status: 'CONNECTED', createdAt: new Date() });
    expect(await voiceCallback({ clientRequestId: 'used', isActive: '1' })).not.toContain('<Dial');
  });

  it('closes the session when AT reports the call ended', async () => {
    prisma.callSession.findUnique.mockResolvedValue({ id: 's1', status: 'CONNECTED', createdAt: new Date() });
    await voiceCallback({ clientRequestId: 'tok', isActive: '0' });
    expect(prisma.callSession.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'ENDED' }) }));
  });
});
