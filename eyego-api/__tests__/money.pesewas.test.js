'use strict';

/**
 * The money invariants.
 *
 * These are not "does the function run" tests. Each one is a property that, if
 * it ever stops holding, means the platform is charging or paying the wrong
 * amount — the class of bug you only find out about from a rider, weeks later,
 * with no way to reconstruct what happened.
 *
 * Runs with no database and no network, so it is safe on every commit.
 */

const money = require('../src/utils/money');
const { calculateFare } = require('../src/modules/trips/fare.calculator');
const env = require('../src/config/env');

describe('money: representation', () => {
  test('cedis knobs are converted exactly once, at the env boundary', () => {
    expect(Number.isInteger(env.ECO_BASE_FARE_PESEWAS)).toBe(true);
    expect(Number.isInteger(env.MIN_FARE_PER_SEAT_PESEWAS)).toBe(true);
    // The cedis-named keys must NOT survive onto the exported object. If they
    // do, an unconverted call site keeps working and prices rides at 1/100th.
    expect(env.ECO_BASE_FARE).toBeUndefined();
    expect(env.MIN_FARE_PER_SEAT).toBeUndefined();
    expect(env.DRIVER_MIN_WITHDRAWAL).toBeUndefined();
  });

  test('fromCedis survives float representation error', () => {
    // 25.50 is not exactly representable; `25.5 * 100` can land on 2549.9999…
    expect(money.fromCedis(25.5)).toBe(2550);
    expect(money.fromCedis(0.1 + 0.2)).toBe(30);
    expect(money.fromCedis(1.005)).toBe(101);
    expect(money.fromCedis(null)).toBe(0);
  });

  test('formatGhs never renders a wrong-looking amount', () => {
    expect(money.formatGhs(2550)).toBe('GH₵25.50');
    expect(money.formatGhs(5)).toBe('GH₵0.05');
    expect(money.formatGhs(0)).toBe('GH₵0.00');
    expect(money.formatGhs(100)).toBe('GH₵1.00');
    expect(money.formatGhs(-2550)).toBe('-GH₵25.50');
  });
});

describe('money: guards', () => {
  test('assertPesewas rejects a fractional value — cedis leaking past the boundary', () => {
    expect(() => money.assertPesewas(25.5)).toThrow(/integer number of pesewas/);
  });

  test('assertPesewas rejects the values that quietly become free rides', () => {
    expect(() => money.assertPesewas(NaN)).toThrow();
    expect(() => money.assertPesewas(undefined)).toThrow();
    expect(() => money.assertPesewas('2550')).not.toThrow(); // numeric strings coerce
    expect(() => money.assertPesewas(-5)).toThrow(/negative/);
    expect(() => money.assertPesewas(1e12)).toThrow(/ceiling/);
  });

  test('a ledger delta may be signed', () => {
    expect(money.assertPesewas(-500, 'delta', { allowNegative: true })).toBe(-500);
  });
});

describe('money: splitting cannot lose or invent a pesewa', () => {
  // The single most common way an integer-money system still ends up
  // unbalanced: rounding each share independently.
  test.each([
    [1000, 3],
    [2551, 7],
    [1, 4],
    [99999, 13],
    [0, 5],
    [7, 7],
  ])('split(%i, %i) sums back to the total', (total, parts) => {
    const shares = money.split(total, parts);
    expect(shares).toHaveLength(parts);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
    // No share differs from another by more than one pesewa.
    expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
  });

  test('a negative total splits without changing sign', () => {
    const shares = money.split(-1000, 3);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(-1000);
    expect(shares.every((s) => s <= 0)).toBe(true);
  });
});

describe('fare: the numbers the rider and the driver see must agree', () => {
  const CASES = [
    ['ECO', 12.4, 1],
    ['COMFORT', 3.1, 4],
    ['PREMIUM', 250, 14],
    ['ECO', 0.4, 1],
    ['ECO', 0, 1],
  ];

  test.each(CASES)('%s over %skm across %i seat(s)', (tier, distanceKm, seatCount) => {
    const f = calculateFare({ tier, distanceKm, seatCount });

    // Nothing fractional may escape the calculator.
    for (const key of [
      'farePerPersonPesewas',
      'commissionPerSeatPesewas',
      'driverEarningsPerSeatPesewas',
      'totalTripCostPesewas',
      'minFarePerSeatPesewas',
    ]) {
      expect(Number.isInteger(f[key])).toBe(true);
    }

    /**
     * The platform's cut and the driver's cut must add back EXACTLY — rounding
     * the two sides independently is what leaves a ledger short by a pesewa per
     * ride.
     *
     * They add back to the RIDE, not to what the rider pays. This assertion used
     * to compare against `farePerPersonPesewas` and was correct when it was
     * written; the booking fee and the flat platform fee were added on top of
     * the ride afterwards, and no commission is taken from either — they are
     * platform revenue in full (see RIDE_BOOKING_FEE_RATE in config/settings.js).
     * So the old form was off by exactly those two fees, and would have stayed
     * red for as long as the fee model is right.
     */
    const ridePerSeat = f.commissionPerSeatPesewas + f.driverEarningsPerSeatPesewas;
    expect(ridePerSeat + f.bookingFeePesewas + f.platformFeePesewas).toBe(f.farePerPersonPesewas);

    // What the driver is told the trip is worth is exactly seats × what each
    // rider pays — the two apps quoting different totals for one trip was a
    // real, shipped bug.
    expect(f.totalTripCostPesewas).toBe(f.farePerPersonPesewas * seatCount);

    // The floor always binds; nothing is ever free.
    expect(f.farePerPersonPesewas).toBeGreaterThan(0);
    expect(f.farePerPersonPesewas).toBeGreaterThanOrEqual(f.minFarePerSeatPesewas);
  });

  test('tier separation survives the floor', () => {
    const at = (tier) => calculateFare({ tier, distanceKm: 10, seatCount: 1 }).farePerPersonPesewas;
    expect(at('ECO')).toBeLessThan(at('COMFORT'));
    expect(at('COMFORT')).toBeLessThan(at('PREMIUM'));
  });

  test('the same inputs always price the same — a quote is reproducible', () => {
    const args = { tier: 'ECO', distanceKm: 7.77, seatCount: 3 };
    expect(calculateFare(args)).toEqual(calculateFare(args));
  });

  test('a stored rate beats the current env, so a live trip cannot be repriced', () => {
    const withStored = calculateFare({
      tier: 'ECO',
      distanceKm: 10,
      seatCount: 1,
      storedBaseFarePesewas: 100_00,
      storedPerKmRatePesewas: 10_00,
    });
    // 10000 + 1000×10 = 20000 pesewas = GH₵200 for the RIDE.
    expect(withStored.baseFarePesewas).toBe(10000);
    expect(
      withStored.commissionPerSeatPesewas + withStored.driverEarningsPerSeatPesewas,
    ).toBe(20000);

    // And the total is that ride plus the two platform fees, which is the whole
    // of what the rider pays.
    expect(withStored.farePerPersonPesewas).toBe(
      20000 + withStored.bookingFeePesewas + withStored.platformFeePesewas,
    );
  });

  /**
   * KNOWN GAP — not a passing test, and deliberately not deleted.
   *
   * `storedBaseFarePesewas` and `storedPerKmRatePesewas` are the only two
   * values a stored quote can pin. `RIDE_BOOKING_FEE_RATE`,
   * `RIDE_PLATFORM_FEE_PESEWAS` and `PLATFORM_COMMISSION` are all read live
   * through `cfg()` at calculation time (fare.calculator.js:206-218), so an
   * operator changing a fee in the console changes the total of a trip that was
   * already quoted — which is the precise repricing the test above exists to
   * prevent, left half-guarded.
   *
   * The blast radius today is small: the quote is TTL'd and the fare is written
   * onto the booking, so the rider is charged what they were shown. It bites on
   * any path that RE-derives a fare — a receipt, a dispute, a driver's earnings
   * breakdown — which can then disagree with the ledger.
   *
   * The fix is to store the fee rate and the flat fee on the quote alongside
   * the two rates, which is a schema change plus every recalculation call site.
   * Sized, not done, and not worth a rushed half-fix in money code.
   */
  test.todo('a stored quote should pin the fee rates too, not just base and per-km');

  test('a nonsense distance is refused rather than priced', () => {
    expect(() => calculateFare({ tier: 'ECO', distanceKm: NaN, seatCount: 1 })).toThrow();
    expect(() => calculateFare({ tier: 'ECO', distanceKm: -5, seatCount: 1 })).toThrow();
  });
});
