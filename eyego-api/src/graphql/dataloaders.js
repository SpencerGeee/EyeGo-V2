'use strict';

const DataLoader = require('dataloader');
const prisma = require('../config/database');

/**
 * createDataLoaders — call once per request, never share across requests.
 *
 * Each DataLoader batches individual .load(id) calls that fire in the same
 * event-loop tick into a single SQL IN query, eliminating N+1 patterns.
 */
function createDataLoaders() {
  return {
    trip: new DataLoader(async (ids) => {
      const trips = await prisma.trip.findMany({
        where: { id: { in: [...ids] } },
        include: {
          route: {
            select: { id: true, name: true, originName: true, destinationName: true },
          },
          driver: {
            select: { id: true, name: true, phone: true, profilePhoto: true, walletBalance: true },
          },
        },
      });

      const tripMap = new Map(trips.map((t) => [t.id, t]));

      return ids.map((id) => {
        const trip = tripMap.get(id);
        if (!trip) return null;
        return {
          id: trip.id,
          shortId: trip.shortId,
          status: trip.status,
          tier: trip.tier,
          departureTime: trip.departureTime.toISOString(),
          route: trip.route,
          driver: trip.driver,
          availableSeats: Math.max(0, trip.maxSeats - trip.confirmedSeats),
          baseFare: trip.baseFare,
          maxSeats: trip.maxSeats,
        };
      });
    }),

    user: new DataLoader(async (ids) => {
      const users = await prisma.user.findMany({
        where: { id: { in: [...ids] } },
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          profilePhoto: true,
          preferredTier: true,
          walletBalance: true,
          createdAt: true,
        },
      });

      const userMap = new Map(
        users.map((u) => [u.id, { ...u, createdAt: u.createdAt.toISOString() }])
      );

      return ids.map((id) => userMap.get(id) ?? null);
    }),
  };
}

module.exports = { createDataLoaders };
