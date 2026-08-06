import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SearchPlace } from './tripFlow.store';

/**
 * The rider's recently-used destinations.
 *
 * WHY THIS EXISTS. The where-to card had a large empty region below the two
 * fields that only ever filled once a destination was already chosen — so the
 * one moment the rider needs help ("where am I going?") was the moment the
 * screen offered nothing. Every comparable app answers that with saved places
 * plus recents; saved places already had a backend, recents had nowhere to
 * live at all.
 *
 * Deliberately device-local. A recent destination is a UI convenience, not a
 * record — round-tripping it through the API would add a request to the
 * critical path of the app's most-opened screen for no benefit the rider can
 * perceive.
 */

const STORAGE_KEY = '@eyego_recent_places';
const MAX_RECENTS = 6;

interface RecentPlacesState {
  places: SearchPlace[];
  loaded: boolean;
  /** Read the persisted list. Idempotent — safe to call on every mount. */
  load: () => Promise<void>;
  /** Record a destination the rider actually committed to. Most recent first. */
  add: (place: SearchPlace) => void;
  clear: () => void;
}

/** Two places are "the same place" if they land within ~10 m of each other. */
const samePlace = (a: SearchPlace, b: SearchPlace) =>
  Math.abs(a.latitude - b.latitude) < 1e-4 && Math.abs(a.longitude - b.longitude) < 1e-4;

const persist = (places: SearchPlace[]) => {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(places)).catch(() => {
    // A recents list that fails to persist is a cosmetic loss, not a failure
    // the rider should be interrupted for.
  });
};

export const useRecentPlaces = create<RecentPlacesState>((set, get) => ({
  places: [],
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      set({
        places: Array.isArray(parsed)
          ? parsed.filter(
              (p): p is SearchPlace =>
                !!p &&
                typeof p.name === 'string' &&
                Number.isFinite(p.latitude) &&
                Number.isFinite(p.longitude),
            )
          : [],
        loaded: true,
      });
    } catch {
      set({ loaded: true });
    }
  },

  add: (place) => {
    if (!Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) return;
    const next = [place, ...get().places.filter((p) => !samePlace(p, place))].slice(0, MAX_RECENTS);
    set({ places: next });
    persist(next);
  },

  clear: () => {
    set({ places: [] });
    persist([]);
  },
}));
