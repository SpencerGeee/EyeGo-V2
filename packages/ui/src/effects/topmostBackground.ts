import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useScreenFocus } from './screenFocus';

/**
 * ONLY THE BACKGROUND YOU CAN SEE IS ALLOWED TO RUN.
 *
 * `AppBackground` renders a full-screen Skia raymarch, and both navigators keep
 * screens MOUNTED when they are not on screen — a stack keeps everything you
 * pushed through, a tab navigator keeps every tab you have ever opened. Each of
 * those screens renders its own background, so without a gate the phone runs
 * several full-screen fragment shaders at once, most of them drawing pixels
 * nobody will ever see.
 *
 * WHAT CHANGED. This used to infer "on top" from MOUNT ORDER, which is only
 * correct for a stack. Under tabs it was actively wrong: the second tab you
 * opened mounted last and kept the animated background for the rest of the
 * session, while the tab you were actually looking at froze on its last frame.
 * Visibility now comes from navigation focus (see screenFocus.ts), which is the
 * fact this was always trying to approximate, and it is correct for stacks,
 * tabs, and the trip surface's stage swaps alike.
 */

/**
 * True only when this instance's screen is focused AND the app is in the
 * foreground. Drive every ambient animation off this.
 */
export function useIsTopmostBackground(): boolean {
  const focused = useScreenFocus();
  const [foreground, setForeground] = useState(() => AppState.currentState === 'active');

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setForeground(s === 'active'));
    return () => sub.remove();
  }, []);

  return focused && foreground;
}
