/**
 * Send a browser-side failure to the server, which forwards it to Sentry.
 *
 * Deliberately `keepalive`: an error boundary is often the last thing that
 * renders before someone reloads, and a plain fetch is cancelled on navigation
 * — losing exactly the reports that matter most.
 *
 * Every failure path is swallowed. This runs inside an error boundary; a
 * reporter that throws would replace a page the operator can read with one they
 * cannot.
 */
export function reportClientError(
  error: Error & { digest?: string },
  boundary: 'global' | 'segment',
): void {
  try {
    void fetch('/api/client-error', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        message: error?.message ?? String(error),
        stack: error?.stack,
        digest: error?.digest,
        boundary,
        path: typeof window !== 'undefined' ? window.location.pathname : undefined,
      }),
    }).catch(() => {});
  } catch {
    // No network, no fetch, no problem — the boundary still renders.
  }
}
