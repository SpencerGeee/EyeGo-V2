'use strict';

jest.mock('../src/config/redis', () => ({}), { virtual: false });
const { withProgress } = require('../src/services/route-geometry.service');

// Run 45902035048 #2: a cached leg re-sent its whole-leg ETA for minutes.
const leg = { leg: 'toPickup', distanceKm: 2.2, durationMin: 12, geometry: { coordinates: [[-0.2, 5.6], [-0.2, 5.61], [-0.2, 5.62]] } };

test('the ETA counts down as the driver moves along a cached line', () => {
  expect(withProgress(leg, { lat: 5.6, lng: -0.2 }).durationMin).toBeCloseTo(12, 0);
  expect(withProgress(leg, { lat: 5.61, lng: -0.2 }).durationMin).toBeCloseTo(6, 0);
  expect(withProgress(leg, { lat: 5.62, lng: -0.2 }).durationMin).toBe(0);
});

test('no fix leaves the leg untouched', () => {
  expect(withProgress(leg, null)).toBe(leg);
});
