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

/**
 * Perform the one legal forward move from `status`.
 *
 * The status → endpoint mapping is the dangerous half of this machine: calling
 * the wrong verb does not fail loudly, it moves the trip to a state neither the
 * driver nor the rider expected. It lived in two places — here and the manage
 * screen — and while they happened to agree, nothing made them.
 *
 * `onAcknowledgeUnderMinimum` is read-and-cleared by the caller because the
 * permission is spent by one departure: a failed attempt must not leave a
 * standing acknowledgement behind for the next one.
 */
export function advanceRequest(
  status: string,
  tripId: string,
  opts?: { acknowledgeUnderMinimum?: boolean },
) {
  switch (status) {
    case 'CONFIRMED':
    case 'DRIVER_ASSIGNED':
    case 'SCHEDULED':
    case 'FILLING':
      return driverApi.startTrip(tripId);
    case 'DRIVER_EN_ROUTE':
      return driverApi.arriveAtPickup(tripId);
    case 'ARRIVED_AT_PICKUP':
      return driverApi.departTrip(
        tripId,
        opts?.acknowledgeUnderMinimum ? { acknowledgeUnderMinimum: true } : undefined,
      );
    /** `arriveTrip` means arrived at the DESTINATION — the same event as finishing. */
    case 'IN_PROGRESS':
      return driverApi.arriveTrip(tripId);
    default:
      throw new Error(`Cannot advance from status: ${status || 'unknown'}`);
  }
}

/**
 * The status a trip lands on after one successful forward step, or `null` if
 * there is no move from here.
 *
 * Exported because the manage screen needs the same answer and used to derive
 * it inline — and its copy left `DRIVER_ASSIGNED` out. That branch decides
 * whether the screen writes the new status into the cache, joins the chat room
 * and navigates, so omitting a status meant a swipe that SUCCEEDED on the
 * server did nothing whatsoever in the app: no refetch, no redirect, chips
 * still showing the old state. Indistinguishable from a failure, and the next
 * swipe 409s. One function now, so the two cannot disagree again.
 */
export function nextStatusAfter(from: string | null | undefined): string | null {
  switch (String(from ?? '').toUpperCase()) {
    case 'CONFIRMED':
    case 'SCHEDULED':
    case 'FILLING':
    case 'DRIVER_ASSIGNED':
      return 'DRIVER_EN_ROUTE';
    case 'DRIVER_EN_ROUTE':
      return 'ARRIVED_AT_PICKUP';
    case 'ARRIVED_AT_PICKUP':
      return 'IN_PROGRESS';
    case 'IN_PROGRESS':
      return 'COMPLETED';
    default:
      return null;
  }
}

/** What the button should say, for a status. `null` when there is no move. */
export function advanceLabel(status: string | null | undefined): string | null {
  switch (String(status ?? '').toUpperCase()) {
    case 'CONFIRMED':
    case 'SCHEDULED':
    case 'FILLING':
      return 'Start trip';
    /**
     * Not "Start trip", even though it calls the same endpoint.
     *
     * A DRIVER_ASSIGNED trip is one the driver did not start — an admin
     * assigned it, or it was reassigned, or they claimed a scheduled ride — so
     * from their side the next thing that happens is a drive to the pickup,
     * not the beginning of a trip they set up. The manage screen has always
     * drawn that distinction; this surface said "Start trip" for the same
     * state, so one trip offered the driver two different promises depending
     * on which screen they happened to be looking at.
     */
    case 'DRIVER_ASSIGNED':
      return 'Head to pickup';
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
      // Read-and-clear in one go: a failed departure must not leave a standing
      // permission behind for the next attempt.
      const ack = underMinimumAck?.current ?? false;
      if (underMinimumAck) underMinimumAck.current = false;
      return advanceRequest(s, tripId, { acknowledgeUnderMinimum: ack });
    },
    onSuccess: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      const to = nextStatusAfter(pendingFrom.current);
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
