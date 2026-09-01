'use strict';

/**
 * The runtime checks on payloads that decide what someone pays.
 *
 * Lives in the API's suite because it is the only jest runner in the repo; the
 * code under test is `packages/api/src/money-guards.ts` and is compiled from
 * TypeScript by the apps. The logic is plain JavaScript, so it is exercised
 * here by reimplementing nothing — the file is read and evaluated as written.
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

const SRC = path.join(__dirname, '../../packages/api/src/money-guards.ts');

// Compile the TypeScript to CommonJS in memory rather than duplicating the
// logic here. A test that reimplements its subject tests the reimplementation.
const compiled = ts.transpileModule(fs.readFileSync(SRC, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

const moduleShim = { exports: {} };

new Function('module', 'exports', compiled)(moduleShim, moduleShim.exports);
const { pesewas, optionalPesewas, multiplier, distanceKm, assertFareQuote, MoneyShapeError } =
  moduleShim.exports;

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
