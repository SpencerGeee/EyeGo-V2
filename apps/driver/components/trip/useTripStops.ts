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
    const passengers = live
      .map(passengerFrom)
      .sort((a, b) => (a.seatNumber ?? 99) - (b.seatNumber ?? 99));

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
    const byDrop = new Map<string, StopPassenger[]>();
    for (const b of live) {
      const label =
        shortAddress(b?.dropoffAddress) ??
        str(b?.dropoffStop?.name) ??
        shortAddress(trip?.dropoffAddress) ??
        str(trip?.route?.destinationName) ??
        'Drop-off';
      const list = byDrop.get(label) ?? [];
      list.push(passengerFrom(b));
      byDrop.set(label, list);
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
        lat: num(trip?.dropoffLat) ?? num(trip?.route?.destinationLat),
        lng: num(trip?.dropoffLng) ?? num(trip?.route?.destinationLng),
        state: 'UPCOMING',
        passengers: group.sort((a, b) => (a.seatNumber ?? 99) - (b.seatNumber ?? 99)),
      });
    }

    const currentIndex = currentIndexFor(status, stops);
    for (let i = 0; i < stops.length; i++) {
      stops[i].state = i < currentIndex ? 'DONE' : i === currentIndex ? 'CURRENT' : 'UPCOMING';
    }

    const seatsTotal =
      num(trip?.maxSeats) ?? num(trip?.vehicle?.seaterCount) ?? passengers.length;
    const seatsTaken = passengers.reduce(
      (n, p) => n + 1 + (p.extraSeats?.length ?? 0),
      0,
    );

    return { stops, currentIndex, passengers, seatsTotal, seatsTaken };
  }, [trip]);
}
