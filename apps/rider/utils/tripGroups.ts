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

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "6:40 PM", built by hand: `toLocaleTimeString` answers from each platform's
 * own ICU data, so the same trip read "18:40" on one phone and "6:40 pm" on
 * another.
 */
export function clockTime(d: Date): string {
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Whole calendar days from today to `d` (0 = today, 1 = tomorrow). */
function calendarDaysFromToday(d: Date): number {
  const today = new Date();
  const a = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const b = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((b - a) / 86_400_000);
}

/**
 * "Leaves in 8 min" / "Leaves in 2 h 10" / "Tomorrow, 6:40 PM" / "Thu, 6:40 PM".
 *
 * The old label called anything a day or more away "tomorrow" — a Friday bus
 * read "18:40 tomorrow" on a Monday — and a 9 PM bus seen at 10 AM counted
 * as today only because the arithmetic was in hours, not calendar days.
 */
export function departureLabel(trip: any): string {
  const at = departureOf(trip);
  if (!at) return 'Departing soon';
  const mins = Math.round((at.getTime() - Date.now()) / 60000);
  if (mins <= 0) return groupOf(trip) === 'boarding' ? 'Boarding now' : 'Leaving now';
  if (mins < 60) return `Leaves in ${mins} min`;
  const days = calendarDaysFromToday(at);
  const time = clockTime(at);
  if (days <= 0) {
    if (mins >= 180) return `Today, ${time}`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m === 0 ? `Leaves in ${h} h` : `Leaves in ${h} h ${m}`;
  }
  if (days === 1) return `Tomorrow, ${time}`;
  if (days < 7) return `${WEEKDAYS[at.getDay()]}, ${time}`;
  return `${at.getDate()} ${MONTHS[at.getMonth()]}, ${time}`;
}

/** Great-circle km — good enough to rank pickups and estimate a walk. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** "4 min walk" / "2.3 km away" — streets are ~25 % longer than the crow flies. */
export function walkLabel(km: number): string {
  const mins = Math.max(1, Math.round((km * 1.25 * 1000) / 80));
  if (mins <= 25) return `${mins} min walk`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km away`;
}

/** "Silver Toyota Corolla", or null when the trip carried no vehicle. */
export function vehicleLabel(trip: any): string | null {
  const v = trip?.vehicle;
  if (!v) return null;
  const label = [v.colour, v.make, v.model].filter((x) => typeof x === 'string' && x.trim()).join(' ');
  return label || null;
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
