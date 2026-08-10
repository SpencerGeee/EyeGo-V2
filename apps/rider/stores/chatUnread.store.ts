import { create } from 'zustand';

/**
 * HOW MANY MESSAGES THE RIDER HAS NOT READ.
 *
 * There was no answer to that question anywhere in the app. A message from the
 * driver raised a floating banner — except on the trip surface and the chat
 * screen, where `TripStatusListener` deliberately suppresses banners so the
 * same sentence is not on screen twice. The trip surface is exactly where a
 * rider sits for the whole ride, so in practice a driver's message arrived,
 * flashed nothing, and was only discovered by opening the chat on a hunch.
 *
 * Kept per trip: a badge on THIS ride's chat button must not be lit by a
 * message from a previous one.
 */
interface ChatUnreadState {
  /** tripId → number of unread inbound messages. */
  counts: Record<string, number>;
  /** A message arrived from the other party. */
  received: (tripId: string) => void;
  /** The rider opened (or is looking at) this trip's chat. */
  markRead: (tripId: string) => void;
  countFor: (tripId: string | null | undefined) => number;
}

export const useChatUnread = create<ChatUnreadState>((set, get) => ({
  counts: {},

  received: (tripId) =>
    set((s) => (tripId ? { counts: { ...s.counts, [tripId]: (s.counts[tripId] ?? 0) + 1 } } : s)),

  markRead: (tripId) =>
    set((s) => {
      if (!tripId || !(tripId in s.counts)) return s;
      const next = { ...s.counts };
      delete next[tripId];
      return { counts: next };
    }),

  countFor: (tripId) => (tripId ? get().counts[tripId] ?? 0 : 0),
}));
