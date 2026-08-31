import { Platform } from 'react-native';

/**
 * `notify()` — THE IN-APP REPLACEMENT FOR 143 BLOCKING OS MODALS.
 *
 * ── WHAT WAS THERE ──────────────────────────────────────────────────────────
 * Both apps used `Alert.alert` as a status line. Classified across the two:
 *
 *     41  real decisions    two or more buttons, a genuine two-way door
 *                           ("Depart with empty seats?"). These are CORRECT and
 *                           stay exactly as they are.
 *    143  pure reports      one button, or none. A modal that stops the app,
 *                           dims the screen and looks nothing like the product,
 *                           used to say "we could not save that".
 *
 * Twenty-two of the 143 were titled literally `"Error"`, which tells the user
 * the category of event they had already worked out for themselves.
 *
 * Meanwhile `GlobalToast` (rider) and `DriverToast` (driver) both existed, both
 * looked right, and between them had eight callers.
 *
 * ── WHY THE SIGNATURE IS WHAT IT IS ─────────────────────────────────────────
 * `notify(title, message)` is positionally identical to
 * `Alert.alert(title, message)`. That is deliberate and it is the whole reason
 * this migration is finishable: 143 sites across two apps convert in one
 * scripted pass with no behaviour lost and no judgement calls.
 *
 * The alternative — designing a richer API and migrating into it by hand —
 * is better on paper and reliably dies at about site sixty, leaving the app
 * with two error systems instead of one.
 *
 * ── A MODULE SINGLETON, NOT A HOOK ──────────────────────────────────────────
 * `Alert.alert` is callable from a mutation's `onError`, a catch block, a socket
 * handler and a module-scope helper. A hook is callable from none of those. So
 * this is a plain function over a tiny subscription, and the React part is only
 * the host that draws it.
 */

export type NoticeTone = 'success' | 'error' | 'warning' | 'info';

export interface Notice {
  id: number;
  title: string | null;
  message: string;
  tone: NoticeTone;
  /** Stays until dismissed. For a fact that dismissing does not change. */
  persist: boolean;
  /** ms; ignored when `persist`. */
  duration: number;
  /**
   * True for the offline notice itself, so a host can style it apart and so
   * `notify` can find and replace it rather than stacking a second one.
   */
  isNetwork?: boolean;
  /**
   * ONE optional verb.
   *
   * Most reports need no action — they state a fact and leave. A few carry a
   * button that genuinely does something, and dropping it would be a
   * regression rather than a simplification: "Show me" lights the seat map a
   * driver otherwise cannot find, and the dispatch screen's "OK" is what takes
   * a driver off a dead offer. A toast that keeps those is strictly better than
   * the blocking modal it replaced — same verb, without stopping the app.
   *
   * Deliberately ONE. A toast with two choices is a dialog wearing a costume,
   * and a real decision belongs in `Alert.alert`.
   */
  action?: { label: string; onPress: () => void } | null;
}

export interface NotifyOptions {
  tone?: NoticeTone;
  /** Keep it up until the user dismisses it. */
  persist?: boolean;
  duration?: number;
  /** One verb. See `Notice.action`. */
  action?: { label: string; onPress: () => void } | null;
}

type Listener = (notice: Notice | null) => void;

const listeners = new Set<Listener>();
let current: Notice | null = null;
let seq = 1;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Network truth, pushed in by each app's root. See `reportNetwork`. */
let offline = false;
let pendingWrites = 0;

function emit() {
  for (const l of listeners) {
    try {
      l(current);
    } catch {
      /* a listener must never break the queue for the others */
    }
  }
}

function put(notice: Notice) {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  current = notice;
  emit();
  if (!notice.persist) {
    timer = setTimeout(() => {
      // Only retire it if it is still the one on screen — a newer notice that
      // arrived in the meantime owns the slot and its own timer.
      if (current?.id === notice.id) {
        current = null;
        emit();
      }
    }, notice.duration);
  }
}

/**
 * ONE SLOT, NEWEST WINS — deliberately not a queue.
 *
 * A rider reading a stack of four toasts is a rider not looking at the road or
 * the fare, and by the time the fourth is readable the first is no longer true.
 * This is the same rule `DriverToast` and the dispatch offer sheet already use.
 */
export function notify(
  title: string | null,
  message?: string,
  opts: NotifyOptions = {},
): void {
  const text = (message ?? title ?? '').trim();
  if (!text) return;

  /**
   * ── OFFLINE SUPPRESSES, IT DOES NOT STACK ─────────────────────────────────
   *
   * With 143 call sites now routed through here, a drive through a tunnel used
   * to mean fifteen toasts, each saying something slightly different about the
   * same single fact. When the network is the reason, the network is the
   * message — one true statement instead of fifteen confusing ones.
   *
   * Only failures are suppressed. A `success` notice while offline is a local
   * confirmation (a draft saved, a setting stored) and is still worth showing.
   */
  const tone = opts.tone ?? 'error';
  if (offline && (tone === 'error' || tone === 'warning')) {
    showOfflineNotice();
    return;
  }

  put({
    id: seq++,
    title: title && message ? title : null,
    message: text,
    tone,
    persist: opts.persist ?? false,
    // An actionable notice gets longer on screen: it is asking for a tap, and a
    // button that leaves before it can be read is worse than no button.
    duration: opts.duration ?? (opts.action ? 7000 : tone === 'error' ? 5000 : 3500),
    action: opts.action ?? null,
  });
}

/** Convenience wrappers, so a caller does not have to remember the tone key. */
export const notifySuccess = (message: string, title?: string) =>
  notify(title ?? null, message, { tone: 'success' });
export const notifyInfo = (message: string, title?: string) =>
  notify(title ?? null, message, { tone: 'info' });

export function dismissNotice(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  current = null;
  emit();
}

export function subscribeNotices(fn: Listener): () => void {
  listeners.add(fn);
  fn(current);
  return () => {
    listeners.delete(fn);
  };
}

/** For a host that mounts after a notice was raised. */
export function currentNotice(): Notice | null {
  return current;
}

function offlineMessage(): string {
  if (pendingWrites <= 0) return "You're offline. We'll reconnect on our own.";
  return pendingWrites === 1
    ? "You're offline. 1 action will send when you're back."
    : `You're offline. ${pendingWrites} actions will send when you're back.`;
}

function showOfflineNotice() {
  // Replace the existing offline notice in place rather than resetting the
  // slot, so the count can climb without the banner re-animating each time.
  if (current?.isNetwork) {
    current = { ...current, message: offlineMessage() };
    emit();
    return;
  }
  put({
    id: seq++,
    title: null,
    message: offlineMessage(),
    tone: 'warning',
    // A fact that dismissing does not change.
    persist: true,
    duration: 0,
    isNetwork: true,
  });
}

/**
 * NETWORK TRUTH, PUSHED IN FROM EACH APP'S ROOT.
 *
 * `packages/ui` deliberately carries no dependency on either app's
 * `useNetworkStatus` or `offlineQueue`, so the root layouts report into this
 * instead. Both files already existed in both apps; the rider's
 * `useNetworkStatus` had ZERO consumers before this — built, wired to nothing.
 *
 * `pending` comes from `offlineQueue`, so the count in the banner is the real
 * number of queued writes rather than a reassurance.
 */
export function reportNetwork({ offline: isOffline, pending }: { offline: boolean; pending?: number }): void {
  const was = offline;
  offline = isOffline;
  if (typeof pending === 'number') pendingWrites = pending;

  if (isOffline) {
    // Raise it immediately, not on the next failure: a rider who has just lost
    // signal should be told before they tap something that cannot work.
    showOfflineNotice();
    return;
  }

  if (was && !isOffline) {
    /**
     * THE RECOVERY BEAT.
     *
     * Without this the banner simply vanishes and the rider never learns
     * whether the cancel they queued actually went through. Silence after a
     * failure reads as the failure standing.
     */
    const sent = pendingWrites;
    if (current?.isNetwork) dismissNotice();
    notify(
      null,
      sent > 0
        ? `Back online. ${sent} ${sent === 1 ? 'action' : 'actions'} sent.`
        : 'Back online.',
      { tone: 'success', duration: 2600 },
    );
    pendingWrites = 0;
  }
}

/** Test seam. Never call from app code. */
export function __resetNotices(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  current = null;
  offline = false;
  pendingWrites = 0;
  seq = 1;
}

/**
 * Haptic tone for a notice, so a driver with the phone in a cradle feels the
 * difference between "saved" and "that failed" without looking at it. Resolved
 * lazily: `expo-haptics` is an app dependency, and Android's implementation is
 * a no-op for the lighter styles, so this is best-effort by design.
 */
export function noticeHaptic(tone: NoticeTone): void {
  if (Platform.OS === 'web') return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const H = require('expo-haptics');
    if (tone === 'error') void H.notificationAsync?.(H.NotificationFeedbackType.Error).catch(() => {});
    else if (tone === 'warning') void H.notificationAsync?.(H.NotificationFeedbackType.Warning).catch(() => {});
    else if (tone === 'success') void H.notificationAsync?.(H.NotificationFeedbackType.Success).catch(() => {});
  } catch {
    /* no haptics available */
  }
}
