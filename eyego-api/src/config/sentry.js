'use strict';

// Lightweight Sentry wrapper. Safe to require even when @sentry/node is not
// installed or no DSN is configured — every export becomes a no-op so the rest
// of the app never has to guard its calls.

const env = require('./env');

let Sentry = null;
let enabled = false;

function initSentry(app) {
  if (!env.SENTRY_DSN) return; // no DSN → stay disabled (dev / sandbox)

  try {
    // eslint-disable-next-line global-require
    Sentry = require('@sentry/node');
  } catch (_err) {
    // Package not installed yet — degrade gracefully.
    // eslint-disable-next-line no-console
    console.warn('[sentry] SENTRY_DSN set but @sentry/node is not installed; skipping init');
    return;
  }

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENV || env.NODE_ENV,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    // Don't ship local stack frames / PII we don't control.
    sendDefaultPii: false,
  });

  enabled = true;
  return Sentry;
}

// Attach the Express error handler (Sentry v8 API). No-op if disabled.
function setupExpressErrorHandler(app) {
  if (!enabled || !Sentry) return;
  if (typeof Sentry.setupExpressErrorHandler === 'function') {
    Sentry.setupExpressErrorHandler(app);
  }
}

function captureException(err, context = {}) {
  if (!enabled || !Sentry) return;
  Sentry.captureException(err, (scope) => {
    if (context.tags) scope.setTags(context.tags);
    if (context.user) scope.setUser(context.user);
    if (context.extra) scope.setExtras(context.extra);
    return scope;
  });
}

function isEnabled() {
  return enabled;
}

module.exports = { initSentry, setupExpressErrorHandler, captureException, isEnabled };
