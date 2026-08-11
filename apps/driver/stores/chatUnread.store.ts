import { create } from 'zustand';

/**
 * HOW MANY MESSAGES THE DRIVER HAS NOT READ.
 *
 * The rider app grew one of these; the driver app never had one at all — "the
 * driver app also doesn't have the badge so there's nothing showing that a text
 * arrived". A message raised a floating banner and nothing else, so a driver
 * who was looking at the road, or whose phone was face-down in a cradle for the
 * four seconds the banner lived, had no way to discover it afterwards. The
 * passenger's message simply went unanswered.
 *
 * Kept per trip: a badge on THIS ride's chat button must not be lit by a
 * message from a previous one.
 */
interface ChatUnreadState {
  /** tripId → number of unread inbound messages. */
  counts: Record<string, number>;
  /** A message arrived from a passenger. */
  received: (tripId: string) => void;
  /** The driver opened (or is looking at) this trip's chat. */
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
