// Lightweight Sentry wrapper for the driver app.
//
// Safe to import even when @sentry/react-native is not installed or no DSN is
// configured: every export degrades to a no-op. Native crash reporting requires
// a dev-client / production rebuild with the Sentry config plugin, but JS-level
// captureException works in any build once the package is installed.

let Sentry: any = null;
let enabled = false;

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

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
  if (!enabled || !Sentry) return;
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
