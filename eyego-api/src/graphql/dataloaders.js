'use strict';

const DataLoader = require('dataloader');
const prisma = require('../config/database');
const { seatOccupyingWhere } = require('../utils/booking-status');

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
            select: { id: true, name: true, phone: true, profilePhoto: true, walletBalancePesewas: true },
          },
          /**
           * SEAT-OCCUPYING BOOKINGS, so `availableSeats` below can be the same
           * number the REST payload reports.
           *
           * This loader used to answer `maxSeats - confirmedSeats`, and the
           * "ONE ANSWER TO HOW MANY SEATS ARE LEFT" note in
           * modules/trips/trips.service.js names this exact file as one of the
           * four divergent formulas it was written to replace — but this one was
           * never actually changed. `confirmedSeats` counts PAID seats only, so
           * it ignores holds; sharing a group invite holds every remaining seat,
           * which means GraphQL reported a full trip as wide open. Anything
           * booking off this number can overbook the vehicle.
           */
          bookings: { where: seatOccupyingWhere(), select: { id: true } },
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
          // Holds included — see the `bookings` include above.
          availableSeats: Math.max(0, trip.maxSeats - trip.bookings.length),
          occupiedSeats: trip.bookings.length,
          baseFarePesewas: trip.baseFarePesewas,
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
          walletBalancePesewas: true,
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
