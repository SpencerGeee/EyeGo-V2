'use strict';

/**
 * The runtime checks on payloads that decide what someone pays.
 *
 * Lives in the API's suite because it is the only jest runner in the repo; the
 * code under test is `packages/api/src/schemas.ts` and the `money-guards.ts`
 * façade over it, both compiled from TypeScript by the apps. Nothing is
 * reimplemented here — the files are read and evaluated as written.
 *
 * Why these cases and not others: each one is a way a fare has actually gone
 * wrong somewhere, or would go wrong silently. A missing field multiplies to
 * NaN and renders "GH₵ NaN". A numeric string divides into a plausible wrong
 * number, which is worse than an error because nobody notices. A surge
 * multiplier from a mistyped config prices a ride at a thousand times its
 * fare, and the app renders it without hesitation.
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const SRC_DIR = path.join(__dirname, '../../packages/api/src');

/**
 * Compile the TypeScript to CommonJS in memory rather than duplicating the
 * logic here. A test that reimplements its subject tests the reimplementation.
 *
 * `money-guards.ts` is no longer standalone — it is a façade over `schemas.ts`,
 * which is zod — so the shim now resolves relative imports through a tiny
 * registry and everything else through Node, FROM `packages/api`.
 *
 * That last part matters and is not incidental. `eyego-api` pins zod 3 for the
 * server; the apps and `packages/api` resolve zod 4 from the workspace root,
 * and the two majors disagree about whether `Infinity` is a number. Resolving
 * from the source directory means this suite exercises the zod the phones will
 * actually run, not the one that happens to sit next to the test.
 */
const cache = new Map();

function load(name) {
  if (cache.has(name)) return cache.get(name);
  const compiled = ts.transpileModule(fs.readFileSync(path.join(SRC_DIR, `${name}.ts`), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;

  const shim = { exports: {} };
  cache.set(name, shim.exports);
  const localRequire = (id) =>
    id.startsWith('./') ? load(id.slice(2)) : require(require.resolve(id, { paths: [SRC_DIR] }));
  new Function('module', 'exports', 'require', compiled)(shim, shim.exports, localRequire);
  cache.set(name, shim.exports);
  return shim.exports;
}

const {
  pesewas,
  optionalPesewas,
  signedPesewas,
  multiplier,
  distanceKm,
  seatCount,
  assertFareQuote,
  MoneyShapeError,
} = load('money-guards');

describe('pesewas', () => {
  it('accepts a non-negative integer', () => {
    expect(pesewas(2500, 'f')).toBe(2500);
    expect(pesewas(0, 'f')).toBe(0);
  });

  it('refuses a numeric string', () => {
    // The dangerous one. Coercing "2500" hides a changed server contract until
    // something downstream concatenates instead of adding.
    expect(() => pesewas('2500', 'f')).toThrow(MoneyShapeError);
  });

  it.each([[undefined], [null], [NaN], [Infinity], [-1], [12.5], [{}], [[]]])(
    'refuses %p',
    (bad) => {
      expect(() => pesewas(bad, 'f')).toThrow(MoneyShapeError);
    },
  );

  it('names the field it refused, so the error is actionable', () => {
    try {
      pesewas(undefined, 'quote.amountPesewas');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e.field).toBe('quote.amountPesewas');
      expect(e.message).toMatch(/missing/);
    }
  });
});

describe('optionalPesewas', () => {
  it('allows absent', () => {
    expect(optionalPesewas(undefined, 'f')).toBeUndefined();
    expect(optionalPesewas(null, 'f')).toBeUndefined();
  });

  it('still refuses present-but-wrong', () => {
    expect(() => optionalPesewas('5', 'f')).toThrow(MoneyShapeError);
  });
});

describe('multiplier', () => {
  it('accepts a sane surge', () => {
    expect(multiplier(1, 'f')).toBe(1);
    expect(multiplier(2.5, 'f')).toBe(2.5);
  });

  it('refuses zero, negative and absurd values', () => {
    expect(() => multiplier(0, 'f')).toThrow(MoneyShapeError);
    expect(() => multiplier(-1, 'f')).toThrow(MoneyShapeError);
    // A config mistake that would price a ride at a thousand times its fare.
    expect(() => multiplier(1000, 'f')).toThrow(MoneyShapeError);
  });
});

describe('distanceKm', () => {
  it('allows fractional distances', () => {
    expect(distanceKm(12.4, 'f')).toBe(12.4);
  });

  it('refuses negative and non-finite', () => {
    expect(() => distanceKm(-1, 'f')).toThrow(MoneyShapeError);
    expect(() => distanceKm(NaN, 'f')).toThrow(MoneyShapeError);
  });
});

describe('assertFareQuote', () => {
  const good = () => ({
    quoteId: 'q_1',
    amountPesewas: 2500,
    currency: 'GHS',
    distanceKm: 12.4,
    surgeMultiplier: 1,
    breakdown: {},
  });

  it('passes a well-formed quote through unchanged', () => {
    const q = good();
    // The same object, not a copy: rebuilding it would silently drop any field
    // added to the payload since this was written.
    expect(assertFareQuote(q)).toBe(q);
  });

  it('refuses a quote with no id', () => {
    // Without it the booking cannot reference the price it was quoted, and the
    // rider is charged whatever the server recalculates later.
    expect(() => assertFareQuote({ ...good(), quoteId: '' })).toThrow(/quoteId/);
  });

  it('refuses a missing amount rather than rendering NaN', () => {
    const q = good();
    delete q.amountPesewas;
    expect(() => assertFareQuote(q)).toThrow(/amountPesewas/);
  });

  it('refuses a loyalty discount that is present but malformed', () => {
    expect(() => assertFareQuote({ ...good(), loyaltyDiscountPesewas: '300' })).toThrow(
      /loyaltyDiscountPesewas/,
    );
  });

  it('allows the optional loyalty fields to be absent', () => {
    expect(() => assertFareQuote(good())).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The zod boundary itself (§3b item 24).
//
// The tests above exercise the named primitives. These exercise the properties
// that only exist because the checking moved to schemas: that a payload keeps
// its identity and its unknown fields, that a list degrades instead of
// vanishing, and that the error names the exact field rather than the payload.
// ─────────────────────────────────────────────────────────────────────────────

const {
  assertShape,
  parseEach,
  parseOrNull,
  FareQuoteSchema,
  ReceiptSchema,
  CancellationTermsSchema,
  WalletTransactionSchema,
  EarningsBreakdownSchema,
  PendingOfferSchema,
  DriverWalletBalanceSchema,
} = load('schemas');

describe('signedPesewas', () => {
  it('accepts a negative balance — a driver who owes commission on a cash fare', () => {
    expect(signedPesewas(-4500, 'balance')).toBe(-4500);
  });

  it('still refuses a numeric string', () => {
    expect(() => signedPesewas('-4500', 'balance')).toThrow(MoneyShapeError);
  });
});

describe('seatCount', () => {
  it('accepts a real party size', () => {
    expect(seatCount(4, 'seats')).toBe(4);
  });

  it('refuses zero — nobody travels on a booking for no seats', () => {
    expect(() => seatCount(0, 'seats')).toThrow(MoneyShapeError);
  });

  it('refuses a numeric string, which would repeat rather than multiply', () => {
    expect(() => seatCount('4', 'seats')).toThrow(MoneyShapeError);
  });

  it('refuses a bus that does not exist', () => {
    expect(() => seatCount(500, 'seats')).toThrow(MoneyShapeError);
  });
});

describe('assertShape', () => {
  const terms = () => ({
    feePercentage: 25,
    feeAmountPesewas: 500,
    feeType: 'LATE_CANCELLATION',
    fareAmountPesewas: 2000,
    seatCount: 1,
  });

  it('returns the SAME object, so nothing memoised on identity re-renders', () => {
    const t = terms();
    expect(assertShape(CancellationTermsSchema, t, 'terms')).toBe(t);
  });

  it('keeps a field the server added that no schema mentions', () => {
    const t = { ...terms(), somethingShippedLastTuesday: 'kept' };
    expect(assertShape(CancellationTermsSchema, t, 'terms').somethingShippedLastTuesday).toBe('kept');
  });

  it('names the exact field, not the payload, so the log says where', () => {
    expect(() => assertShape(CancellationTermsSchema, { ...terms(), feeAmountPesewas: '500' }, 'terms'))
      .toThrow(/terms\.feeAmountPesewas/);
  });

  it('reports what actually arrived rather than "missing" for every failure', () => {
    try {
      assertShape(CancellationTermsSchema, { ...terms(), feeAmountPesewas: '500' }, 'terms');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.received).toBe('500');
    }
  });

  it('refuses a nested total that is not money — the receipt case', () => {
    const receipt = {
      bookingId: 'b1',
      fareBreakdown: {
        baseFarePesewas: 2000, platformFeePesewas: 100, surcharges: 0,
        discount: 0, tip: 0, total: 21.5,
      },
      paymentMethod: 'CASH',
      receiptNumber: 'R-1',
    };
    // 21.5 is what a cedis-vs-pesewas mix-up looks like on the wire, and it is
    // the exact bug class that has bitten the wallet routes before.
    expect(() => assertShape(ReceiptSchema, receipt, 'receipt')).toThrow(/fareBreakdown\.total/);
  });
});

describe('parseEach', () => {
  const rows = () => [
    { id: 'a', type: 'TRIP_EARNING', amountPesewas: 1200, createdAt: '2026-09-01' },
    { id: 'b', type: 'WITHDRAWAL', amountPesewas: '-500', createdAt: '2026-09-01' },
    { id: 'c', type: 'WITHDRAWAL', amountPesewas: -500, createdAt: '2026-09-01' },
  ];

  it('drops only the bad row — a history missing a line beats an empty screen', () => {
    const kept = parseEach(WalletTransactionSchema, rows());
    expect(kept.map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('keeps the negative rows: a withdrawal is written as one', () => {
    expect(parseEach(WalletTransactionSchema, rows())[1].amountPesewas).toBe(-500);
  });

  it('answers with an empty list rather than throwing when handed a non-array', () => {
    expect(parseEach(WalletTransactionSchema, undefined)).toEqual([]);
  });
});

describe('parseOrNull', () => {
  it('answers null instead of throwing', () => {
    expect(parseOrNull(PendingOfferSchema, { tripId: '' })).toBeNull();
  });
});

describe('the schemas the screens depend on', () => {
  it('lets a driver wallet go negative but not fractional', () => {
    const owed = { balancePesewas: -4500, currency: 'GHS' };
    expect(assertShape(DriverWalletBalanceSchema, owed, 'w')).toBe(owed);
    expect(() => assertShape(DriverWalletBalanceSchema, { balancePesewas: -45.5, currency: 'GHS' }, 'w'))
      .toThrow(MoneyShapeError);
  });

  it('accepts an earnings breakdown whose net is negative', () => {
    // A driver deep in commission debt. Rejecting this would blank the one
    // screen that explains to them why they cannot go online.
    const b = {
      totalEarningsPesewas: 0, totalTrips: 0, totalTips: 0,
      totalDeductions: -3000, netEarnings: -3000, averagePerTripPesewas: 0,
      // `earnings` and `trips`, which is what drivers.service.js groups into —
      // NOT `amountPesewas`, which the client type used to declare and the
      // server has never sent.
      dailyBreakdown: [{ date: '2026-09-01', earnings: -3000, trips: 0 }],
    };
    expect(assertShape(EarningsBreakdownSchema, b, 'earnings')).toBe(b);
  });

  it('refuses an offer whose fare is a string', () => {
    expect(() =>
      assertShape(PendingOfferSchema, { tripId: 't1', farePesewas: '2500' }, 'offer'),
    ).toThrow(/offer\.farePesewas/);
  });

  it('accepts an offer whose money is null — the fare is not computed yet', () => {
    const o = { tripId: 't1', farePesewas: null, driverEarningsPesewas: null };
    expect(assertShape(PendingOfferSchema, o, 'offer')).toBe(o);
  });

  it('refuses a surge multiplier from a mistyped config', () => {
    expect(() =>
      assertShape(FareQuoteSchema, {
        quoteId: 'q1', amountPesewas: 2500, distanceKm: 4, surgeMultiplier: 1000,
      }, 'quote'),
    ).toThrow(/quote\.surgeMultiplier/);
  });

  it('refuses a breakdown line that is a string', () => {
    expect(() =>
      assertShape(FareQuoteSchema, {
        quoteId: 'q1', amountPesewas: 2500, distanceKm: 4, surgeMultiplier: 1,
        breakdown: { baseFarePesewas: '2000' },
      }, 'quote'),
    ).toThrow(/quote\.breakdown\.baseFarePesewas/);
  });
});
