'use strict';

/**
 * Webhook idempotency and wallet withdrawal resource-contention tests.
 *
 * Webhook test scenarios:
 *   1. First delivery processes successfully (acquires Redis lock)
 *   2. Concurrent duplicate returns { duplicate: true } (lock already held)
 *   3. Delayed replay returns { received: true } (already processed in DB)
 *   4. Invalid signatures are rejected
 *
 * Wallet contention:
 *   5. N concurrent withdrawals against limited balance — only N-2 succeed
 *      (guarded by updateMany with gte constraint)
 */

const crypto = require('crypto');

// ────────────────────────────────────────────────────────────────────────────
// Webhook idempotency
// ────────────────────────────────────────────────────────────────────────────
describe('Webhook idempotency — Redis NX lock + DB replay guard', () => {
  let mockRedis;
  let mockPaymentTransaction;
  let mockBooking;
  let mockTrip;
  let mockPrisma;
  let paymentsService;

  beforeEach(() => {
    jest.resetModules();

    mockRedis = { set: jest.fn(), del: jest.fn() };
    mockPaymentTransaction = {
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    };
    mockBooking = { findUnique: jest.fn(), updateMany: jest.fn() };
    mockTrip = { update: jest.fn() };
    mockPrisma = {
      booking: mockBooking,
      trip: mockTrip,
      paymentTransaction: mockPaymentTransaction,
      $transaction: jest.fn((cb) => cb(mockPrisma)),
    };

    jest.doMock('../src/config/database', () => mockPrisma);
    jest.doMock('../src/config/redis', () => mockRedis);
    jest.doMock('../src/modules/payments/paystack.client', () => ({
      initiateMomoCharge: jest.fn(),
      initializeCheckout: jest.fn(),
      verifyTransaction: jest.fn(),
    }));
    jest.doMock('../src/services/push.service', () => ({ sendPush: jest.fn() }));
    jest.doMock('../src/config/env', () => ({
      PAYSTACK_SECRET_KEY: 'test_secret',
      PLATFORM_COMMISSION: 0.15,
      MIN_OCCUPANCY_TO_DEPART: 5,
      SEAT_HOLD_DURATION_MINUTES: 10,
    }));

    paymentsService = require('../src/modules/payments/payments.service');
    process.env.PAYSTACK_SECRET_KEY = 'test_secret';
  });

  function buildSignature(body) {
    return crypto.createHmac('sha512', 'test_secret').update(body).digest('hex');
  }

  it('processes first webhook delivery and returns received:true', async () => {
    const body = JSON.stringify({
      event: 'charge.success',
      data: {
        reference: 'ref-w-1',
        metadata: { bookingId: 'b-w-1' },
      },
    });
    const sig = buildSignature(body);

    // Redis lock acquired
    mockRedis.set.mockResolvedValue('OK');
    // No existing successful transaction
    mockPaymentTransaction.findFirst.mockResolvedValue(null);
    // Booking found and confirmable
    mockBooking.findUnique.mockResolvedValue({
      id: 'b-w-1',
      userId: 'u1',
      paymentStatus: 'SEAT_HELD',
      status: 'SEAT_HELD',
      fareAmount: 20.0,
      paymentMethod: 'MOMO_MTN',
      tripId: 't-w-1',
      trip: {
        confirmedSeats: 0,
        maxSeats: 10,
        status: 'FILLING',
        route: { distanceKm: 10 },
      },
    });
    mockBooking.updateMany.mockResolvedValue({ count: 1 });
    mockTrip.update.mockResolvedValue({ confirmedSeats: 1 });

    const result = await paymentsService.handleWebhook(body, sig);

    expect(result).toEqual({ received: true });
    expect(mockRedis.set).toHaveBeenCalledWith('lock:webhook:ref-w-1', '1', 'EX', 30, 'NX');
    expect(mockRedis.del).toHaveBeenCalledWith('lock:webhook:ref-w-1');
    expect(mockBooking.updateMany).toHaveBeenCalled();
  });

  it('returns { duplicate: true } when Redis NX lock is already held (concurrent delivery)', async () => {
    const body = JSON.stringify({
      event: 'charge.success',
      data: {
        reference: 'ref-w-2',
        metadata: { bookingId: 'b-w-2' },
      },
    });
    const sig = buildSignature(body);

    // Lock not acquired — another webhook handler is already processing
    mockRedis.set.mockResolvedValue(null);

    const result = await paymentsService.handleWebhook(body, sig);

    expect(result).toEqual({ duplicate: true });
    expect(mockBooking.updateMany).not.toHaveBeenCalled();
    expect(mockPaymentTransaction.create).not.toHaveBeenCalled();
  });

  it('returns { received: true } on replay after first webhook was already processed', async () => {
    const body = JSON.stringify({
      event: 'charge.success',
      data: {
        reference: 'ref-w-3',
        metadata: { bookingId: 'b-w-3' },
      },
    });
    const sig = buildSignature(body);

    // Lock acquired (new delivery attempt)
    mockRedis.set.mockResolvedValue('OK');
    // But the transaction already has SUCCESS status (already processed)
    mockPaymentTransaction.findFirst.mockResolvedValue({
      id: 'tx-w-3',
      paystackRef: 'ref-w-3',
      status: 'SUCCESS',
    });

    const result = await paymentsService.handleWebhook(body, sig);

    expect(result).toEqual({ received: true });
    // confirmPayment should NOT be called — already processed
    expect(mockBooking.updateMany).not.toHaveBeenCalled();
    // Lock released
    expect(mockRedis.del).toHaveBeenCalledWith('lock:webhook:ref-w-3');
  });

  it('rejects requests with invalid webhook signature', async () => {
    const body = JSON.stringify({ event: 'charge.success', data: {} });

    await expect(
      paymentsService.handleWebhook(body, 'invalid-signature'),
    ).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });

    // No DB queries or locks should have been attempted
    expect(mockRedis.set).not.toHaveBeenCalled();
    expect(mockBooking.findUnique).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Wallet withdrawal contention
// ────────────────────────────────────────────────────────────────────────────
describe('Concurrent wallet withdrawal — resource contention', () => {
  let mockDriver;
  let mockWalletTx;
  let mockPrisma;
  let mockPaystack;
  let walletService;

  beforeEach(() => {
    jest.resetModules();

    mockDriver = { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() };
    mockWalletTx = { create: jest.fn(), findMany: jest.fn() };
    mockPrisma = {
      driver: mockDriver,
      walletTransaction: mockWalletTx,
      $transaction: jest.fn(),
    };
    mockPaystack = {
      createTransferRecipient: jest.fn(),
      initiateTransfer: jest.fn(),
    };

    jest.doMock('../src/config/database', () => mockPrisma);
    jest.doMock('../src/modules/payments/paystack.client', () => mockPaystack);
    jest.doMock('../src/config/env', () => ({
      PAYSTACK_SECRET_KEY: 'test_secret',
      PLATFORM_COMMISSION: 0.15,
      MIN_OCCUPANCY_TO_DEPART: 5,
      SEAT_HOLD_DURATION_MINUTES: 10,
      DRIVER_MIN_WITHDRAWAL: 0,
    }));

    walletService = require('../src/modules/wallet/wallet.service');
  });

  it('allows exactly 3 of 10 concurrent withdrawals against GHS 100 balance at GHS 30 each', async () => {
    /**
     * Classic race: 10 concurrent withdrawal attempts, wallet has GHS 100.
     * Each withdraws GHS 30. Without the updateMany gte guard, all 10 could pass
     * the findUnique balance check and overspend. With the guard, exactly 3
     * succeed (3 × 30 = 90 ≤ 100) and 7 fail.
     */
    const BALANCE = 100;
    const AMOUNT = 30;
    const TOTAL = 10;

    mockPrisma.$transaction.mockImplementation((cb) => cb(mockPrisma));

    // findUnique always shows sufficient balance — simulating the race window
    mockDriver.findUnique.mockResolvedValue({
      walletBalance: BALANCE,
      name: 'Driver Race',
      phone: '+233240000099',
    });

    // Simulate decrementing balance with atomic guard
    let remaining = BALANCE;
    mockDriver.updateMany.mockImplementation(({ where, data }) => {
      if (data.walletBalance?.decrement) {
        if (remaining >= data.walletBalance.decrement) {
          remaining -= data.walletBalance.decrement;
          return Promise.resolve({ count: 1 });
        }
        return Promise.resolve({ count: 0 });
      }
      return Promise.resolve({ count: 1 });
    });

    mockWalletTx.create.mockResolvedValue({ id: 'tx-con' });
    mockPaystack.createTransferRecipient.mockResolvedValue({
      data: { recipient_code: 'RCP_CON' },
    });
    mockPaystack.initiateTransfer.mockResolvedValue({ success: true });

    const results = await Promise.allSettled(
      Array.from({ length: TOTAL }, () => walletService.withdraw('driver-con', AMOUNT)),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    // Exactly 3 should succeed (3 × 30 = 90 ≤ 100)
    expect(succeeded).toBe(3);
    expect(failed).toBe(7);
    // Each success created a wallet transaction
    expect(mockWalletTx.create).toHaveBeenCalledTimes(succeeded);
    // Final balance correctly tracked
    expect(remaining).toBe(10);
  });

  it('ensures all failing withdrawals get a clear error message', async () => {
    mockPrisma.$transaction.mockImplementation((cb) => cb(mockPrisma));
    mockDriver.findUnique.mockResolvedValue({
      walletBalance: 50,
      name: 'Driver Low',
      phone: '+233240000099',
    });
    // All fail
    mockDriver.updateMany.mockResolvedValue({ count: 0 });

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => walletService.withdraw('driver-low', 100)),
    );

    const failed = results.filter((r) => r.status === 'rejected');
    expect(failed).toHaveLength(5);
    failed.forEach((r) => {
      expect(r.reason.message).toMatch(/Insufficient|insufficient/i);
    });
  });

  it('recovers from a Paystack failure with a compensating reversal', async () => {
    mockPrisma.$transaction.mockImplementation((cb) => cb(mockPrisma));
    mockDriver.findUnique.mockResolvedValue({
      walletBalance: 200,
      name: 'Driver Recover',
      phone: '+233240000099',
    });
    mockDriver.updateMany.mockResolvedValue({ count: 1 });
    mockWalletTx.create.mockResolvedValue({ id: 'tx-recover' });

    // Paystack fails
    mockPaystack.createTransferRecipient.mockRejectedValue(
      new Error('Paystack server down'),
    );

    await expect(
      walletService.withdraw('driver-recover', 50),
    ).rejects.toThrow('Withdrawal failed. Your balance has been restored.');

    // Verify both the debit and the compensating credit were called
    // Debit: decrement
    expect(mockDriver.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'driver-recover' }),
        data: expect.objectContaining({ walletBalance: { decrement: 50 } }),
      }),
    );
    // Credit: increment (compensating)
    expect(mockDriver.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'driver-recover' },
        data: { walletBalance: { increment: 50 } },
      }),
    );
    // Two wallet transactions: WITHDRAWAL + WITHDRAWAL_REVERSAL
    expect(mockWalletTx.create).toHaveBeenCalledTimes(2);
    const calls = mockWalletTx.create.mock.calls.map(([args]) => args.data.type);
    expect(calls).toContain('WITHDRAWAL');
    expect(calls).toContain('WITHDRAWAL_REVERSAL');
  });
});
