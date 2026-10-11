'use strict';

const { boundedBody, boundedPaging, tooBig, MAX_STRING } = require('../boundedBody');

function run(mw, req) {
  let status = null;
  let nexted = false;
  const res = { status(s) { status = s; return this; }, json() { return this; } };
  mw(req, res, () => { nexted = true; });
  return { status, nexted };
}

describe('boundedBody', () => {
  it('passes ordinary bodies, refuses an oversized string anywhere in the tree', () => {
    expect(tooBig({ comment: 'ok', items: [{ note: 'x' }] })).toBeNull();
    expect(tooBig({ a: { b: ['x'.repeat(MAX_STRING + 1)] } })).toMatch(/text field/);
    expect(tooBig({ list: new Array(1001).fill(1) })).toMatch(/list/);
    let deep = {}; const root = deep;
    for (let i = 0; i < 30; i++) { deep.n = {}; deep = deep.n; }
    expect(tooBig(root)).toMatch(/nested/);
  });
  it('lets a dev-mode inline photo through, but not a megabyte of plain text', () => {
    expect(tooBig({ photoUrls: ['data:image/jpeg;base64,' + 'A'.repeat(500_000)] })).toBeNull();
    expect(tooBig({ comment: 'A'.repeat(500_000) })).not.toBeNull();
  });
  it('answers 413, and leaves gateway webhooks alone', () => {
    const big = { note: 'x'.repeat(MAX_STRING + 1) };
    expect(run(boundedBody, { path: '/v1/disputes', body: big })).toEqual({ status: 413, nexted: false });
    expect(run(boundedBody, { path: '/v1/payments/webhook', body: big }).nexted).toBe(true);
  });
});

describe('boundedPaging', () => {
  it('clamps limit and page outside the admin console', () => {
    const req = { path: '/v1/bookings', query: { limit: '1000000', page: '-3' } };
    run(boundedPaging, req);
    expect(req.query).toEqual({ limit: '100', page: '1' });
    const junk = { path: '/v1/bookings', query: { limit: 'abc' } };
    run(boundedPaging, junk);
    expect(junk.query.limit).toBe('20');
    const admin = { path: '/v1/admin/users', query: { limit: '500' } };
    run(boundedPaging, admin);
    expect(admin.query.limit).toBe('500');
  });
});
