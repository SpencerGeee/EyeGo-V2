/**
 * Buses only (2026-10-29): a private ride is the whole bus, so party size does
 * not change the price, and the premium over a seat is PRIVATE_RIDE_MULTIPLIER.
 */
const { calculateRideFare } = require('../src/modules/trips/fare.calculator');

const base = { tier: 'ECO', distanceKm: 12, durationMin: 25 };

describe('private ride pricing', () => {
  test('one rider and a full party pay the same for the same bus', () => {
    const solo = calculateRideFare({ ...base, partySize: 1 });
    const party = calculateRideFare({ ...base, partySize: 12 });
    expect(party.totalTripCostPesewas).toBe(solo.totalTripCostPesewas);
    expect(party.partySize).toBe(12);
  });

  test('the private premium is the multiplier on the metered ride, in whole pesewas', () => {
    const fare = calculateRideFare({ ...base, partySize: 3 });
    const metered = fare.startFarePesewas + fare.distanceComponentPesewas + fare.timeComponentPesewas;
    expect(fare.privateRideMultiplier).toBeGreaterThanOrEqual(1);
    expect(fare.partySizeSurchargePesewas).toBe(Math.round(metered * (fare.privateRideMultiplier - 1)));
    expect(Number.isInteger(fare.totalTripCostPesewas)).toBe(true);
  });
});
