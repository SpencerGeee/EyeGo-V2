'use strict';

jest.mock('../../config/database', () => ({ driverDocument: { findMany: jest.fn(), update: jest.fn() } }));
jest.mock('../push.service', () => ({ sendPush: jest.fn(async () => 'ok') }));

const prisma = require('../../config/database');
const push = require('../push.service');
const { runExpiryWarnings } = require('../driver-documents.service');

const DAY = 86_400_000;
const now = new Date('2026-10-10T08:00:00Z');
const doc = (daysLeft, expiryNoticeDays = null) => ({
  id: `d${daysLeft}`, driverId: 'drv', type: 'DRIVERS_LICENSE', expiresAt: new Date(now.getTime() + daysLeft * DAY),
  expiryNoticeDays, driver: { id: 'drv', name: 'K', fcmToken: 'tok' },
});
// The sweep asks per bucket (1, 7, 30 days); answer with the docs inside each.
const serve = (docs) =>
  prisma.driverDocument.findMany.mockImplementation(async ({ where }) =>
    docs.filter((d) => d.expiresAt >= where.expiresAt.gte && d.expiresAt <= where.expiresAt.lte));

describe('document expiry warnings — once per threshold, not every hour', () => {
  beforeEach(() => jest.clearAllMocks());

  it('warns once when a document enters the 30-day window, then stays quiet', async () => {
    serve([doc(20)]);
    await runExpiryWarnings(now);
    expect(push.sendPush).toHaveBeenCalledTimes(1);
    expect(prisma.driverDocument.update).toHaveBeenCalledWith({ where: { id: 'd20' }, data: { expiryNoticeDays: 30 } });

    jest.clearAllMocks();
    serve([doc(20, 30)]); // the next hourly run
    await runExpiryWarnings(now);
    expect(push.sendPush).not.toHaveBeenCalled();
  });

  it('speaks again when it crosses into a tighter threshold', async () => {
    serve([doc(5, 30)]);
    await runExpiryWarnings(now);
    expect(push.sendPush).toHaveBeenCalledTimes(1);
    expect(prisma.driverDocument.update).toHaveBeenCalledWith({ where: { id: 'd5' }, data: { expiryNoticeDays: 7 } });
  });
});
