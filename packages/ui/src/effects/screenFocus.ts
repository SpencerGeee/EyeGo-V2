import { useContext, useEffect, useState } from 'react';

/**
 * "Is the screen I am rendered on the one the user is looking at?"
 *
 * WHY THIS EXISTS. Both ambient-background registries (`shaderSlot`,
 * `topmostBackground`) used to infer visibility from MOUNT ORDER — the last
 * background to mount was assumed to be the one on top. That is true for a
 * stack, where pushing mounts and popping unmounts, and it is flatly false for
 * a tab navigator, where every tab stays mounted for the life of the session.
 *
 * The consequence was the whole of "the Skia background gets laggy on the home
 * page and going to Services or Activity never brings it back": visiting a
 * second tab mounted that tab's background LAST, so it owned the shader slot
 * for the rest of the session. Returning to Home did not remount anything, so
 * Home kept painting the cheap static gradient — flatter and darker than the
 * live shader, which is also the "the background seems a bit darker than
 * previously" half of the report — while the invisible Services tab kept the
 * only animated canvas.
 *
 * Focus is the fact those registries actually wanted, so ask for it directly.
 *
 * `NavigationContext` rather than `useIsFocused()`: the root layout renders an
 * `AppBackground` as a SIBLING of the navigator, where there is no screen and
 * `useIsFocused()` throws. A background with no navigation context above it is
 * app-chrome, not a screen, so it counts as always focused and simply sits at
 * the bottom of the claim order.
 */

// Optional peer: packages/ui deliberately carries no navigation dependency, so
// resolve it at load time and degrade to "always focused" if it is absent.
let NavigationContext: React.Context<any> | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  NavigationContext = require('@react-navigation/native').NavigationContext ?? null;
} catch {
  NavigationContext = null;
}

const NullContext = { Provider: null, Consumer: null } as unknown as React.Context<any>;

export function useScreenFocus(): boolean {
  // Hook count must not depend on whether the peer resolved, so always call
  // useContext — with a dummy context when there is nothing real to read.
  const navigation = useContext(NavigationContext ?? NullContext) as
    | { isFocused?: () => boolean; addListener?: (e: string, cb: () => void) => () => void }
    | undefined;

  const [focused, setFocused] = useState(() => {
    try {
      return navigation?.isFocused?.() ?? true;
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (!navigation?.addListener || !navigation.isFocused) {
      setFocused(true);
      return;
    }
    setFocused(navigation.isFocused());
    const offFocus = navigation.addListener('focus', () => setFocused(true));
    const offBlur = navigation.addListener('blur', () => setFocused(false));
    return () => {
      offFocus?.();
      offBlur?.();
    };
  }, [navigation]);

  return focused;
}
