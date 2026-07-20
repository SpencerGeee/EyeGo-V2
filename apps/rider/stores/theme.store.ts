import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { userApi } from '@eyego/api';

interface ThemeState {
  isDark: boolean;
  isLoaded: boolean;
  setDark: (isDark: boolean) => Promise<void>;
  load: () => Promise<void>;
}

export const useThemeStore = create<ThemeState>((set) => ({
  isDark: true,
  isLoaded: false,

  setDark: async (isDark) => {
    set({ isDark });
    // Local write first (instant, works offline) — same set-then-persist
    // order as auth.store's login(), so the UI never waits on the network.
    await AsyncStorage.setItem('eyego_theme', isDark ? 'dark' : 'light');
    // Sync to the account so the choice follows the rider across
    // reinstalls/devices instead of resetting to the default. Best-effort:
    // a failed sync just means it stays local until the next successful call.
    userApi.updatePreferences({ theme: isDark ? 'dark' : 'light' }).catch((e) => {
      console.warn('[ThemeStore] Failed to sync theme to account:', e?.message ?? e);
    });
  },

  load: async () => {
    // Local cache first so the theme applies instantly without a network
    // round-trip on cold start (avoids a light/dark flash).
    const stored = await AsyncStorage.getItem('eyego_theme');
    set({ isDark: stored !== 'light', isLoaded: true });
    // Then reconcile with the account's saved preference — covers a fresh
    // install / new device where AsyncStorage has nothing yet but the
    // account does. Silently no-ops (stays on local/default) if logged out
    // or unreachable.
    try {
      const res = await userApi.getPreferences();
      const remoteTheme = res.data?.data?.preferences?.theme;
      if (remoteTheme === 'dark' || remoteTheme === 'light') {
        set({ isDark: remoteTheme === 'dark' });
        await AsyncStorage.setItem('eyego_theme', remoteTheme);
      }
    } catch {
      // Not logged in yet, or offline — local value already applied above.
    }
  },
}));
