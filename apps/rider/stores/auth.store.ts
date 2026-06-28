import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import type { User, AuthTokens } from '@eyego/types';
import { forceDisconnectSocket } from '@eyego/api';
import { useRideStore } from './ride.store';

/**
 * Cleanup callbacks registered by the app root (e.g. clearing the React Query
 * cache, resetting Sentry user). auth.store cannot import the module-scoped
 * queryClient directly, so the root registers a teardown fn here. Runs on every
 * logout — including the 401-triggered logout in _layout.tsx — so a logged-out
 * or swapped user never inherits the prior user's cached data.
 */
let logoutCleanup: (() => void) | null = null;
export function registerLogoutCleanup(fn: () => void) {
  logoutCleanup = fn;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isLoggedIn: boolean;
  isLoading: boolean;

  login: (user: User, tokens: AuthTokens) => Promise<void>;
  updateUser: (user: User) => void;
  logout: () => Promise<void>;
  loadFromStorage: () => Promise<void>;
}

const KEYS = {
  accessToken: 'eyego_access_token',
  refreshToken: 'eyego_refresh_token',
  user: 'eyego_user',
};

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  isLoggedIn: false,
  isLoading: true,

  login: async (user, tokens) => {
    // Defensive: clear any residual ride state from a prior session before the
    // new user's data loads. Guards against a stale activeBooking/trip surviving
    // a crash-without-logout into the next sign-in.
    useRideStore.getState().clearRideState();
    await Promise.all([
      SecureStore.setItemAsync(KEYS.accessToken, tokens.accessToken),
      SecureStore.setItemAsync(KEYS.refreshToken, tokens.refreshToken),
      SecureStore.setItemAsync(KEYS.user, JSON.stringify(user)),
    ]);
    set({
      user,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      isLoggedIn: true,
    });
  },

  updateUser: (user) => {
    SecureStore.setItemAsync(KEYS.user, JSON.stringify(user)).catch(e =>
      console.error('[AuthStore] Failed to persist user:', e)
    );
    set({ user });
  },

  logout: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(KEYS.accessToken),
      SecureStore.deleteItemAsync(KEYS.refreshToken),
      SecureStore.deleteItemAsync(KEYS.user),
    ]);
    set({ user: null, accessToken: null, refreshToken: null, isLoggedIn: false });

    // SECURITY: full teardown so the next user inherits nothing from this one.
    // 1) Wipe persisted ride state (AsyncStorage: eyego_ride_storage —
    //    activeBooking/selectedTrip/seat/driverLocation/fare).
    useRideStore.getState().clearRideState();
    // 2) Hard-drop the socket even if screens still hold connectSocket() refs,
    //    so we don't stay joined to the prior user's trip room.
    forceDisconnectSocket();
    // 3) Clear React Query cache + reset Sentry user (registered by app root).
    logoutCleanup?.();
  },

  loadFromStorage: async () => {
    try {
      const [accessToken, refreshToken, userJson] = await Promise.all([
        SecureStore.getItemAsync(KEYS.accessToken),
        SecureStore.getItemAsync(KEYS.refreshToken),
        SecureStore.getItemAsync(KEYS.user),
      ]);
      if (accessToken && refreshToken && userJson) {
        set({
          accessToken,
          refreshToken,
          user: JSON.parse(userJson),
          isLoggedIn: true,
        });
      }
    } catch {
      // Storage read failed — stay logged out
    } finally {
      set({ isLoading: false });
    }
  },
}));
