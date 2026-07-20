import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AuthTokens } from '@eyego/types';
import type { DriverProfile } from '@eyego/api';
import { disconnectDriverSocket, driverApi } from '@eyego/api';

interface DriverState {
  driver: DriverProfile | null;
  accessToken: string | null;
  refreshToken: string | null;
  isLoggedIn: boolean;
  isLoading: boolean;
  isOnline: boolean;
  activeTripId: string | null;
  theme: 'dark' | 'light';

  login: (tokens: AuthTokens) => Promise<void>;
  refreshTokens: (tokens: AuthTokens) => void;
  setDriver: (driver: DriverProfile) => void;
  updateDriver: (patch: Partial<DriverProfile>) => void;
  setOnline: (online: boolean) => void;
  setActiveTripId: (id: string | null) => void;
  setTheme: (theme: 'dark' | 'light') => void;
  logout: () => Promise<void>;
  loadFromStorage: () => Promise<void>;
}

const KEYS = {
  accessToken: 'eyego_driver_access_token',
  refreshToken: 'eyego_driver_refresh_token',
  driver: 'eyego_driver_profile',
  isOnline: 'eyego_driver_is_online',
  activeTripId: 'eyego_driver_active_trip_id',
  theme: 'eyego_driver_theme',
};

export const useDriverStore = create<DriverState>((set, get) => ({
  driver: null,
  accessToken: null,
  refreshToken: null,
  isLoggedIn: false,
  isLoading: true,
  isOnline: false,
  activeTripId: null,
  theme: 'dark',

  login: async (tokens) => {
    // Clear previous session's state first
    await Promise.all([
      SecureStore.deleteItemAsync(KEYS.driver),
      AsyncStorage.removeItem(KEYS.isOnline),
      AsyncStorage.removeItem(KEYS.activeTripId),
    ]);
    // Set in-memory state first (synchronous) so retried requests pick up the
    // new token before SecureStore writes complete (~50ms async gap caused a refresh loop).
    set({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      isLoggedIn: true,
      driver: null,
      isOnline: false,
      activeTripId: null,
    });
    // Then persist to SecureStore (async, non-blocking but catch errors)
    SecureStore.setItemAsync(KEYS.accessToken, tokens.accessToken).catch(err =>
      console.error('Failed to persist accessToken:', err)
    );
    SecureStore.setItemAsync(KEYS.refreshToken, tokens.refreshToken).catch(err =>
      console.error('Failed to persist refreshToken:', err)
    );
  },

  refreshTokens: (tokens) => {
    SecureStore.setItemAsync(KEYS.accessToken, tokens.accessToken).catch(err =>
      console.error('Failed to persist accessToken:', err)
    );
    SecureStore.setItemAsync(KEYS.refreshToken, tokens.refreshToken).catch(err =>
      console.error('Failed to persist refreshToken:', err)
    );
    set({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
  },

  setDriver: (driver) => {
    SecureStore.setItemAsync(KEYS.driver, JSON.stringify(driver)).catch(e =>
      console.error('[DriverStore] Failed to persist driver profile:', e)
    );
    set({ driver });
  },

  updateDriver: (patch) => {
    const current = get().driver;
    if (!current) return;
    const updated = { ...current, ...patch };
    SecureStore.setItemAsync(KEYS.driver, JSON.stringify(updated)).catch(e =>
      console.error('[DriverStore] Failed to persist driver profile:', e)
    );
    set({ driver: updated });
  },

  setOnline: (online) => {
    AsyncStorage.setItem(KEYS.isOnline, String(online)).catch(e =>
      console.error('[DriverStore] Failed to persist isOnline:', e)
    );
    set({ isOnline: online });
  },

  setTheme: (theme) => {
    AsyncStorage.setItem(KEYS.theme, theme).catch(e =>
      console.error('[DriverStore] Failed to persist theme:', e)
    );
    set({ theme });
    // Sync to the account's preferences blob (same one navigationApp already
    // uses) so theme follows the driver across reinstalls/devices instead of
    // silently resetting — previously local-only, unlike navApp.
    driverApi.updatePreferences({ theme }).catch(e =>
      console.warn('[DriverStore] Failed to sync theme to account:', e)
    );
  },

  setActiveTripId: (id) => {
    if (id) {
      AsyncStorage.setItem(KEYS.activeTripId, id).catch(e =>
        console.error('[DriverStore] Failed to persist activeTripId:', e)
      );
    } else {
      AsyncStorage.removeItem(KEYS.activeTripId).catch(e =>
        console.error('[DriverStore] Failed to clear activeTripId:', e)
      );
    }
    set({ activeTripId: id });
  },

  logout: async () => {
    // DH1: disconnect socket before clearing state so any in-flight emissions are stopped
    disconnectDriverSocket();
    await Promise.all([
      SecureStore.deleteItemAsync(KEYS.accessToken),
      SecureStore.deleteItemAsync(KEYS.refreshToken),
      SecureStore.deleteItemAsync(KEYS.driver),
      AsyncStorage.removeItem(KEYS.isOnline),
      AsyncStorage.removeItem(KEYS.activeTripId),
    ]);
    set({
      driver: null,
      accessToken: null,
      refreshToken: null,
      isLoggedIn: false,
      isOnline: false,
      activeTripId: null,
    });
  },

  loadFromStorage: async () => {
    try {
      const [accessToken, refreshToken, driverJson, isOnlineStr, activeTripId, themeStr] = await Promise.all([
        SecureStore.getItemAsync(KEYS.accessToken),
        SecureStore.getItemAsync(KEYS.refreshToken),
        SecureStore.getItemAsync(KEYS.driver),
        AsyncStorage.getItem(KEYS.isOnline),
        AsyncStorage.getItem(KEYS.activeTripId),
        AsyncStorage.getItem(KEYS.theme),
      ]);

      const theme = (themeStr === 'light' || themeStr === 'dark') ? themeStr : 'dark';
      set({ theme }); // apply theme immediately even if not logged in

      if (accessToken && refreshToken) {
        set({
          accessToken,
          refreshToken,
          isLoggedIn: true,
          driver: driverJson ? JSON.parse(driverJson) : null,
          isOnline: isOnlineStr === 'true',
          activeTripId: activeTripId ?? null,
        });
        // Reconcile theme with the account's saved preference — getMe() now
        // returns it (previously the backend never read the preferences blob
        // back out, so a reinstall/new device always fell back to the
        // AsyncStorage default instead of what was actually saved server-side).
        driverApi.getMe().then((res) => {
          const remoteTheme = (res.data as any)?.data?.theme;
          if (remoteTheme === 'dark' || remoteTheme === 'light') {
            AsyncStorage.setItem(KEYS.theme, remoteTheme).catch(() => {});
            set({ theme: remoteTheme });
          }
        }).catch(() => {
          // Not reachable yet / token stale — local theme already applied above.
        });
      }
    } catch {
      // stay logged out
    } finally {
      set({ isLoading: false });
    }
  },
}));
