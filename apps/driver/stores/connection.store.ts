import { create } from 'zustand';

/**
 * Is the driver's socket up?
 *
 * PRESENTATION ONLY. This store exists so the trip screens can show the same
 * "Reconnecting…" chip the rider's tracking screen has, and nothing else reads
 * it — no dispatch decision, no transition, no request is gated on it. The
 * socket hook already knew this (it had `onConnect` and `onDisconnect`
 * handlers) and did nothing with it but `console.log`, so the driver's screen
 * was the only one of the two that could go quietly stale: the panel kept
 * showing the last ETA it received with no indication that the feed behind it
 * had stopped.
 *
 * `recovering` marks the window between reconnecting and having replayed
 * whatever was missed, which is a different message to the rider ("Catching
 * up…" rather than "Reconnecting…") and a different one here for the same
 * reason — a driver who reconnects wants to know the numbers are not yet
 * trustworthy, not merely that the pipe is open.
 */
interface ConnectionState {
  connected: boolean;
  recovering: boolean;
  setConnected: (connected: boolean) => void;
  setRecovering: (recovering: boolean) => void;
}

export const useDriverConnection = create<ConnectionState>((set) => ({
  // Optimistic: the socket connects within a moment of the screen mounting, and
  // opening on "Reconnecting…" every single time would train drivers to ignore
  // the chip entirely — which is the one thing it must not become.
  connected: true,
  recovering: false,
  setConnected: (connected) => set({ connected }),
  setRecovering: (recovering) => set({ recovering }),
}));
