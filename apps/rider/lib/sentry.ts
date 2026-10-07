// Lightweight Sentry wrapper for the rider app.
//
// Safe to import even when @sentry/react-native is not installed or no DSN is
// configured: every export degrades to a no-op. Native crash reporting requires
// a dev-client / production rebuild with the Sentry config plugin, but JS-level
// captureException works in any build once the package is installed.

import AsyncStorage from '@react-native-async-storage/async-storage';

let Sentry: any = null;
let enabled = false;

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

/**
 * The Privacy screen's "Crash reports" switch. It used to be saved and read by
 * nothing — reports went out either way. Now an opt-out stops them here.
 */
export const CRASH_REPORTS_KEY = 'eyego_privacy_analytics';
let optedOut = false;
AsyncStorage.getItem(CRASH_REPORTS_KEY)
  .then((v) => { optedOut = v === 'false'; })
  .catch(() => {});

export function setCrashReporting(on: boolean): void {
  optedOut = !on;
  AsyncStorage.setItem(CRASH_REPORTS_KEY, String(on)).catch(() => {});
}

export function initSentry(): void {
  if (!DSN) return; // no DSN → stay disabled (dev / sandbox)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Sentry = require('@sentry/react-native');
  } catch {
    // Package not installed — degrade gracefully.
    return;
  }
  try {
    Sentry.init({
      dsn: DSN,
      environment: process.env.EXPO_PUBLIC_SENTRY_ENV ?? (__DEV__ ? 'development' : 'production'),
      tracesSampleRate: 0.1,
      enableNativeCrashHandling: true,
      debug: false,
    });
    enabled = true;
  } catch {
    enabled = false;
  }
}

export function captureException(error: unknown, context?: Record<string, any>): void {
  if (!enabled || !Sentry || optedOut) return;
  try {
    Sentry.captureException(error, context ? { extra: context } : undefined);
  } catch {
    // never let telemetry crash the app
  }
}

export function setUser(user: { id?: string } | null): void {
  if (!enabled || !Sentry) return;
  try {
    Sentry.setUser(user);
  } catch {
    /* noop */
  }
}

export function isSentryEnabled(): boolean {
  return enabled;
}
