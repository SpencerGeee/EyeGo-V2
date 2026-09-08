import { create } from 'zustand';

/**
 * THE RIDE ENDED AND SOMEBODY ELSE ENDED IT.
 *
 * BUGFIX ("on the rider app, if the driver marks as no-show, when the rider is
 * redirected to the homepage they should be given a notification or popup like
 * 'the driver cancelled' or something").
 *
 * There WAS a banner for this, fired by `TripStatusListener` — and it was
 * fired into the wrong moment. The terminal event arrives while the rider is
 * still on the trip surface; the surface then tears itself down and replaces
 * the whole screen. By the time the rider is looking at Home, the four-second
 * toast that explained what happened has been unmounted along with the screen
 * it was drawn over. The rider watches their ride vanish and is told nothing.
 *
 * A toast is the wrong shape for this anyway. Losing a ride you were waiting
 * for is the single worst moment in the product; it deserves a surface that
 * waits for the rider to read it, says what happened to their money, and offers
 * the one thing they actually want next — another car.
 *
 * So the listener records the FACT here and stops trying to own the moment of
 * telling. `RideEndedSheet`, mounted on Home, presents it whenever the rider
 * gets there — immediately if they are already on Home, or after the surface
 * has finished retiring if they are not.
 */

export type RideEndedReason =
  | 'DRIVER_CANCELLED'
  | 'DRIVER_NO_SHOW'
  | 'RIDER_CANCELLED'
  | 'NO_DRIVERS'
  | 'EXPIRED';

/** Enough of a journey to re-request it without asking anything again. */
export interface RideEndedJourney {
  origin: { latitude: number; longitude: number; address: string } | null;
  destination: { latitude: number; longitude: number; address: string } | null;
  seatCount: number;
}

export interface RideEndedNotice {
  reason: RideEndedReason;
  /** Whether money is coming back. Drives the copy — never guess this. */
  refunded: boolean;
  /** Where they were going, so "try again" can go straight there. */
  destinationLabel: string | null;
  /**
   * THE JOURNEY, CARRIED OUT OF A STORE THAT IS ABOUT TO BE WIPED.
   *
   * BUGFIX ("on the rider app, when the ride was marked as no-show there was an
   * option that said find another rider — but when I clicked on it, it brought
   * me to the search stage").
   *
   * "Find another driver" went to `?stage=search`, which is the WHERE-TO step:
   * the rider is asked to type in the destination they had already chosen and
   * were already being driven to. It went there because it had to — the
   * terminal branch of `TripStatusListener` calls `clearRideState()`, so by the
   * time this sheet is on screen the origin and destination are gone and
   * `?stage=request` would have had nothing to request.
   *
   * The fix is to take a copy BEFORE the wipe rather than to send the rider
   * back through a form. The notice is raised in the same tick, from the same
   * store, one statement earlier.
   */
  journey: RideEndedJourney | null;
  /** Set when raised, so a notice cannot outlive the session that made it. */
  atMs: number;
}

interface RideEndedState {
  notice: RideEndedNotice | null;
  raise: (n: Omit<RideEndedNotice, 'atMs' | 'journey'> & { journey?: RideEndedJourney | null }) => void;
  clear: () => void;
}

/**
 * The journey, snapshotted here rather than at each call site.
 *
 * There are three `raise()` callers and the window between them and
 * `clearRideState()` is a couple of statements wide, so "remember to pass the
 * journey" is a rule that will be broken. Reading it inside `raise` makes the
 * capture unforgettable — a caller with a better source (the terminal
 * snapshot's own pickup/dropoff) can still pass one explicitly.
 */
function captureJourney(): RideEndedJourney | null {
  try {
    // Required lazily: this store is imported by the trip surface, and a
    // top-level import back into the ride store would be a cycle waiting to
    // happen the first time ride.store needs to raise a notice itself.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useRideStore } = require('./ride.store');
    const s = useRideStore.getState();
    if (!s?.origin || !s?.destination) return null;
    return { origin: s.origin, destination: s.destination, seatCount: s.requestSeatCount || 1 };
  } catch {
    return null;
  }
}

export const useRideEnded = create<RideEndedState>((set) => ({
  notice: null,
  /**
   * Last one wins, deliberately. Two terminal events for one ride (a NO_SHOW
   * followed by the REFUNDED that settles it) are one piece of news, and the
   * later frame carries the better answer about the money.
   */
  raise: (n) =>
    set({
      notice: {
        ...n,
        journey: n.journey !== undefined ? n.journey : captureJourney(),
        atMs: Date.now(),
      },
    }),
  clear: () => set({ notice: null }),
}));

/**
 * Not every ending needs a sheet. A rider who cancelled their own ride knows
 * why it ended, and a completed trip has its own receipt screen. Only the
 * endings the rider did not choose get one.
 */
export function shouldAnnounce(reason: RideEndedReason): boolean {
  return reason !== 'RIDER_CANCELLED';
}
