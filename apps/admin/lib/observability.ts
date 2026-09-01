/**
 * ERROR REPORTING FOR THE CONSOLE.
 *
 * ── WHY IT LOOKS LIKE THIS ──────────────────────────────────────────────────
 *
 * The API has had Sentry since the observability pass; the admin console has
 * had nothing, so a console that broke in production broke silently and the
 * first anyone heard of it was an operator saying "the dashboard is down".
 *
 * The obvious answer is `@sentry/nextjs`, and that is what §3b item 11 asked
 * for. It is not what this is, for one concrete reason: `@sentry/nextjs` is a
 * build-time integration — it wraps the Next config, rewrites the webpack
 * build and uploads sourcemaps — so adding it to `package.json` without being
 * able to install it turns `next build` from working into broken. The console
 * not building at all is a worse outcome than the console not reporting.
 *
 * `@sentry/node` is already in the tree and is a plain runtime library. It
 * gives the two things that actually matter — a server-side exception reaching
 * Sentry, tagged with the release — with none of the build coupling. The one
 * thing it does not give is automatic instrumentation of every route, so the
 * call sites are explicit. That is a fair trade for a six-page console.
 *
 * ── THE DSN STAYS ON THE SERVER ─────────────────────────────────────────────
 *
 * Client-side failures are reported by POSTing to `/api/client-error`, which
 * forwards them through here. That is deliberate rather than incidental: the
 * console is an internal, authenticated tool, and shipping a DSN to the browser
 * of anything internal invites someone else's traffic into the project's quota.
 *
 * ── ALWAYS SAFE TO CALL ─────────────────────────────────────────────────────
 *
 * No DSN, or the package missing from the tree, means every export becomes a
 * no-op. Nothing in the console has to guard a call to this file, and a
 * misconfigured deploy loses reporting rather than serving 500s.
 */

type SentryLike = {
  init: (options: Record<string, unknown>) => void;
  captureException: (err: unknown, hint?: Record<string, unknown>) => void;
  captureMessage: (msg: string, hint?: Record<string, unknown>) => void;
};

let sentry: SentryLike | null = null;
let state: 'unstarted' | 'on' | 'off' = 'unstarted';

/**
 * The build this error came from.
 *
 * Without it every issue in Sentry is attributed to "unknown", which makes the
 * one question you ask during an incident — did this start with the last
 * deploy? — unanswerable. Read from whatever the build actually stamped: the
 * container build arg, then Vercel's git SHA, then the package version.
 */
function release(): string | undefined {
  return (
    process.env.SENTRY_RELEASE ||
    process.env.NEXT_PUBLIC_APP_VERSION ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    undefined
  );
}

function ensureStarted(): SentryLike | null {
  if (state !== 'unstarted') return sentry;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    state = 'off';
    return null;
  }

  try {
    // Required lazily so a tree without the package is a degraded console
    // rather than a console that will not boot.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@sentry/node') as SentryLike;
    mod.init({
      dsn,
      environment: process.env.SENTRY_ENV || process.env.NODE_ENV || 'production',
      release: release(),
      // The console shows riders' names, phone numbers and trip histories.
      // None of that belongs in an error report, and Sentry's default PII
      // capture would attach request bodies and headers containing it.
      sendDefaultPii: false,
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
      // `dist` separates two builds that share a release — a hotfix rebuilt
      // from the same commit is a different artefact and its stack frames do
      // not line up with the first one's.
      dist: process.env.SENTRY_DIST || undefined,
      initialScope: { tags: { service: 'admin-console' } },
    });
    sentry = mod;
    state = 'on';
  } catch {
    // eslint-disable-next-line no-console
    console.warn('[observability] SENTRY_DSN is set but @sentry/node is not installed; skipping');
    state = 'off';
  }

  return sentry;
}

export type ErrorContext = {
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
};

/** Report a server-side failure. Never throws, never blocks a render. */
export function captureServerException(err: unknown, context: ErrorContext = {}): void {
  // Always logged, whether or not Sentry is configured. `docker logs` is the
  // fallback that exists on every deploy, including the ones with no DSN.
  // eslint-disable-next-line no-console
  console.error('[console]', context.tags?.where ?? 'error', err);

  const s = ensureStarted();
  if (!s) return;
  try {
    s.captureException(err, {
      tags: { ...context.tags },
      extra: { ...context.extra },
    });
  } catch {
    // A reporter that throws while reporting must not become the incident.
  }
}

/** Whether errors are actually reaching Sentry. Used by the health surface. */
export function observabilityEnabled(): boolean {
  ensureStarted();
  return state === 'on';
}

export { release as observabilityRelease };
