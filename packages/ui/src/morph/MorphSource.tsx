import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { View, type ViewStyle } from 'react-native';
import { useMorphOptional, type MorphRect } from './MorphProvider';

interface MorphSourceProps {
  /** Unique id linking this source to a MorphTarget on the pushed screen. */
  id: string;
  /** Corner radius of the source element (start of the morph). */
  borderRadius?: number;
  /** Clone fill while in flight — match the source's visual background. */
  backgroundColor?: string;
  style?: ViewStyle;
  children: React.ReactNode;
}

/** Imperative handle for force-restoring a source that may have been left
 * hidden by an abandoned flight (see MorphSourceHandle.show doc below). */
export interface MorphSourceHandle {
  /**
   * Force this source back to visible. `morphTo` hides the source and only
   * un-hides it via `morphBack`/the target-timeout fallback — if the flow
   * instead navigates forward past the target (e.g. tapping a button on the
   * morph target screen that pushes a *different* screen, rather than using
   * the target's own back/close control), the source is left hidden forever
   * even after the user eventually returns to this screen, since nothing
   * ever calls its `show()`. Callers should invoke this from a focus effect
   * on the screen that owns the source, so it self-heals regardless of how
   * the caller wandered away.
   */
  show: () => void;
}

/**
 * Wraps the element a morph departs from. Registers a measurable handle +
 * clone renderer with MorphProvider; hides itself while the clone flies and
 * restores when the morph returns. Trigger the flight with
 * `useMorph().morphTo(id, () => router.push(...))`.
 */
export const MorphSource = forwardRef<MorphSourceHandle, MorphSourceProps>(function MorphSource({
  id,
  borderRadius = 0,
  backgroundColor,
  style,
  children,
}, ref) {
  const morph = useMorphOptional();
  const viewRef = useRef<View>(null);
  const [hidden, setHidden] = useState(false);

  // Keep the latest children available to the provider without re-registering
  // every render.
  const childrenRef = useRef(children);
  childrenRef.current = children;

  /** Last window frame this source reported — the fallback for `measureSync`. */
  const lastRectRef = useRef<MorphRect | null>(null);

  const measure = useCallback(
    () =>
      new Promise<MorphRect | null>((resolve) => {
        const node = viewRef.current;
        if (!node) return resolve(null);
        node.measureInWindow((mx, my, mw, mh) => {
          if (typeof mx !== 'number' || Number.isNaN(mx)) return resolve(null);
          const rect = { x: mx, y: my, width: mw, height: mh };
          lastRectRef.current = rect;
          resolve(rect);
        });
      }),
    []
  );

  /**
   * Synchronous frame for the reverse morph. Fabric exposes
   * `unstable_getBoundingClientRect()` on host components, which is the only way
   * to get a window-relative frame without awaiting a callback; when it is
   * unavailable (or the node is gone) we fall back to the last frame measured on
   * the way out, which is what `morphBack` used to use unconditionally.
   */
  const measureSync = useCallback((): MorphRect | null => {
    const node = viewRef.current as unknown as
      | { unstable_getBoundingClientRect?: () => { x: number; y: number; width: number; height: number } }
      | null;
    const rect = node?.unstable_getBoundingClientRect?.();
    if (
      rect &&
      Number.isFinite(rect.x) &&
      Number.isFinite(rect.y) &&
      rect.width > 0 &&
      rect.height > 0
    ) {
      const next = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      lastRectRef.current = next;
      return next;
    }
    return lastRectRef.current;
  }, []);

  useEffect(() => {
    if (!morph) return;
    return morph.registerSource(id, {
      measure,
      measureSync,
      getClone: () => childrenRef.current,
      borderRadius,
      backgroundColor,
      hide: () => setHidden(true),
      show: () => setHidden(false),
    });
  }, [morph, id, measure, borderRadius, backgroundColor]);

  // Exposed so the owning screen can force-restore visibility on focus —
  // see MorphSourceHandle.show doc above for why this is necessary.
  useImperativeHandle(ref, () => ({
    show: () => setHidden(false),
  }), []);

  return (
    <View
      ref={viewRef}
      collapsable={false}
      style={[style, hidden && { opacity: 0 }]}
      pointerEvents={hidden ? 'none' : 'auto'}
    >
      {children}
    </View>
  );
});
