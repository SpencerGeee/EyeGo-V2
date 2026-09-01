'use strict';

/**
 * The driver wallet: reading it, crediting a top-up, and withdrawing.
 *
 * ── WHY THIS FILE WAS REWRITTEN ─────────────────────────────────────────────
 *
 * It asserted an API that no longer exists. It read `walletBalance` as a float
 * of cedis and expected `getWallet` to return `{ balance }` — both from before
 * money moved to integer pesewas, which is the single most important invariant
 * in this codebase. Its mock transaction client had no `findFirst`, so
 * `creditTopUp` threw "tx.walletTransaction.findFirst is not a function": the
 * mock never learned about the idempotency guard that was added to stop a
 * replayed webhook crediting a driver twice.
 *
 * None of that was visible, because the suite could not run at all — nothing
 * loaded `.env`, so the first `require` that reached `config/redis` called
 * `process.exit(1)` and took the worker with it. A test that cannot run does
 * not go red; it disappears.
 *
 * So the assertions here are written against what the service does NOW, and
 * deliberately against behaviour rather than call shape: the old suite compared
 * exact Prisma `select` objects, which meant adding a column to a query broke a
 * test that had nothing to say about the column.
 */

const mockDriver = {
  findUnique: jest.fn(),
  update: jest.fn(),
  updateMany: jest.fn(),
};

const mockWalletTransaction = {
  findMany: jest.fn(),
  findFirst: jest.fn(),
  create: jest.fn(),
};

const mockPrisma = {
  driver: mockDriver,
  walletTransaction: mockWalletTransaction,
  // The transaction client is the same object: every test here cares about
  // what was written, not about isolation semantics a mock cannot model.
  $transaction: jest.fn((cb) => cb(mockPrisma)),
};

jest.mock('../src/config/database', () => mockPrisma);

jest.mock('../src/modules/payments/paystack.client', () => ({
  initiateMomoCharge: jest.fn(),
  createTransferRecipient: jest.fn(),
  initiateTransfer: jest.fn(),
  resolvePayoutBankCode: jest.fn(),
}));

const walletService = require('../src/modules/wallet/wallet.service');
const paystack = require('../src/modules/payments/paystack.client');

/** A driver row as the service selects it. Pesewas, always. */
const driverRow = (over = {}) => ({
  walletBalancePesewas: 150_00,
  name: 'Kwame',
  phone: '+233200000000',
  payoutHold: false,
  payoutHoldReason: null,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockDriver.updateMany.mockResolvedValue({ count: 1 });
  mockWalletTransaction.findFirst.mockResolvedValue(null);
  mockWalletTransaction.create.mockResolvedValue({ id: 'wt1' });
  mockWalletTransaction.findMany.mockResolvedValue([]);
});

describe('getWallet', () => {
  it('reports the balance in pesewas, not cedis', async () => {
    mockDriver.findUnique.mockResolvedValue({ walletBalancePesewas: 150_00 });
    const txs = [{ id: 'tx1', amountPesewas: 50_00, type: 'TOP_UP' }];
    mockWalletTransaction.findMany.mockResolvedValue(txs);

    const result = await walletService.getWallet('d1');

    // The name of the field is the assertion. A caller that reads `balance`
    // and gets 15000 will render ₵15,000 for a ₵150 wallet.
    expect(result).toEqual({ balancePesewas: 150_00, transactions: txs });
  });

  it('refuses to invent a wallet for a driver who does not exist', async () => {
    mockDriver.findUnique.mockResolvedValue(null);
    await expect(walletService.getWallet('nope')).rejects.toThrow(/driver/i);
  });

  it('caps how many transactions it will return', async () => {
    mockDriver.findUnique.mockResolvedValue({ walletBalancePesewas: 0 });
    await walletService.getWallet('d1', 10_000);
    // Unbounded, this is a driver with three years of history pulling every
    // row into memory to render one screen.
    expect(mockWalletTransaction.findMany.mock.calls[0][0].take).toBeLessThanOrEqual(500);
  });
});

describe('creditTopUp', () => {
  it('credits the balance and records the movement', async () => {
    mockDriver.update.mockResolvedValue({ walletBalancePesewas: 200_00 });

    await walletService.confirmTopUp('d1', 'ref-1', 50_00);

    expect(mockDriver.update).toHaveBeenCalled();
    expect(mockWalletTransaction.create).toHaveBeenCalled();
  });

  it('is idempotent — a replayed webhook does not credit twice', async () => {
    // The guard the old mock had never heard of. Paystack retries webhooks;
    // without this a driver is paid again for every retry.
    mockWalletTransaction.findFirst.mockResolvedValue({ id: 'existing', balanceAfterPesewas: 200_00 });

    await walletService.confirmTopUp('d1', 'ref-already-seen', 50_00);

    expect(mockDriver.update).not.toHaveBeenCalled();
    expect(mockWalletTransaction.create).not.toHaveBeenCalled();
  });

  it('refuses a fractional amount', async () => {
    // Money is integer pesewas everywhere. A float here is a rounding error
    // that compounds across a ledger.
    await expect(walletService.confirmTopUp('d1', 'ref-2', 50.5)).rejects.toThrow();
  });
});

describe('withdraw', () => {
  const PAYOUT = { type: 'momo', accountNumber: '0200000000', provider: 'MTN' };

  beforeEach(() => {
    mockDriver.findUnique.mockResolvedValue(driverRow());
    paystack.createTransferRecipient.mockResolvedValue({ recipient_code: 'RCP_1' });
    paystack.initiateTransfer.mockResolvedValue({ status: 'success', reference: 'trf_1' });
  });

  it('refuses more than the balance', async () => {
    mockDriver.findUnique.mockResolvedValue(driverRow({ walletBalancePesewas: 10_00 }));
    await expect(walletService.withdraw('d1', 500_00)).rejects.toThrow();
    expect(paystack.initiateTransfer).not.toHaveBeenCalled();
  });

  it('refuses while a payout hold is in force, and says why', async () => {
    mockDriver.findUnique.mockResolvedValue(
      driverRow({ payoutHold: true, payoutHoldReason: 'under review' }),
    );

    // The hold is read inside the same transaction as the balance: a hold
    // applied between the read and the debit is exactly when it matters.
    await expect(walletService.withdraw('d1', 20_00)).rejects.toThrow(/under review/i);
    expect(paystack.initiateTransfer).not.toHaveBeenCalled();
  });

  it('refuses an amount below the minimum', async () => {
    await expect(walletService.withdraw('d1', 1)).rejects.toThrow();
  });
});
