'use strict';

// P1-2 regression: the rider client releases a SEAT_HELD booking immediately on a
// hard payment failure by calling cancelBooking. That must (a) free the seat and
// (b) be idempotent against the server-side seat-hold sweep, which independently
// flips SEAT_HELD -> CANCELLED. Re-cancelling an already-cancelled unpaid booking
// must NOT throw.

const mockBooking = {
  findUnique: jest.fn(),
  update: jest.fn(),
  count: jest.fn(),
};
const mockTrip = { update: jest.fn() };

jest.mock('../src/config/database', () => ({
  booking: mockBooking,
  trip: mockTrip,
}));

const bookingsService = require('../src/modules/bookings/bookings.service');

describe('bookings.service.cancelBooking (P1-2 immediate seat release)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBooking.count.mockResolvedValue(1); // not the last booking — skip trip revert
  });

  it('cancels an unpaid SEAT_HELD booking and frees the seat', async () => {
    mockBooking.findUnique.mockResolvedValue({
      id: 'b1', userId: 'u1', paymentStatus: 'PENDING', tripId: 't1', trip: { status: 'FILLING' },
    });
    mockBooking.update.mockResolvedValue({ id: 'b1', status: 'CANCELLED', seatNumber: null });

    const result = await bookingsService.cancelBooking('b1', 'u1', {});

    expect(mockBooking.update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { status: 'CANCELLED', seatNumber: null },
    });
    expect(result.status).toBe('CANCELLED');
  });

  it('is idempotent against the sweep: re-cancelling an already-CANCELLED unpaid booking does not throw', async () => {
    mockBooking.findUnique.mockResolvedValue({
      id: 'b1', userId: 'u1', paymentStatus: 'PENDING', status: 'CANCELLED', tripId: 't1', trip: { status: 'SCHEDULED' },
    });
    mockBooking.update.mockResolvedValue({ id: 'b1', status: 'CANCELLED', seatNumber: null });

    await expect(bookingsService.cancelBooking('b1', 'u1', {})).resolves.toMatchObject({ status: 'CANCELLED' });
  });

  it('refuses to cancel a PAID booking (protects confirmed seats)', async () => {
    mockBooking.findUnique.mockResolvedValue({
      id: 'b1', userId: 'u1', paymentStatus: 'PAID', tripId: 't1', trip: { status: 'CONFIRMED' },
    });

    await expect(bookingsService.cancelBooking('b1', 'u1', {})).rejects.toMatchObject({ code: 'BOOKING_PAID' });
    expect(mockBooking.update).not.toHaveBeenCalled();
  });
});
