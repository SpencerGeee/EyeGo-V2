'use client';

import { useEffect } from 'react';

import { Icon } from '@/components/ui/Icon';

/**
 * Segment error boundary. Keeps the shell — sidebar, topbar, SOS badge — alive
 * when one page throws, so an operator mid-incident does not lose their way to
 * the rest of the console.
 *
 * The message is shown verbatim. A console that hides the reason behind "Oops,
 * something went wrong" forces whoever is on call to open the server logs, and
 * the reason here is usually something they can act on ("Forbidden", "Cannot
 * reach the EyeGo API at …").
 */
export default function ConsoleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaces in the browser console and in Vercel's client logs.
    console.error('[console] render failed', error);
  }, [error]);

  return (
    <div className="card p-6 max-w-[560px] mx-auto mt-6">
      <div className="flex items-start gap-3">
        <span className="w-8 h-8 rounded-lg bg-danger-soft text-danger grid place-items-center flex-none">
          <Icon name="alert" size={17} />
        </span>
        <div className="min-w-0">
          <h1 className="t-title mb-1">This page could not be rendered</h1>
          <p className="t-body text-text-dim mb-3">
            Nothing was changed by this failure. Data is unaffected — the read that
            builds this page failed.
          </p>
          <p className="t-small mono text-text-faint bg-bg-inset border border-line rounded-md p-2.5 mb-4 break-words">
            {error.message || 'Unknown error'}
            {error.digest ? <span className="block mt-1 opacity-70">digest {error.digest}</span> : null}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary btn-sm" onClick={reset}>
              <Icon name="refresh" size={13} />
              Try again
            </button>
            <a href="/" className="btn btn-secondary btn-sm">
              Back to dashboard
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
