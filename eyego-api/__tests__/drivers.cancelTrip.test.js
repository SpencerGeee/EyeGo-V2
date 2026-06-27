'use strict';

// P0-1 regression: when a driver cancels a trip, the rider on the live tracking
// screen must be notified in realtime via the passenger trip room, not left on a
// stale "en route" state until the next REST poll.

jest.mock('../src/modules/drivers/drivers.service');
jest.mock('../src/modules/trips/trips.service', () => ({}));
jest.mock('../src/modules/trips/fare.calculator', () => ({ estimateFare: jest.fn() }));
jest.mock('../src/modules/trips/surge.service', () => ({}));

const driversService = require('../src/modules/drivers/drivers.service');
const controller = require('../src/modules/drivers/drivers.controller');

function buildIoSpy() {
  const emit = jest.fn();
  const to = jest.fn(() => ({ emit }));
  const of = jest.fn(() => ({ to }));
  return { io: { of }, of, to, emit };
}

function buildReqRes(io) {
  const req = {
    driver: { userId: 'driver-1' },
    params: { id: 'trip-123' },
    app: { get: jest.fn((key) => (key === 'io' ? io : undefined)) },
  };
  const res = {
    status: jest.fn(() => res),
    json: jest.fn(() => res),
  };
  return { req, res };
}

describe('drivers.controller.cancelTrip', () => {
  beforeEach(() => jest.clearAllMocks());

  it('emits trip:status_change CANCELLED into the passenger trip room', async () => {
    driversService.cancelTrip.mockResolvedValue({ id: 'trip-123', status: 'CANCELLED' });
    const spy = buildIoSpy();
    const { req, res } = buildReqRes(spy.io);

    await controller.cancelTrip(req, res);

    expect(driversService.cancelTrip).toHaveBeenCalledWith('driver-1', 'trip-123');
    expect(spy.of).toHaveBeenCalledWith('/passenger');
    expect(spy.to).toHaveBeenCalledWith('trip:trip-123');
    expect(spy.emit).toHaveBeenCalledWith('trip:status_change', {
      tripId: 'trip-123',
      status: 'CANCELLED',
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('still responds 200 even when io is unavailable (emit is best-effort)', async () => {
    driversService.cancelTrip.mockResolvedValue({ id: 'trip-123', status: 'CANCELLED' });
    const { req, res } = buildReqRes(undefined);

    await expect(controller.cancelTrip(req, res)).resolves.not.toThrow();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
