'use strict';

const { riderBookingOutcome } = require('../away-outcomes.service');

const at = new Date('2026-10-09T08:00:00Z');
const booking = (over = {}, trip = {}) => ({
  id: 'b1', tripId: 't1', status: 'PAID', paymentStatus: 'PAID', cancellationReason: null,
  dropoffAddress: 'Circle', updatedAt: at,
  trip: { status: 'IN_PROGRESS', cancelledBy: null, cancelledAt: null, updatedAt: at, dropoffAddress: null, route: null, ...trip },
  ...over,
});

describe('riderBookingOutcome — what a closed app is owed on reopen', () => {
  it('a passenger no-show is told even though the bus drove on', () => {
    const o = riderBookingOutcome(booking({ status: 'NO_SHOW' }, { status: 'COMPLETED' }), new Set());
    expect(o.kind).toBe('RIDER_NO_SHOW');
    expect(o.money).toBe('KEPT');
  });
  it('a driver cancellation says the money came back when it did', () => {
    const o = riderBookingOutcome(
      booking({ status: 'REFUNDED', paymentStatus: 'REFUNDED' }, { status: 'CANCELLED', cancelledBy: 'DRIVER' }),
      new Set(),
    );
    expect(o).toMatchObject({ kind: 'DRIVER_CANCELLED', money: 'REFUNDED' });
  });
  it('the rider’s own cancellation is not news', () => {
    expect(riderBookingOutcome(booking({ status: 'CANCELLED' }, { status: 'CANCELLED', cancelledBy: 'RIDER' }), new Set())).toBeNull();
  });
  it('a completed ride is listed either way, flagged once rated (the sheet skips rated ones)', () => {
    const done = booking({ status: 'COMPLETED' }, { status: 'COMPLETED' });
    expect(riderBookingOutcome(done, new Set())).toMatchObject({ kind: 'COMPLETED', rated: false });
    expect(riderBookingOutcome(done, new Set(['t1']))).toMatchObject({ kind: 'COMPLETED', rated: true });
  });
  it('an expired hold is a released seat, not a cancellation', () => {
    const o = riderBookingOutcome(booking({ status: 'CANCELLED', paymentStatus: 'PENDING', cancellationReason: 'HOLD_EXPIRED' }), new Set());
    expect(o).toMatchObject({ kind: 'SEAT_RELEASED', money: 'NOT_CHARGED' });
  });
});
