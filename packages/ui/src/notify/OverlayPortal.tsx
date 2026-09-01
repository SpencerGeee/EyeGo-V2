import React from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';

/**
 * ── THE LAYER THAT IS ACTUALLY ABOVE EVERY SCREEN ───────────────────────────
 *
 * BUGFIX ("the redesigned toast is nice but it only shows on the homepage,
 * which is wrong — it should be app wide so the driver gets the relevant
 * information very quickly and easily"), and the other half of ("when I swipe
 * to accept and it doesn't work, the error is only shown when I go back to the
 * homepage").
 *
 * Both apps already mount their notice surfaces at the ROOT layout, as siblings
 * of the `<Stack>`, and both have a comment above them saying that is what
 * makes them app-wide. On Android it is. On iOS it is not, and the reason is
 * not a z-index:
 *
 *   `presentation: 'modal'` in react-native-screens is a NATIVE modal — UIKit
 *   presents that screen in its own view controller, on top of the one holding
 *   the entire React root view. Anything rendered as a sibling of the Stack is
 *   inside that root view, so it is underneath the presented controller no
 *   matter what `zIndex` or `elevation` it declares. The driver app presents
 *   the dispatch offer, the cancel sheet and add-passenger this way; the rider
 *   app presents seven screens this way.
 *
 * So the toast really was "homepage only" in the sense that mattered: it was
 * visible on the tab screens and invisible on precisely the screens where
 * something is happening. And a `notify()` fired FROM a modal — the failed
 * swipe-to-accept — drew itself into a layer the driver could not see until
 * they dismissed the modal, which is exactly the reported sequence.
 *
 * `FullWindowOverlay` is UIKit's own answer: a sibling UIWindow above the whole
 * application window, including presented view controllers. It is iOS-only and
 * unnecessary elsewhere, so Android and web keep the plain absolute layer they
 * already had.
 *
 * ── RULES FOR ANYTHING PUT INSIDE ───────────────────────────────────────────
 *  - It must be non-interactive by default. A full-window overlay that accepts
 *    touches would eat every tap in the app; children opt in individually and
 *    this container is `box-none`.
 *  - It has no safe-area context of its own on iOS — a window is not a screen —
 *    so children must read insets from a hook, which both hosts already do.
 *  - Nothing that needs to be laid out by the app belongs here. This is for
 *    surfaces that float above everything: notices, toasts, release gates.
 */
export function OverlayPortal({ children }: { children: React.ReactNode }) {
  const { width, height } = useWindowDimensions();

  if (Platform.OS !== 'ios') {
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {children}
      </View>
    );
  }

  // Required lazily: on a platform or a build where react-native-screens has
  // not registered the native component, falling back to the plain layer is
  // strictly better than crashing the root layout of both apps.
  let FullWindowOverlay: React.ComponentType<{ children?: React.ReactNode }> | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    FullWindowOverlay = require('react-native-screens').FullWindowOverlay ?? null;
  } catch {
    FullWindowOverlay = null;
  }

  if (!FullWindowOverlay) {
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {children}
      </View>
    );
  }

  return (
    <FullWindowOverlay>
      {/*
        The overlay window has no intrinsic size, so its content must be given
        one explicitly — an absoluteFill inside it resolves against nothing and
        collapses. Window dimensions rather than screen: this must line up with
        what the app is laid out in, and children position themselves against
        the same numbers.
      */}
      <View style={{ width, height }} pointerEvents="box-none">
        {children}
      </View>
    </FullWindowOverlay>
  );
}

export default OverlayPortal;
