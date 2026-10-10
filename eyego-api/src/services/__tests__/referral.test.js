'use strict';

jest.mock('../../config/database', () => {
  const db = {
    user: { findUnique: jest.fn(), findMany: jest.fn(async () => []) },
    booking: { count: jest.fn() },
    referral: { create: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
    paymentTransaction: { create: jest.fn() },
    referralBonus: { create: jest.fn() },
  };
  db.$transaction = (fn) => fn(db);
  return db;
});
jest.mock('../rider-wallet.service', () => ({ record: jest.fn() }));
jest.mock('../push.service', () => ({ sendPush: jest.fn(async () => 'ok') }));

const prisma = require('../../config/database');
const riderWallet = require('../rider-wallet.service');
const { redeem, rewardFirstRides } = require('../referral.service');

const me = { id: 'u2', phone: '+233200000002', createdAt: new Date() };
const friend = { id: 'u1', phone: '+233200000001', name: 'Ama' };

describe('referrals', () => {
  beforeEach(() => jest.clearAllMocks());

  it('a new rider redeems a friend’s code', async () => {
    prisma.user.findUnique.mockImplementation(async ({ where }) => (where.id ? me : friend));
    prisma.booking.count.mockResolvedValue(0);
    await expect(redeem('u2', 'amaxk3p')).resolves.toMatchObject({ inviterName: 'Ama' });
    expect(prisma.referral.create).toHaveBeenCalledWith({ data: { inviterId: 'u1', inviteeId: 'u2' } });
  });

  it('refuses your own code, and riders who already rode', async () => {
    prisma.user.findUnique.mockImplementation(async () => me);
    await expect(redeem('u2', 'MINE1234')).rejects.toMatchObject({ code: 'SELF_REFERRAL' });
    prisma.user.findUnique.mockImplementation(async ({ where }) => (where.id ? me : friend));
    prisma.booking.count.mockResolvedValue(1);
    await expect(redeem('u2', 'AMA12345')).rejects.toMatchObject({ code: 'NOT_NEW' });
  });

  it('pays both sides once, after the first paid ride', async () => {
    prisma.referral.findMany.mockResolvedValue([{ id: 'r1', inviterId: 'u1', inviteeId: 'u2' }]);
    prisma.booking.count.mockResolvedValue(1);
    prisma.referral.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect(await rewardFirstRides(['u2'])).toBe(1);
    expect(riderWallet.record).toHaveBeenCalledTimes(2);
    // A second completion (retry, second trip) finds it claimed.
    expect(await rewardFirstRides(['u2'])).toBe(0);
    expect(riderWallet.record).toHaveBeenCalledTimes(2);
  });
});
