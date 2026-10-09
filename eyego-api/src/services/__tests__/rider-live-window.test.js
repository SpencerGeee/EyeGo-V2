'use strict';

const { isLiveForRider } = require('../trip-state.service');

// SCHEDULED_RIDE_BLOCK_MINUTES defaults to 60.
const now = new Date('2026-10-09T08:00:00Z');
const inMin = (m) => new Date(now.getTime() + m * 60_000);

describe('isLiveForRider — an upcoming seat is not a ride in progress', () => {
  it('tomorrow’s bus is upcoming', () => {
    expect(isLiveForRider({ status: 'SCHEDULED', departureTime: inMin(24 * 60) }, now)).toBe(false);
    expect(isLiveForRider({ status: 'CONFIRMED', departureTime: inMin(61) }, now)).toBe(false);
  });
  it('inside the window it is live', () => {
    expect(isLiveForRider({ status: 'SCHEDULED', departureTime: inMin(59) }, now)).toBe(true);
  });
  it('boarding open, searching and moving are always live', () => {
    for (const status of ['FILLING', 'REQUESTED', 'MATCHING', 'DRIVER_EN_ROUTE', 'IN_PROGRESS']) {
      expect(isLiveForRider({ status, departureTime: inMin(600) }, now)).toBe(true);
    }
  });
  it('an ended trip never is', () => {
    expect(isLiveForRider({ status: 'COMPLETED', departureTime: now }, now)).toBe(false);
    expect(isLiveForRider(null, now)).toBe(false);
  });
});
