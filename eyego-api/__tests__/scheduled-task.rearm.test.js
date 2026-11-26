'use strict';

// A handler that re-arms its own key (dispatch resweep, offer timeout for the
// next driver) must not have that re-arm overwritten to DONE by tick().
const mockRows = new Map();
jest.mock('../src/config/database', () => ({
  scheduledTask: {
    upsert: async ({ where, create, update }) => {
      const key = `${where.type_dedupeKey.type}:${where.type_dedupeKey.dedupeKey}`;
      const row = mockRows.get(key);
      if (row) Object.assign(row, update);
      else mockRows.set(key, { id: key, ...create });
      return mockRows.get(key);
    },
    updateMany: async ({ where, data }) => {
      let count = 0;
      for (const r of mockRows.values()) {
        if (r.id === where.id && r.status === where.status && r.claimedBy === where.claimedBy) {
          Object.assign(r, data);
          count += 1;
        }
      }
      return { count };
    },
    update: async ({ where, data }) => Object.assign(mockRows.get(where.id), data),
  },
  $queryRaw: async () => {
    const due = [...mockRows.values()].filter((r) => r.status === 'PENDING' && r.runAt <= new Date());
    due.forEach((r) => Object.assign(r, { status: 'CLAIMED', claimedBy: 'w1', attempts: (r.attempts || 0) + 1 }));
    return due.map((r) => ({ ...r }));
  },
}));
jest.mock('../src/utils/logger', () => ({ info() {}, warn() {}, error() {}, debug() {} }));

const tasks = require('../src/services/scheduled-task.service');

test('self re-arm survives tick', async () => {
  tasks.registerHandler('T', async () => {
    await tasks.enqueue({ type: 'T', dedupeKey: 'k', runAt: new Date(Date.now() + 10_000) });
  });
  await tasks.enqueue({ type: 'T', dedupeKey: 'k', runAt: new Date(Date.now() - 1) });
  await tasks.tick('w1');
  expect(mockRows.get('T:k').status).toBe('PENDING');
});

test('plain task is marked DONE', async () => {
  tasks.registerHandler('P', async () => {});
  await tasks.enqueue({ type: 'P', dedupeKey: 'k', runAt: new Date(Date.now() - 1) });
  await tasks.tick('w1');
  expect(mockRows.get('P:k').status).toBe('DONE');
});
