'use strict';

jest.mock('../../config/database', () => ({ trip: { findMany: jest.fn() } }));
const mockSent = new Set();
jest.mock('../../config/redis', () => ({
  set: jest.fn(async (k) => (mockSent.has(k) ? null : (mockSent.add(k), 'OK'))),
}));
jest.mock('../push.service', () => ({ sendPush: jest.fn(async () => 'ok'), prefAllows: () => true }));

const prisma = require('../../config/database');
const push = require('../push.service');
const { runDepartureReminders } = require('../trip-lifecycle.service');

const now = new Date('2026-10-10T08:00:00Z');
const trip = {
  id: 't1', departureTime: new Date('2026-10-10T08:25:00Z'), pickupAddress: null, dropoffAddress: null,
  driver: { fcmToken: 'drv' }, route: { originName: 'Madina', destinationName: 'Circle' },
  bookings: [{ seats: 2, pickupAddress: 'Madina Zongo Junction', user: { fcmToken: 'r1', notificationPrefs: null } }],
};

describe('departure reminders', () => {
  it('reminds the riders and the driver once, in local (UTC+0) time', async () => {
    prisma.trip.findMany.mockResolvedValue([trip]);
    await runDepartureReminders(now);
    expect(push.sendPush).toHaveBeenCalledWith('r1', 'Your trip leaves at 08:25', expect.stringContaining('Madina Zongo Junction'), expect.any(Object));
    expect(push.sendPush).toHaveBeenCalledWith('drv', 'Your trip departs at 08:25', 'Madina → Circle · 2 seats booked.', expect.any(Object));

    push.sendPush.mockClear();
    await runDepartureReminders(now); // next sweep
    expect(push.sendPush).not.toHaveBeenCalled();
  });
});
