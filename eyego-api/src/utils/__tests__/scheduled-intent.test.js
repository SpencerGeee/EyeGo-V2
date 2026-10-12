'use strict';

jest.mock('../../config/database', () => ({}));
const { settledIntentStatus } = require('../scheduled-intent');

const NOW = Date.parse('2026-10-12T12:00:00Z');
const at = (h) => new Date(NOW + h * 3600e3).toISOString();

describe('settledIntentStatus', () => {
  it('an un-dispatched ride long past its time is expired, not upcoming', () => {
    expect(settledIntentStatus({ status: 'PENDING', scheduledAt: at(-72) }, null, NOW)).toBe('EXPIRED');
    expect(settledIntentStatus({ status: 'PENDING', scheduledAt: at(2) }, null, NOW)).toBe('PENDING');
  });

  it('reads the ride it became', () => {
    const d = { status: 'DISPATCHED', scheduledAt: at(-72) };
    expect(settledIntentStatus(d, { tripStatus: 'NO_DRIVERS_FOUND', riderOn: false }, NOW)).toBe('EXPIRED');
    expect(settledIntentStatus(d, { tripStatus: 'COMPLETED', riderOn: true }, NOW)).toBe('COMPLETED');
    expect(settledIntentStatus(d, { tripStatus: 'CANCELLED', riderOn: false }, NOW)).toBe('CANCELLED');
    expect(settledIntentStatus(d, { tripStatus: 'DRIVER_EN_ROUTE', riderOn: true }, NOW)).toBe('MATCHED');
    expect(settledIntentStatus(d, { tripStatus: 'MATCHING', riderOn: true }, NOW)).toBe('DISPATCHED');
  });

  it('a bus that finished without the rider is their cancellation', () => {
    const m = { status: 'MATCHED', scheduledAt: at(-72) };
    expect(settledIntentStatus(m, { tripStatus: 'COMPLETED', riderOn: false }, NOW)).toBe('CANCELLED');
    expect(settledIntentStatus(m, { tripStatus: 'FILLING', riderOn: false }, NOW)).toBe('CANCELLED');
  });

  it('never revives a closed intent', () => {
    expect(settledIntentStatus({ status: 'CANCELLED', scheduledAt: at(5) }, { tripStatus: 'IN_PROGRESS', riderOn: true }, NOW)).toBe('CANCELLED');
  });
});
