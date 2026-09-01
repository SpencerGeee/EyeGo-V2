/**
 * THE SMOOTHNESS SYSTEM.
 *
 * One place that makes every screen in both apps feel the same, and calm. Read
 * `transitionClock.ts` for the diagnosis, `SmoothScreen.tsx` for the mechanism,
 * `navigation.ts` for the stack-depth fix.
 *
 * Adopting it on a screen is three edits:
 *
 *   1. Root layout, once per app:  `enableSmoothNavigation()` at module scope,
 *      and `freezeOnBlur: true` in the Stack's `screenOptions`.
 *   2. Wrap the screen body:       `<SmoothScreen placeholder={<Skeleton/>}>`.
 *   3. Swap the entrances:         `Animated.View entering={FadeIn.delay(i*60)}`
 *                                  becomes `<SmoothIn index={i}>`.
 *
 * And navigate with `goDeeper` / `goLateral` / `goBack` / `goOut` instead of
 * `router.push` / `router.replace` / `router.back`.
 */

export {
  SmoothScreen,
  SmoothDefer,
  useSmoothScreen,
  useSettled,
} from './SmoothScreen';
export type { SmoothScreenProps, SmoothScreenState } from './SmoothScreen';

export { SmoothIn, SmoothSection } from './SmoothIn';
export type { SmoothInProps } from './SmoothIn';

export { goDeeper, goLateral, goInstead, goBack, goOut } from './navigation';

export { enableSmoothNavigation } from './enableSmoothNavigation';
export { SmoothNavigationProvider } from './SmoothNavigationProvider';
export type { SmoothNavigationProviderProps } from './SmoothNavigationProvider';
export { smoothScreenLayout } from './smoothScreenLayout';

export {
  isTransitioning,
  beginTransition,
  subscribeTransition,
  afterTransition,
  TRANSITION_MS,
} from './transitionClock';
