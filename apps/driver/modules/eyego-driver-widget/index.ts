import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

/**
 * The driver's Android home-screen widget.
 *
 * ── WHY EVERY CALL IS GUARDED ───────────────────────────────────────────────
 *
 * Same shape as `apps/rider/modules/eyego-live-activity`, and for the same
 * reason: `requireNativeModule` THROWS when the native side is not linked, and
 * that is a completely ordinary state — Expo Go, an iOS build, or a JS-only OTA
 * update landing on a binary built before this module existed. A widget helper
 * must never be the reason the driver app fails to start, so the module is
 * resolved lazily, cached, and every export is a no-op when it is absent.
 */
let nativeModule: any = null;
function getNativeModule() {
  if (Platform.OS !== 'android') return null;
  if (nativeModule) return nativeModule;
  try {
    nativeModule = requireNativeModule('EyeGoDriverWidgetModule');
  } catch {
    nativeModule = null;
  }
  return nativeModule;
}

export interface DriverWidgetData {
  /**
   * PRE-FORMATTED money, e.g. "GH₵82.50".
   *
   * The widget renders this string verbatim. Formatting stays in JS
   * (`formatGhs`) because this product has already had a class of bug where a
   * money value was rendered in cedis by one surface and pesewas by another —
   * a second formatter in Kotlin is how that happens again.
   */
  earningsLabel: string;
  /** e.g. "6 trips · 4h 20m online" */
  tripsLabel: string;
  /** e.g. "Quest 2/3 · GH₵15 bonus", or '' to hide the line. */
  questLabel: string;
  online: boolean;
}

/** Store what the widget shows and redraw it. No-op where unsupported. */
export function setDriverWidgetData(data: DriverWidgetData): void {
  const m = getNativeModule();
  if (!m) return;
  try {
    m.setData(
      data.earningsLabel ?? '—',
      data.tripsLabel ?? '',
      data.questLabel ?? '',
      Boolean(data.online),
    );
  } catch {
    // The widget is a convenience. It must never surface an error into a
    // screen the driver is trying to work from.
  }
}

/**
 * Wipe the widget. Call on sign-out.
 *
 * A widget still showing yesterday's earnings for a signed-out driver is a
 * small privacy leak on a shared phone and a lie about a session that ended.
 */
export function clearDriverWidget(): void {
  const m = getNativeModule();
  if (!m) return;
  try {
    m.clear();
  } catch {
    /* see above */
  }
}

/** Is a widget actually on a home screen? Used to skip pointless writes. */
export function isDriverWidgetPlaced(): boolean {
  const m = getNativeModule();
  if (!m) return false;
  try {
    return Boolean(m.isPlaced());
  } catch {
    return false;
  }
}

/**
 * Ask the launcher to pin the widget.
 *
 * Returns false when the launcher refuses or is too old (pre-Android 8), so the
 * caller can tell the driver to add it by hand instead of leaving a button that
 * appears to do nothing.
 */
export function requestPinDriverWidget(): boolean {
  const m = getNativeModule();
  if (!m) return false;
  try {
    return Boolean(m.requestPin());
  } catch {
    return false;
  }
}

/** True when this build can host the widget at all. */
export const driverWidgetSupported = (): boolean => getNativeModule() != null;
