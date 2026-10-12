'use strict';

jest.mock('../../config/database', () => ({
  route: { findUnique: jest.fn() },
  virtualStop: { update: jest.fn(async () => ({})), createMany: jest.fn() },
}));
jest.mock('../mapbox.service', () => ({ getDirections: jest.fn(), placeFor: jest.fn() }));

const prisma = require('../../config/database');
const { placeFor } = require('../mapbox.service');
const { ensureVirtualStops } = require('../virtual-stops.service');

const route = (stops) => ({ id: 'r1', originLat: 5.6, originLng: -0.2, destLat: 5.7, destLng: -0.1, distanceKm: 12, virtualStops: stops });

describe('virtual stop names — a place a rider can find, never "Accra, Greater Accra, Ghana"', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renames a legacy full-path name in place, to the short street form', async () => {
    prisma.route.findUnique.mockResolvedValue(route([{ id: 's1', name: 'Obuakon Avenue, Shiashie, Accra, Greater Accra, Ghana', lat: 5.63, lng: -0.17 }]));
    placeFor.mockResolvedValue({ name: 'Obuakon Avenue', fullAddress: 'Obuakon Avenue, Shiashie, East Legon, Accra', approximate: false });
    await ensureVirtualStops('r1');
    expect(prisma.virtualStop.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { name: 'Obuakon Avenue, Shiashie' } });
  });

  it('a city-only answer is not a name — falls back to the distance label', async () => {
    prisma.route.findUnique.mockResolvedValue(route([{ id: 's1', name: 'Accra, Greater Accra, Ghana', lat: 5.6, lng: -0.2 }]));
    placeFor.mockResolvedValue({ name: 'Accra', fullAddress: 'Accra, Greater Accra, Ghana', approximate: true });
    await ensureVirtualStops('r1');
    expect(prisma.virtualStop.update.mock.calls[0][0].data.name).toMatch(/^\d+ km in$/);
  });

  it('leaves healthy names alone', async () => {
    prisma.route.findUnique.mockResolvedValue(route([{ id: 's1', name: 'Kaneshie First Light', lat: 5.6, lng: -0.2 }]));
    await ensureVirtualStops('r1');
    expect(placeFor).not.toHaveBeenCalled();
    expect(prisma.virtualStop.update).not.toHaveBeenCalled();
  });
});
