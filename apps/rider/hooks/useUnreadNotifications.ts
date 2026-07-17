import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { notificationsApi } from '@eyego/api';
import type { AppNotification } from '@eyego/api';

// Notifications are DERIVED live from booking history on the backend (no
// stored read-state model), so the server mark-read routes are intentional
// no-ops. Read-state is persisted locally keyed by the stable derived id
// (e.g. "<bookingId>:paid") so mark-read buttons actually work and the
// unread dot stays cleared across refetches/sessions/screens — every screen
// that shows an unread signal (home bell badge, notifications list) MUST
// share this hook, not compute unread separately, or they'll disagree about
// whether something is read.
export const NOTIFICATIONS_READ_KEY = 'eyego_read_notifications';

export function useUnreadNotifications() {
  const [readIds, setReadIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    AsyncStorage.getItem(NOTIFICATIONS_READ_KEY)
      .then((raw) => { if (raw) setReadIds(new Set(JSON.parse(raw) as string[])); })
      .catch(() => {});
  }, []);

  const persistReadIds = useCallback((next: Set<string>) => {
    setReadIds(next);
    AsyncStorage.setItem(NOTIFICATIONS_READ_KEY, JSON.stringify([...next])).catch(() => {});
  }, []);

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.getAll({ limit: 50 }),
    refetchInterval: 30_000,
    refetchOnMount: true,
  });

  const rawNotifications: AppNotification[] = (data as any)?.data?.data?.notifications ?? [];
  const notifications: AppNotification[] = useMemo(
    () => rawNotifications.map((n) => (readIds.has(n.id) ? { ...n, read: true } : n)),
    [rawNotifications, readIds],
  );
  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);
  const hasUnread = unreadCount > 0;

  const markRead = useCallback((notifId: string) => {
    if (readIds.has(notifId)) return;
    const next = new Set(readIds);
    next.add(notifId);
    persistReadIds(next);
    notificationsApi.markRead(notifId).catch(() => {});
  }, [readIds, persistReadIds]);

  const markAllRead = useCallback(() => {
    const next = new Set(readIds);
    notifications.forEach((n) => next.add(n.id));
    persistReadIds(next);
    notificationsApi.markAllRead().catch(() => {});
  }, [readIds, notifications, persistReadIds]);

  return { notifications, readIds, isLoading, isRefetching, refetch, hasUnread, unreadCount, markRead, markAllRead };
}
