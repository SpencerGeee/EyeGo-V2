/**
 * TWO SWITCHES, THROWN ONCE AT BOOT.
 *
 * Both apps shipped without either of them, which is why every screen either
 * app had ever opened kept re-rendering forever.
 *
 * ── enableFreeze ────────────────────────────────────────────────────────────
 * `react-native-screens` can suspend the React subtree of any screen that is
 * not on top. Without it, a driver sitting on the tracking screen is ALSO
 * re-rendering the manage screen underneath it, and the home screen under that,
 * on every location fix — three trees' worth of work for one visible screen.
 * Freezing keeps their state and their native views; it only stops React
 * committing to them. This is the single biggest frame-cost win available in
 * these two apps and it is one line.
 *
 * ── enableScreens ───────────────────────────────────────────────────────────
 * On by default in recent versions, but stated explicitly: it is what makes
 * off-screen screens genuinely detached at the native level instead of merely
 * hidden. Being explicit also documents that we WANT native screen recycling,
 * so nobody turns it off chasing an unrelated bug.
 *
 * Call from the root layout, at module scope, before anything renders.
 */

export function enableSmoothNavigation(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const screens = require('react-native-screens');
    screens.enableScreens?.(true);
    screens.enableFreeze?.(true);
  } catch {
    // A build without react-native-screens still runs, just without recycling.
  }
}
