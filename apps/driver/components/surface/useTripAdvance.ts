import { useCallback, useMemo, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { driverApi } from '@eyego/api';
import { notify } from '@eyego/ui';

/**
 * ONE DEFINITION OF "MOVE THIS TRIP FORWARD".
 *
 * The driver's trip flow is a state machine with exactly four legal moves, and
 * until now the only implementation lived inside `(trip)/active/[id].tsx`. The
 * tracking screen had its own opinion of some of the same transitions, which is
 * precisely how the two screens drifted apart — the sort of split that produced
 * "the Activity tab was missing the DISPATCHED status the standalone screen
 * already had".
 *
 * With the trip becoming stages on the home surface there would have been a
 * THIRD copy. So it is a hook, and every surface calls it.
 *
 *   CONFIRMED / SCHEDULED / FILLING / DRIVER_ASSIGNED → startTrip   → EN_ROUTE
 *   DRIVER_EN_ROUTE                                    → arriveAtPickup
 *   ARRIVED_AT_PICKUP                                  → departTrip → IN_PROGRESS
 *   IN_PROGRESS                                        → arriveTrip → COMPLETED
 */
export const VALID_ADVANCE_STATUSES = [
  'CONFIRMED',
  'SCHEDULED',
  'FILLING',
  'DRIVER_ASSIGNED',
  'DRIVER_EN_ROUTE',
  'ARRIVED_AT_PICKUP',
  'IN_PROGRESS',
] as const;

/** What the button should say, for a status. `null` when there is no move. */
export function advanceLabel(status: string | null | undefined): string | null {
  switch (String(status ?? '').toUpperCase()) {
    case 'CONFIRMED':
    case 'SCHEDULED':
    case 'FILLING':
    case 'DRIVER_ASSIGNED':
      return 'Start trip';
    case 'DRIVER_EN_ROUTE':
      return "I'm at the pickup";
    case 'ARRIVED_AT_PICKUP':
      return 'Start the ride';
    case 'IN_PROGRESS':
      return 'Complete trip';
    default:
      return null;
  }
}

export interface UseTripAdvanceOptions {
  tripId: string;
  status: string | null | undefined;
  /** Spent once if the driver has acknowledged departing under the minimum. */
  underMinimumAck?: React.MutableRefObject<boolean>;
  onAdvanced?: (toStatus: string | null) => void;
}

export function useTripAdvance({ tripId, status, underMinimumAck, onAdvanced }: UseTripAdvanceOptions) {
  const qc = useQueryClient();
  const pendingFrom = useRef<string | null>(null);

  const mutation = useMutation({
    /**
     * NEVER RETRIED.
     *
     * These transitions are legal exactly once. A request that SUCCEEDED but
     * whose response was slow or lost — routine on a driver's phone — used to
     * be retried, and the retry asked the server to move from a status the trip
     * had already left. The driver was then shown a raw conflict for an action
     * that had worked.
     */
    retry: 0,
    mutationFn: async () => {
      const s = String(status ?? '').toUpperCase();
      if (!s || !(VALID_ADVANCE_STATUSES as readonly string[]).includes(s)) {
        throw new Error(`Cannot advance from status: ${s || 'unknown'}`);
      }
      pendingFrom.current = s;
      if (s === 'CONFIRMED' || s === 'DRIVER_ASSIGNED' || s === 'SCHEDULED' || s === 'FILLING') {
        return driverApi.startTrip(tripId);
      }
      if (s === 'DRIVER_EN_ROUTE') return driverApi.arriveAtPickup(tripId);
      if (s === 'ARRIVED_AT_PICKUP') {
        // Read-and-clear in one go: a failed departure must not leave a
        // standing permission behind for the next attempt.
        const ack = underMinimumAck?.current ?? false;
        if (underMinimumAck) underMinimumAck.current = false;
        return driverApi.departTrip(tripId, ack ? { acknowledgeUnderMinimum: true } : undefined);
      }
      if (s === 'IN_PROGRESS') return driverApi.arriveTrip(tripId);
      throw new Error('Cannot advance from current status');
    },
    onSuccess: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      const from = pendingFrom.current;
      const to =
        from === 'CONFIRMED' || from === 'SCHEDULED' || from === 'FILLING' || from === 'DRIVER_ASSIGNED'
          ? 'DRIVER_EN_ROUTE'
          : from === 'DRIVER_EN_ROUTE'
            ? 'ARRIVED_AT_PICKUP'
            : from === 'ARRIVED_AT_PICKUP'
              ? 'IN_PROGRESS'
              : from === 'IN_PROGRESS'
                ? 'COMPLETED'
                : null;
      qc.invalidateQueries({ queryKey: ['driver'] });
      onAdvanced?.(to);
    },
    onError: (err: any) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      notify(
        'Could not update the trip',
        err?.response?.data?.message ?? 'Check your connection and try again.',
      );
    },
  });

  const label = useMemo(() => advanceLabel(status), [status]);
  const advance = useCallback(() => {
    if (mutation.isPending) return;
    mutation.mutate();
  }, [mutation]);

  return { advance, label, busy: mutation.isPending, canAdvance: label != null };
}
