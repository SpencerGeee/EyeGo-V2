const { pickCorridor } = require('../src/services/corridor.service');
const { seatFareData } = require('../src/modules/trips/fare.calculator');
const { newBoardingCode, normalizeBoardingCode, ALPHABET } = require('../src/utils/boarding-code');

// Kasoa (5.53, -0.42) → Shiashie (5.63, -0.17)
const kasoaShiashie = { id: 'c1', name: 'Kasoa → Shiashie', originLat: 5.53, originLng: -0.42, destLat: 5.63, destLng: -0.17, radiusKm: 2, seatPricePesewas: 2800 };

describe('corridors', () => {
  test('a trip with both ends near the corridor ends is on it', () => {
    const route = { originLat: 5.535, originLng: -0.415, destLat: 5.628, destLng: -0.172 };
    expect(pickCorridor([kasoaShiashie], route)?.id).toBe('c1');
  });

  test('the reverse direction is a different corridor', () => {
    const route = { originLat: 5.63, originLng: -0.17, destLat: 5.53, destLng: -0.42 };
    expect(pickCorridor([kasoaShiashie], route)).toBeNull();
  });

  test('inactive corridors never match', () => {
    const route = { originLat: 5.53, originLng: -0.42, destLat: 5.63, destLng: -0.17 };
    expect(pickCorridor([{ ...kasoaShiashie, isActive: false }], route)).toBeNull();
  });

  test('a pinned corridor price IS the seat price, whatever the bus', () => {
    const trip = { tier: 'ECO', maxSeats: 14, route: { distanceKm: 30 }, corridorSeatPricePesewas: 2800, commissionRate: 0.15 };
    const fare = seatFareData(trip);
    expect(fare.farePerPersonPesewas).toBe(2800);
    expect(fare.commissionPerSeatPesewas).toBe(420);
    expect(fare.corridorPriced).toBe(true);
    const unpinned = seatFareData({ ...trip, corridorSeatPricePesewas: null });
    expect(unpinned.corridorPriced).toBeUndefined();
  });
});

describe('boarding code', () => {
  test('4 unambiguous characters', () => {
    const code = newBoardingCode();
    expect(code).toHaveLength(4);
    for (const ch of code) expect(ALPHABET).toContain(ch);
  });
  test('typed loosely, read strictly', () => {
    expect(normalizeBoardingCode(' ab-3k ')).toBe('AB3K');
  });
});
