export const queryKeys = {
  rides: {
    all: ['rides'] as const,
    list: (filters?: object) => [...queryKeys.rides.all, 'list', filters] as const,
    detail: (id: string) => [...queryKeys.rides.all, 'detail', id] as const,
    occupancy: (id: string) => [...queryKeys.rides.all, 'occupancy', id] as const,
  },
  bookings: {
    all: ['bookings'] as const,
    myHistory: () => [...queryKeys.bookings.all, 'my-history'] as const,
    detail: (id: string) => [...queryKeys.bookings.all, 'detail', id] as const,
    active: () => [...queryKeys.bookings.all, 'active'] as const,
  },
  routes: {
    all: ['routes'] as const,
    detail: (id: string) => [...queryKeys.routes.all, 'detail', id] as const,
  },
  notifications: {
    all: ['notifications'] as const,
    list: () => [...queryKeys.notifications.all, 'list'] as const,
    unreadCount: () => [...queryKeys.notifications.all, 'unread-count'] as const,
  },
  user: {
    profile: ['user', 'profile'] as const,
  },
  wallet: {
    all: ['wallet'] as const,
    balance: () => [...queryKeys.wallet.all, 'balance'] as const,
    transactions: () => [...queryKeys.wallet.all, 'transactions'] as const,
  },
} as const;
