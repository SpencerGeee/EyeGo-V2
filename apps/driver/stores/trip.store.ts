import { create } from 'zustand';
import {
  getDriverSocket,
  connectDriverSocket,
  disconnectDriverSocket,
  ridesApi,
  subscribeToTrip,
  serverNow,
  secondsRemaining,
  type TripSnapshot,
  type TripStatus,
  type TripEvent,
  type TripChannelState,
  type PendingDispatch,
} from '@eyego/api';

/**
 * The driver's single source of truth for the current trip and the current
 * dispatch offer.
 *
 * WHAT THIS REPLACES. The driver app learned about its own trip from a
 * scattering of independent socket events (`trip:assigned`, `trip:status_update`,
 * a `dispatch:*` family) plus a REST poll for pending requests, with no
 * sequence number anywhere. Two consequences the driver felt:
 *
 *   - "The app forgot I was on a trip." There was no `GET /driver/state`, so a
 *     cold start after a force-quit rebuilt the trip from whatever the current
 *     screen happened to query. Now `hydrate()` answers it in one call.
 *   - Offer countdowns disagreed between phones, because each device counted
 *     down against its own clock. Every payload now carries `serverNowMs` and
 *     `expiresAtServerMs`; `offerSecondsLeft()` renders the difference, so two
 *     drivers looking at the same offer see the same number.
 */

export interface DispatchOffer {
  tripId: string;
  pickupLat: number | null;
  pickupLng: number | null;
  pickupAddress: string | null;
  dropoffLat: number | null;
  dropoffLng: number | null;
  dropoffAddress: string | null;
  /** Gross fare on the trip, and what this driver actually keeps. Pesewas. */
  farePesewas: number | null;
  driverEarningsPesewas: number | null;
  /** Wallet balance needed to BOARD this ride — see PendingOffer in @eyego/api. */
  walletRequiredPesewas: number | null;
  tier: string | null;
  /** Server deadline. Never compare this to Date.now() directly. */
  expiresAtServerMs: number;
  etaSeconds: number | null;
  attempt: number;
  totalCandidates: number;
}

interface DriverTripState {
  snapshot: TripSnapshot | null;
  lastSeq: number;
  clockSkewMs: number;
  connected: boolean;
  recovering: boolean;
  /** The exclusive offer this driver currently holds, if any. */
  offer: DispatchOffer | null;
  /**
   * Every live search this driver is eligible for, held by them or not.
   *
   * This is what the Dispatch tab lists. A rider watching "asking driver 1 of 1"
   * has to correspond to SOMETHING visible on the driver side; before this the
   * only evidence a search existed was an offer frame you had to be awake for.
   */
  pendingRequests: PendingDispatch[];
  /**
   * HAS THE BOARD EVER BEEN ANSWERED FOR?
   *
   * BUGFIX (item 1: "the live card that shows the live trip dispatch takes a
   * while to load up and it comes as blank for a while before the whole thing
   * is loaded up").
   *
   * `pendingRequests` starts as `[]`, and an empty array is indistinguishable
   * from "nothing is being dispatched to you" — so the home screen confidently
   * rendered its empty state for the whole first round trip and then replaced
   * it with live work. A driver reads that as the app telling them there is no
   * work and then changing its mind.
   *
   * `false` until the first `hydrate`/`resync` resolves, which is what lets the
   * board show a skeleton instead of an answer it does not have.
   * Never returns to false: once the server has spoken, an empty board is a
   * real empty board.
   */
  requestsHydrated: boolean;

  watch: (tripId: string) => void;
  unwatch: () => void;
  /** ONE-CALL REHYDRATION — cold start, foreground, reconnect. */
  hydrate: (opts?: { nudge?: boolean }) => Promise<TripSnapshot | null>;
  /**
   * Foreground recovery: hydrate, but ask the server to re-poke the cascade
   * first. Use this on AppState → active; `hydrate()` elsewhere.
   */
  resync: () => Promise<TripSnapshot | null>;
  /** Start listening for dispatch offers. Call once, while online. */
  listenForOffers: () => () => void;
  clearOffer: () => void;
  now: () => number;
  /** Seconds left on the held offer, against SERVER time. */
  offerSecondsLeft: () => number | null;
}


/**
 * Remove a dispatch offer notification from the system tray.
 *
 * Matched on the `tripId` the push carried in its data payload, so it only
 * ever clears the offer that actually ended. Wrapped because expo-notifications
 * is a native module and a JS-only OTA landing on an older binary must degrade,
 * not throw.
 */
async function dismissOfferNotification(tripId?: string | null) {
  if (!tripId) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Notifications = require('expo-notifications');
    const shown = await Notifications.getPresentedNotificationsAsync?.();
    for (const n of shown ?? []) {
      const data = n?.request?.content?.data as Record<string, unknown> | undefined;
      if (data?.type === 'TRIP_OFFER' && String(data?.tripId ?? '') === String(tripId)) {
        await Notifications.dismissNotificationAsync?.(n.request.identifier);
      }
    }
  } catch {
    // No native module, or the OS refused. The card is already down in-app.
  }
}

let unsubscribe: (() => void) | null = null;
let watchedTripId: string | null = null;

/**
 * How far the measured clock skew must move before it is worth a re-render.
 *
 * Skew is a network measurement and jitters on every poll. Everything that
 * consumes it renders whole seconds (`offerSecondsLeft`, the countdown ring),
 * so a quarter of a second is far finer than anything downstream can show —
 * and writing it unconditionally re-rendered every countdown twice a second.
 */
const CLOCK_SKEW_EPSILON_MS = 250;

/**
 * Has the trip actually moved?
 *
 * `version` is the server's own change counter for the row, so this is an exact
 * test rather than a heuristic: same id and same version means the snapshot the
 * store already holds is the same trip in the same state, whatever the JSON
 * parser handed back this time. Status is compared too, defensively, for any
 * path that mutates without bumping the version.
 */
function sameSnapshot(a: TripSnapshot | null, b: TripSnapshot | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.tripId === b.tripId && a.version === b.version && a.status === b.status;
}

/**
 * Are these the same board rows, in the same state?
 *
 * Compares the fields the board and the stage derivations actually branch on.
 * Deliberately NOT a deep equality: this runs every two seconds, and the point
 * is to be cheaper than the re-render it prevents.
 */
function sameRequests(a: PendingDispatch[], b: PendingDispatch[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.tripId !== y.tripId ||
      x.status !== y.status ||
      x.offeredToMe !== y.offeredToMe ||
      x.heldByAnother !== y.heldByAnother ||
      x.expiresAtServerMs !== y.expiresAtServerMs ||
      x.farePesewas !== y.farePesewas ||
      x.driverEarningsPesewas !== y.driverEarningsPesewas ||
      x.pickupLat !== y.pickupLat ||
      x.pickupLng !== y.pickupLng
    ) {
      return false;
    }
  }
  return true;
}

export const useDriverTripStore = create<DriverTripState>((set, get) => ({
  snapshot: null,
  lastSeq: 0,
  clockSkewMs: 0,
  connected: false,
  recovering: false,
  offer: null,
  pendingRequests: [],
  requestsHydrated: false,

  watch: (tripId) => {
    if (watchedTripId === tripId && unsubscribe) return;
    const hadRef = unsubscribe != null;
    unsubscribe?.();
    watchedTripId = tripId;
    // Hold a socket ref for as long as we are watching — `disconnectDriverSocket`
    // nulls the module's socket at zero refs, and this subscription's listeners
    // would be left on the discarded object. See the same note in the rider
    // store; it is the same bug with a different namespace.
    if (!hadRef) connectDriverSocket();
    unsubscribe = subscribeToTrip({
      socket: getDriverSocket(),
      tripId,
      lastSeq: get().snapshot?.tripId === tripId ? get().lastSeq : 0,
      onState: (s: TripChannelState) =>
        set({
          snapshot: s.snapshot,
          lastSeq: s.lastSeq,
          clockSkewMs: s.clockSkewMs,
          connected: s.connected,
          recovering: s.recovering,
        }),
    });
  },

  unwatch: () => {
    const hadRef = unsubscribe != null;
    unsubscribe?.();
    if (hadRef) disconnectDriverSocket();
    unsubscribe = null;
    watchedTripId = null;
    set({ snapshot: null, lastSeq: 0, recovering: false });
  },

  resync: () => get().hydrate({ nudge: true }),

  hydrate: async (opts) => {
    try {
      /**
       * Captured BEFORE the await so the answer can be applied without
       * clobbering an offer that arrived over the socket while it was in
       * flight. Identity, not equality: a fresh `set` produces a new object,
       * so `held !== heldBefore` is exactly "something happened meanwhile".
       */
      const heldBefore = get().offer;
      /**
       * NUDGE ON FOREGROUND, READ EVERYWHERE ELSE.
       *
       * BUGFIX ("the rider says asking driver 1 of 1 and nothing shows on the
       * driver app when I switch to it"). Reading was never enough on its own.
       * If the cascade had already offered to this driver and the frame was
       * missed, a read finds the offer — fine. But if the cascade had run out
       * of candidates and parked in `waiting`, there is nothing to read: the
       * search is alive on the rider's screen and dead on the driver's. Only
       * the server can restart it, so foregrounding asks it to.
       */
      const { trip, serverNowMs, offer, pendingRequests } = opts?.nudge
        ? await ridesApi.driverResync()
        : await ridesApi.driverState();
      /**
       * ── WRITE ONLY WHAT ACTUALLY CHANGED ──────────────────────────────────
       *
       * BUGFIX ("make it such that when the user opens the app, every
       * animation, effect or transition is butter fluid").
       *
       * This was an unconditional `set()`, and `_layout` calls it on a 2-second
       * safety poll for as long as the driver has no live trip — which is most
       * of a shift. Every one of those writes handed zustand a BRAND NEW
       * `snapshot` object and a BRAND NEW `pendingRequests` array parsed out of
       * fresh JSON, so every subscriber re-rendered every two seconds with data
       * that was structurally identical to what it already had.
       *
       * That is a permanent re-render storm on the driver's main screen, and it
       * got worse when home became the persistent surface: the map wrapper, the
       * sheet host, the board, the offer stage and every stage-derivation memo
       * keyed on `pendingRequests` identity all recompute on each tick. No
       * amount of animation tuning survives the tree being rebuilt underneath
       * it twice a second.
       *
       * `clockSkewMs` deserves its own mention: it is a network measurement, so
       * it jitters by a few milliseconds on EVERY poll. A component selecting
       * only the skew — the offer countdowns do — re-rendered every two seconds
       * for a number whose sub-second precision it cannot use.
       */
      const prev = get();
      const skew = serverNowMs - Date.now();
      const nextRequests = pendingRequests ?? [];

      set({
        // Identity is preserved when the trip has not moved. `version` is the
        // server's own change counter, so this is exact rather than a guess.
        snapshot: sameSnapshot(prev.snapshot, trip) ? prev.snapshot : trip,
        lastSeq: trip?.version ?? 0,
        // Only when it moved enough to matter to a countdown rendered in whole
        // seconds. 250 ms is well under the smallest thing skew is used for.
        clockSkewMs:
          Math.abs(skew - prev.clockSkewMs) > CLOCK_SKEW_EPSILON_MS ? skew : prev.clockSkewMs,
        pendingRequests: sameRequests(prev.pendingRequests, nextRequests)
          ? prev.pendingRequests
          : nextRequests,
        requestsHydrated: true,
      });
      // THE OFFER SURVIVES A DEAD SOCKET.
      //
      // An offer is a 20-second window. If the phone was asleep, on a train, or
      // mid-reconnect when it was published, the socket frame is simply gone —
      // there is no replay for offers because they carry no trip seq. So the
      // one call every cold start / foreground / reconnect already makes now
      // answers "is someone waiting on me right now?" too. Only adopt it if it
      // still has time on it against SERVER time.
      /**
       * AND IT DIES WITH THE SERVER'S ANSWER, TOO.
       *
       * BUGFIX ("if the driver app is in the background, the dispatch should
       * show immediately when it's opened — but ONLY if the dispatch hasn't
       * already gone to another driver").
       *
       * This used to only ever ADOPT an offer, never drop one. `OFFER_REVOKED`
       * was the sole way a card could be taken down, and it rides the socket —
       * which is precisely the channel that is dead in the case this whole
       * function exists for. A phone that was asleep when the offer was
       * published AND asleep when it was revoked came back, hydrated, and sat
       * there showing a live countdown for a ride another driver was already
       * driving. Accept then 409s.
       *
       * The server's answer is the whole truth about who holds what: the offer
       * key is per-driver and is deleted the moment the offer stops being
       * theirs (taken, declined, cancelled), and it self-expires with its own
       * window. So `offer: null` means "nothing is waiting on you", and the
       * card must go.
       *
       * The identity check is the race guard. Between the request leaving and
       * the response landing, the socket can deliver a genuinely new OFFER; the
       * response was true before that frame and must not undo it.
       */
      const liveOffer = offer && offer.expiresAtServerMs - (Date.now() + skew) > 1000 ? offer : null;
      if (!liveOffer) {
        const held = get().offer;
        const expired = held != null && held.expiresAtServerMs - (Date.now() + skew) <= 1000;
        if (held != null && (held === heldBefore || expired)) set({ offer: null });
      } else {
        const held = get().offer;
        if (held?.tripId !== liveOffer.tripId) {
          set({
            offer: {
              tripId: liveOffer.tripId,
              pickupLat: liveOffer.pickupLat ?? null,
              pickupLng: liveOffer.pickupLng ?? null,
              pickupAddress: liveOffer.pickupAddress ?? null,
              dropoffLat: liveOffer.dropoffLat ?? null,
              dropoffLng: liveOffer.dropoffLng ?? null,
              dropoffAddress: liveOffer.dropoffAddress ?? null,
              farePesewas: liveOffer.farePesewas ?? null,
              driverEarningsPesewas: liveOffer.driverEarningsPesewas ?? null,
              walletRequiredPesewas: liveOffer.walletRequiredPesewas ?? null,
              tier: liveOffer.tier ?? null,
              expiresAtServerMs: liveOffer.expiresAtServerMs,
              etaSeconds: liveOffer.etaSeconds ?? null,
              attempt: liveOffer.attempt ?? 0,
              totalCandidates: liveOffer.totalCandidates ?? 0,
            },
          });
        }
      }
      if (trip) get().watch(trip.tripId);
      return trip;
    } catch {
      /**
       * A FAILED READ IS STILL AN ANSWER, FOR THE PURPOSE OF THE SKELETON.
       *
       * Leaving `requestsHydrated` false here would leave the board shimmering
       * forever on a driver with no connection — a loading state that never
       * resolves is worse than an empty one, because the empty one at least
       * offers "Check now". The offline chip above the board is what says the
       * network is down; this only says "we have finished trying".
       */
      set({ requestsHydrated: true });
      return null;
    }
  },

  /**
   * Dispatch offers ride the same `trip:event` envelope as everything else, so
   * there is ONE socket handler in this app rather than one per event name —
   * and one staleness rule (TTL) rather than none.
   */
  listenForOffers: () => {
    // THE BUG THIS FIXES: "I requested a ride and the driver phone never rang."
    //
    // The driver socket is created with `autoConnect: false`, and the ONLY
    // thing that ever called `.connect()` was `watch()` — which runs when the
    // driver is already on a trip. A driver sitting on the home screen waiting
    // for work therefore held a socket object that had never dialled out. The
    // server published the offer correctly, into a room nobody was in.
    //
    // Taking a refcounted connection here means the offer channel is live for
    // the whole logged-in session, which is exactly as long as a driver can be
    // offered work. It also pins the socket identity: `disconnectDriverSocket`
    // nulls the module socket at zero refs, so without this ref an `unwatch()`
    // at the end of a trip destroyed the object this handler was bound to and
    // no further offer could ever arrive until the app was restarted.
    connectDriverSocket();
    const socket = getDriverSocket();
    const handler = (event: TripEvent) => {
      if (event.type === 'OFFER') {
        const p = event.payload;
        set((s) => ({
          // Keep the Dispatch list in step with the card without another round
          // trip: an offer I hold is by definition a live search I am on.
          pendingRequests: [
            {
              tripId: p.tripId,
              status: 'MATCHING',
              tier: p.tier ?? null,
              requestedAtMs: null,
              pickupLat: p.pickupLat ?? null,
              pickupLng: p.pickupLng ?? null,
              pickupAddress: p.pickupAddress ?? null,
              dropoffLat: p.dropoffLat ?? null,
              dropoffLng: p.dropoffLng ?? null,
              dropoffAddress: p.dropoffAddress ?? null,
              farePesewas: p.farePesewas ?? null,
              driverEarningsPesewas: p.driverEarningsPesewas ?? null,
              walletRequiredPesewas: p.walletRequiredPesewas ?? null,
              offeredToMe: true,
              expiresAtServerMs: p.expiresAtServerMs,
              heldByAnother: false,
            },
            ...s.pendingRequests.filter((r) => r.tripId !== p.tripId),
          ],
        }));
        set({
          clockSkewMs: event.serverNowMs - Date.now(),
          offer: {
            tripId: p.tripId,
            pickupLat: p.pickupLat ?? null,
            pickupLng: p.pickupLng ?? null,
            pickupAddress: p.pickupAddress ?? null,
            dropoffLat: p.dropoffLat ?? null,
            dropoffLng: p.dropoffLng ?? null,
            dropoffAddress: p.dropoffAddress ?? null,
            farePesewas: p.farePesewas ?? null,
            driverEarningsPesewas: p.driverEarningsPesewas ?? null,
            walletRequiredPesewas: p.walletRequiredPesewas ?? null,
            tier: p.tier ?? null,
            expiresAtServerMs: p.expiresAtServerMs,
            etaSeconds: p.etaSeconds ?? null,
            attempt: p.attempt ?? 0,
            totalCandidates: p.totalCandidates ?? 0,
          },
        });
      } else if (event.type === 'OFFER_REVOKED') {
        // The offer moved on — taken, cancelled or timed out. Told explicitly
        // so no driver is left holding a dead card and tapping Accept into a
        // 409, which is what a broadcast dispatch does to four drivers in five.
        const revokedId = event.payload?.tripId;
        const reason = event.payload?.reason;
        /**
         * WHY IT WAS REVOKED DECIDES WHAT HAPPENS TO THE ROW.
         *
         * BUGFIX (item 4: "on the driver app it's still telling me live
         * requests in queue, all 2 of them, but on the rider side I cancelled
         * the trip").
         *
         * Every revoke used to be treated as "somebody else has it": the row
         * survived, wearing `heldByAnother`, which the board rendered as IN
         * QUEUE. For TAKEN that is true and useful. For CANCELLED there is no
         * ride left at all, and for TIMEOUT the truth is the opposite of what
         * was shown — nobody holds it, and this very driver may claim it.
         */
        /**
         * A PASS TAKES THE ROW AWAY. A TIMEOUT ONLY STOPS THE CLOCK.
         *
         * BUGFIX ("if the driver passes, it shouldn't be shown to them again").
         *
         * `DECLINED` joined this set when a pass became permanent server-side
         * (see `noteDecline`'s `deliberate` flag in dispatch-cascade). Before
         * that, a decline was a cooldown, so keeping the row was right — the
         * ride could legitimately come back. It cannot any more: the cascade
         * will never offer this trip to this driver again, so a row that stays
         * on the board is advertising work that can no longer be taken.
         *
         * TIMEOUT is deliberately NOT in this set. Letting an offer lapse is an
         * accident, the server only puts a cooldown on it, and a first-claim
         * accept can still win — so the row survives, without a countdown.
         */
        /**
         * ── TAKE THE NOTIFICATION OUT OF THE TRAY TOO ─────────────────────────
         *
         * The in-app card comes down here, but the PUSH that woke the phone
         * stays in the notification shade until the driver swipes it away. So a
         * driver could tap an offer twenty minutes later, cold-start the app for
         * it, and be told it had expired — an entirely avoidable trip to a dead
         * end, and the sort of thing that teaches a driver to ignore the
         * notification that matters most.
         *
         * Best-effort and never awaited: failing to tidy the shade must not
         * interfere with revoking the offer itself.
         */
        void dismissOfferNotification(revokedId);

        const gone = reason === 'CANCELLED' || reason === 'TAKEN' || reason === 'DECLINED';
        set((s) => ({
          offer: s.offer?.tripId === revokedId ? null : s.offer,
          pendingRequests: gone
            ? s.pendingRequests.filter((r) => r.tripId !== revokedId)
            : s.pendingRequests.map((r) =>
                r.tripId === revokedId
                  ? {
                      ...r,
                      offeredToMe: false,
                      expiresAtServerMs: null,
                      /**
                       * Says WHY the deadline went away, so the offer screen
                       * cannot mistake "ended" for "never had one" and start a
                       * fresh 45-second ring on a dead offer.
                       */
                      offerExpiredForMe: true,
                      // A timeout hands the ride back to the pool, it does not
                      // hand it to a named driver. The next poll carries the
                      // server's own answer either way.
                      heldByAnother: false,
                    }
                  : r,
              ),
        }));
        // Whatever it was, the server knows more than this frame does — and
        // this is the moment the board is most likely to be wrong. One read.
        void get().hydrate();
      }
    };
    // A reconnect (backgrounded phone, tunnel, carrier handover) re-runs the
    // server's `socket.join('driver:<id>')`, but any offer published while we
    // were away is gone for good — offers carry no seq and so are not replayed.
    // Re-asking on every reconnect is what closes that window.
    const onReconnect = () => { void get().hydrate(); };
    socket.on('connect', onReconnect);
    socket.on('trip:event', handler);
    return () => {
      socket.off('trip:event', handler);
      socket.off('connect', onReconnect);
      disconnectDriverSocket();
    };
  },

  clearOffer: () => set({ offer: null }),
  now: () => serverNow(get().clockSkewMs),
  offerSecondsLeft: () => {
    const { offer, clockSkewMs } = get();
    return offer ? secondsRemaining(offer.expiresAtServerMs, clockSkewMs) : null;
  },
}));

/**
 * Every driver query cache that holds a copy of a trip's status.
 *
 * Three screens each keep their own `useQuery` for the same trip under a
 * different key, which is why the list has to exist at all: `active/[id]` is the
 * manage page, `tracking/[id]` is the live map, and `activeTrip` feeds home.
 */
const TRIP_STATUS_QUERY_KEYS = (tripId: string): unknown[][] => [
  ['driver', 'trip', 'active', tripId],
  ['driver', 'trip', 'tracking', tripId],
  ['driver', 'activeTrip'],
];

/** Minimal surface of QueryClient we need — avoids importing react-query here. */
type StatusCacheWriter = {
  setQueryData: (key: unknown[], updater: (old: any) => any) => unknown;
  invalidateQueries: (filters: { queryKey: unknown[] }) => unknown;
};

/**
 * ONE WRITE, EVERY SCREEN.
 *
 * BUGFIX ("i tapped I've arrived on the tracking page, went to the manage page,
 * and it still said heading to pickup — it corrects eventually but takes
 * excruciatingly long").
 *
 * The two screens were entirely independent caches. `tracking/[id]`'s success
 * handler invalidated `['driver','trip','tracking',id]` and — this is the actual
 * bug — never touched `['driver','trip','active',id]`, which is the key the
 * manage page reads. (Its ERROR handler invalidated 'active', the exact inverse
 * of what was needed.) So after a successful arrival the manage page's cache was
 * simply never told. With the app-wide `staleTime: 5 min` it would not even
 * refetch on being navigated to, leaving its own 30-second `refetchInterval` as
 * the only thing that could ever correct it: up to half a minute of a driver
 * looking at a status they had personally changed, and up to five minutes if the
 * interval tick had just passed.
 *
 * Patching one screen's key from the other screen's handler would just be the
 * same mistake with a longer list. Instead, a status transition writes to ALL of
 * them through here — optimistically, so it is instant — and the invalidation
 * underneath reconciles each against the server. Callers no longer need to know
 * which other screens exist.
 *
 * Patches the RAW axios payload because that is what these queries cache;
 * their `select` extracts `.data.data.trip` on read.
 */
export function applyDriverTripStatus(
  qc: StatusCacheWriter,
  tripId: string,
  status: string,
): void {
  for (const key of TRIP_STATUS_QUERY_KEYS(tripId)) {
    qc.setQueryData(key, (old: any) => {
      const trip = old?.data?.data?.trip;
      // `activeTrip` legitimately holds null once a trip ends, and a cache we
      // have never populated must not be conjured into existence here.
      if (!trip) return old;
      // Never patch a DIFFERENT trip's cache (activeTrip is not id-scoped).
      if (trip.id && trip.id !== tripId) return old;
      if (trip.status === status) return old;
      return {
        ...old,
        data: { ...old.data, data: { ...old.data.data, trip: { ...trip, status } } },
      };
    });
  }
  // The store the home screen and the dispatch screen read. Keeping it in step
  // is what stops a driver seeing the new status on one screen and the old one
  // on another — the complaint this whole function exists to answer.
  useDriverTripStore.setState((s) =>
    s.snapshot && s.snapshot.tripId === tripId && s.snapshot.status !== status
      ? { snapshot: { ...s.snapshot, status: status as TripStatus } }
      : s,
  );
}

/**
 * Reconcile the query caches from the SERVER's versioned snapshot.
 *
 * The other half of the optimistic write above: `trip:event` is the authority,
 * so when one arrives (including for a transition this device did not make —
 * an admin correction, or the rider cancelling) every screen's cache is brought
 * into line without each one having to poll for it. Wired once, in `_layout`.
 */
export function subscribeDriverStatusToCaches(qc: StatusCacheWriter): () => void {
  let lastSeen: string | null = null;
  return useDriverTripStore.subscribe((state) => {
    const snap = state.snapshot;
    if (!snap) {
      lastSeen = null;
      return;
    }
    const fingerprint = `${snap.tripId}:${snap.status}`;
    if (fingerprint === lastSeen) return;
    lastSeen = fingerprint;
    applyDriverTripStatus(qc, snap.tripId, snap.status);
    // Then let the server's full row land — the snapshot carries status, but the
    // screens read plenty of fields it does not (passenger list, fare, seats).
    for (const key of TRIP_STATUS_QUERY_KEYS(snap.tripId)) {
      qc.invalidateQueries({ queryKey: key });
    }
  });
}

/**
 * Which screen this trip belongs on. The mirror image of the rider's
 * `stageForStatus` — same source of truth, so the two apps cannot be showing
 * different phases of the same ride.
 */
export function driverScreenForStatus(
  status: TripStatus | null | undefined,
): 'dispatch' | 'active' | 'tracking' | null {
  switch (status) {
    case 'DRIVER_ASSIGNED':
      return 'dispatch';
    case 'DRIVER_EN_ROUTE':
    case 'ARRIVED_AT_PICKUP':
      return 'active';
    case 'IN_PROGRESS':
      return 'tracking';
    default:
      return null;
  }
}

export const DRIVER_TERMINAL_STATUSES: TripStatus[] = [
  'COMPLETED', 'CANCELLED', 'NO_DRIVERS_FOUND', 'EXPIRED', 'NO_SHOW',
];

export const isTerminal = (s: TripStatus | null | undefined): boolean =>
  !!s && DRIVER_TERMINAL_STATUSES.includes(s);
