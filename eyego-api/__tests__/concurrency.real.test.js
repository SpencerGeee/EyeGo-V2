'use strict';

/**
 * REAL-DB adversarial concurrency tests — no mocked Prisma.
 *
 * Unlike concurrency.test.js (which mocks the DB and only asserts that the
 * right mock functions were called with the right args — it cannot detect
 * an actual race condition), these tests run against a real, isolated
 * SQLite database and fire genuinely concurrent requests at the real
 * service layer, then assert on the resulting DB state. If the app-level
 * transaction/locking logic is wrong, these tests fail for real — nobody
 * fed them the "right" answer in advance.
 *
 * Only the external Paystack network call is stubbed (we are not testing
 * a third-party payment gateway); every DB interaction is real.
 */

process.env.DATABASE_URL = 'file:./test.db';
process.env.NODE_ENV = 'test';
process.env.PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || 'sk_test_dummy';
process.env.APP_URL = process.env.APP_URL || 'https://eyego.app';

jest.mock('../src/modules/payments/paystack.client', () => ({
  createTransferRecipient: jest.fn().mockResolvedValue({ data: { recipient_code: 'RCP_test' } }),
  initiateTransfer: jest.fn().mockResolvedValue({ data: { status: 'success' } }),
  resolvePayoutBankCode: jest.fn().mockResolvedValue(null),
}));

// Fire-and-forget side effects (push notifications, receipts, quests) must not
// block or crash the test — stub them to no-ops so we isolate DB behavior.
jest.mock('../src/services/push.service', () => ({
  notifications: new Proxy({}, { get: () => jest.fn().mockResolvedValue(undefined) }),
  sendMulticastPush: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/services/sms.service', () => ({
  sendOfflinePassengerOtp: jest.fn().mockResolvedValue(undefined),
}));

const prisma = require('../src/config/database');
const bookingsService = require('../src/modules/bookings/bookings.service');
const walletService = require('../src/modules/wallet/wallet.service');
const driversService = require('../src/modules/drivers/drivers.service');
const questsService = require('../src/modules/quests/quests.service');

jest.setTimeout(30000);

async function makeRoute() {
  return prisma.route.create({
    data: {
      name: `Test Route ${Date.now()}-${Math.random()}`,
      originName: 'A', destinationName: 'B',
      originLat: 5.6, originLng: -0.18, destLat: 5.65, destLng: -0.19,
      distanceKm: 10,
    },
  });
}

async function makeDriver() {
  const phone = `+233${Math.floor(Math.random() * 1e9)}`;
  return prisma.driver.create({ data: { phone, name: 'Test Driver', status: 'ACTIVE' } });
}

async function makeVehicle(driverId) {
  return prisma.vehicle.create({
    data: {
      driverId,
      plateNumber: `GT-${Math.floor(Math.random() * 1e9)}`,
      make: 'Toyota', model: 'Hiace', year: 2020, seaterCount: 14, tier: 'ECO',
    },
  });
}

async function makeTrip({ driverId, vehicleId, routeId, maxSeats = 4 }) {
  return prisma.trip.create({
    data: {
      driverId, vehicleId, routeId,
      tier: 'ECO', status: 'FILLING',
      departureTime: new Date(Date.now() + 3600_000),
      baseFare: 10, perKmRate: 1, maxSeats,
    },
  });
}

async function makeUser() {
  const phone = `+233${Math.floor(Math.random() * 1e9)}`;
  return prisma.user.create({ data: { phone, name: 'Test Rider' } });
}

describe('REAL concurrency: seat booking race (bookSeat)', () => {
  it('exactly one of N simultaneous requests for the SAME seat wins — no overbooking', async () => {
    const route = await makeRoute();
    const driver = await makeDriver();
    const vehicle = await makeVehicle(driver.id);
    const trip = await makeTrip({ driverId: driver.id, vehicleId: vehicle.id, routeId: route.id, maxSeats: 4 });
    const users = await Promise.all(Array.from({ length: 6 }, () => makeUser()));

    // 6 different riders all try to grab SEAT #1 on the SAME trip at the same instant.
    const results = await Promise.allSettled(
      users.map((u) => bookingsService.bookSeat(u.id, trip.id, 1, null, 'CASH')),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // The real invariant: no matter how many riders raced for it, only ONE
    // booking for seat #1 may exist in a non-cancelled state.
    const seatOneBookings = await prisma.booking.findMany({
      where: { tripId: trip.id, seatNumber: 1, status: { not: 'CANCELLED' } },
    });

    expect(seatOneBookings.length).toBe(1);
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(users.length - 1);
    // Everyone who lost the race should get a real "seat taken" style error,
    // not a generic crash / undefined behavior.
    for (const r of rejected) {
      expect(r.reason?.code || r.reason?.message).toMatch(/SEAT_TAKEN|Seat.*taken|taken/i);
    }
  });

  it('N concurrent bookings for DIFFERENT seats on a trip with limited capacity never exceed maxSeats', async () => {
    const route = await makeRoute();
    const driver = await makeDriver();
    const vehicle = await makeVehicle(driver.id);
    const trip = await makeTrip({ driverId: driver.id, vehicleId: vehicle.id, routeId: route.id, maxSeats: 3 });
    const users = await Promise.all(Array.from({ length: 5 }, () => makeUser()));

    // 5 riders race for 5 different seats (1..5) on a trip that only has 3.
    const results = await Promise.allSettled(
      users.map((u, i) => bookingsService.bookSeat(u.id, trip.id, i + 1, null, 'CASH')),
    );

    const activeBookings = await prisma.booking.findMany({
      where: { tripId: trip.id, status: { not: 'CANCELLED' } },
    });

    // The hard invariant that protects the driver from overbooking a real vehicle.
    expect(activeBookings.length).toBeLessThanOrEqual(3);
    const fulfilledCount = results.filter((r) => r.status === 'fulfilled').length;
    expect(fulfilledCount).toBeLessThanOrEqual(3);
  });
});

describe('REAL concurrency: wallet withdrawal race (walletService.withdraw)', () => {
  it('concurrent withdrawals never let the driver overdraw their balance', async () => {
    const driver = await makeDriver();
    await prisma.driver.update({ where: { id: driver.id }, data: { walletBalance: 100 } });

    // 5 concurrent withdrawal requests of 30 each = 150 total demand against
    // a balance of 100. At most 3 can legitimately succeed (3*30=90<=100, 4*30=120<=100
    // actually allows 3; verify no more than floor(100/30)=3 succeed and balance
    // never goes negative).
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => walletService.withdraw(driver.id, 30)),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const finalDriver = await prisma.driver.findUnique({ where: { id: driver.id } });

    expect(finalDriver.walletBalance).toBeGreaterThanOrEqual(0);
    expect(fulfilled.length).toBeLessThanOrEqual(3);
    expect(finalDriver.walletBalance).toBeCloseTo(100 - fulfilled.length * 30, 2);
  });
});

describe('REAL concurrency: arriveTrip double-credit idempotency', () => {
  it('calling arriveTrip twice concurrently for the same trip credits earnings only ONCE', async () => {
    const route = await makeRoute();
    const driver = await makeDriver();
    await prisma.driver.update({ where: { id: driver.id }, data: { walletBalance: 0 } });
    const vehicle = await makeVehicle(driver.id);
    const trip = await makeTrip({ driverId: driver.id, vehicleId: vehicle.id, routeId: route.id, maxSeats: 4 });
    const rider = await makeUser();

    // One real online-paid booking on the trip.
    await prisma.booking.create({
      data: {
        tripId: trip.id, userId: rider.id, seatNumber: 1,
        fareAmount: 20, commissionAmount: 3, paymentMethod: 'MOMO_MTN',
        paymentStatus: 'PAID', status: 'CONFIRMED',
      },
    });

    // Simulate the documented real-world trigger: a mutation retry racing the
    // socket `driver:arrived` handler — both call arriveTrip for the same trip
    // at nearly the same time.
    const results = await Promise.allSettled([
      driversService.arriveTrip(driver.id, trip.id),
      driversService.arriveTrip(driver.id, trip.id),
    ]);

    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);

    const finalDriver = await prisma.driver.findUnique({ where: { id: driver.id } });
    const earningsCredits = await prisma.walletTransaction.findMany({
      where: { driverId: driver.id, type: 'EARNINGS_CREDIT', tripId: trip.id },
    });

    // fareAmount 20, commission 15% => driver nets 17. Must be credited exactly once.
    expect(earningsCredits.length).toBe(1);
    expect(finalDriver.walletBalance).toBeCloseTo(17, 2);
  });

  it('a CASH-paid booking does NOT get double-paid via arriveTrip (regression: online-only earnings credit)', async () => {
    const route = await makeRoute();
    const driver = await makeDriver();
    await prisma.driver.update({ where: { id: driver.id }, data: { walletBalance: 0 } });
    const vehicle = await makeVehicle(driver.id);
    const trip = await makeTrip({ driverId: driver.id, vehicleId: vehicle.id, routeId: route.id, maxSeats: 4 });
    const rider = await makeUser();

    // Cash booking boarded via addCashNoPhone/verifyOfflineOtp reaches PAID +
    // paymentMethod CASH — commission already collected at boarding time.
    await prisma.booking.create({
      data: {
        tripId: trip.id, userId: rider.id, seatNumber: 1,
        fareAmount: 20, commissionAmount: 3, paymentMethod: 'CASH',
        paymentStatus: 'PAID', status: 'BOARDED', isOffline: true,
      },
    });

    await driversService.arriveTrip(driver.id, trip.id);

    const finalDriver = await prisma.driver.findUnique({ where: { id: driver.id } });
    const earningsCredits = await prisma.walletTransaction.findMany({
      where: { driverId: driver.id, type: 'EARNINGS_CREDIT', tripId: trip.id },
    });

    // Must NOT be credited — cash was collected in person, commission already
    // debited at boarding. Crediting here would double-pay the driver.
    expect(earningsCredits.length).toBe(0);
    expect(finalDriver.walletBalance).toBe(0);
  });
});

describe('REAL concurrency: quest claim double-credit race', () => {
  it('double-tapping Claim Bonus concurrently only credits the reward ONCE', async () => {
    const driver = await makeDriver();
    await prisma.driver.update({ where: { id: driver.id }, data: { walletBalance: 0 } });

    const quest = await prisma.driverQuest.create({
      data: {
        title: 'Test Quest', description: 'Complete 1 trip', type: 'RIDES_COUNT',
        target: 1, rewardAmount: 12,
        periodStart: new Date(Date.now() - 1000), periodEnd: new Date(Date.now() + 3600_000),
        isActive: true,
      },
    });
    await prisma.driverQuestProgress.create({
      data: { questId: quest.id, driverId: driver.id, current: 1, completed: true },
    });

    // Two concurrent claim attempts for the same completed-but-unclaimed quest.
    const results = await Promise.allSettled([
      questsService.claimQuestReward(driver.id, quest.id),
      questsService.claimQuestReward(driver.id, quest.id),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(rejected[0].reason?.code).toBe('ALREADY_CLAIMED');

    const finalDriver = await prisma.driver.findUnique({ where: { id: driver.id } });
    const bonusCredits = await prisma.walletTransaction.findMany({
      where: { driverId: driver.id, type: 'QUEST_BONUS' },
    });

    expect(bonusCredits.length).toBe(1);
    expect(finalDriver.walletBalance).toBe(12);
  });

  it('claiming an already-claimed quest a second time (sequentially) is rejected, not re-credited', async () => {
    const driver = await makeDriver();
    await prisma.driver.update({ where: { id: driver.id }, data: { walletBalance: 0 } });

    const quest = await prisma.driverQuest.create({
      data: {
        title: 'Test Quest 2', description: 'Earn GHS 50', type: 'EARNINGS',
        target: 50, rewardAmount: 8,
        periodStart: new Date(Date.now() - 1000), periodEnd: new Date(Date.now() + 3600_000),
        isActive: true,
      },
    });
    await prisma.driverQuestProgress.create({
      data: { questId: quest.id, driverId: driver.id, current: 50, completed: true },
    });

    await questsService.claimQuestReward(driver.id, quest.id);
    await expect(questsService.claimQuestReward(driver.id, quest.id)).rejects.toMatchObject({ code: 'ALREADY_CLAIMED' });

    const finalDriver = await prisma.driver.findUnique({ where: { id: driver.id } });
    expect(finalDriver.walletBalance).toBe(8);
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
