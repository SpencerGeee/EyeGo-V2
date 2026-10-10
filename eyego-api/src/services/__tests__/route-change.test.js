'use strict';

// One straight road: every km is a minute, so leg costs are easy to reason about.
jest.mock('../mapbox.service', () => ({
  isWithinGhana: () => true,
  roadDistanceKm: async (aLat, aLng, bLat, bLng) => {
    const km = Math.abs(bLat - aLat) * 100 + Math.abs(bLng - aLng) * 100;
    return { distanceKm: km, durationMin: km };
  },
}));
jest.mock('../../config/database', () => ({ trip: { findUnique: jest.fn() } }));

const prisma = require('../../config/database');
const { quoteRouteChange } = require('../../modules/rides/rides.service');

const trip = (over = {}) => ({
  id: 't1', status: 'DRIVER_EN_ROUTE', requesterId: 'u1', routeId: null, driverId: 'd1', tier: 'ECO',
  perKmRatePesewas: 200, surgeMultiplier: 1, bookingFeeRate: 0, commissionRate: 0.2,
  pickupLat: 5.6, pickupLng: -0.2, dropoffLat: 5.7, dropoffLng: -0.2, dropoffAddress: 'Circle', onwardStops: [],
  bookings: [{ id: 'b1', paymentMethod: 'CASH', status: 'CONFIRMED', fareAmountPesewas: 5000 }],
  ...over,
});

describe('mid-trip route change', () => {
  it('a stop goes in front of the final destination and is priced as the extra road', async () => {
    prisma.trip.findUnique.mockResolvedValue(trip());
    // A stop 5 km off the line and back: pickup→stop 10+... measured by the mock.
    const q = await quoteRouteChange('u1', 't1', { kind: 'stop', lat: 5.65, lng: -0.15, address: 'Pharmacy' });
    expect(q.stops.map((s) => s.address)).toEqual(['Pharmacy']);
    expect(q.destination.address).toBe('Circle');
    expect(q.deltaPesewas).toBeGreaterThan(0);
    expect(q.farePesewas).toBe(5000 + q.deltaPesewas);
  });
  it('a nearer destination makes it cheaper, never below the tier minimum', async () => {
    prisma.trip.findUnique.mockResolvedValue(trip());
    const q = await quoteRouteChange('u1', 't1', { kind: 'destination', lat: 5.61, lng: -0.2, address: 'Near' });
    expect(q.deltaPesewas).toBeLessThan(0);
    expect(q.farePesewas).toBeGreaterThanOrEqual(2000);
  });
  it('refuses shared trips, other riders, and a third stop', async () => {
    prisma.trip.findUnique.mockResolvedValue(trip({ routeId: 'r1' }));
    await expect(quoteRouteChange('u1', 't1', { kind: 'stop', lat: 5.65, lng: -0.15 })).rejects.toMatchObject({ code: 'SHARED_TRIP' });
    prisma.trip.findUnique.mockResolvedValue(trip());
    await expect(quoteRouteChange('u2', 't1', { kind: 'stop', lat: 5.65, lng: -0.15 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    prisma.trip.findUnique.mockResolvedValue(trip({ onwardStops: [{ lat: 5.66, lng: -0.2 }, { lat: 5.7, lng: -0.2 }] }));
    await expect(quoteRouteChange('u1', 't1', { kind: 'stop', lat: 5.65, lng: -0.15 })).rejects.toMatchObject({ code: 'TOO_MANY_STOPS' });
  });
});
