import React, { useCallback, useEffect, useRef, useState } from 'react';
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

/**
 * Wraps the element a morph departs from. Registers a measurable handle +
 * clone renderer with MorphProvider; hides itself while the clone flies and
 * restores when the morph returns. Trigger the flight with
 * `useMorph().morphTo(id, () => router.push(...))`.
 */
export function MorphSource({
  id,
  borderRadius = 0,
  backgroundColor,
  style,
  children,
}: MorphSourceProps) {
  const morph = useMorphOptional();
  const ref = useRef<View>(null);
  const [hidden, setHidden] = useState(false);

  // Keep the latest children available to the provider without re-registering
  // every render.
  const childrenRef = useRef(children);
  childrenRef.current = children;

  const measure = useCallback(
    () =>
      new Promise<MorphRect | null>((resolve) => {
        const node = ref.current;
        if (!node) return resolve(null);
        node.measureInWindow((mx, my, mw, mh) => {
          if (typeof mx !== 'number' || Number.isNaN(mx)) return resolve(null);
          resolve({ x: mx, y: my, width: mw, height: mh });
        });
      }),
    []
  );

  useEffect(() => {
    if (!morph) return;
    return morph.registerSource(id, {
      measure,
      getClone: () => childrenRef.current,
      borderRadius,
      backgroundColor,
      hide: () => setHidden(true),
      show: () => setHidden(false),
    });
  }, [morph, id, measure, borderRadius, backgroundColor]);

  return (
    <View
      ref={ref}
      collapsable={false}
      style={[style, hidden && { opacity: 0 }]}
      pointerEvents={hidden ? 'none' : 'auto'}
    >
      {children}
    </View>
  );
}
