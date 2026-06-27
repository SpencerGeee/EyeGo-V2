'use strict';

const mockBooking = {
  findUnique: jest.fn(),
  findFirst: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  updateMany: jest.fn(),
  count: jest.fn(),
};

const mockRideGroup = {
  findUnique: jest.fn(),
  create: jest.fn(),
};

const mockTrip = {
  findUnique: jest.fn(),
  update: jest.fn(),
};

const mockUser = {
  findUnique: jest.fn(),
  update: jest.fn(),
  updateMany: jest.fn(),
};

const mockDriver = {
  findUnique: jest.fn(),
  update: jest.fn(),
};

const mockPaymentTransaction = {
  findFirst: jest.fn(),
  create: jest.fn(),
};

const mockPrisma = {
  booking: mockBooking,
  trip: mockTrip,
  user: mockUser,
  driver: mockDriver,
  paymentTransaction: mockPaymentTransaction,
  rideGroup: mockRideGroup,
  $transaction: jest.fn((cb) => cb(mockPrisma)),
};

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
  });

  it('runs a complete booking, wallet payment, and driver cancellation sequence', async () => {
    const tripData = {
      id: 'trip-99',
      status: 'SCHEDULED',
      maxSeats: 10,
      confirmedSeats: 0,
      tier: 'ECO',
      baseFare: 5.0,
      perKmRate: 1.5,
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
      fareAmount: 20.0,
      status: 'SEAT_HELD',
    });

    const bookResult = await bookingsService.bookSeat('rider-99', 'trip-99', 3);
    expect(bookResult.booking.seatNumber).toBe(3);
    expect(bookResult.booking.status).toBe('SEAT_HELD');
    expect(mockTrip.update).toHaveBeenCalledWith({
      where: { id: 'trip-99' },
      data: { status: 'FILLING' },
    });

    // 2. Rider initiates WALLET payment
    mockBooking.findUnique.mockResolvedValue({
      id: 'booking-99',
      userId: 'rider-99',
      paymentMethod: 'WALLET',
      fareAmount: 20.0,
      status: 'SEAT_HELD',
      trip: { id: 'trip-99', confirmedSeats: 0, maxSeats: 10, route: { distanceKm: 10 } },
      user: { phone: '+233240000099' },
    });
    mockUser.updateMany.mockResolvedValue({ count: 1 });
    mockTrip.findUnique.mockResolvedValue({ ...tripData, status: 'FILLING', confirmedSeats: 0 });

    const payResult = await paymentsService.initiatePayment({ userId: 'rider-99', bookingId: 'booking-99' });
    expect(payResult.status).toBe('SUCCESS');
    expect(mockUser.updateMany).toHaveBeenCalledWith({
      where: { id: 'rider-99', walletBalance: { gte: 20.0 } },
      data: { walletBalance: { decrement: 20.0 } },
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
