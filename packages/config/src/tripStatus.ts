/**
 * ONE VOCABULARY FOR TRIP STATUS, SHARED BY BOTH APPS.
 *
 * BUGFIX — the same status renamed itself as you moved around the app.
 *
 * `DRIVER_EN_ROUTE` was rendered five different ways across four independent
 * maps, two of which lived in the SAME FILE:
 *
 *   driver active/[id].tsx:55   "Heading to Pickup"
 *   driver active/[id].tsx:77   "En Route"
 *   driver tracking/[id].tsx:35 "En Route to Stop"
 *   driver tracking/[id].tsx:725"En Route"
 *   driver TripCard.tsx:22      "En Route"
 *
 * while the rider was told "Driver is on the way". A driver moving between the
 * manage and tracking screens mid-trip watched the status change name without
 * the trip changing state, and support could not match what a driver reported
 * against what the rider saw.
 *
 * Each status gets ONE rider-facing phrase and ONE driver-facing phrase — they
 * differ because the two are looking at the ride from opposite ends ("your
 * driver is on the way" / "heading to pickup"), but each is defined once.
 *
 * Keep in step with `enum TripStatus` in eyego-api/prisma/schema.prisma.
 */

export type TripStatusKey =
  | 'REQUESTED'
  | 'MATCHING'
  | 'SCHEDULED'
  | 'FILLING'
  | 'CONFIRMED'
  | 'DRIVER_ASSIGNED'
  | 'REASSIGNING'
  | 'DRIVER_EN_ROUTE'
  | 'ARRIVED_AT_PICKUP'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_DRIVERS_FOUND'
  | 'EXPIRED'
  | 'NO_SHOW';

export interface TripStatusCopy {
  /** What the RIDER is told. Second person — it is their ride. */
  rider: string;
  /** What the DRIVER is told. Imperative/positional — it is their job. */
  driver: string;
  /** Semantic colour role. Resolved to a real colour by each app's palette. */
  tone: 'pending' | 'active' | 'success' | 'danger' | 'neutral';
}

export const TRIP_STATUS_COPY: Record<TripStatusKey, TripStatusCopy> = {
  REQUESTED:         { rider: 'Finding your driver',      driver: 'New request',          tone: 'pending' },
  MATCHING:          { rider: 'Finding your driver',      driver: 'Matching',             tone: 'pending' },
  SCHEDULED:         { rider: 'Scheduled',                driver: 'Scheduled',            tone: 'neutral' },
  FILLING:           { rider: 'Filling up',               driver: 'Filling up',           tone: 'pending' },
  CONFIRMED:         { rider: 'Confirmed',                driver: 'Ready to start',       tone: 'active'  },
  DRIVER_ASSIGNED:   { rider: 'Driver assigned',          driver: 'Trip assigned',        tone: 'active'  },
  REASSIGNING:       { rider: 'Finding another driver',   driver: 'Reassigning',          tone: 'pending' },
  DRIVER_EN_ROUTE:   { rider: 'Driver is on the way',     driver: 'Heading to pickup',    tone: 'active'  },
  ARRIVED_AT_PICKUP: { rider: 'Your driver has arrived',  driver: 'At pickup',            tone: 'active'  },
  IN_PROGRESS:       { rider: 'On your way',              driver: 'Trip in progress',     tone: 'active'  },
  COMPLETED:         { rider: 'Completed',                driver: 'Completed',            tone: 'success' },
  CANCELLED:         { rider: 'Cancelled',                driver: 'Cancelled',            tone: 'danger'  },
  NO_DRIVERS_FOUND:  { rider: 'No drivers available',     driver: 'No drivers found',     tone: 'danger'  },
  EXPIRED:           { rider: 'Expired',                  driver: 'Expired',              tone: 'neutral' },
  NO_SHOW:           { rider: 'Marked as no-show',        driver: 'No-show',              tone: 'danger'  },
};

/** Rider-facing phrase, with a safe fallback for a status this build predates. */
export function riderStatusLabel(status: string | null | undefined): string {
  if (!status) return '';
  return TRIP_STATUS_COPY[status as TripStatusKey]?.rider ?? humanise(status);
}

/** Driver-facing phrase, same fallback rule. */
export function driverStatusLabel(status: string | null | undefined): string {
  if (!status) return '';
  return TRIP_STATUS_COPY[status as TripStatusKey]?.driver ?? humanise(status);
}

export function statusTone(status: string | null | undefined): TripStatusCopy['tone'] {
  if (!status) return 'neutral';
  return TRIP_STATUS_COPY[status as TripStatusKey]?.tone ?? 'neutral';
}

/**
 * Last resort for an unrecognised status: "ARRIVED_AT_PICKUP" → "Arrived at
 * pickup". Better than rendering the raw enum at a rider, and better than
 * rendering nothing, which reads as a broken screen.
 */
function humanise(status: string): string {
  const s = status.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
