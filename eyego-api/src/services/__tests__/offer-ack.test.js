// L1 offer ACK: a receipt is recorded only for the live offer, and an
// ack-capable app that never acks loses the offer early without a "missed" mark.
const mockStore = new Map();
jest.mock('../../config/redis', () => ({
  get: jest.fn(async (k) => (mockStore.has(k) ? mockStore.get(k) : null)),
  set: jest.fn(async (k, v) => { mockStore.set(k, v); return 'OK'; }),
  del: jest.fn(async (k) => { mockStore.delete(k); return 1; }),
  incr: jest.fn(async () => 1),
  expire: jest.fn(async () => 1),
}));
const mockHandlers = {};
jest.mock('../scheduled-task.service', () => ({
  registerHandler: (type, fn) => { mockHandlers[type] = fn; },
  enqueue: jest.fn(async () => {}),
  cancel: jest.fn(async () => {}),
}));
jest.mock('../../config/database', () => ({}));
jest.mock('../trip-events.publisher', () => ({ publishOfferRevoked: jest.fn() }));

const cascade = require('../dispatch-cascade.service');
const publisher = require('../trip-events.publisher');

const put = (s) => mockStore.set(`dispatch:cascade:${s.tripId}`, JSON.stringify(s));
const get = (id) => JSON.parse(mockStore.get(`dispatch:cascade:${id}`));

beforeEach(() => mockStore.clear());

test('acks the live offer and marks the app ack-capable', async () => {
  put({ tripId: 't1', currentDriverId: 'd1', offerId: 'o1', expiresAtMs: Date.now() + 40_000 });
  await expect(cascade.ackOffer('t1', 'd1', 'o1')).resolves.toEqual({ acked: true });
  expect(get('t1').ackedAtMs).toEqual(expect.any(Number));
  expect(mockStore.get('dispatch:ackcap:d1')).toBe('1');
});

test('a stale offer id or another driver is not an ack', async () => {
  put({ tripId: 't2', currentDriverId: 'd1', offerId: 'o2', expiresAtMs: Date.now() + 40_000 });
  await expect(cascade.ackOffer('t2', 'd1', 'old')).resolves.toEqual({ acked: false });
  await expect(cascade.ackOffer('t2', 'd9', 'o2')).resolves.toEqual({ acked: false });
  expect(get('t2').ackedAtMs).toBeUndefined();
});

test('ack check leaves an acked offer alone and revokes an unacked one as UNDELIVERED', async () => {
  const check = mockHandlers[cascade.TASK_OFFER_ACK_CHECK];
  put({ tripId: 't3', currentDriverId: 'd1', offerId: 'o3', ackedAtMs: Date.now() });
  await check({ payload: { tripId: 't3', driverId: 'd1', offerId: 'o3' } });
  expect(publisher.publishOfferRevoked).not.toHaveBeenCalled();

  put({ tripId: 't4', currentDriverId: 'd1', offerId: 'o4', done: true });
  await check({ payload: { tripId: 't4', driverId: 'd1', offerId: 'o4' } });
  expect(publisher.publishOfferRevoked).not.toHaveBeenCalled();

  put({ tripId: 't5', currentDriverId: 'd1', offerId: 'o5', ackedAtMs: null, done: false });
  await check({ payload: { tripId: 't5', driverId: 'd1', offerId: 'o5' } }).catch(() => {}); // offerNext needs prisma
  expect(publisher.publishOfferRevoked).toHaveBeenCalledWith('d1', 't5', 'UNDELIVERED');
  expect(get('t5').currentDriverId).toBeFalsy();
});
