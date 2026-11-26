// A resweep that finds a driver must actually reach offerNext. It used to queue
// offerNext with setImmediate while still holding the cascade lock; SET NX lost
// to its own lock, withLock returned null silently, and the trip sat in MATCHING
// with the driver online (eyego-testers run 45814292257).
const mockStore = new Map();
// A real Redis reply is a network round trip, not a microtask — that gap is the race.
const mockRtt = () => new Promise((r) => setTimeout(r, 2));
jest.mock('../../config/redis', () => ({
  get: jest.fn(async (k) => { await mockRtt(); return mockStore.has(k) ? mockStore.get(k) : null; }),
  set: jest.fn(async (k, v, ...opts) => {
    await mockRtt();
    if (opts.includes('NX') && mockStore.has(k)) return null;
    mockStore.set(k, v);
    return 'OK';
  }),
  del: jest.fn(async (k) => { await mockRtt(); mockStore.delete(k); return 1; }),
  incr: jest.fn(async () => 1),
  expire: jest.fn(async () => 1),
}));
jest.mock('../scheduled-task.service', () => ({
  registerHandler: () => {},
  enqueue: jest.fn(async () => {}),
  cancel: jest.fn(async () => {}),
}));
const mockFindUnique = jest.fn();
jest.mock('../../config/database', () => ({
  trip: { findUnique: (...a) => mockFindUnique(...a) },
  tripEvent: { findMany: async () => [] },
}));
jest.mock('../matcher.service', () => ({ rankCandidates: async () => [{ id: 'd1' }] }));
jest.mock('../trip-events.publisher', () => ({ publishOfferRevoked: jest.fn() }));
jest.mock('../../utils/logger', () => ({ info() {}, warn() {}, error() {}, debug() {} }));

const cascade = require('../dispatch-cascade.service');

test('resweep with supply hands off to offerNext under a fresh lock', async () => {
  mockStore.set('dispatch:cascade:t1', JSON.stringify({
    tripId: 't1', candidates: [{ id: 'd1' }], index: 1, startedAtMs: Date.now(),
  }));
  // resweep sees MATCHING; offerNext's read sees it taken, so it finishes early.
  mockFindUnique
    .mockResolvedValueOnce({ id: 't1', status: 'MATCHING' })
    .mockResolvedValueOnce({ id: 't1', status: 'ACCEPTED' });

  await cascade.resweep('t1');
  await new Promise((r) => setTimeout(r, 100)); // let a (buggy) deferred offerNext settle too

  expect(mockFindUnique).toHaveBeenCalledTimes(2); // offerNext got the lock and ran
  expect(JSON.parse(mockStore.get('dispatch:cascade:t1')).done).toBe(true);
});
