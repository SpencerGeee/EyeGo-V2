'use client';

import { useSearchParams } from 'next/navigation';

import { Icon } from './Icon';

/**
 * "Export CSV", next to a filtered table.
 *
 * It is an anchor, not a button with a fetch behind it, because a download has
 * to be a real navigation for the browser to save the file. The href points at
 * this app's own proxy route, which attaches the admin token server-side — the
 * browser never holds a credential.
 *
 * THE FILTERS COME ALONG. Whatever narrowed the table on screen is copied into
 * the export URL, so the button means "give me what I am looking at". An export
 * that ignored the filters would hand somebody 40,000 rows when they wanted
 * twelve, and they would not notice until they opened it.
 */
export function ExportButton({
  dataset,
  label = 'Export CSV',
  /** Extra filters the page knows about but that are not in the URL. */
  extraParams,
  /** URL params to leave behind — paging has no meaning in an export. */
  omit = ['page', 'limit'],
}: {
  dataset: string;
  label?: string;
  extraParams?: Record<string, string | undefined>;
  omit?: string[];
}) {
  const searchParams = useSearchParams();

  const params = new URLSearchParams();
  searchParams.forEach((value, key) => {
    if (!omit.includes(key) && value) params.set(key, value);
  });
  for (const [key, value] of Object.entries(extraParams ?? {})) {
    if (value) params.set(key, value);
  }

  const qs = params.toString();
  const filtered = params.size > 0;

  return (
    <a
      href={`/api/export/${dataset}${qs ? `?${qs}` : ''}`}
      className="btn btn-ghost btn-sm"
      // Not download="" — the filename comes from the server's
      // Content-Disposition, which already dates and names the file.
      title={
        filtered
          ? 'Downloads exactly the rows this page is showing, with the current filters applied'
          : 'Downloads every row, up to the 50,000 cap'
      }
    >
      <Icon name="download" size={14} />
      {label}
      {filtered ? <span className="t-small text-text-dim">(filtered)</span> : null}
    </a>
  );
}
