'use strict';

jest.mock('../../config/database', () => {
  const tx = {
    booking: { findFirst: jest.fn(), update: jest.fn() },
    paymentTransaction: { create: jest.fn() },
  };
  return { $transaction: (fn) => fn(tx), user: { findUnique: jest.fn(async () => null) }, __tx: tx };
});
jest.mock('../rider-wallet.service', () => ({ record: jest.fn() }));
jest.mock('../../modules/wallet/wallet.service', () => ({ moveDriverBalance: jest.fn() }));

const prisma = require('../../config/database');
const riderWallet = require('../rider-wallet.service');
const { moveDriverBalance } = require('../../modules/wallet/wallet.service');
const { recordCashReceived } = require('../../modules/drivers/drivers.service');

const booking = (over = {}) => ({
  id: 'b1', userId: 'u1', paymentMethod: 'CASH', fareAmountPesewas: 3700, cashReceivedPesewas: null, status: 'BOARDED', ...over,
});

describe('recordCashReceived — no change? it goes to their wallet', () => {
  beforeEach(() => jest.clearAllMocks());

  it('moves the overpayment rider-wallet up, driver-wallet down', async () => {
    prisma.__tx.booking.findFirst.mockResolvedValue(booking());
    const r = await recordCashReceived('d1', 't1', 'b1', 5000);
    expect(r.changePesewas).toBe(1300);
    expect(riderWallet.record).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', type: 'CASH_CHANGE', amountPesewas: 1300 }));
    expect(moveDriverBalance).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ driverId: 'd1', deltaPesewas: -1300, type: 'CASH_CHANGE' }));
  });
  it('exact fare records the cash and moves nothing', async () => {
    prisma.__tx.booking.findFirst.mockResolvedValue(booking());
    expect((await recordCashReceived('d1', 't1', 'b1', 3700)).changePesewas).toBe(0);
    expect(riderWallet.record).not.toHaveBeenCalled();
  });
  it('refuses under the fare, twice, and over the cap', async () => {
    prisma.__tx.booking.findFirst.mockResolvedValue(booking());
    await expect(recordCashReceived('d1', 't1', 'b1', 3000)).rejects.toMatchObject({ code: 'UNDERPAID' });
    prisma.__tx.booking.findFirst.mockResolvedValue(booking({ cashReceivedPesewas: 4000 }));
    await expect(recordCashReceived('d1', 't1', 'b1', 5000)).rejects.toMatchObject({ code: 'CASH_ALREADY_RECORDED' });
    prisma.__tx.booking.findFirst.mockResolvedValue(booking());
    await expect(recordCashReceived('d1', 't1', 'b1', 3700 + 50_01)).rejects.toMatchObject({ code: 'CHANGE_TOO_LARGE' });
  });
});
