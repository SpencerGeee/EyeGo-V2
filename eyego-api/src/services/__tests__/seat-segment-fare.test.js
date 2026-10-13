'use strict';

jest.mock('../../config/database', () => ({}));
// Never a live connection from a unit test: an open socket keeps the whole run alive.
jest.mock('../../config/redis', () => ({ get: jest.fn(async () => null), set: jest.fn(async () => 'OK'), del: jest.fn(async () => 1), on: jest.fn(), quit: jest.fn() }));

const { priceSeat } = require('../../modules/bookings/bookings.service');

/**
 * "It should accurately calculate the fare based on the distance from the
 * start of the trip to where they are alighting, so it's super fair." An
 * L-shaped road, 1 km east then 1 km north; the passenger gets off halfway up
 * the second leg — 1.5 km of 2 km ridden by road, ~1.12 km as the crow flies.
 */
const ROAD = [[-0.2, 5.6], [-0.191, 5.6], [-0.191, 5.609]];
const STOP = { id: 'up-the-hill', lat: 5.6045, lng: -0.191, sequence: 1, isActive: true };
const trip = {
  tier: 'ECO',
  maxSeats: 14,
  doorstepPickup: false,
  heavyLoad: false,
  surgeMultiplier: 1,
  route: { distanceKm: 2, originLat: 5.6, originLng: -0.2, destLat: 5.609, destLng: -0.191, virtualStops: [STOP] },
};

describe('a part-route seat is priced by the road ridden', () => {
  const full = priceSeat(trip, {}).finalFareAmount;

  it('charges a named stop for the road, not the straight line', () => {
    const stop = priceSeat(trip, { dropoffStopId: STOP.id, routeLine: ROAD });
    expect(stop.enRouteRatio).toBeCloseTo(0.75, 2);
    expect(stop.finalFareAmount).toBe(Math.max(Math.round(full * stop.enRouteRatio), stop.finalFareAmount));
  });

  it('a pin on the same kerb costs exactly what the stop costs', () => {
    const stop = priceSeat(trip, { dropoffStopId: STOP.id, routeLine: ROAD });
    const pin = priceSeat(trip, { dropoff: { lat: STOP.lat, lng: STOP.lng }, routeLine: ROAD });
    expect(pin.finalFareAmount).toBe(stop.finalFareAmount);
  });

  it('riding to the end is the full fare', () => {
    const pin = priceSeat(trip, { dropoff: { lat: 5.609, lng: -0.191 }, routeLine: ROAD });
    expect(pin.finalFareAmount).toBe(full);
  });

  it('falls back to the straight line only when there is no road', () => {
    const stop = priceSeat(trip, { dropoffStopId: STOP.id, routeLine: null });
    expect(stop.enRouteRatio).toBeLessThan(0.6);
  });
});
