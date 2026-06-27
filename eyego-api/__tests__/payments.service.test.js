'use strict';

const mockBooking = {
  findUnique: jest.fn(),
  update: jest.fn(),
  updateMany: jest.fn(),
};

const mockUser = {
  update: jest.fn(),
  updateMany: jest.fn(),
};

const mockTrip = {
  update: jest.fn(),
};

const mockPaymentTransaction = {
  findFirst: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
};

const mockWalletTransaction = {
  updateMany: jest.fn(),
};

const mockPrisma = {
  booking: mockBooking,
  user: mockUser,
  trip: mockTrip,
  paymentTransaction: mockPaymentTransaction,
  walletTransaction: mockWalletTransaction,
  $transaction: jest.fn((cb) => cb(mockPrisma)),
};

jest.mock('../src/config/database', () => mockPrisma);

jest.mock('../src/config/env', () => ({
  PAYSTACK_SECRET_KEY: 'test_secret',
  PLATFORM_COMMISSION: 0.15,
  MIN_OCCUPANCY_TO_DEPART: 5,
  SEAT_HOLD_DURATION_MINUTES: 10,
}));

const mockRedis = {
  set: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
};
jest.mock('../src/config/redis', () => mockRedis);

jest.mock('../src/modules/payments/paystack.client', () => ({
  initiateMomoCharge: jest.fn(),
  initializeCheckout: jest.fn(),
  verifyTransaction: jest.fn(),
}));

jest.mock('../src/services/push.service', () => ({
  sendPush: jest.fn(),
}));

const paymentsService = require('../src/modules/payments/payments.service');
const paystack = require('../src/modules/payments/paystack.client');

describe('payments.service logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTrip.update.mockResolvedValue({ confirmedSeats: 1, status: 'FILLING' });
    mockBooking.updateMany.mockResolvedValue({ count: 1 });
    mockRedis.set.mockResolvedValue('OK');
  });

  describe('initiatePayment', () => {
    it('directly confirms booking if payment method is CASH', async () => {
      mockBooking.findUnique.mockResolvedValue({
        id: 'b1',
        userId: 'u1',
        paymentMethod: 'CASH',
        fareAmount: 20.0,
        status: 'SEAT_HELD',
        trip: { id: 't1', confirmedSeats: 0, maxSeats: 10, route: { distanceKm: 5 } },
        user: { phone: '+233240000000' },
      });

      const result = await paymentsService.initiatePayment({ userId: 'u1', bookingId: 'b1' });

      expect(mockBooking.updateMany).toHaveBeenCalledWith({
        where: { id: 'b1', paymentStatus: undefined },
        data: {
          paymentStatus: 'CASH_PENDING',
          status: 'CONFIRMED',
          paystackRef: expect.any(String),
        },
      });
      expect(result.status).toBe('SUCCESS');
      expect(result.requiresVerification).toBe(false);
    });

    it('processes WALLET payment by deducting user wallet balance', async () => {
      mockBooking.findUnique.mockResolvedValue({
        id: 'b2',
        userId: 'u2',
        paymentMethod: 'WALLET',
        fareAmount: 15.0,
        status: 'SEAT_HELD',
        trip: { id: 't1', confirmedSeats: 0, maxSeats: 10, route: { distanceKm: 5 } },
        user: { phone: '+233240000000' },
      });
      mockUser.updateMany.mockResolvedValue({ count: 1 });

      const result = await paymentsService.initiatePayment({ userId: 'u2', bookingId: 'b2' });

      expect(mockUser.updateMany).toHaveBeenCalledWith({
        where: { id: 'u2', walletBalance: { gte: 15.0 } },
        data: { walletBalance: { decrement: 15.0 } },
      });
      expect(mockBooking.updateMany).toHaveBeenCalledWith({
        where: { id: 'b2', paymentStatus: undefined },
        data: {
          paymentStatus: 'PAID',
          status: 'CONFIRMED',
          paystackRef: expect.any(String),
        },
      });
      expect(result.status).toBe('SUCCESS');
    });

    it('initiates mobile money charge with Paystack on MOMO payment', async () => {
      mockBooking.findUnique.mockResolvedValue({
        id: 'b3',
        userId: 'u3',
        paymentMethod: 'MOMO',
        fareAmount: 25.0,
        status: 'SEAT_HELD',
        trip: { id: 't1', confirmedSeats: 0, maxSeats: 10, route: { distanceKm: 5 } },
        user: { phone: '+233240000003', email: 'john@gmail.com' },
      });
      mockPaymentTransaction.findFirst.mockResolvedValue(null);
      paystack.initiateMomoCharge.mockResolvedValue({ data: { status: 'pay_offline' } });

      const result = await paymentsService.initiatePayment({ userId: 'u3', bookingId: 'b3', phone: '+233240000003' });

      expect(paystack.initiateMomoCharge).toHaveBeenCalled();
      expect(mockBooking.update).toHaveBeenCalled();
      expect(mockPaymentTransaction.create).toHaveBeenCalled();
      expect(result.status).toBe('PENDING');
      expect(result.requiresVerification).toBe(true);
    });
  });

  describe('handleWebhook charge.success', () => {
    const rawBody = JSON.stringify({
      event: 'charge.success',
      data: {
        reference: 'ref_web_123',
        metadata: { bookingId: 'b4' },
      },
    });

    it('verifies signature and acquires Redis lock for transaction idempotency', async () => {
      // Setup environment secret to verify signature correctly
      process.env.PAYSTACK_SECRET_KEY = 'test_secret';
      const signature = require('crypto')
        .createHmac('sha512', 'test_secret')
        .update(rawBody)
        .digest('hex');

      mockRedis.set.mockResolvedValue('OK');
      mockPaymentTransaction.findFirst.mockResolvedValue(null);
      mockBooking.findUnique.mockResolvedValue({
        id: 'b4',
        status: 'SEAT_HELD',
        fareAmount: 10.0,
        trip: { id: 't1', confirmedSeats: 0, maxSeats: 5, route: { distanceKm: 5 } },
      });

      const result = await paymentsService.handleWebhook(rawBody, signature);

      expect(mockRedis.set).toHaveBeenCalledWith('lock:webhook:ref_web_123', '1', 'EX', 30, 'NX');
      expect(mockBooking.updateMany).toHaveBeenCalledWith({
        where: { id: 'b4', paymentStatus: undefined },
        data: {
          paymentStatus: 'PAID',
          status: 'CONFIRMED',
          paystackRef: 'ref_web_123',
        },
      });
      expect(result.received).toBe(true);
    });
  });
});
