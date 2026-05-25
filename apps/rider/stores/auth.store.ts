import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { User, AuthTokens } from '@eyego/types';

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
    await Promise.all([
      SecureStore.setItemAsync(KEYS.accessToken, tokens.accessToken),
      SecureStore.setItemAsync(KEYS.refreshToken, tokens.refreshToken),
      AsyncStorage.setItem(KEYS.user, JSON.stringify(user)),
    ]);
    set({
      user,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      isLoggedIn: true,
    });
  },

  updateUser: (user) => {
    AsyncStorage.setItem(KEYS.user, JSON.stringify(user));
    set({ user });
  },

  logout: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(KEYS.accessToken),
      SecureStore.deleteItemAsync(KEYS.refreshToken),
      AsyncStorage.removeItem(KEYS.user),
    ]);
    set({ user: null, accessToken: null, refreshToken: null, isLoggedIn: false });
  },

  loadFromStorage: async () => {
    try {
      const [accessToken, refreshToken, userJson] = await Promise.all([
        SecureStore.getItemAsync(KEYS.accessToken),
        SecureStore.getItemAsync(KEYS.refreshToken),
        AsyncStorage.getItem(KEYS.user),
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
