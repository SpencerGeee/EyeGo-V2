'use client';

/**
 * Last-resort boundary: only reached when the root layout itself throws, which
 * means no shell, no theme script and no globals.css. It therefore carries its
 * own inline styling rather than relying on tokens that may not have loaded, and
 * must render <html>/<body> itself.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          background: '#0a0c0f',
          color: '#e9eef5',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 460 }}>
          <h1 style={{ fontSize: 17, margin: '0 0 8px' }}>The console failed to start</h1>
          <p style={{ fontSize: 13.5, lineHeight: 1.55, color: '#9aa7b6', margin: '0 0 14px' }}>
            This is a failure in the console itself, not in the EyeGo API. Rider and
            driver apps are unaffected.
          </p>
          <pre
            style={{
              fontSize: 12,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              background: '#111419',
              border: '1px solid #222831',
              borderRadius: 8,
              padding: 10,
              color: '#9aa7b6',
            }}
          >
            {error.message || 'Unknown error'}
            {error.digest ? `\ndigest ${error.digest}` : ''}
          </pre>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 14,
              padding: '8px 14px',
              borderRadius: 8,
              border: 0,
              background: '#2fd46b',
              color: '#06210f',
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Reload the console
          </button>
        </div>
      </body>
    </html>
  );
}
