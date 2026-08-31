/**
 * HOW OPEN TRIPS ARE GROUPED — ONE DEFINITION, TWO SCREENS.
 *
 * The home screen's rails and the browse pages have to agree about what
 * "boarding now" means, or the count on a "See all 27" pill will not match the
 * 27 rows behind it. These four functions were inlined in `(tabs)/home.tsx`;
 * they live here now so `browse/[group].tsx` uses the same ones rather than a
 * second implementation that drifts.
 */

export type TripGroup = 'boarding' | 'scheduled' | 'suggested';

/** Every group a browse page can show, plus the catch-all. */
export const BROWSE_GROUPS = ['all', 'boarding', 'scheduled', 'suggested'] as const;
export type BrowseGroup = (typeof BROWSE_GROUPS)[number];

export const GROUP_COPY: Record<BrowseGroup, { title: string; subtitle: string }> = {
  all: { title: 'All rides', subtitle: 'Everything leaving from near you' },
  boarding: { title: 'Boarding now', subtitle: 'Driver is at the pickup point filling seats' },
  scheduled: { title: 'Departing later', subtitle: 'Reserve a seat now and be there when it leaves' },
  suggested: { title: 'Going your way', subtitle: 'Rides heading roughly where you are' },
};

/** The amber that marks a trip a rider can walk onto right now. */
export const BOARDING_ACCENT = '#FFB020';

/**
 * When a trip leaves.
 *
 * `departureTime` is the column; `scheduledAt` was the name a card once guessed
 * at and it does not exist on the search payload — which is why every card said
 * "Departing soon" regardless of when it actually left.
 */
export function departureOf(trip: any): Date | null {
  const raw = trip?.departureTime ?? trip?.scheduledAt;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function groupOf(trip: any): BrowseGroup {
  const status = String(trip?.status ?? '').toUpperCase();
  if (status === 'FILLING') return 'boarding';
  if (status === 'SCHEDULED') return 'scheduled';
  return 'suggested';
}

/** Nearest departure first — the only ordering that answers "which do I run for". */
export function byDeparture(a: any, b: any): number {
  return (departureOf(a)?.getTime() ?? Infinity) - (departureOf(b)?.getTime() ?? Infinity);
}

export interface GroupedTrips {
  boardingTrips: any[];
  scheduledTrips: any[];
  suggestedTrips: any[];
}

export function groupTrips(trips: any[]): GroupedTrips {
  const boarding: any[] = [];
  const scheduled: any[] = [];
  const rest: any[] = [];
  for (const t of trips) {
    const g = groupOf(t);
    if (g === 'boarding') boarding.push(t);
    else if (g === 'scheduled') scheduled.push(t);
    else rest.push(t);
  }
  return {
    boardingTrips: boarding.sort(byDeparture),
    scheduledTrips: scheduled.sort(byDeparture),
    suggestedTrips: rest.sort(byDeparture),
  };
}

/** "in 8 min" / "in 2 h 10" / "18:40 tomorrow" — what a rider needs to decide. */
export function departureLabel(trip: any): string {
  const at = departureOf(trip);
  if (!at) return 'Departing soon';
  const mins = Math.round((at.getTime() - Date.now()) / 60000);
  if (mins <= 0) return 'Leaving now';
  if (mins < 60) return `Leaves in ${mins} min`;
  const time = at.toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' });
  const days = Math.floor((at.getTime() - Date.now()) / 86_400_000);
  if (days >= 1) return `${time} tomorrow`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `Leaves in ${h} h` : `Leaves in ${h} h ${m}`;
}

/**
 * WHERE A TRIP STARTS AND ENDS, whichever shape the search payload used.
 *
 * `searchTrips` returns ad-hoc trips with their endpoints on the trip row and
 * route-backed trips with them on the joined route, so every consumer has to
 * try both. Returning `null` rather than a default coordinate matters: a pin at
 * [0, 0] is in the Gulf of Guinea and would drag every map fit out to sea.
 */
export function tripOrigin(trip: any): [number, number] | null {
  const lng = trip?.originLng ?? trip?.pickupLng ?? trip?.route?.originLng;
  const lat = trip?.originLat ?? trip?.pickupLat ?? trip?.route?.originLat;
  return Number.isFinite(lng) && Number.isFinite(lat) ? [Number(lng), Number(lat)] : null;
}

export function tripDestination(trip: any): [number, number] | null {
  const lng = trip?.destLng ?? trip?.dropoffLng ?? trip?.route?.destLng;
  const lat = trip?.destLat ?? trip?.dropoffLat ?? trip?.route?.destLat;
  return Number.isFinite(lng) && Number.isFinite(lat) ? [Number(lng), Number(lat)] : null;
}

export function originName(trip: any): string {
  return trip?.route?.originName ?? trip?.pickupAddress ?? trip?.origin ?? 'Pickup';
}

export function destinationName(trip: any): string {
  return trip?.route?.destinationName ?? trip?.dropoffAddress ?? trip?.destination ?? 'Destination';
}

/** Seats a rider can still buy, defensively — the payload spells it two ways. */
export function seatsLeft(trip: any): number | null {
  const n = trip?.availableSeats ?? trip?.seats?.available;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}
