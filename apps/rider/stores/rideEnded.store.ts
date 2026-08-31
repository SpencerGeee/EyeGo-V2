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

export interface RideEndedNotice {
  reason: RideEndedReason;
  /** Whether money is coming back. Drives the copy — never guess this. */
  refunded: boolean;
  /** Where they were going, so "try again" can go straight there. */
  destinationLabel: string | null;
  /** Set when raised, so a notice cannot outlive the session that made it. */
  atMs: number;
}

interface RideEndedState {
  notice: RideEndedNotice | null;
  raise: (n: Omit<RideEndedNotice, 'atMs'>) => void;
  clear: () => void;
}

export const useRideEnded = create<RideEndedState>((set) => ({
  notice: null,
  /**
   * Last one wins, deliberately. Two terminal events for one ride (a NO_SHOW
   * followed by the REFUNDED that settles it) are one piece of news, and the
   * later frame carries the better answer about the money.
   */
  raise: (n) => set({ notice: { ...n, atMs: Date.now() } }),
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
