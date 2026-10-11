'use strict';

// The console refund cap counts what already went back automatically (a rider's
// own cancel, a driver's cancel) — excess-seat and duplicate-charge refunds are
// someone else's money and stay out of it.

const rows = [];
const db = {
  booking: { findUnique: async () => ({ id: 'b1', fareAmountPesewas: 1000, status: 'CANCELLED', paymentStatus: 'PAID', paymentMethod: 'MOMO', paystackRef: 'ref1', userId: 'u1' }) },
  refund: { aggregate: async () => ({ _sum: { amountPesewas: 100 } }) },
  paymentTransaction: { findMany: async () => rows },
  $queryRaw: async () => [],
};
db.$transaction = (fn) => fn(db);
jest.mock('../../config/database', () => db);

const { refundableAmount, issueRefund } = require('../refunds.service');

describe('refund cap', () => {
  beforeEach(() => {
    rows.length = 0;
    rows.push(
      { amountPesewas: 800, paystackRef: null, gatewayResponse: 'Refunded GH₵8.00 (fee: GH₵2.00)' },
      { amountPesewas: 500, paystackRef: 'ref1_excess', gatewayResponse: 'Refunded to wallet' },
      { amountPesewas: 900, paystackRef: 'ref2', gatewayResponse: 'Duplicate payment refunded to wallet' },
    );
  });

  it('counts the rider’s own cancellation refund, not excess or duplicate refunds', async () => {
    const s = await refundableAmount('b1');
    expect(s.alreadyRefundedPesewas).toBe(900); // 100 console + 800 cancellation
    expect(s.remainingPesewas).toBe(100);
  });

  it('refuses to refund past what is left', async () => {
    await expect(issueRefund('b1', { amountPesewas: 500, reason: 'goodwill', admin: { email: 'a@x' } }))
      .rejects.toMatchObject({ code: 'REFUND_EXCEEDS_REMAINING' });
  });
});
