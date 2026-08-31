'use strict';

const prisma = require('../config/database');
const logger = require('../utils/logger');
const pushService = require('./push.service');
const liveActivityPush = require('./live-activity-push.service');
const pubSub = require('../graphql/pubsub');
const { seatOccupyingWhere } = require('../utils/booking-status');

/**
 * Out-of-band notification of a committed trip transition.
 *
 * WHAT THIS REPLACES, AND WHY IT HAD TO EXIST BEFORE THE DRIVER APP COULD MOVE.
 *
 * `trip-events.publisher.js` fans a transition out over sockets. That reaches
 * an app that is OPEN. Everything that reaches an app that is not — the FCM
 * push, the iOS Live Activity on the lock screen, the GraphQL subscription —
 * lived in the legacy driver socket handlers and in one-off `setImmediate`
 * blocks inside individual `drivers.service.js` functions. So which
 * notifications a rider got depended on which code path the driver's tap
 * happened to travel down, and the rewired REST endpoints
 * (`POST /v1/rides/:id/arrived` and friends) travelled down none of them:
 * they changed the status, emitted `trip:event`, and told a backgrounded rider
 * nothing at all.
 *
 * That is the actual blocker on migrating the driver's trip screens off the
 * legacy sockets. Moving them first would have silently stopped every "your
 * driver has arrived" for anyone whose screen was off.
 *
 * So: ONE owner. `publishCommitted` calls this for every transition, from
 * every path — REST, socket, dispatch expiry, the stale-trip sweep. Add a
 * notification here and every path gets it; there is nowhere else to add one.
 *
 * Everything here is fire-and-forget and must never throw: the transition is
 * already committed, and a failed push must not look like a failed ride.
 */

/** Lock-screen copy per status. Keep in sync with the Swift widget's enum. */
const LIVE_ACTIVITY_STATUS_TEXT = {
  DRIVER_EN_ROUTE: 'Driver is on the way',
  ARRIVED_AT_PICKUP: 'Your driver has arrived',
  IN_PROGRESS: 'Trip in progress',
  COMPLETED: 'You have arrived',
  CANCELLED: 'Trip cancelled',
};

/** Statuses whose Live Activity should be ENDED rather than updated. */
const LIVE_ACTIVITY_TERMINAL = new Set(['COMPLETED', 'CANCELLED', 'NO_SHOW', 'EXPIRED']);

/**
 * Transitions worth waking a phone for. Deliberately short.
 *
 * REQUESTED/MATCHING are excluded: the rider is staring at the screen that
 * started them. REASSIGNING is included because the rider's driver just
 * vanished and the app may well be in their pocket by then.
 */
const PUSHABLE = new Set([
  'DRIVER_ASSIGNED',
  'DRIVER_EN_ROUTE',
  'ARRIVED_AT_PICKUP',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'NO_DRIVERS_FOUND',
  'REASSIGNING',
]);

/**
 * Dedupe by `tripId:version`.
 *
 * A version is one transition, forever — so this is exact, not heuristic. It
 * matters during the migration window, when a driver tap can reach the state
 * machine through the REST endpoint AND the legacy socket handler; without it
 * the rider's phone buzzes twice for one arrival. Capped so a long-lived
 * process cannot grow this without bound.
 */
const MAX_SEEN = 5000;
const seen = new Set();

function alreadyNotified(tripId, version) {
  const key = `${tripId}:${version}`;
  if (seen.has(key)) return true;
  seen.add(key);
  if (seen.size > MAX_SEEN) {
    // Drop the oldest half. Set preserves insertion order, so this is FIFO.
    const drop = Math.floor(MAX_SEEN / 2);
    let i = 0;
    for (const k of seen) {
      seen.delete(k);
      if (++i >= drop) break;
    }
  }
  return false;
}

/** Copy for the FCM push, per status. `null` means "send nothing". */
function pushCopyFor(status, { driverName, originName, destinationName }) {
  switch (status) {
    case 'DRIVER_ASSIGNED':
      return {
        title: 'Driver found',
        body: `${driverName} is on the way to you.`,
        type: 'DRIVER_ASSIGNED',
      };
    case 'DRIVER_EN_ROUTE':
      return {
        title: 'Your driver is on the way',
        body: `${driverName} has started heading to ${originName}.`,
        type: 'DRIVER_EN_ROUTE',
      };
    case 'ARRIVED_AT_PICKUP':
      return {
        title: 'Your driver has arrived',
        body: `${driverName} is waiting at ${originName}.`,
        type: 'ARRIVED_AT_PICKUP',
      };
    case 'IN_PROGRESS':
      return {
        title: 'Trip started',
        body: `You're on your way to ${destinationName}.`,
        type: 'IN_PROGRESS',
      };
    case 'COMPLETED':
      return {
        title: 'You have arrived',
        body: 'Tap to rate your trip and see your receipt.',
        type: 'RIDE_COMPLETE',
      };
    case 'CANCELLED':
      return { title: 'Trip cancelled', body: 'Your trip was cancelled.', type: 'TRIP_CANCELLED' };
    case 'NO_SHOW':
      return {
        title: 'Trip cancelled — no show',
        body: 'Your driver waited but could not find you.',
        type: 'TRIP_CANCELLED_NO_SHOW',
      };
    case 'NO_DRIVERS_FOUND':
      return {
        title: 'No drivers available',
        body: 'We could not find a driver nearby. Please try again.',
        type: 'NO_DRIVERS_FOUND',
      };
    case 'REASSIGNING':
      return {
        title: 'Finding you a new driver',
        body: "Your driver had to cancel — we're matching you with another nearby.",
        type: 'TRIP_REASSIGNING',
      };
    default:
      return null;
  }
}

/**
 * The rider-visible names for the copy above.
 *
 * `route` is nullable on an ad-hoc on-demand trip (the group/fixed-route
 * product creates one, a hailed ride does not), so every read falls back —
 * a push reading "has arrived at undefined" is worse than a vague one.
 */
function namesFor(trip) {
  return {
    driverName: trip.driver?.name ?? 'Your driver',
    originName: trip.route?.originName ?? trip.pickupAddress ?? 'your pickup point',
    destinationName: trip.route?.destinationName ?? trip.dropoffAddress ?? 'your destination',
  };
}

/**
 * Which switch on the rider's notification-preferences screen governs each
 * push this service sends.
 *
 * BUGFIX — the preferences screen did nothing.
 *
 * `sendRiderPushes` already SELECTED `notificationPrefs` and then called
 * `pushService.sendPush` directly, which does not consult them. `prefAllows`
 * was only wired into the four legacy `notifications.*` wrappers, and this
 * service is the single owner of every trip-lifecycle notification — so the
 * exact pushes a rider would want to silence (driver assigned, driver on the
 * way, arrived, trip started, trip complete) were the ones no toggle could
 * reach. A rider who turned everything off kept receiving all of it.
 *
 * `null` means "not user-silenceable". Cancellations, a failed dispatch and a
 * reassignment are things that happened TO the rider's ride while they were
 * waiting for it; suppressing those would leave someone standing at a kerb for
 * a car that is not coming. They map to the same "Safety Alerts" reasoning that
 * makes that toggle locked in the UI.
 */
const PREF_CATEGORY_FOR_TYPE = {
  DRIVER_ASSIGNED: 'driverArriving',
  DRIVER_EN_ROUTE: 'driverArriving',
  ARRIVED_AT_PICKUP: 'driverArriving',
  IN_PROGRESS: 'tripStarted',
  RIDE_COMPLETE: 'tripCompleted',
  TRIP_CANCELLED: null,
  TRIP_CANCELLED_NO_SHOW: null,
  NO_DRIVERS_FOUND: null,
  TRIP_REASSIGNING: null,
};

/** FCM to every rider on the trip who still has a token — and who wants it. */
async function sendRiderPushes(trip, status) {
  const copy = pushCopyFor(status, namesFor(trip));
  if (!copy) return;

  const category = PREF_CATEGORY_FOR_TYPE[copy.type];

  const bookings = await prisma.booking.findMany({
    where: { tripId: trip.id, ...seatOccupyingWhere() },
    select: { id: true, user: { select: { fcmToken: true, notificationPrefs: true } } },
  });

  await Promise.all(
    bookings.map((b) => {
      const token = b.user?.fcmToken;
      if (!token) return null;
      if (category && !pushService.prefAllows(b.user.notificationPrefs, category)) return null;
      // Per-booking data so tapping the notification opens THAT rider's
      // receipt rather than whichever booking happened to be first.
      return pushService
        .sendPush(token, copy.title, copy.body, {
          type: copy.type,
          tripId: trip.id,
          bookingId: b.id,
        })
        .catch(() => null);
    }),
  );
}

/** Update — or end — the iOS Live Activity for every rider running one. */
async function syncLiveActivity(trip, status) {
  const bookings = await prisma.booking.findMany({
    where: {
      tripId: trip.id,
      liveActivityPushToken: { not: null },
      ...(LIVE_ACTIVITY_TERMINAL.has(status)
        ? {}
        : { status: { in: ['CONFIRMED', 'PAID', 'BOARDED'] } }),
    },
    select: { id: true, liveActivityPushToken: true },
  });
  if (!bookings.length) return;

  const contentState = {
    status,
    statusText: LIVE_ACTIVITY_STATUS_TEXT[status] || status,
    updatedAt: Date.now(),
  };

  if (LIVE_ACTIVITY_TERMINAL.has(status)) {
    // End it AND clear the token: a live activity left running on a finished
    // trip is the lock-screen equivalent of a stuck "reconnecting" chip.
    await Promise.all(
      bookings.map(async (b) => {
        await liveActivityPush.pushEnd(b.liveActivityPushToken, contentState).catch(() => null);
        await prisma.booking
          .update({
            where: { id: b.id },
            data: { liveActivityPushToken: null, liveActivityId: null },
          })
          .catch(() => null);
      }),
    );
    return;
  }

  await Promise.all(
    bookings.map((b) =>
      liveActivityPush.pushUpdate(b.liveActivityPushToken, contentState).catch(() => null),
    ),
  );
}

/**
 * Notify a committed transition. Never throws, never blocks the caller.
 *
 * `trip` must be a row with `route` and `driver` included (what
 * `applyTransition` returns via TRIP_INCLUDE); anything missing degrades to
 * the generic copy rather than failing.
 */
/**
 * ── THE RECEIPT ─────────────────────────────────────────────────────────────
 *
 * A completed trip sends each rider an SMS receipt naming what they paid and
 * for what.
 *
 * WHY IT LIVES HERE. Receipts are a notification, and this service is the sole
 * owner of every trip-lifecycle notification — the reason that rule exists is
 * that notifications used to be scattered across four socket handlers with
 * four slightly different payloads. A `receipt.service` that also reacted to
 * COMPLETED would be exactly that mistake again, and it would double-send the
 * moment `notifyTransition`'s replay guard and its own disagreed.
 *
 * WHY SMS AND NOT EMAIL. Email is optional on a User row and usually absent —
 * riders sign up with a phone. Africa's Talking is already wired and already
 * sends the OTP that got them into the app, so SMS reaches everybody. When an
 * email provider is added, the address is on the row and this is where the
 * second channel goes.
 *
 * WHY IT MATTERS. In-app receipts already exist. A SENT receipt is a different
 * artifact: it is timestamped, it is outside the app, and it survives the rider
 * uninstalling — which is what makes a fare dispute tractable rather than one
 * person's word about a number they can no longer see.
 *
 * Governed by the same `tripCompleted` preference as the completion push, so a
 * rider who has silenced trip-completion messages is not texted anyway.
 */
async function sendReceipts(trip) {
  const smsService = require('./sms.service');
  if (!smsService.isConfigured?.()) return;

  const bookings = await prisma.booking.findMany({
    where: { tripId: trip.id, ...seatOccupyingWhere() },
    select: {
      id: true,
      // `fareAmountPesewas`, not `fareAmount`. The suffix is load-bearing in
      // this schema: money is stored in pesewas everywhere and the name is what
      // stops a read site treating it as cedis.
      fareAmountPesewas: true,
      paymentMethod: true,
      user: { select: { phone: true, notificationPrefs: true } },
    },
  });

  const { destinationName } = namesFor(trip);
  const shortId = String(trip.id).slice(0, 8).toUpperCase();

  await Promise.all(
    bookings.map((b) => {
      const phone = b.user?.phone;
      if (!phone) return null;
      if (!pushService.prefAllows(b.user.notificationPrefs, 'tripCompleted')) return null;

      // Pesewas → cedis at the edge, exactly once, like every other money
      // string in this codebase.
      const pesewas = Number(b.fareAmountPesewas ?? 0);
      const amount = (pesewas / 100).toFixed(2);
      const method = b.paymentMethod ? String(b.paymentMethod).toLowerCase() : 'your selected method';

      const text =
        `EyeGo receipt ${shortId}: GHS ${amount} paid by ${method} for your trip to ` +
        `${destinationName}. Full breakdown in the app under Activity.`;

      return smsService.sendSms(phone, text).catch(() => null);
    }),
  );
}

function notifyTransition(trip, event) {
  if (!trip?.id || !trip.status) return;
  if (alreadyNotified(trip.id, trip.version)) return;

  const status = trip.status;

  // GraphQL subscribers first — cheap, in-process, and the admin live map
  // reads it. Previously published from four separate socket handlers, each
  // with a slightly different payload.
  try {
    pubSub.publish(`TRIP_STATUS:${trip.id}`, {
      tripId: trip.id,
      status,
      driverLat: trip.driver?.currentLat ?? null,
      driverLng: trip.driver?.currentLng ?? null,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.debug(`[trip-notify] pubSub publish failed for ${trip.id}: ${err?.message ?? err}`);
  }

  // Everything that leaves the process runs after the caller's turn, so a slow
  // APNs round trip cannot delay the HTTP response the driver is waiting on.
  setImmediate(async () => {
    try {
      await syncLiveActivity(trip, status);
    } catch (err) {
      logger.debug(`[trip-notify] live activity failed for ${trip.id}: ${err?.message ?? err}`);
    }
    try {
      if (PUSHABLE.has(status)) await sendRiderPushes(trip, status);
    } catch (err) {
      logger.debug(`[trip-notify] rider push failed for ${trip.id}: ${err?.message ?? err}`);
    }
    try {
      if (status === 'COMPLETED') await sendReceipts(trip);
    } catch (err) {
      logger.debug(`[trip-notify] receipt failed for ${trip.id}: ${err?.message ?? err}`);
    }
  });

  // `event` is unused today but is the natural place to reach for when a
  // notification needs to know WHY a status was reached (driver-cancelled vs
  // rider-cancelled read very differently to the person being told).
  void event;
}

module.exports = {
  notifyTransition,
  LIVE_ACTIVITY_STATUS_TEXT,
  PUSHABLE,
};
