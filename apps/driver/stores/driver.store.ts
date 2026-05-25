import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AuthTokens } from '@eyego/types';
import type { DriverProfile } from '@eyego/api';

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
      AsyncStorage.removeItem(KEYS.driver),
      AsyncStorage.removeItem(KEYS.isOnline),
      AsyncStorage.removeItem(KEYS.activeTripId),
    ]);
    // Update in-memory state immediately so retried requests pick up the new token
    // before the SecureStore writes complete (~50ms async gap caused a refresh loop).
    set({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      isLoggedIn: true,
      driver: null,
      isOnline: false,
      activeTripId: null,
    });
    await Promise.all([
      SecureStore.setItemAsync(KEYS.accessToken, tokens.accessToken),
      SecureStore.setItemAsync(KEYS.refreshToken, tokens.refreshToken),
    ]);
  },

  setDriver: (driver) => {
    AsyncStorage.setItem(KEYS.driver, JSON.stringify(driver));
    set({ driver });
  },

  updateDriver: (patch) => {
    const current = get().driver;
    if (!current) return;
    const updated = { ...current, ...patch };
    AsyncStorage.setItem(KEYS.driver, JSON.stringify(updated));
    set({ driver: updated });
  },

  setOnline: (online) => {
    AsyncStorage.setItem(KEYS.isOnline, String(online));
    set({ isOnline: online });
  },

  setTheme: (theme) => {
    AsyncStorage.setItem(KEYS.theme, theme);
    set({ theme });
  },

  setActiveTripId: (id) => {
    if (id) {
      AsyncStorage.setItem(KEYS.activeTripId, id);
    } else {
      AsyncStorage.removeItem(KEYS.activeTripId);
    }
    set({ activeTripId: id });
  },

  logout: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(KEYS.accessToken),
      SecureStore.deleteItemAsync(KEYS.refreshToken),
      AsyncStorage.removeItem(KEYS.driver),
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
        AsyncStorage.getItem(KEYS.driver),
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
      }
    } catch {
      // stay logged out
    } finally {
      set({ isLoading: false });
    }
  },
}));
