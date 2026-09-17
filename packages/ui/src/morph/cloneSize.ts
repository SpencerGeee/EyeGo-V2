import { createContext, useContext } from 'react';

/**
 * The laid-out size of the element a morph clone is a copy of.
 *
 * Provided ONLY by MorphProvider around the clone it is flying. Anything that
 * normally has to wait for its own `onLayout` before it can draw (the glow
 * ring — see GradientGlowBorder) reads this as its first-frame answer, so the
 * clone is pixel-identical to the source on the very frame the source is
 * hidden instead of one or two frames later. Null everywhere else.
 */
export const CloneSizeContext = createContext<{ width: number; height: number } | null>(null);

export function useCloneSize() {
  return useContext(CloneSizeContext);
}
