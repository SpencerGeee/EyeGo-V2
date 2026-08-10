import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * ONLY THE BACKGROUND YOU CAN SEE IS ALLOWED TO RUN.
 *
 * `AppBackground` renders a full-screen Skia raymarch, and a stack navigator
 * keeps every screen you have pushed through MOUNTED underneath the current
 * one. Each of those screens renders its own background, so walking four
 * screens into the booking flow left four full-screen fragment shaders
 * compositing every frame — three of them behind an opaque screen, drawing
 * pixels no one would ever see.
 *
 * That is the "the phone gets hot and starts to lag" report, and it is also
 * why the lag was worst deep in a flow rather than on the home screen.
 *
 * There is no navigation dependency in this package, so focus is inferred the
 * way a stack actually behaves: the LAST background to mount is the topmost
 * one. Everything below it freezes on its current frame — no unmount, no
 * remount, no visible change when it comes back.
 */

let nextId = 1;
const mounted: number[] = [];
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((fn) => fn());

function acquire(): number {
  const id = nextId++;
  mounted.push(id);
  notify();
  return id;
}

function release(id: number) {
  const i = mounted.indexOf(id);
  if (i !== -1) mounted.splice(i, 1);
  notify();
}

const isTopmost = (id: number) => mounted.length === 0 || mounted[mounted.length - 1] === id;

/**
 * True only when this instance is the topmost mounted background AND the app
 * is in the foreground. Drive every ambient animation off this.
 */
export function useIsTopmostBackground(): boolean {
  const [id] = useState(acquire);
  const [top, setTop] = useState(() => isTopmost(id));
  const [foreground, setForeground] = useState(() => AppState.currentState === 'active');

  useEffect(() => {
    const onChange = () => setTop(isTopmost(id));
    listeners.add(onChange);
    onChange();
    return () => {
      listeners.delete(onChange);
      release(id);
    };
  }, [id]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setForeground(s === 'active'));
    return () => sub.remove();
  }, []);

  return top && foreground;
}
