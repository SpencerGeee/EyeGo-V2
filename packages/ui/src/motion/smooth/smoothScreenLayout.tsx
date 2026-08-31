import React from 'react';

import { SmoothScreen } from './SmoothScreen';

/**
 * EVERY SCREEN, WITHOUT TOUCHING EVERY SCREEN.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * "You need to make sure the smoothness component is applied everywhere on both
 * apps and not select places."
 *
 * Right — and wrapping ~90 screens by hand would be ninety chances to miss one,
 * ninety diffs to review, and a rule the next new screen would silently opt out
 * of. React Navigation 7 has the correct hook for this: `screenLayout` on a
 * navigator wraps EVERY screen it renders, including ones added later.
 *
 * So both root stacks and both tab navigators pass `screenLayout={smoothScreenLayout}`
 * and the entire app is covered by one line each. A screen that wants more
 * (a hold, a deferred map) nests its own `SmoothScreen`/`SmoothDefer` inside;
 * the nearer provider wins.
 *
 * ── WHY `eager` ─────────────────────────────────────────────────────────────
 * This wrapper provides the smoothness CONTEXT — `settled` and
 * `firstAppearance` — which is what `Entrance` (127 call sites) and `SmoothIn`
 * read. It deliberately does NOT hold content back, for two reasons:
 *
 *   1. A blanket hold would break the morph transitions. `ride/[id]` is a
 *      container-transform target: the card the rider tapped expands into that
 *      screen's real layout, so an empty target would morph into nothing.
 *   2. Most screens are cheap. Holding a settings page for 300 ms to save it
 *      from a cost it does not have is a downgrade, not an optimisation.
 *
 * The expensive part of a screen is almost never the whole screen — it is one
 * map, one long list, one chart. Those wrap themselves in `SmoothDefer`, which
 * works fine under an eager parent because `settled` is already true and the
 * defer runs on its own delay.
 *
 * What every screen DOES get from this, for free:
 *   • entrance animations that wait for the transition instead of racing it;
 *   • entrance animations that do not replay when the rider comes back;
 *   • a `useSettled()` any component can gate expensive work on.
 */
export function smoothScreenLayout({ children }: { children: React.ReactNode }) {
  return <SmoothScreen eager>{children}</SmoothScreen>;
}

export default smoothScreenLayout;
