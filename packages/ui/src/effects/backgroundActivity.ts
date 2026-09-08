/**
 * Global "background busy" signal — lets scroll-heavy screens pause the
 * ambient GPU shader while the user is actively scrolling, so the raymarch
 * never competes with list rendering for frame budget. Counter-based so
 * overlapping sources (drag + momentum, multiple scrollables) can't
 * accidentally resume early.
 */

type Listener = (busy: boolean) => void;

let busyCount = 0;
const listeners = new Set<Listener>();

function emit() {
  const busy = busyCount > 0;
  listeners.forEach((l) => l(busy));
}

/**
 * A COUNTER THAT ONLY EVER GOES UP IS A PERMANENTLY PAUSED BACKGROUND.
 *
 * These events are not reliably paired. Tapping to catch a list mid-flight
 * fires `onMomentumScrollBegin` and then `onScrollBeginDrag`/`onScrollEndDrag`
 * with no `onMomentumScrollEnd` at all; navigating away mid-momentum drops the
 * end event on the floor entirely. Every dropped decrement is permanent,
 * because `Math.max(0, …)` swallows the over-decrement that would have healed
 * it — so after a few minutes of ordinary scrolling the counter never returns
 * to zero and the ambient shader is frozen for the rest of the session, on
 * every screen, with nothing on screen to explain it.
 *
 * So the busy flag expires. Scrolling is a thing a finger is doing right now;
 * if no scroll event has arrived for this long, no finger is doing it.
 */
const BUSY_WATCHDOG_MS = 6000;
let watchdog: ReturnType<typeof setTimeout> | null = null;

function armWatchdog() {
  if (watchdog) clearTimeout(watchdog);
  watchdog = null;
  if (busyCount === 0) return;
  watchdog = setTimeout(() => {
    watchdog = null;
    if (busyCount === 0) return;
    busyCount = 0;
    emit();
  }, BUSY_WATCHDOG_MS);
}

/** Increment/decrement the busy counter. Callers SHOULD balance calls; the
 *  watchdog above is what makes an unbalanced one survivable. */
export function setBackgroundBusy(busy: boolean) {
  busyCount = Math.max(0, busyCount + (busy ? 1 : -1));
  armWatchdog();
  emit();
}

/** Test hook — the pause state, without subscribing. */
export function backgroundBusyCount(): number {
  return busyCount;
}

/**
 * Drop-in scroll props for plain ScrollView/FlashList: pauses the ambient
 * shader for the whole drag + momentum span. For Reanimated scroll handlers,
 * call setBackgroundBusy via runOnJS from the equivalent events instead.
 */
export const backgroundScrollPauseProps = {
  onScrollBeginDrag: () => setBackgroundBusy(true),
  onScrollEndDrag: () => setBackgroundBusy(false),
  onMomentumScrollBegin: () => setBackgroundBusy(true),
  onMomentumScrollEnd: () => setBackgroundBusy(false),
} as const;

/** Subscribe to busy state; fires immediately with current state. */
export function subscribeBackgroundBusy(listener: Listener): () => void {
  listeners.add(listener);
  listener(busyCount > 0);
  return () => {
    listeners.delete(listener);
  };
}
