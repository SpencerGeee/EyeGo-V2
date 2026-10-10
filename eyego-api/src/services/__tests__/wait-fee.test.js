'use strict';

const { waitFeeFor } = require('../../modules/trips/fare.calculator');

// Defaults: 3 free minutes, ECO waiting 82 pesewas/min (env.js), capped at 1000.
const ago = (min) => new Date(Date.now() - min * 60_000);

describe('waitFeeFor — waiting at the pickup', () => {
  it('charges whole minutes past the free window', () => {
    expect(waitFeeFor(ago(10.5), 'ECO')).toEqual({ minutes: 7, feePesewas: 574 });
  });
  it('is free inside the window', () => {
    expect(waitFeeFor(ago(2), 'ECO')).toEqual({ minutes: 0, feePesewas: 0 });
  });
  it('is capped', () => {
    expect(waitFeeFor(ago(60), 'ECO').feePesewas).toBe(1000);
  });
  it('charges nothing when the driver never marked arrival', () => {
    expect(waitFeeFor(null, 'ECO')).toEqual({ minutes: 0, feePesewas: 0 });
  });
});
