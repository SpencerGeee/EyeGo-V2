import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { bookingsApi, type AwayOutcome, type AppNotification } from '@eyego/api';
import { describeOutcome } from '../components/RideEndedSheet';
import { loadSeen } from '../stores/rideEnded.store';

/**
 * THE INBOX IS THE AWAY FEED, KEPT FOR 30 DAYS.
 *
 * It used to be its own derived feed on the server (bookings → "Seat booked!")
 * that knew nothing of no-shows, refunds or support replies, behind mark-read
 * routes that did nothing. Now it reads the same facts as the away sheet
 * (away-outcomes.service, `days=30`) and words them with the sheet's own copy.
 *
 * Read state is per device: what the rider marked read here, plus everything
 * the away sheet or the live path already told them (the seen-set). Every
 * screen that shows an unread signal (home bell, Activity alerts, this list)
 * MUST share this hook, or they will disagree about what is unread.
 */
export const NOTIFICATIONS_READ_KEY = 'eyego_read_notifications';

const MONEY = new Set(['REFUND_ISSUED', 'MONEY_RECEIVED']);
const typeOf = (o: AwayOutcome): AppNotification['type'] =>
  MONEY.has(o.kind) ? 'payment' : o.kind === 'SUPPORT_REPLY' ? 'system' : o.kind.startsWith('DRIVER') ? 'driver' : 'booking';

function toNotification(o: AwayOutcome, read: boolean): AppNotification & { outcome: AwayOutcome } {
  const d = describeOutcome(o);
  return {
    id: o.key,
    type: typeOf(o),
    title: d.title,
    body: d.body,
    read,
    createdAt: o.at,
    tripId: o.tripId ?? undefined,
    bookingId: o.bookingId ?? undefined,
    outcome: o,
  } as AppNotification & { outcome: AwayOutcome };
}

export function useUnreadNotifications() {
  const [readIds, setReadIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    Promise.all([AsyncStorage.getItem(NOTIFICATIONS_READ_KEY).catch(() => null), loadSeen()])
      .then(([raw, seen]) => setReadIds(new Set([...(raw ? (JSON.parse(raw) as string[]) : []), ...seen.keys])))
      .catch(() => {});
  }, []);

  const persistReadIds = useCallback((next: Set<string>) => {
    setReadIds(next);
    AsyncStorage.setItem(NOTIFICATIONS_READ_KEY, JSON.stringify([...next].slice(-500))).catch(() => {});
  }, []);

  const { data, isLoading, isError, isRefetching, refetch } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => bookingsApi.outcomes(undefined, 30),
    refetchInterval: 30_000,
    refetchOnMount: true,
  });

  const outcomes: AwayOutcome[] = (data as any)?.data?.data?.outcomes ?? [];
  const notifications = useMemo(
    // An already-rated ride needs nothing from the rider: it lands read.
    () => outcomes.map((o) => toNotification(o, readIds.has(o.key) || (o.kind === 'COMPLETED' && !!o.rated))),
    [outcomes, readIds],
  );
  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);
  const hasUnread = unreadCount > 0;

  const markRead = useCallback((notifId: string) => {
    if (readIds.has(notifId)) return;
    persistReadIds(new Set(readIds).add(notifId));
  }, [readIds, persistReadIds]);

  const markAllRead = useCallback(() => {
    const next = new Set(readIds);
    notifications.forEach((n) => next.add(n.id));
    persistReadIds(next);
  }, [readIds, notifications, persistReadIds]);

  return { notifications, readIds, isLoading, isError: isError && !data, isRefetching, refetch, hasUnread, unreadCount, markRead, markAllRead };
}
