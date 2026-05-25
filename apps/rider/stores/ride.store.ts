import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Trip, Booking, Seat } from '@eyego/types';

interface Location {
  latitude: number;
  longitude: number;
  address: string;
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
  driverLocation: { latitude: number; longitude: number; heading: number } | null;
  tripEta: number | null; // minutes

  // Guest Info
  guestInfo: { name: string; phone: string } | null;

  // Scheduled Ride
  scheduledTime: string | null;

  // Tier & computed fare
  selectedTier: 'ECONOMY' | 'COMFORT' | null;
  computedFare: number | null;

  // Promo
  pendingPromoCode: string | null;

  // Actions
  setOrigin: (loc: Location | null) => void;
  setDestination: (loc: Location | null) => void;
  setSelectedTrip: (trip: Trip | null) => void;
  setSelectedSeat: (seat: Seat | null) => void;
  setActiveBooking: (booking: Booking | null) => void;
  setDriverLocation: (loc: { latitude: number; longitude: number; heading: number } | null) => void;
  setTripEta: (eta: number | null) => void;
  setGuestInfo: (info: { name: string; phone: string } | null) => void;
  setScheduledTime: (time: string | null) => void;
  setSelectedTier: (tier: 'ECONOMY' | 'COMFORT', fare: number) => void;
  setComputedFare: (fare: number | null) => void;
  setPendingPromoCode: (code: string | null) => void;
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
      selectedTier: null,
      computedFare: null,
      pendingPromoCode: null,

      setOrigin: (loc) => set({ origin: loc }),
      setDestination: (loc) => set({ destination: loc }),
      setSelectedTrip: (trip) => set({ selectedTrip: trip }),
      setSelectedSeat: (seat) => set({ selectedSeat: seat }),
      setActiveBooking: (booking) => set({ activeBooking: booking }),
      setDriverLocation: (loc) => set({ driverLocation: loc }),
      setTripEta: (eta) => set({ tripEta: eta }),
      setGuestInfo: (info) => set({ guestInfo: info }),
      setScheduledTime: (time) => set({ scheduledTime: time }),
      setSelectedTier: (tier, fare) => set({ selectedTier: tier, computedFare: fare }),
      setComputedFare: (fare) => set({ computedFare: fare }),
      setPendingPromoCode: (code) => set({ pendingPromoCode: code }),

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
          selectedTier: null,
          computedFare: null,
          pendingPromoCode: null,
        }),
    }),
    {
      name: 'eyego_ride_storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        activeBooking: state.activeBooking,
        selectedTrip: state.selectedTrip,
        tripEta: state.tripEta,
        selectedTier: state.selectedTier,
        computedFare: state.computedFare,
        pendingPromoCode: state.pendingPromoCode,
      }),
    }
  )
);
