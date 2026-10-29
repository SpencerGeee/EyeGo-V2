const { busRatioFor, routeLengthM } = require('../src/services/trip-position.service');

// A straight road due north, ~2.2 km, as [lng, lat].
const line = [[-0.2, 5.6], [-0.2, 5.61], [-0.2, 5.62]];

describe('bus position on its route', () => {
  test('a departed bus at the midpoint is ~half way', () => {
    const r = busRatioFor({ status: 'IN_PROGRESS', driver: { currentLat: 5.61, currentLng: -0.2 } }, line);
    expect(r).toBeGreaterThan(0.45);
    expect(r).toBeLessThan(0.55);
  });

  test('a bus still filling has passed nothing', () => {
    expect(busRatioFor({ status: 'FILLING', driver: { currentLat: 5.615, currentLng: -0.2 } }, line)).toBe(0);
  });

  test('no fix or no road is 0, never NaN', () => {
    expect(busRatioFor({ status: 'IN_PROGRESS', driver: {} }, line)).toBe(0);
    expect(busRatioFor({ status: 'IN_PROGRESS', driver: { currentLat: 5.61, currentLng: -0.2 } }, null)).toBe(0);
  });

  test('route length is measured along the road', () => {
    expect(routeLengthM(line)).toBeGreaterThan(2000);
    expect(routeLengthM(line)).toBeLessThan(2400);
  });
});
