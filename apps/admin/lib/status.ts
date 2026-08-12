/**
 * Domain status vocabulary for the console.
 *
 * Mirrors the Prisma enums and the groupings in packages/types/src/trip.types.ts.
 * Kept in one file because the console shows trip status in nine different
 * places, and a second opinion about what counts as "active" is exactly the bug
 * that made a boarding driver look free.
 */

export type Tone = 'neutral' | 'accent' | 'info' | 'warn' | 'danger' | 'critical';

export const TRIP_STATUSES = [
  'REQUESTED',
  'MATCHING',
  'REASSIGNING',
  'SCHEDULED',
  'FILLING',
  'CONFIRMED',
  'DRIVER_ASSIGNED',
  'DRIVER_EN_ROUTE',
  'ARRIVED_AT_PICKUP',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_DRIVERS_FOUND',
  'EXPIRED',
  'NO_SHOW',
] as const;

export type TripStatus = (typeof TRIP_STATUSES)[number];

/**
 * A trip that still occupies a driver.
 *
 * ARRIVED_AT_PICKUP belongs here and its omission is a real, previously-shipped
 * bug: a driver waiting at the pickup point was reported as free, which invites
 * a second dispatch to the same vehicle. Any new "is this driver busy" check in
 * this console must use this constant rather than writing its own list.
 */
export const ACTIVE_TRIP_STATUSES: readonly TripStatus[] = [
  'REQUESTED',
  'MATCHING',
  'REASSIGNING',
  'SCHEDULED',
  'FILLING',
  'CONFIRMED',
  'DRIVER_ASSIGNED',
  'DRIVER_EN_ROUTE',
  'ARRIVED_AT_PICKUP',
  'IN_PROGRESS',
];

export const TERMINAL_TRIP_STATUSES: readonly TripStatus[] = [
  'COMPLETED',
  'CANCELLED',
  'NO_DRIVERS_FOUND',
  'EXPIRED',
  'NO_SHOW',
];

/** On the road right now, rider aboard or driver moving toward them. */
export const LIVE_TRIP_STATUSES: readonly TripStatus[] = [
  'DRIVER_EN_ROUTE',
  'ARRIVED_AT_PICKUP',
  'IN_PROGRESS',
];

/** A trip that dispatch still owes a driver. */
export const AWAITING_DRIVER_STATUSES: readonly TripStatus[] = [
  'REQUESTED',
  'MATCHING',
  'REASSIGNING',
];

export function isActiveTrip(s: string | null | undefined): boolean {
  return !!s && ACTIVE_TRIP_STATUSES.includes(s as TripStatus);
}

export function isTerminalTrip(s: string | null | undefined): boolean {
  return !!s && TERMINAL_TRIP_STATUSES.includes(s as TripStatus);
}

export function isLiveTrip(s: string | null | undefined): boolean {
  return !!s && LIVE_TRIP_STATUSES.includes(s as TripStatus);
}

type StatusMeta = { label: string; tone: Tone };

const TRIP_META: Record<TripStatus, StatusMeta> = {
  REQUESTED: { label: 'Requested', tone: 'info' },
  MATCHING: { label: 'Matching', tone: 'info' },
  REASSIGNING: { label: 'Reassigning', tone: 'warn' },
  SCHEDULED: { label: 'Scheduled', tone: 'neutral' },
  FILLING: { label: 'Filling', tone: 'info' },
  CONFIRMED: { label: 'Confirmed', tone: 'accent' },
  DRIVER_ASSIGNED: { label: 'Driver assigned', tone: 'accent' },
  DRIVER_EN_ROUTE: { label: 'En route', tone: 'accent' },
  ARRIVED_AT_PICKUP: { label: 'At pickup', tone: 'accent' },
  IN_PROGRESS: { label: 'In progress', tone: 'accent' },
  COMPLETED: { label: 'Completed', tone: 'neutral' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
  // Not an error and not a success: dispatch worked and found nobody. Amber so
  // it reads as "needs supply", which is the action it actually implies.
  NO_DRIVERS_FOUND: { label: 'No drivers found', tone: 'warn' },
  EXPIRED: { label: 'Expired', tone: 'warn' },
  NO_SHOW: { label: 'No show', tone: 'danger' },
};

export function tripStatusMeta(status: string | null | undefined): StatusMeta {
  if (status && status in TRIP_META) return TRIP_META[status as TripStatus];
  return { label: status ? status.replace(/_/g, ' ') : 'Unknown', tone: 'neutral' };
}

export const BOOKING_STATUSES = [
  'PENDING',
  'SEAT_HELD',
  'CONFIRMED',
  'PAID',
  'BOARDED',
  'COMPLETED',
  'CANCELLED',
  'REFUNDED',
  'EXPIRED',
  'NO_SHOW',
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/**
 * The seat-occupancy predicate, mirroring seatOccupyingWhere() on the server.
 * A seat is occupied by these statuses and by nothing else — in particular
 * "not cancelled" is NOT the rule, which is the mistake that let a released
 * seat keep blocking capacity.
 */
export const SEAT_OCCUPYING_STATUSES: readonly BookingStatus[] = [
  'PENDING',
  'SEAT_HELD',
  'CONFIRMED',
  'PAID',
  'BOARDED',
  'COMPLETED',
];

export const SEAT_RELEASING_STATUSES: readonly BookingStatus[] = [
  'CANCELLED',
  'EXPIRED',
  'REFUNDED',
  'NO_SHOW',
];

const BOOKING_META: Record<BookingStatus, StatusMeta> = {
  PENDING: { label: 'Pending', tone: 'neutral' },
  SEAT_HELD: { label: 'Seat held', tone: 'info' },
  CONFIRMED: { label: 'Confirmed', tone: 'accent' },
  PAID: { label: 'Paid', tone: 'accent' },
  BOARDED: { label: 'Boarded', tone: 'accent' },
  COMPLETED: { label: 'Completed', tone: 'neutral' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
  REFUNDED: { label: 'Refunded', tone: 'warn' },
  EXPIRED: { label: 'Expired', tone: 'warn' },
  NO_SHOW: { label: 'No show', tone: 'danger' },
};

export function bookingStatusMeta(status: string | null | undefined): StatusMeta {
  if (status && status in BOOKING_META) return BOOKING_META[status as BookingStatus];
  return { label: status ? status.replace(/_/g, ' ') : 'Unknown', tone: 'neutral' };
}

/**
 * Settlement truth for a cash-majority market.
 *
 * Revenue must be counted from Booking.paymentStatus === 'PAID', never from
 * PaymentTransaction.status === 'SUCCESS'. Most EyeGo fares are cash, so they
 * never produce a PaymentTransaction row at all — counting transactions is why
 * the old console once reported revenue as roughly zero.
 */
export const SETTLED_PAYMENT_STATUS = 'PAID';

export function paymentStatusMeta(status: string | null | undefined): StatusMeta {
  switch (status) {
    case 'PAID':
      return { label: 'Paid', tone: 'accent' };
    case 'PENDING':
      return { label: 'Pending', tone: 'warn' };
    case 'FAILED':
      return { label: 'Failed', tone: 'danger' };
    case 'REFUNDED':
      return { label: 'Refunded', tone: 'warn' };
    default:
      return { label: status ? status.replace(/_/g, ' ') : 'Unknown', tone: 'neutral' };
  }
}

/**
 * DRIVER ACCOUNT STATUS — the API's approved value is 'ACTIVE', not 'APPROVED'.
 *
 * This is not cosmetic and it is not a guess: `middleware/driverAuth.js`,
 * `drivers.service#goOnline`, `services/driver-availability.js` and the fleet
 * KPIs all test `status === 'ACTIVE'`, and `admin.service#approveDriver` writes
 * exactly that. `Driver.status` is a free-form String column with the default
 * 'PENDING_REVIEW', so there is no enum to catch a wrong literal.
 *
 * Testing for 'APPROVED' — which this console did — makes every working driver
 * render as "Pending approval" while the approvals queue (which correctly filters
 * PENDING_REVIEW) shows nothing. Both halves of that report were this one string.
 */
export const DRIVER_STATUSES = ['PENDING_REVIEW', 'ACTIVE', 'SUSPENDED', 'REJECTED'] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

/** The one value that means "cleared to drive". */
export const DRIVER_ACTIVE_STATUS: DriverStatus = 'ACTIVE';

const DRIVER_ACCOUNT_META: Record<DriverStatus, StatusMeta> = {
  PENDING_REVIEW: { label: 'Pending review', tone: 'warn' },
  ACTIVE: { label: 'Approved', tone: 'accent' },
  SUSPENDED: { label: 'Suspended', tone: 'danger' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
};

/** The account's standing, independent of whether they happen to be online. */
export function driverAccountMeta(status: string | null | undefined): StatusMeta {
  if (status && status in DRIVER_ACCOUNT_META) return DRIVER_ACCOUNT_META[status as DriverStatus];
  // An unrecognised value is a real problem — dispatch will not offer to this
  // driver — so it is surfaced rather than smoothed over.
  return { label: status ? `Unknown (${status})` : 'Unknown', tone: 'danger' };
}

export function isDriverApproved(status: string | null | undefined): boolean {
  return status === DRIVER_ACTIVE_STATUS;
}

/**
 * The live, operational state an operator scans a fleet list for. Account
 * standing wins over presence: a suspended driver is not "offline", they are
 * suspended.
 *
 * `requestsPaused` is the driver's own "still finishing this one, don't send me
 * another" switch, honoured by dispatch, so it must not read as available.
 */
export function driverStatusMeta(driver: {
  status?: string | null;
  isOnline?: boolean;
  requestsPaused?: boolean;
  hasActiveTrip?: boolean;
}): StatusMeta {
  if (driver.status !== DRIVER_ACTIVE_STATUS) return driverAccountMeta(driver.status);
  if (!driver.isOnline) return { label: 'Offline', tone: 'neutral' };
  if (driver.hasActiveTrip) return { label: 'On a trip', tone: 'info' };
  if (driver.requestsPaused) return { label: 'Paused', tone: 'warn' };
  return { label: 'Available', tone: 'accent' };
}

export function tierMeta(tier: string | null | undefined): StatusMeta {
  // The server speaks 'ECO' while the apps' type union says 'ECONOMY'. Both are
  // accepted here; assuming one of them is how tier chips ended up greyed out.
  const t = (tier || '').toUpperCase();
  if (t === 'PREMIUM') return { label: 'Premium', tone: 'warn' };
  if (t === 'COMFORT') return { label: 'Comfort', tone: 'info' };
  if (t === 'ROYAL') return { label: 'Royal', tone: 'warn' };
  if (t === 'ECO' || t === 'ECONOMY' || t === 'STANDARD' || t === 'SHARED') {
    return { label: 'Economy', tone: 'accent' };
  }
  return { label: tier ? tier.replace(/_/g, ' ') : '—', tone: 'neutral' };
}

export function ticketStatusMeta(status: string | null | undefined): StatusMeta {
  switch (status) {
    case 'OPEN':
      return { label: 'Open', tone: 'warn' };
    case 'IN_PROGRESS':
      return { label: 'In progress', tone: 'info' };
    case 'RESOLVED':
      return { label: 'Resolved', tone: 'accent' };
    case 'CLOSED':
      return { label: 'Closed', tone: 'neutral' };
    default:
      return { label: status ? status.replace(/_/g, ' ') : 'Unknown', tone: 'neutral' };
  }
}
