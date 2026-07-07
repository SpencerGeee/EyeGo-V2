import { useCallback, useEffect, useRef, useState } from 'react';
import type { PanelState } from './usePanelMotion';

/**
 * Panel lifecycle orchestration — manages mount gate (`mounted`),
 * freezes/unfreezes the motion engine when visibility toggles, and
 * fires the dismiss callback after the panel has fully animated off-screen.
 *
 * PanelSheet calls this AFTER `usePanelMotion` so `snapToState` is ready.
 * `contentH` drives the expanded snap-point math and guards the "snap
 * open" effect so the panel doesn't animate until content is measured.
 */
interface UsePanelLifecycleOptions {
  visible: boolean;
  contentH: number;
  snapToState: (state: PanelState) => void;
  onDismiss: () => void;
  /** Passed so handleDismissed can reset the auto-height measurement. */
  setContentH: (h: number) => void;
}

interface UsePanelLifecycleReturn {
  mounted: boolean;
  handleDismissed: () => void;
}

export function usePanelLifecycle({
  visible,
  contentH,
  snapToState,
  onDismiss,
  setContentH,
}: UsePanelLifecycleOptions): UsePanelLifecycleReturn {
  const [mounted, setMounted] = useState(visible);

  // Ref so a mid-dismissal re-render can't swap the callback under the spring.
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const handleDismissed = useCallback(() => {
    setMounted(false);
    setContentH(0);
    onDismissRef.current();
  }, [setContentH]);

  // Mount when visibility flips true.
  useEffect(() => {
    if (visible) setMounted(true);
  }, [visible]);

  // Snap open once content is measured.
  useEffect(() => {
    if (mounted && visible && contentH > 0) snapToState('expanded');
  }, [mounted, visible, contentH, snapToState]);

  // Snap shut when visibility is toggled off.
  useEffect(() => {
    if (!visible && mounted && contentH > 0) snapToState('hidden');
  }, [visible, mounted, contentH, snapToState]);

  return { mounted, handleDismissed };
}
