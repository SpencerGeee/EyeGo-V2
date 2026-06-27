'use strict';

/**
 * Complex concurrency, race-condition, and idempotency tests.
 *
 * These tests cover three categories of race-prone operations:
 *   1. TOCTOU races — check-then-act patterns that need serializable transactions
 *   2. Webhook idempotency — duplicate delivery protection via Redis NX locks
 *   3. Resource-contention load — concurrent wallet withdrawals against limited balance
 *
 * Each group uses isolated mocks so failures don't cascade.
 */

// ────────────────────────────────────────────────────────────────────────────
// 1. TOCTOU race: createRideGroup
// ────────────────────────────────────────────────────────────────────────────
const mockRideGroup1 = {
  findUnique: jest.fn(),
  create: jest.fn(),
};

const mockPrisma1 = {
  rideGroup: mockRideGroup1,
  $transaction: jest.fn(),
};

jest.mock('../src/config/env', () => ({
  SEAT_HOLD_DURATION_MINUTES: 10,
  PLATFORM_COMMISSION: 0.15,
  MIN_OCCUPANCY_TO_DEPART: 5,
  PAYSTACK_SECRET_KEY: 'test_secret',
  APP_URL: 'https://eyego.app',
  DRIVER_MIN_WITHDRAWAL: 20,
}));

jest.mock('../src/config/database', () => mockPrisma1);

const bookingsService = require('../src/modules/bookings/bookings.service');

describe('TOCTOU race: createRideGroup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a ride group when none exists (happy path)', async () => {
    // Simulate serializable transaction: callback receives a tx object
    mockPrisma1.$transaction.mockImplementation((cb, opts) => {
      expect(opts.isolationLevel).toBe('Serializable');
      return cb(mockPrisma1);
    });

    mockRideGroup1.findUnique.mockResolvedValue(null);
    const createdGroup = {
      id: 'rg-1',
      tripId: 'trip-1',
      leadPassengerId: 'user-1',
      isCoverAll: false,
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    };
    mockRideGroup1.create.mockResolvedValue(createdGroup);

    const result = await bookingsService.createRideGroup('trip-1', 'user-1');

    expect(mockPrisma1.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
    expect(mockRideGroup1.findUnique).toHaveBeenCalledWith({ where: { tripId: 'trip-1' } });
    expect(mockRideGroup1.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tripId: 'trip-1',
        leadPassengerId: 'user-1',
        isCoverAll: false,
      }),
    });
    expect(result).toEqual(createdGroup);
  });

  it('returns existing group without creating a duplicate', async () => {
    mockPrisma1.$transaction.mockImplementation((cb) => cb(mockPrisma1));

    const existingGroup = {
      id: 'rg-existing',
      tripId: 'trip-1',
      leadPassengerId: 'other-user',
    };
    mockRideGroup1.findUnique.mockResolvedValue(existingGroup);

    const result = await bookingsService.createRideGroup('trip-1', 'user-2');

    // Should return the existing group, NOT create a new one
    expect(result).toEqual(existingGroup);
    expect(mockRideGroup1.create).not.toHaveBeenCalled();
  });

  it('prevents TOCTOU double-insert when called concurrently', async () => {
    // Simulate serializable transaction semantics: no matter how many concurrent
    // calls enter the callback, only the first findUnique+create succeeds.
    // Subsequent calls see the existing group and short-circuit.
    let callCount = 0;
    mockPrisma1.$transaction.mockImplementation((cb) => {
      callCount++;
      const findUnique = jest.fn();
      if (callCount === 1) {
        // First call: no existing group → proceed to create
        findUnique.mockResolvedValue(null);
      } else {
        // Subsequent calls: group now exists → return it
        findUnique.mockResolvedValue({ id: 'rg-1', tripId: 'trip-con', leadPassengerId: 'user-1' });
      }

      const tx = { rideGroup: { findUnique, create: mockRideGroup1.create } };
      return cb(tx);
    });

    mockRideGroup1.create.mockImplementation(({ data }) => {
      if (data.tripId === 'trip-con' && data.leadPassengerId === 'user-1') {
        return { id: 'rg-1', ...data };
      }
      throw new Error('Unexpected create call');
    });

    // Fire 5 concurrent calls — only the first should create; rest return existing
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        bookingsService.createRideGroup('trip-con', i === 0 ? 'user-1' : `user-${i + 1}`),
      ),
    );

    // Exactly one create call (first caller with user-1)
    expect(mockRideGroup1.create).toHaveBeenCalledTimes(1);
    // All callers get a result (either created or existing)
    expect(results).toHaveLength(5);
    results.forEach((r) => {
      expect(r).toHaveProperty('id');
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. Webhook idempotency — duplicate delivery via Redis NX lock
// ────────────────────────────────────────────────────────────────────────────
const mockRedis = {
  set: jest.fn(),
  del: jest.fn(),
};

const mockPaymentTransaction = {
  findFirst: jest.fn(),
  create: jest.fn(),
  updateMany: jest.fn(),
};

const mockBooking2 = {
  findUnique: jest.fn(),
  updateMany: jest.fn(),
};

const mockTrip2 = {
  update: jest.fn(),
};

const mockUser2 = {
  update: jest.fn(),
  updateMany: jest.fn(),
};

const mockPrisma2 = {
  booking: mockBooking2,
  trip: mockTrip2,
  user: mockUser2,
  paymentTransaction: mockPaymentTransaction,
  $transaction: jest.fn((cb) => cb(mockPrisma2)),
};

// Re-mock for this group — need to swap prisma and redis mocks
beforeEach(() => {
  jest.resetModules();
});

describe('Webhook idempotency (handleWebhook)', () => {
  let paymentsService;

  beforeAll(() => {
    jest.doMock('../src/config/database', () => mockPrisma2);
    jest.doMock('../src/config/redis', () => mockRedis);
    jest.doMock('../src/modules/payments/paystack.client', () => ({
      initiateMomoCharge: jest.fn(),
    }));
    paymentsService = require('../src/modules/payments/payments.service');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PAYSTACK_SECRET_KEY = 'test_secret';
  });

  function buildSignature(body) {
    return require('crypto')
      .createHmac('sha512', 'test_secret')
      .update(body)
      .digest('hex');
  }

  it('processes first webhook and returns received:true', async () => {
    const body = JSON.stringify({
      event: 'charge.success',
      data: {
        reference: 'ref-dup-1',
        metadata: { bookingId: 'b-dup-1' },
      },
    });
    const sig = buildSignature(body);

    // Lock acquired
    mockRedis.set.mockResolvedValue('OK');
    // No existing successful transaction
    mockPaymentTransaction.findFirst.mockResolvedValue(null);
    // Booking found
    mockBooking2.findUnique.mockResolvedValue({
      id: 'b-dup-1',
      userId: 'u1',
      paymentStatus: 'SEAT_HELD',
      status: 'SEAT_HELD',
      fareAmount: 20.0,
      paymentMethod: 'MOMO_MTN',
      tripId: 't1',
      trip: {
        confirmedSeats: 0,
        maxSeats: 10,
        status: 'FILLING',
        route: { distanceKm: 10 },
      },
    });
    mockBooking2.updateMany.mockResolvedValue({ count: 1 });
    mockTrip2.update.mockResolvedValue({ confirmedSeats: 1 });

    const result = await paymentsService.handleWebhook(body, sig);

    expect(result.received).toBe(true);
    // Should have acquired the lock
    expect(mockRedis.set).toHaveBeenCalledWith('lock:webhook:ref-dup-1', '1', 'EX', 30, 'NX');
    // Should have released the lock
    expect(mockRedis.del).toHaveBeenCalledWith('lock:webhook:ref-dup-1');
  });

  it('returns { duplicate: true } when Redis lock is already held (concurrent delivery)', async () => {
    const body = JSON.stringify({
      event: 'charge.success',
      data: {
        reference: 'ref-dup-2',
        metadata: { bookingId: 'b-dup-2' },
      },
    });
    const sig = buildSignature(body);

    // Lock NOT acquired (another webhook beat us)
    mockRedis.set.mockResolvedValue(null);

    const result = await paymentsService.handleWebhook(body, sig);

    expect(result).toEqual({ duplicate: true });
    expect(mockBooking2.updateMany).not.toHaveBeenCalled();
    expect(mockPaymentTransaction.create).not.toHaveBeenCalled();
  });

  it('returns { received: true } on replay after first webhook already processed', async () => {
    const body = JSON.stringify({
      event: 'charge.success',
      data: {
        reference: 'ref-dup-3',
        metadata: { bookingId: 'b-dup-3' },
      },
    });
    const sig = buildSignature(body);

    // Lock acquired (first attempt)
    mockRedis.set.mockResolvedValue('OK');
    // But transaction already processed
    mockPaymentTransaction.findFirst.mockResolvedValue({
      id: 'tx-dup-3',
      paystackRef: 'ref-dup-3',
      status: 'SUCCESS',
    });

    const result = await paymentsService.handleWebhook(body, sig);

    expect(result).toEqual({ received: true });
    // confirmPayment should NOT have been called (already processed)
    expect(mockBooking2.updateMany).not.toHaveBeenCalled();
  });

  it('rejects invalid webhook signature', async () => {
    const body = JSON.stringify({ event: 'charge.success', data: {} });

    await expect(
      paymentsService.handleWebhook(body, 'invalid-signature'),
    ).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. Resource-contention load: concurrent wallet withdrawals
// ────────────────────────────────────────────────────────────────────────────
describe('Concurrent wallet withdrawal contention', () => {
  let walletService;
  const mockDriver3 = { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() };
  const mockWalletTx3 = { create: jest.fn(), findMany: jest.fn() };
  const mockPrisma3 = {
    driver: mockDriver3,
    walletTransaction: mockWalletTx3,
    $transaction: jest.fn(),
  };

  const mockPaystack3 = {
    createTransferRecipient: jest.fn(),
    initiateTransfer: jest.fn(),
  };

  beforeAll(() => {
    jest.doMock('../src/config/database', () => mockPrisma3);
    jest.doMock('../src/modules/payments/paystack.client', () => mockPaystack3);
    walletService = require('../src/modules/wallet/wallet.service');
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows exactly N withdrawals when balance supports N and rejects the rest (race-safe)', async () => {
    /**
     * Simulate the classic race: 10 concurrent withdrawal attempts on a wallet
     * with GHS 100 balance, each attempting to withdraw GHS 30.
     * At most 3 should succeed (3 × 30 = 90 ≤ 100), but a naive check-then-deduct
     * pattern could let all 10 pass. The fix uses updateMany with a balance guard
     * inside the transaction, so exactly 3 succeed and 7 get INSUFFICIENT_WALLET.
     */

    const BALANCE = 100;
    const WITHDRAW_AMOUNT = 30;
    const TOTAL_CALLS = 10;

    // Drivers who have passed the balance check (initial findUnique)
    let driversWhoPassedCheck = 0;
    mockDriver3.findUnique.mockImplementation(() => {
      driversWhoPassedCheck++;
      return Promise.resolve({
        walletBalance: BALANCE,
        name: 'Driver Race',
        phone: '+233240000099',
      });
    });

    // Track how many actually deduct (updateMany with gte guard)
    let successfulDeductions = 0;
    let remainingBalance = BALANCE;
    mockDriver3.updateMany.mockImplementation(({ where, data }) => {
      if (data.walletBalance?.decrement) {
        const amt = data.walletBalance.decrement;
        if (remainingBalance >= amt) {
          remainingBalance -= amt;
          successfulDeductions++;
          return Promise.resolve({ count: 1 });
        }
        return Promise.resolve({ count: 0 });
      }
      return Promise.resolve({ count: 1 });
    });

    mockPrisma3.$transaction.mockImplementation((cb) => cb(mockPrisma3));
    mockWalletTx3.create.mockResolvedValue({ id: 'tx-race' });
    mockPaystack3.createTransferRecipient.mockResolvedValue({
      data: { recipient_code: 'RCP_RACE' },
    });
    mockPaystack3.initiateTransfer.mockResolvedValue({ success: true });

    const results = await Promise.allSettled(
      Array.from({ length: TOTAL_CALLS }, () =>
        walletService.withdraw('driver-race', WITHDRAW_AMOUNT),
      ),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const rejectedResults = results.filter((r) => r.status === 'rejected');
    const failed = rejectedResults.length;

    // With GHS 100 balance and GHS 30 per withdrawal: exactly 3 should succeed
    expect(succeeded).toBe(3);
    expect(failed).toBe(7);

    // All failed ones should have the correct error
    rejectedResults.forEach((r) => {
      // Some fail at balance check, some at updateMany guard — both produce AppError
      expect(r.reason).toBeDefined();
    });

    // Verify at least the successful ones created wallet transactions
    expect(mockWalletTx3.create).toHaveBeenCalledTimes(succeeded);
    // Verify exactly N updateMany calls decremented balance
    expect(successfulDeductions).toBe(3);
    // Final balance should be 100 - 90 = 10
    expect(remainingBalance).toBe(10);
  });

  it('detects the classic TOCTOU in withdraw: check happens BEFORE deduction', async () => {
    /**
     * This test explicitly documents the race window in wallet.withdraw:
     *   Line 79-80: findUnique (CHECK balance)
     *   Line 83-90: updateMany with gte guard (ACTUAL deduction)
     *
     * Between lines 80 and 83, another concurrent call could see the SAME
     * balance and both would pass the findUnique check. The updateMany guard
     * (line 84: `walletBalance: { gte: amount }`) is what ultimately prevents
     * overspend, not the findUnique check alone.
     *
     * We simulate this by making findUnique always return sufficient balance
     * while updateMany enforces the real constraint.
     */

    mockDriver3.findUnique.mockResolvedValue({
      // Always report sufficient balance — simulating the race window
      walletBalance: 100,
      name: 'Driver Race',
      phone: '+233240000099',
    });

    let deductionAttempts = 0;
    mockDriver3.updateMany.mockImplementation(({ where, data }) => {
      deductionAttempts++;
      // Alternating behavior: first 3 succeed, rest fail
      if (deductionAttempts <= 3) {
        return Promise.resolve({ count: 1 });
      }
      return Promise.resolve({ count: 0 });
    });

    mockPrisma3.$transaction.mockImplementation((cb) => cb(mockPrisma3));
    mockWalletTx3.create.mockResolvedValue({ id: 'tx-race-2' });
    mockPaystack3.createTransferRecipient.mockResolvedValue({
      data: { recipient_code: 'RCP_RACE_2' },
    });
    mockPaystack3.initiateTransfer.mockResolvedValue({ success: true });

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        walletService.withdraw('driver-race-2', 30),
      ),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;

    // updateMany guard catches the TOCTOU — max 3 succeed per our mock
    expect(succeeded).toBeLessThanOrEqual(3);
    expect(deductionAttempts).toBe(8); // All 8 attempted deduction
  });
});
