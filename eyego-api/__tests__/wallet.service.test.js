'use strict';

const mockDriver = {
  findUnique: jest.fn(),
  update: jest.fn(),
  updateMany: jest.fn(),
};

const mockWalletTransaction = {
  findMany: jest.fn(),
  create: jest.fn(),
};

const mockPrisma = {
  driver: mockDriver,
  walletTransaction: mockWalletTransaction,
  $transaction: jest.fn((cb) => cb(mockPrisma)),
};

jest.mock('../src/config/database', () => mockPrisma);

jest.mock('../src/modules/payments/paystack.client', () => ({
  initiateMomoCharge: jest.fn(),
  createTransferRecipient: jest.fn(),
  initiateTransfer: jest.fn(),
}));

const walletService = require('../src/modules/wallet/wallet.service');
const paystack = require('../src/modules/payments/paystack.client');

describe('wallet.service transactions and withdrawals', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: allow updateMany to succeed (gte guard passes). Individual tests override for edge cases.
    mockDriver.updateMany.mockResolvedValue({ count: 1 });
  });

  describe('getWallet', () => {
    it('returns driver balance and recent transactions', async () => {
      mockDriver.findUnique.mockResolvedValue({ walletBalance: 150.0 });
      const txs = [{ id: 'tx1', amount: 50.0, type: 'TOP_UP' }];
      mockWalletTransaction.findMany.mockResolvedValue(txs);

      const result = await walletService.getWallet('d1');

      expect(mockDriver.findUnique).toHaveBeenCalledWith({
        where: { id: 'd1' },
        select: { walletBalance: true },
      });
      expect(result).toEqual({ balance: 150.0, transactions: txs });
    });
  });

  describe('confirmTopUp', () => {
    it('increments driver wallet balance and logs transaction atomically', async () => {
      mockDriver.findUnique.mockResolvedValue({ walletBalance: 100.0 });
      mockDriver.update.mockResolvedValue({ walletBalance: 150.0 });

      await walletService.confirmTopUp('d1', 'ref123', 50.0);

      expect(mockDriver.update).toHaveBeenCalledWith({
        where: { id: 'd1' },
        data: { walletBalance: { increment: 50.0 } },
      });
      expect(mockWalletTransaction.create).toHaveBeenCalledWith({
        data: {
          driverId: 'd1',
          type: 'TOP_UP',
          amount: 50.0,
          description: 'Wallet top-up via MoMo',
          balanceBefore: 100.0,
          balanceAfter: 150.0,
          paystackRef: 'ref123',
        },
      });
    });
  });

  describe('withdraw', () => {
    it('deducts balance and initiates Paystack transfer successfully', async () => {
      // Setup mock data for active withdrawal path
      const driverData = { walletBalance: 200.0, name: 'Driver Joe', phone: '+233240000002' };
      mockDriver.findUnique.mockResolvedValue(driverData);
      mockDriver.updateMany.mockResolvedValue({ count: 1 });
      mockDriver.update.mockResolvedValue({ walletBalance: 100.0 });
      
      paystack.createTransferRecipient.mockResolvedValue({ data: { recipient_code: 'RCP_123' } });
      paystack.initiateTransfer.mockResolvedValue({ success: true });

      const result = await walletService.withdraw('d1', 100.0);

      // Verify deduction transaction called
      expect(mockDriver.updateMany).toHaveBeenCalledWith({
        where: { id: 'd1', walletBalance: { gte: 100.0 } },
        data: { walletBalance: { decrement: 100.0 } },
      });
      expect(mockWalletTransaction.create).toHaveBeenCalledWith({
        data: {
          driverId: 'd1',
          type: 'WITHDRAWAL',
          amount: 100.0,
          description: 'Withdrawal to MoMo',
          balanceBefore: 200.0,
          balanceAfter: 100.0,
          paystackRef: expect.any(String),
        },
      });

      // Verify external paystack calls
      expect(paystack.createTransferRecipient).toHaveBeenCalledWith({
        name: 'Driver Joe',
        accountNumber: '+233240000002',
      });
      expect(paystack.initiateTransfer).toHaveBeenCalledWith({
        amount: 100.0,
        recipient: 'RCP_123',
        reason: 'EyeGo Driver earnings withdrawal',
        reference: expect.any(String),
      });
      expect(result).toHaveProperty('message');
    });

    it('runs compensating transaction if Paystack transfer fails', async () => {
      const driverData = { walletBalance: 200.0, name: 'Driver Joe', phone: '+233240000002' };
      mockDriver.findUnique.mockResolvedValue(driverData);
      mockDriver.updateMany.mockResolvedValue({ count: 1 });
      mockDriver.update.mockResolvedValue({ walletBalance: 100.0 });

      paystack.createTransferRecipient.mockRejectedValue(new Error('Paystack server down'));

      await expect(walletService.withdraw('d1', 100.0)).rejects.toThrow('Withdrawal failed. Your balance has been restored.');

      // Verify compensating transaction was invoked to increment balance back
      expect(mockDriver.update).toHaveBeenCalledWith({
        where: { id: 'd1' },
        data: { walletBalance: { increment: 100.0 } },
      });
      expect(mockWalletTransaction.create).toHaveBeenCalledWith({
        data: {
          driverId: 'd1',
          type: 'WITHDRAWAL_REVERSAL',
          amount: 100.0,
          description: 'Withdrawal reversal — Paystack transfer failed',
          balanceBefore: 100.0,
          balanceAfter: 200.0,
          paystackRef: expect.stringContaining('_reversal'),
        },
      });
    });

    it('rejects withdrawal if balance is insufficient', async () => {
      // Balance of 50.0 with withdrawal of 100.0 should fail the gte guard in updateMany
      mockDriver.findUnique.mockResolvedValue({ walletBalance: 50.0, name: 'Driver Joe', phone: '123' });
      mockDriver.updateMany.mockResolvedValue({ count: 0 }); // gte guard fails

      await expect(walletService.withdraw('d1', 100.0)).rejects.toThrow('Insufficient wallet balance');
      expect(mockDriver.updateMany).toHaveBeenCalledWith({
        where: { id: 'd1', walletBalance: { gte: 100.0 } },
        data: { walletBalance: { decrement: 100.0 } },
      });
      expect(paystack.initiateTransfer).not.toHaveBeenCalled();
    });
  });
});
