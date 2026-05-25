import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
    await AsyncStorage.setItem('eyego_theme', isDark ? 'dark' : 'light');
  },

  load: async () => {
    const stored = await AsyncStorage.getItem('eyego_theme');
    set({ isDark: stored !== 'light', isLoaded: true });
  },
}));
