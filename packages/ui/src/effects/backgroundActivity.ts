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

/** Increment/decrement the busy counter. Callers MUST balance calls. */
export function setBackgroundBusy(busy: boolean) {
  busyCount = Math.max(0, busyCount + (busy ? 1 : -1));
  emit();
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
