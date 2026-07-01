import { createContext, useContext } from 'react';
import { colors, type ColorTokens } from '@eyego/config';

// Default is the exact static dark palette every component already rendered
// before this context existed — any consumer that never wraps a
// ColorsProvider (i.e. the driver app, unchanged) keeps looking identical.
const ColorsContext = createContext<ColorTokens | null>(null);

export const ColorsProvider = ColorsContext.Provider;

export function useThemedColors(): ColorTokens {
  const ctx = useContext(ColorsContext);
  return ctx ?? colors;
}
