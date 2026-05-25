import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type NotificationType =
  | 'TRIP_ASSIGNED'
  | 'PAYMENT_CONFIRMED'
  | 'DRIVER_EN_ROUTE'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'SEAT_UPDATE'
  | 'INFO';

export interface DriverNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  timestamp: string; // ISO
  read: boolean;
  tripId?: string;
}

interface NotificationsState {
  notifications: DriverNotification[];
  addNotification: (n: Omit<DriverNotification, 'id' | 'timestamp' | 'read'>) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clear: () => void;
}

export const useNotificationsStore = create<NotificationsState>()(
  persist(
    (set, get) => ({
      notifications: [],

      addNotification: (n) => {
        const entry: DriverNotification = {
          ...n,
          id: Date.now().toString(),
          timestamp: new Date().toISOString(),
          read: false,
        };
        const existing = get().notifications;
        // Keep most recent 50
        set({ notifications: [entry, ...existing].slice(0, 50) });
      },

      markRead: (id) => {
        set({
          notifications: get().notifications.map((n) =>
            n.id === id ? { ...n, read: true } : n,
          ),
        });
      },

      markAllRead: () => {
        set({ notifications: get().notifications.map((n) => ({ ...n, read: true })) });
      },

      clear: () => set({ notifications: [] }),
    }),
    {
      name: 'eyego_driver_notifications',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
