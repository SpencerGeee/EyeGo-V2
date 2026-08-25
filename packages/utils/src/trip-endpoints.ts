/**
 * WHERE A RIDE STARTS AND ENDS, AND HOW MANY PEOPLE ARE ON IT.
 *
 * ── THE BUG THIS FILE EXISTS FOR ────────────────────────────────────────────
 * "On the manage trip page of the driver app it's showing dash dash for both
 * the pickup and destination — mind you, this is a trip I created and requested
 * from the rider app", and "at the top of the tracking page it's showing - -> -
 * with no detail".
 *
 * Nine driver screens read `trip.route?.originName ?? '—'`. `Route` is the
 * GROUP/BUS product's row and is **null** on every on-demand ride — the ones the
 * rider app books — so nine screens rendered em-dashes for a trip whose
 * addresses were sitting right there under different keys.
 *
 * There are exactly two shapes on the wire and both carry the answer:
 *
 *   snapshot (services/trip-view.js)     `pickup.address`  / `dropoff.address`
 *   raw Prisma row (driver REST reads)   `pickupAddress`   / `dropoffAddress`
 *                                        `route.originName`/`route.destinationName`
 *
 * One resolver for all three, so a screen cannot be written against the wrong
 * one again.
 *
 * ── AND THE SEATS ───────────────────────────────────────────────────────────
 * "On the rider app I chose to book for 3 seats but the driver app shows 1/1
 * boarded", and "it says passengers boarded are 1/3 — but I booked all 3 seats,
 * so if I'm on board they are too."
 *
 * An on-demand ride is ONE `Booking` row carrying a party of N (`Booking.seats`),
 * because it is one payment, one cancellation and one person to phone. A group
 * ride is N rows of one seat each, because each of those is a different
 * passenger who paid separately. Counting rows is right for one product and
 * wrong for the other; counting `seats` is right for both.
 */

/** Anything a screen might be handed for a ride. Deliberately loose. */
export interface TripLike {
  pickup?: { address?: string | null } | null;
  dropoff?: { address?: string | null } | null;
  pickupAddress?: string | null;
  dropoffAddress?: string | null;
  origin?: { address?: string | null } | null;
  destination?: { address?: string | null } | null;
  route?: {
    originName?: string | null;
    destinationName?: string | null;
  } | null;
  bookings?: BookingLike[] | null;
  seats?: { confirmed?: number | null; max?: number | null; occupied?: number | null } | null;
  maxSeats?: number | null;
  confirmedSeats?: number | null;
}

export interface BookingLike {
  status?: string | null;
  /** Party size on this one row. Absent on legacy rows, which are one seat. */
  seats?: number | null;
  seatNumber?: number | null;
  pickupAddress?: string | null;
  trip?: TripLike | null;
}

/** First non-blank string in the list, or null. Blank strings are not answers. */
function firstText(...candidates: (string | null | undefined)[]): string | null {
  for (const c of candidates) {
    if (typeof c === 'string') {
      const t = c.trim();
      if (t) return t;
    }
  }
  return null;
}

/** Where the ride is collected from, whichever shape the caller was handed. */
export function originLabel(trip: TripLike | null | undefined): string | null {
  if (!trip) return null;
  return firstText(
    trip.pickup?.address,
    trip.pickupAddress,
    trip.origin?.address,
    trip.route?.originName,
  );
}

/** Where the ride ends. */
export function destinationLabel(trip: TripLike | null | undefined): string | null {
  if (!trip) return null;
  return firstText(
    trip.dropoff?.address,
    trip.dropoffAddress,
    trip.destination?.address,
    trip.route?.destinationName,
  );
}

/**
 * The short form for a one-line header: everything before the first comma.
 *
 * A full address is "Oxford Street, Osu, Accra, Greater Accra, Ghana" and a
 * 200 pt header renders that as "Oxford Street, Osu, Acc…". The leading segment
 * is the part that identifies the place; the rest is the context that made the
 * label too long in the first place.
 */
export function shortPlace(label: string | null | undefined): string | null {
  if (!label) return null;
  const head = label.split(',')[0]?.trim();
  return head || label.trim() || null;
}

export function originShort(trip: TripLike | null | undefined): string | null {
  return shortPlace(originLabel(trip));
}

export function destinationShort(trip: TripLike | null | undefined): string | null {
  return shortPlace(destinationLabel(trip));
}

/** Seats on one booking row. Legacy rows predate the column and are one seat. */
export function seatsOf(booking: BookingLike | null | undefined): number {
  const n = booking?.seats;
  if (typeof n === 'number' && Number.isFinite(n) && n > 0) return Math.trunc(n);
  return 1;
}

/** Booking statuses that still hold a seat. Mirrors utils/booking-status.js. */
const OCCUPYING = new Set(['PENDING', 'SEAT_HELD', 'CONFIRMED', 'PAID', 'BOARDED', 'COMPLETED']);

export function isOccupying(booking: BookingLike | null | undefined): boolean {
  const s = booking?.status;
  if (!s) return true;
  return OCCUPYING.has(s);
}

/** Every booking still holding a seat. */
export function activeBookings(trip: TripLike | null | undefined): BookingLike[] {
  return (trip?.bookings ?? []).filter(isOccupying);
}

/**
 * HOW MANY PEOPLE ARE ON THIS RIDE — not how many rows the query returned.
 *
 * Prefers the server's own count when the snapshot carries one, because the
 * snapshot's booking list is already filtered and the driver's raw read is not.
 */
export function bookedSeats(trip: TripLike | null | undefined): number {
  if (!trip) return 0;
  const rows = activeBookings(trip);
  if (rows.length > 0) return rows.reduce((n, b) => n + seatsOf(b), 0);
  const snap = trip.seats?.occupied;
  if (typeof snap === 'number' && snap > 0) return snap;
  const confirmed = trip.confirmedSeats;
  return typeof confirmed === 'number' && confirmed > 0 ? confirmed : 0;
}

/**
 * Seats whose passengers are aboard.
 *
 * A booking is boarded as a unit: the party of three that shares one row got in
 * the car together, so marking their row `BOARDED` puts all three of them in it.
 * That is the whole of "I booked 3 seats — if I'm on board, they are too".
 */
export function boardedSeats(trip: TripLike | null | undefined): number {
  return activeBookings(trip)
    .filter((b) => b.status === 'BOARDED' || b.status === 'COMPLETED')
    .reduce((n, b) => n + seatsOf(b), 0);
}

/** Vehicle capacity for this ride, for the "N/M" denominator. */
export function tripCapacity(trip: TripLike | null | undefined): number {
  const max = trip?.seats?.max ?? trip?.maxSeats;
  if (typeof max === 'number' && max > 0) return Math.trunc(max);
  return Math.max(bookedSeats(trip), 1);
}

/**
 * A PLACE LABEL THAT LEADS WITH THE PLACE.
 *
 * BUGFIX (item 1: "any location I choose gets put in the field as Accra — the
 * driver wouldn't be able to know where exactly the rider is").
 *
 * Mapbox returns two strings per feature: `name` ("Accra Mall") and
 * `place_formatted`, which is the ADMINISTRATIVE CONTEXT and nothing else —
 * literally "Accra, Greater Accra, Ghana". A POI feature commonly carries the
 * context and no `full_address`, so a mapper that falls back to
 * `place_formatted` alone throws away the only half that identifies the point.
 * That string is what the rider's store holds, what the booking sends, and what
 * the driver is shown.
 *
 * Composing them is the fix: the specific part first, the context after it, and
 * no duplication when the geocoder already did that itself.
 */
export function placeLabel(
  name: string | null | undefined,
  context: string | null | undefined,
): string | null {
  const n = firstText(name);
  const c = firstText(context);
  if (!n) return c;
  if (!c) return n;
  // The geocoder already composed it — "Oxford Street, Osu, Accra" contains its
  // own context, and prefixing the name again reads as a stutter.
  if (c.toLowerCase().startsWith(n.toLowerCase())) return c;
  if (n.toLowerCase().includes(c.toLowerCase())) return n;
  return `${n}, ${c}`;
}
