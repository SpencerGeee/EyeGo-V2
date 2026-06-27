'use strict';

/**
 * TOCTOU race-condition tests for createRideGroup.
 *
 * The fix wraps the check-then-insert pattern inside a serializable Prisma
 * transaction so concurrent calls cannot both see "no existing group" and
 * create duplicates.
 */

let mockRideGroup;
let mockPrisma;
let bookingsService;

beforeEach(() => {
  jest.resetModules();

  mockRideGroup = {
    findUnique: jest.fn(),
    create: jest.fn(),
  };

  mockPrisma = {
    rideGroup: mockRideGroup,
    $transaction: jest.fn(),
  };

  jest.doMock('../src/config/env', () => ({
    SEAT_HOLD_DURATION_MINUTES: 10,
    PLATFORM_COMMISSION: 0.15,
    MIN_OCCUPANCY_TO_DEPART: 5,
    PAYSTACK_SECRET_KEY: 'test_secret',
    APP_URL: 'https://eyego.app',
    DRIVER_MIN_WITHDRAWAL: 20,
  }));

  jest.doMock('../src/config/database', () => mockPrisma);

  // Mock promos/routes used by createRideGroup's file-level imports
  jest.doMock('../src/modules/trips/fare.calculator', () => ({
    calculateFare: jest.fn(),
    calculateEnRouteFare: jest.fn(),
  }));

  bookingsService = require('../src/modules/bookings/bookings.service');
});

describe('createRideGroup — TOCTOU race prevention', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a ride group when none exists (happy path)', async () => {
    mockPrisma.$transaction.mockImplementation((cb, opts) => {
      expect(opts.isolationLevel).toBe('Serializable');
      return cb(mockPrisma);
    });

    mockRideGroup.findUnique.mockResolvedValue(null);
    const createdGroup = {
      id: 'rg-1',
      tripId: 'trip-1',
      leadPassengerId: 'user-1',
      isCoverAll: false,
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    };
    mockRideGroup.create.mockResolvedValue(createdGroup);

    const result = await bookingsService.createRideGroup('trip-1', 'user-1');

    expect(mockPrisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
    expect(mockRideGroup.findUnique).toHaveBeenCalledWith({ where: { tripId: 'trip-1' } });
    expect(mockRideGroup.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tripId: 'trip-1',
        leadPassengerId: 'user-1',
        isCoverAll: false,
      }),
    });
    expect(result).toEqual(createdGroup);
  });

  it('returns existing group without creating a duplicate', async () => {
    mockPrisma.$transaction.mockImplementation((cb) => cb(mockPrisma));

    const existingGroup = {
      id: 'rg-existing',
      tripId: 'trip-1',
      leadPassengerId: 'other-user',
    };
    mockRideGroup.findUnique.mockResolvedValue(existingGroup);

    const result = await bookingsService.createRideGroup('trip-1', 'user-2');

    expect(result).toEqual(existingGroup);
    expect(mockRideGroup.create).not.toHaveBeenCalled();
  });

  it('prevents double-insert under concurrent calls (simulated TOCTOU)', async () => {
    /**
     * Simulates 5 concurrent calls. The serializable transaction guarantees that
     * only the first caller sees "no existing group" and creates one. All subsequent
     * callers see the group and short-circuit. Without the transaction, all 5 would
     * attempt to create, causing either a unique violation or duplicate groups.
     */
    let callCount = 0;
    mockPrisma.$transaction.mockImplementation((cb) => {
      callCount++;
      const findUnique = jest.fn();
      if (callCount === 1) {
        findUnique.mockResolvedValue(null);
      } else {
        findUnique.mockResolvedValue({
          id: 'rg-con',
          tripId: 'trip-con',
          leadPassengerId: 'user-1',
        });
      }

      const tx = { rideGroup: { findUnique, create: mockRideGroup.create } };
      return cb(tx);
    });

    mockRideGroup.create.mockImplementation(({ data }) => {
      if (data.tripId === 'trip-con') {
        return { id: 'rg-con', ...data };
      }
      throw new Error('Unexpected create call');
    });

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        bookingsService.createRideGroup('trip-con', 'user-1'),
      ),
    );

    // Exactly one create call
    expect(mockRideGroup.create).toHaveBeenCalledTimes(1);
    // All callers get a result
    expect(results).toHaveLength(5);
    results.forEach((r) => {
      expect(r).toHaveProperty('id');
    });
  });
});
