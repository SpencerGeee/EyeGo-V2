'use strict';

const { payDriverCancellationFee } = require('../../modules/cancellation/cancellation.service');

/** A transaction double that records the two writes moveDriverBalance makes. */
function fakeTx(balance = 1000) {
  const rows = [];
  return {
    rows,
    driver: {
      update: async ({ data }) => {
        balance += data.walletBalancePesewas.increment;
        return { walletBalancePesewas: balance };
      },
    },
    walletTransaction: { create: async ({ data }) => (rows.push(data), data) },
  };
}

describe('payDriverCancellationFee — the kept fee is the driver’s, less commission', () => {
  it('credits gross minus the trip’s commission and chains the ledger', async () => {
    const tx = fakeTx(1000);
    const net = await payDriverCancellationFee(tx, { id: 't1', driverId: 'd1', commissionRate: 0.2 }, 500, 'late');
    expect(net).toBe(400);
    expect(tx.rows[0]).toMatchObject({
      driverId: 'd1', type: 'CANCELLATION_FEE', amountPesewas: 400, tripId: 't1',
      balanceBeforePesewas: 1000, balanceAfterPesewas: 1400,
    });
  });
  it('pays nothing when nothing was kept or nobody drove', async () => {
    const tx = fakeTx();
    expect(await payDriverCancellationFee(tx, { id: 't1', driverId: 'd1', commissionRate: 0.2 }, 0, 'x')).toBe(0);
    expect(await payDriverCancellationFee(tx, { id: 't1', driverId: null, commissionRate: 0.2 }, 500, 'x')).toBe(0);
    expect(tx.rows).toHaveLength(0);
  });
});
