'use strict';

const prisma = require('../config/database');
const pubSub = require('./pubsub');

function requireAuth(user) {
  if (!user) throw new Error('Authentication required');
}

const resolvers = {
  Query: {
    me: async (_, __, { user }) => {
      requireAuth(user);
      const userId = user.userId ?? user.id;
      const u = await prisma.user.findUnique({
        where: { id: userId },
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
      return u ? { ...u, createdAt: u.createdAt.toISOString() } : null;
    },

    myBookings: async (_, { status, page = 1, limit = 20 }, { user, loaders }) => {
      requireAuth(user);
      const userId = user.userId ?? user.id;
      const take = Math.min(Math.max(1, Number(limit)), 100);
      const skip = (Math.max(1, Number(page)) - 1) * take;

      const where = { userId, ...(status ? { status } : {}) };

      const [bookings, total] = await Promise.all([
        prisma.booking.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
          select: {
            id: true,
            status: true,
            paymentStatus: true,
            fareAmountPesewas: true,
            paymentMethod: true,
            seatNumber: true,
            createdAt: true,
            tripId: true,
          },
        }),
        prisma.booking.count({ where }),
      ]);

      return {
        items: bookings.map((b) => ({
          ...b,
          createdAt: b.createdAt.toISOString(),
          // Lazy-load trip via DataLoader — avoids N+1
          trip: loaders.trip.load(b.tripId),
        })),
        total,
        page: Number(page),
        totalPages: Math.ceil(total / take),
      };
    },

    trip: async (_, { id }, { loaders }) => {
      return loaders.trip.load(id);
    },

    earningsBreakdown: async (_, { period = 'TODAY' }, { user }) => {
      requireAuth(user);
      // Driver JWT contains driverId; userId fallback supports future unified tokens
      const driverId = user.driverId ?? user.userId ?? user.id;

      const now = new Date();
      let from;

      if (period === 'WEEK') {
        from = new Date(now);
        from.setDate(now.getDate() - 7);
        from.setHours(0, 0, 0, 0);
      } else if (period === 'MONTH') {
        from = new Date(now);
        from.setDate(now.getDate() - 30);
        from.setHours(0, 0, 0, 0);
      } else {
        // TODAY
        from = new Date(now);
        from.setHours(0, 0, 0, 0);
      }

      const trips = await prisma.trip.findMany({
        where: {
          driverId,
          status: 'COMPLETED',
          arrivedAt: { gte: from },
        },
        orderBy: { arrivedAt: 'asc' },
        // BUGFIX: this passed `include` AND `select` at the same level. Prisma
        // rejects that outright (PrismaClientValidationError, verified against
        // the generated client), so this earnings query threw on every call and
        // the GraphQL resolver 500'd — the driver earnings chart could never
        // have rendered real data. The `select` also re-declared `bookings:
        // true`, which would have discarded the PAID-only filter even if the
        // query had been accepted. One `select` now carries both the field list
        // and the filtered relation.
        select: {
          id: true,
          arrivedAt: true,
          departureTime: true,
          bookings: {
            where: { paymentStatus: 'PAID' },
            select: { fareAmountPesewas: true, commissionAmountPesewas: true },
          },
        },
      });

      const dayMap = new Map();
      let totalEarningsPesewas = 0;
      let totalTrips = 0;

      for (const trip of trips) {
        const tripNet = trip.bookings.reduce(
          (sum, b) => sum + (b.fareAmountPesewas - b.commissionAmountPesewas),
          0
        );
        if (trip.bookings.length === 0) continue;

        totalEarningsPesewas += tripNet;
        totalTrips++;

        const dateKey = (trip.arrivedAt ?? trip.departureTime).toISOString().split('T')[0];
        const day = dayMap.get(dateKey) ?? { date: dateKey, amount: 0, trips: 0 };
        day.amount += tripNet;
        day.trips += 1;
        dayMap.set(dateKey, day);
      }

      return {
        total: totalEarningsPesewas,
        tripCount: totalTrips,
        avgPerTrip: totalTrips > 0 ? totalEarningsPesewas / totalTrips : 0,
        period,
        breakdown: Array.from(dayMap.values()),
      };
    },
  },

  // Field resolver so DataLoader promises resolve correctly on Booking.trip
  Booking: {
    trip: (booking) => {
      // Already a promise from DataLoader.load() set in myBookings resolver
      return booking.trip ?? null;
    },
  },

  Subscription: {
    tripStatus: {
      subscribe: async function* (_, { tripId }, { user }) {
        requireAuth(user);

        // Emit the current state immediately so the client doesn't wait for an event
        const current = await prisma.trip.findUnique({
          where: { id: tripId },
          include: {
            driver: { select: { currentLat: true, currentLng: true } },
          },
        });

        // BUGFIX: this only checked the caller was authenticated, not that they
        // had any relationship to THIS trip — any rider or driver could subscribe
        // to any other trip's live status and driver GPS coordinates. Require
        // either driver ownership or a booking on the trip.
        const driverId = user.driverId;
        const riderId = user.userId ?? user.id;
        const isOwningDriver = driverId && current?.driverId === driverId;
        const hasBooking = !isOwningDriver && riderId
          ? await prisma.booking.findFirst({ where: { tripId, userId: riderId }, select: { id: true } })
          : null;
        if (current && !isOwningDriver && !hasBooking) {
          throw new Error('Forbidden');
        }

        if (current) {
          yield {
            tripStatus: {
              tripId,
              status: current.status,
              driverLat: current.driver?.currentLat ?? null,
              driverLng: current.driver?.currentLng ?? null,
              updatedAt: new Date().toISOString(),
            },
          };
        }

        // Then stream live updates published via pubSub.publish(`TRIP_STATUS:${tripId}`, ...)
        // Call pubSub.publish from trips.service.js after every status transition:
        //   pubSub.publish(`TRIP_STATUS:${tripId}`, { tripId, status, driverLat, driverLng, updatedAt })
        for await (const event of pubSub.subscribe(`TRIP_STATUS:${tripId}`)) {
          yield { tripStatus: event };
        }
      },
    },
  },
};

module.exports = { resolvers };
