import { useMemo } from 'react';

/**
 * THE TRIP AS A LIST OF STOPS, NOT AS A STATUS.
 *
 * The driver's two trip screens both used to render the trip's STATE — a status
 * chip, a step rail, a seat grid, a stack of action buttons — and left the
 * driver to work out what that state meant they should do next. That is the
 * wrong projection for someone driving: at every moment the only questions are
 * "where am I going" and "who gets on or off when I get there". A minibus with
 * four passengers and three different drop-offs cannot answer either from a
 * status.
 *
 * So the surface is built from STOPS. This derives them, once, from whatever
 * shape the trip actually has — an on-demand hail (one pickup, one drop), a
 * driver-created route with virtual stops, or a group booking where several
 * passengers share a pickup and split at the end.
 *
 * DELIBERATELY TOLERANT. Every field is optional somewhere in this codebase's
 * history, and a timeline that throws because a booking has no drop-off address
 * is worse than one that says "Drop-off". Nothing here can fail; the worst case
 * is a thinner label.
 */

export type StopKind = 'PICKUP' | 'DROP';
export type StopState = 'DONE' | 'CURRENT' | 'UPCOMING';

export interface StopPassenger {
  bookingId: string;
  name: string;
  /** Present when the booker is not the traveller. */
  bookedBy: string | null;
  phone: string | null;
  seatNumber: number | null;
  /** Extra seats this one booking occupies, anchor excluded. */
  extraSeats: number[];
  status: string;
  paid: boolean;
  farePesewas: number | null;
  boarded: boolean;
  noShow: boolean;
  /** Cash still to collect from this passenger, in pesewas. */
  owesPesewas: number | null;
  /** Every seat this person holds, anchor first. */
  seats: number[];
  /** Every booking row behind this one person (a cover-all host has one per seat). */
  bookingIds: string[];
  /** One account paying for several seats with no named guests — "Paying for all". */
  paysForGroup: boolean;
  /** Seats this person occupies — `Booking.seats` summed across their rows. */
  seatCount: number;
}

/**
 * ONE ROW PER PERSON, NOT PER SEAT.
 *
 * BUGFIX ("I chose to pay for everyone… it was showing my name for all the
 * seats which is bad cuz its way too repetitive. It should be once with a tag
 * saying paying all"). Cover-all writes one booking per seat under the host's
 * account with no guest name, so the roster printed the host N times. Rows
 * sharing an account and carrying no guest name are one party: one row, all
 * their seats, money summed, boarded only when every seat is.
 */
function groupParties(rows: { b: any; p: StopPassenger }[]): StopPassenger[] {
  const byKey = new Map<string, StopPassenger>();
  const out: StopPassenger[] = [];
  for (const { b, p } of rows) {
    const uid = b?.user?.id ?? b?.userId ?? null;
    const key = uid && !str(b?.guestName) ? `u:${uid}` : `b:${p.bookingId}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, p);
      out.push(p);
      continue;
    }
    prev.seats.push(...p.seats);
    prev.bookingIds.push(p.bookingId);
    prev.paysForGroup = true;
    prev.seatCount += p.seatCount;
    prev.boarded = prev.boarded && p.boarded;
    prev.noShow = prev.noShow && p.noShow;
    prev.paid = prev.paid && p.paid;
    prev.farePesewas = (prev.farePesewas ?? 0) + (p.farePesewas ?? 0);
    prev.owesPesewas =
      prev.owesPesewas == null && p.owesPesewas == null ? null : (prev.owesPesewas ?? 0) + (p.owesPesewas ?? 0);
  }
  for (const p of out) p.seats.sort((x, y) => x - y);
  return out;
}

export interface TripStop {
  id: string;
  kind: StopKind;
  title: string;
  /** The street line under the title. Null when we only know a name. */
  address: string | null;
  lat: number | null;
  lng: number | null;
  state: StopState;
  /** Who this stop is for. Empty for a waypoint nobody is using. */
  passengers: StopPassenger[];
}

/** Booking rows that no longer occupy a seat or a stop. */
const DEAD_BOOKING = ['CANCELLED', 'EXPIRED', 'REFUNDED'];

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** The first line of an address — a timeline row has one line, not four. */
function shortAddress(v: unknown): string | null {
  const s = str(v);
  return s ? s.split(',')[0].trim() : null;
}

function passengerFrom(b: any): StopPassenger {
  const status = String(b?.status ?? '').toUpperCase();
  const paymentStatus = String(b?.paymentStatus ?? '').toUpperCase();
  const paid = paymentStatus === 'PAID';
  const fare = num(b?.fareAmountPesewas);
  return {
    bookingId: String(b?.id ?? ''),
    // A guest booking names the traveller, not the account. The driver is
    // calling out a name at the kerb, so that is the one that has to win.
    name: str(b?.guestName) ?? str(b?.user?.name) ?? 'Passenger',
    bookedBy: str(b?.guestName) ? str(b?.user?.name) : null,
    phone: str(b?.guestPhone) ?? str(b?.user?.phone),
    seatNumber: num(b?.seatNumber),
    extraSeats: Array.isArray(b?.extraSeatNumbers)
      ? b.extraSeatNumbers.filter((n: unknown) => typeof n === 'number')
      : [],
    status,
    paid,
    farePesewas: fare,
    boarded: status === 'BOARDED',
    noShow: status === 'NO_SHOW',
    // Cash is owed only while it is genuinely unpaid — a prepaid seat shows
    // nothing rather than a zero, so the driver's eye goes to the ones that
    // actually need collecting.
    owesPesewas: !paid && fare != null && fare > 0 ? fare : null,
    seats: [
      ...(num(b?.seatNumber) != null ? [num(b?.seatNumber) as number] : []),
      ...(Array.isArray(b?.extraSeatNumbers) ? b.extraSeatNumbers.filter((n: unknown) => typeof n === 'number') : []),
    ],
    bookingIds: [String(b?.id ?? '')],
    paysForGroup: false,
    seatCount: Math.max(num(b?.seats) ?? 1, 1 + (Array.isArray(b?.extraSeatNumbers) ? b.extraSeatNumbers.length : 0)),
  };
}

/** How far through the trip we are, as a stop index. */
function currentIndexFor(status: string, stops: TripStop[]): number {
  const s = status.toUpperCase();
  // Before departure everything is about the pickup.
  if (['SCHEDULED', 'FILLING', 'CONFIRMED', 'DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP'].includes(s)) {
    return 0;
  }
  if (s === 'IN_PROGRESS') {
    // The first drop that still has somebody aboard is the one being driven to.
    const next = stops.findIndex(
      (st) => st.kind === 'DROP' && st.passengers.some((p) => !p.noShow),
    );
    return next === -1 ? stops.length - 1 : next;
  }
  // Terminal: everything is behind us.
  return stops.length;
}

export interface UseTripStopsResult {
  stops: TripStop[];
  /** Index into `stops` of the one the driver is heading for, or -1. */
  currentIndex: number;
  /** Every live passenger on the trip, in seat order. */
  passengers: StopPassenger[];
  seatsTotal: number;
  seatsTaken: number;
}

export function useTripStops(trip: any): UseTripStopsResult {
  return useMemo<UseTripStopsResult>(() => {
    const status = String(trip?.status ?? '');
    const bookings: any[] = Array.isArray(trip?.bookings) ? trip.bookings : [];
    const live = bookings.filter(
      (b) => !DEAD_BOOKING.includes(String(b?.status ?? '').toUpperCase()),
    );
    const passengers = groupParties(
      live
        .map((b) => ({ b, p: passengerFrom(b) }))
        .sort((x, y) => (x.p.seatNumber ?? 99) - (y.p.seatNumber ?? 99)),
    );

    const pickupTitle =
      str(trip?.route?.originName) ??
      shortAddress(trip?.pickupAddress) ??
      shortAddress(trip?.route?.originAddress) ??
      'Pickup';

    const stops: TripStop[] = [
      {
        id: 'pickup',
        kind: 'PICKUP',
        title: pickupTitle,
        address: shortAddress(trip?.pickupAddress) === pickupTitle ? null : shortAddress(trip?.pickupAddress),
        lat: num(trip?.pickupLat) ?? num(trip?.route?.originLat),
        lng: num(trip?.pickupLng) ?? num(trip?.route?.originLng),
        state: 'UPCOMING',
        // Everyone boards at the pickup on this product. A future multi-pickup
        // route would group by `booking.pickupLat/Lng` here and nowhere else.
        passengers,
      },
    ];

    /**
     * One drop per DISTINCT destination, passengers grouped under it.
     *
     * Grouping by the address string rather than by coordinates on purpose:
     * two riders bound for the same place were booked from two different pins
     * metres apart, and a timeline that shows "Madina" twice is telling the
     * driver about a rounding error rather than about their route.
     */
    const byDrop = new Map<string, { b: any; p: StopPassenger }[]>();
    // Where each group actually alights: a rider's own pin on the route, a
    // named stop, or the trip's end. Kept beside the label so the stop the
    // driver navigates to is the kerb the rider chose, not the terminus.
    const dropAt = new Map<string, { lat: number | null; lng: number | null }>();
    for (const b of live) {
      const label =
        shortAddress(b?.dropoffAddress) ??
        str(b?.dropoffStop?.name) ??
        shortAddress(trip?.dropoffAddress) ??
        str(trip?.route?.destinationName) ??
        'Drop-off';
      const list = byDrop.get(label) ?? [];
      list.push({ b, p: passengerFrom(b) });
      byDrop.set(label, list);
      if (!dropAt.has(label)) {
        dropAt.set(label, {
          lat: num(b?.dropoffLat) ?? num(b?.dropoffStop?.lat) ?? null,
          lng: num(b?.dropoffLng) ?? num(b?.dropoffStop?.lng) ?? null,
        });
      }
    }
    if (byDrop.size === 0) {
      byDrop.set(
        shortAddress(trip?.dropoffAddress) ?? str(trip?.route?.destinationName) ?? 'Drop-off',
        [],
      );
    }
    for (const [label, group] of byDrop) {
      stops.push({
        id: `drop:${label}`,
        kind: 'DROP',
        title: label,
        address: null,
        lat: dropAt.get(label)?.lat ?? num(trip?.dropoffLat) ?? num(trip?.route?.destLat) ?? num(trip?.route?.destinationLat),
        lng: dropAt.get(label)?.lng ?? num(trip?.dropoffLng) ?? num(trip?.route?.destLng) ?? num(trip?.route?.destinationLng),
        state: 'UPCOMING',
        passengers: groupParties(group.sort((x, y) => (x.p.seatNumber ?? 99) - (y.p.seatNumber ?? 99))),
      });
    }

    const currentIndex = currentIndexFor(status, stops);
    for (let i = 0; i < stops.length; i++) {
      stops[i].state = i < currentIndex ? 'DONE' : i === currentIndex ? 'CURRENT' : 'UPCOMING';
    }

    const seatsTotal =
      num(trip?.maxSeats) ?? num(trip?.vehicle?.seaterCount) ?? passengers.length;
    const seatsTaken = passengers.reduce(
      (n, p) => n + p.seatCount,
      0,
    );

    return { stops, currentIndex, passengers, seatsTotal, seatsTaken };
  }, [trip]);
}
