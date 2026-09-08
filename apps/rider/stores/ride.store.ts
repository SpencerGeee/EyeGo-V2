import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Trip, Booking, Seat } from '@eyego/types';

interface Location {
  latitude: number;
  longitude: number;
  address: string;
}

/** Booking rows that still occupy the rider. Anything else is history. */
const TERMINAL_BOOKING_STATUSES = ['CANCELLED', 'EXPIRED', 'COMPLETED', 'NO_SHOW', 'REFUNDED'];
/** Trips that are over, whatever their bookings still say. */
const TERMINAL_TRIP_STATUSES = ['COMPLETED', 'CANCELLED', 'NO_DRIVERS_FOUND', 'EXPIRED', 'NO_SHOW'];

/**
 * "IS THIS RIDER ACTUALLY IN A CAR RIGHT NOW?"
 *
 * ONE derivation, because there were two and they disagreed. The home screen
 * asked both halves of the question — is the BOOKING live, and is its TRIP
 * live — while the trip-detail screen asked only the first, and a booking
 * status is not a trip status. A trip that ends leaves its booking row reading
 * `BOARDED`/`PAID`, so the second reader concluded the rider was still aboard a
 * ride that finished, and showed "You're already on a ride" on a trip they were
 * trying to book. The server's own guard has always joined the trip for exactly
 * this reason (see `bookSeat` in bookings.service.js).
 *
 * Deliberately conservative in the safe direction: a booking with no trip
 * attached is treated as NOT live, because the only thing this gates is whether
 * to offer the rider a normal booking flow. The server re-checks and refuses
 * for real if it is wrong.
 */
export function isLiveBooking(booking: Booking | null | undefined): boolean {
  const b = booking as any;
  if (!b?.id || !b?.tripId) return false;
  if (TERMINAL_BOOKING_STATUSES.includes(String(b.status ?? '').toUpperCase())) return false;
  const tripStatus = String(b.trip?.status ?? '').toUpperCase();
  // No trip on the row: it was stored before the join existed. Trust the
  // booking's own status rather than inventing a trip state for it.
  if (!tripStatus) return true;
  return !TERMINAL_TRIP_STATUSES.includes(tripStatus);
}

interface RideState {
  // Search inputs
  origin: Location | null;
  destination: Location | null;

  // Selection
  selectedTrip: Trip | null;
  selectedSeat: Seat | null;

  // Active booking
  activeBooking: Booking | null;

  // Live tracking
  driverLocation: { latitude: number; longitude: number; heading: number; speed?: number } | null;
  tripEta: number | null; // minutes

  // Guest Info
  guestInfo: { name: string; phone: string } | null;

  // Scheduled Ride
  scheduledTime: string | null;

  // On-demand trip request currently awaiting a driver match — persisted so
  // the Activity tab can show a live card and resume polling even if the
  // rider leaves the "Looking for a driver" screen or restarts the app.
  pendingTripRequestId: string | null;
  pendingTripRequestDestination: string | null;

  // Tier & computed fare
  /** Premium is a real ride type — this union used to stop at Comfort, so a
   *  premium trip could not even be stored, let alone displayed. */
  selectedTier: 'ECONOMY' | 'COMFORT' | 'PREMIUM' | 'ROYAL' | null;
  computedFare: number | null;

  // Promo
  pendingPromoCode: string | null;

  // Group on-demand request: how many seats to book, and whether the
  // requester pays for the whole party upfront (coverAll) or books just
  // their own seat and lets others join+pay via the group invite link.
  requestSeatCount: number;
  requestCoverAll: boolean;

  // On-demand ride options, chosen in the paged Where-to flow. The rider could
  // not pick any of these before: every quote went out on the server defaults.
  rideTier: 'ECO' | 'COMFORT' | 'PREMIUM';
  /**
   * TRI-STATE. `null` means the rider has not said, which is NOT the same as
   * declining — the server derives doorstep from how far the pickup pin sits
   * off the road network, and only an explicit `false` moves the pickup to the
   * kerb. Sending `false` by default made every ride look like a decline and
   * the fee could never apply. See fare-quote.service.
   */
  doorstepPickup: boolean | null;
  heavyLoad: boolean;

  // Actions
  setOrigin: (loc: Location | null) => void;
  setDestination: (loc: Location | null) => void;
  setSelectedTrip: (trip: Trip | null) => void;
  setSelectedSeat: (seat: Seat | null) => void;
  setActiveBooking: (booking: Booking | null) => void;
  setDriverLocation: (loc: { latitude: number; longitude: number; heading: number; speed?: number } | null) => void;
  setTripEta: (eta: number | null) => void;
  setGuestInfo: (info: { name: string; phone: string } | null) => void;
  setScheduledTime: (time: string | null) => void;
  setPendingTripRequest: (id: string | null, destination?: string | null) => void;
  setSelectedTier: (tier: 'ECONOMY' | 'COMFORT' | 'PREMIUM' | 'ROYAL', fare: number) => void;
  setComputedFare: (fare: number | null) => void;
  setPendingPromoCode: (code: string | null) => void;
  setRequestSeats: (count: number, coverAll: boolean) => void;
  setRideOptions: (o: Partial<{ rideTier: 'ECO' | 'COMFORT' | 'PREMIUM'; doorstepPickup: boolean | null; heavyLoad: boolean }>) => void;
  clearRideState: () => void;
}

export const useRideStore = create<RideState>()(
  persist(
    (set) => ({
      origin: null,
      destination: null,
      selectedTrip: null,
      selectedSeat: null,
      activeBooking: null,
      driverLocation: null,
      tripEta: null,
      guestInfo: null,
      scheduledTime: null,
      pendingTripRequestId: null,
      pendingTripRequestDestination: null,
      selectedTier: null,
      computedFare: null,
      pendingPromoCode: null,
      requestSeatCount: 1,
      requestCoverAll: true,
      rideTier: 'ECO',
      doorstepPickup: null,
      heavyLoad: false,

      setOrigin: (loc) => set({ origin: loc }),
      setDestination: (loc) => set({ destination: loc }),
      setSelectedTrip: (trip) => set({ selectedTrip: trip }),
      setSelectedSeat: (seat) => set({ selectedSeat: seat }),
      setActiveBooking: (booking) => set({ activeBooking: booking }),
      setDriverLocation: (loc) => set({ driverLocation: loc }),
      setTripEta: (eta) => set({ tripEta: eta }),
      setGuestInfo: (info) => set({ guestInfo: info }),
      setScheduledTime: (time) => set({ scheduledTime: time }),
      setPendingTripRequest: (id, destination) =>
        set({ pendingTripRequestId: id, pendingTripRequestDestination: id ? (destination ?? null) : null }),
      setSelectedTier: (tier, fare) => set({ selectedTier: tier, computedFare: fare }),
      setComputedFare: (fare) => set({ computedFare: fare }),
      setPendingPromoCode: (code) => set({ pendingPromoCode: code }),
      setRequestSeats: (count, coverAll) => set({ requestSeatCount: count, requestCoverAll: coverAll }),
      setRideOptions: (o) => set(o),

      clearRideState: () =>
        set({
          origin: null,
          destination: null,
          selectedTrip: null,
          selectedSeat: null,
          activeBooking: null,
          driverLocation: null,
          tripEta: null,
          guestInfo: null,
          scheduledTime: null,
          pendingTripRequestId: null,
          pendingTripRequestDestination: null,
          selectedTier: null,
          computedFare: null,
          pendingPromoCode: null,
          requestSeatCount: 1,
          requestCoverAll: true,
          rideTier: 'ECO',
          doorstepPickup: null,
          heavyLoad: false,
        }),
    }),
    {
      name: 'eyego_ride_storage',
      storage: createJSONStorage(() => AsyncStorage),
      /**
       * A PERSISTED BOOKING OUTLIVES THE RIDE IT BELONGS TO.
       *
       * `activeBooking` is written when a seat is taken and, until now, was
       * cleared only by an explicit `setActiveBooking(null)` or a full
       * `clearRideState()`. Neither runs when a trip simply ENDS — the driver
       * completes it, the rider's own surfaces correctly show nothing, and this
       * row sits in AsyncStorage saying `BOARDED` for the rest of the install.
       *
       * That is the whole of "I ended the ride, the driver created a live trip,
       * and when I open it the app tells me I'm already on a ride": the banner
       * on the trip screen is derived from this value. See `isLiveBooking`.
       *
       * Rehydration is the one place that sees the value before any screen
       * does, so it is where a dead one gets dropped.
       */
      onRehydrateStorage: () => (state) => {
        if (state && state.activeBooking && !isLiveBooking(state.activeBooking)) {
          state.activeBooking = null;
        }
      },
      // BUGFIX: Added selectedSeat and driverLocation to persisted state.
      // Previously, if the app was killed mid-booking, on restart the user saw an
      // active booking but no idea which seat was chosen. driverLocation is useful
      // for resuming tracking without waiting for the next socket location update.
      // BUGFIX: Guest info (PII — name/phone) explicitly excluded from persisted storage.
      // This data is session-scoped only and should not survive app restarts.
      partialize: (state) => ({
        activeBooking: state.activeBooking,
        selectedTrip: state.selectedTrip,
        selectedSeat: state.selectedSeat,
        driverLocation: state.driverLocation,
        tripEta: state.tripEta,
        selectedTier: state.selectedTier,
        computedFare: state.computedFare,
        pendingPromoCode: state.pendingPromoCode,
        pendingTripRequestId: state.pendingTripRequestId,
        pendingTripRequestDestination: state.pendingTripRequestDestination,
        // guestInfo intentionally omitted — PII should not persist in AsyncStorage
      }),
    }
  )
);
