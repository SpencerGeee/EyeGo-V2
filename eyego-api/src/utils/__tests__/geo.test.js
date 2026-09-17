'use strict';

const { projectOntoPolyline } = require('../geo');

// A straight east-west road along the equator: 0.00 → 0.02 lng (~2.2 km).
const road = [
  [0.0, 0],
  [0.01, 0],
  [0.02, 0],
];

describe('projectOntoPolyline', () => {
  it('measures along the road, not as the crow flies', () => {
    const p = projectOntoPolyline(0.0002, 0.005, road); // 22 m north of the quarter mark
    expect(p).not.toBeNull();
    expect(p.distanceM).toBeGreaterThan(20);
    expect(p.distanceM).toBeLessThan(25);
    expect(p.alongM / p.totalM).toBeCloseTo(0.25, 2);
    expect(p.point.lat).toBeCloseTo(0, 6);
    expect(p.point.lng).toBeCloseTo(0.005, 6);
  });

  it('clamps to the ends of the road', () => {
    const before = projectOntoPolyline(0, -0.5, road);
    const after = projectOntoPolyline(0, 0.5, road);
    expect(before.alongM).toBe(0);
    expect(after.alongM).toBeCloseTo(after.totalM, 6);
  });

  it('answers null for a line that is not a line', () => {
    expect(projectOntoPolyline(0, 0, [[0, 0]])).toBeNull();
    expect(projectOntoPolyline(0, 0, null)).toBeNull();
  });
});
