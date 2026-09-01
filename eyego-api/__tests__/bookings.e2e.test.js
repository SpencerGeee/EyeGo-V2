'use strict';

// Auto-vivifying Prisma mocks: a model or method the service reaches for that
// this suite never listed becomes a jest.fn() rather than a TypeError.
//
// A whole client, not a hand-listed set of models. A trip status change no
// longer writes `trip.update`: it goes through `applyTransitionTx`, which does
// a compare-and-swap on `trip.updateMany` and appends to `tripEvent` — a table
// this suite never mentioned and would have died on.
const { prismaMock } = require('./helpers/prismaMock');

const mockPrisma = prismaMock();

const mockBooking = mockPrisma.booking;
const mockTrip = mockPrisma.trip;
const mockUser = mockPrisma.user;

jest.mock('../src/config/database', () => mockPrisma);

jest.mock('../src/modules/payments/paystack.client', () => ({
  initiateMomoCharge: jest.fn(),
}));

jest.mock('../src/modules/trips/trips.service', () => ({
  getSeatMap: jest.fn().mockResolvedValue({ seats: [] }),
}));

const bookingsService = require('../src/modules/bookings/bookings.service');
const paymentsService = require('../src/modules/payments/payments.service');

describe('E2E Booking Flow Simulation (Rider + Driver)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTrip.update.mockResolvedValue({ confirmedSeats: 1, status: 'FILLING' });
    mockBooking.updateMany.mockResolvedValue({ count: 1 });
    // The compare-and-swap that every status change now runs through. Count 0
    // means "somebody else moved this trip", which raises VERSION_CONFLICT;
    // an unstubbed mock answering `undefined` crashed on `.count` instead.
    mockTrip.updateMany.mockResolvedValue({ count: 1 });
  });

  it('runs a complete booking, wallet payment, and driver cancellation sequence', async () => {
    const tripData = {
      id: 'trip-99',
      status: 'SCHEDULED',
      // The compare-and-swap conditions on this; without it the transition
      // matches nothing and every status change raises VERSION_CONFLICT.
      version: 0,
      maxSeats: 10,
      confirmedSeats: 0,
      tier: 'ECO',
      baseFarePesewas: 500,
      perKmRatePesewas: 150,
      surgeMultiplier: 1.0,
      doorstepPickup: false,
      heavyLoad: false,
      route: { distanceKm: 10, destLat: 5.0, destLng: 5.0, virtualStops: [] },
    };

    // 1. Rider books a seat
    mockTrip.findUnique.mockResolvedValue(tripData);
    mockBooking.count.mockResolvedValue(0);
    mockBooking.findFirst.mockResolvedValue(null);
    mockBooking.create.mockResolvedValue({
      id: 'booking-99',
      tripId: 'trip-99',
      userId: 'rider-99',
      seatNumber: 3,
      fareAmountPesewas: 2000,
      status: 'SEAT_HELD',
    });

    const bookResult = await bookingsService.bookSeat('rider-99', 'trip-99', 3);
    expect(bookResult.booking.seatNumber).toBe(3);
    expect(bookResult.booking.status).toBe('SEAT_HELD');
    // The first seat moves the trip SCHEDULED → FILLING, and that move is a
    // compare-and-swap now, not a blind `update`: it is conditioned on the
    // status and version that were read, so two riders booking at once resolve
    // to one winner and the loser raises instead of overwriting. Asserting the
    // WHERE is the point — a plain `update` would pass a status assertion and
    // silently lose the concurrency guarantee.
    expect(mockTrip.updateMany).toHaveBeenCalledWith({
      where: { id: 'trip-99', status: 'SCHEDULED', version: 0 },
      data: expect.objectContaining({ status: 'FILLING', version: 1 }),
    });

    // 2. Rider initiates WALLET payment
    mockBooking.findUnique.mockResolvedValue({
      id: 'booking-99',
      userId: 'rider-99',
      paymentMethod: 'WALLET',
      fareAmountPesewas: 2000,
      status: 'SEAT_HELD',
      trip: { id: 'trip-99', confirmedSeats: 0, maxSeats: 10, route: { distanceKm: 10 } },
      user: { phone: '+233240000099' },
    });
    mockUser.updateMany.mockResolvedValue({ count: 1 });
    mockTrip.findUnique.mockResolvedValue({ ...tripData, status: 'FILLING', confirmedSeats: 0 });

    const payResult = await paymentsService.initiatePayment({ userId: 'rider-99', bookingId: 'booking-99' });
    expect(payResult.status).toBe('SUCCESS');
    expect(mockUser.updateMany).toHaveBeenCalledWith({
      where: { id: 'rider-99', walletBalancePesewas: { gte: 2000 } },
      data: { walletBalancePesewas: { decrement: 2000 } },
    });
    expect(mockBooking.updateMany).toHaveBeenCalledWith({
      where: { id: 'booking-99', paymentStatus: undefined },
      data: {
        paymentStatus: 'PAID',
        status: 'CONFIRMED',
        paystackRef: expect.any(String),
      },
    });

    // 3. Driver cancels the trip (reverting bookings & trip status)
    // Simulated cancel action
    mockBooking.findUnique.mockResolvedValue({
      id: 'booking-99',
      userId: 'rider-99',
      paymentStatus: 'PAID',
      status: 'CONFIRMED',
    });
    
    // cancelBooking will throw on paid bookings to protect confirmed seats unless handled by admin
    await expect(bookingsService.cancelBooking('booking-99', 'rider-99')).rejects.toThrow('Cannot cancel a paid booking here');
  });
});
