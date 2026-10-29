const { freeSeatsOnSpan, peakOccupancy, isJoinableSpan, spanOf } = require('../src/utils/segment-seats');

const b = (from, to, seats = 1) => ({ boardRatio: from, alightRatio: to, seats });

describe('segment seats', () => {
  test('a booking with no ratios rides the whole route', () => {
    expect(spanOf({})).toEqual([0, 1]);
  });

  test('full bus leaving origin, two get off at 0.5 → two seats free after 0.5', () => {
    const bookings = [b(0, 0.5), b(0, 0.5), b(0, 1), b(0, 1)];
    expect(freeSeatsOnSpan(bookings, 4, 0, 1)).toBe(0);
    expect(freeSeatsOnSpan(bookings, 4, 0.5, 1)).toBe(2);
  });

  test('alighting at x frees the seat for someone boarding at x (half-open)', () => {
    expect(freeSeatsOnSpan([b(0, 0.4)], 1, 0.4, 1)).toBe(1);
  });

  test('peak, not sum: two riders on disjoint stretches use one seat', () => {
    expect(peakOccupancy([b(0, 0.3), b(0.3, 0.6)], 0, 1)).toBe(1);
  });

  test('a multi-seat booking counts all its seats', () => {
    expect(freeSeatsOnSpan([b(0.2, 0.8, 10)], 14, 0.5, 0.9)).toBe(4);
  });

  test('rows written before spans existed occupy the whole route', () => {
    expect(freeSeatsOnSpan([{ seats: 1 }, { seats: 2 }], 14, 0.7, 0.9)).toBe(11);
  });

  test('joinable only ahead of the bus and forward', () => {
    expect(isJoinableSpan({ busRatio: 0.3, from: 0.5, to: 0.9 })).toBe(true);
    expect(isJoinableSpan({ busRatio: 0.6, from: 0.5, to: 0.9 })).toBe(false);
    expect(isJoinableSpan({ busRatio: 0, from: 0.7, to: 0.4 })).toBe(false);
    expect(isJoinableSpan({ busRatio: 0.45, from: 0.5, to: 0.9, aheadMargin: 0.1 })).toBe(false);
  });
});
