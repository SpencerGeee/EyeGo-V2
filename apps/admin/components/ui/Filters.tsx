'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

import { Icon } from './Icon';

/**
 * Filters and paging live in the URL, not in component state.
 *
 * That is what makes a filtered view shareable ("look at this driver's cancelled
 * trips"), survivable across a refresh, and correct with the browser Back button
 * — all three of which a console gets asked for immediately and none of which
 * local state provides.
 */

/** Exported so DateRange writes filters through the same page-resetting path. */
export function useParamWriter() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '') next.delete(key);
        else next.set(key, value);
      }
      // Any filter change invalidates the current page number — staying on
      // page 7 of a newly-narrowed result set shows an empty table.
      if (!('page' in updates)) next.delete('page');
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [params, pathname, router]
  );
}

export function SearchBox({
  paramKey = 'q',
  placeholder = 'Search…',
  label,
}: {
  paramKey?: string;
  placeholder?: string;
  label?: string;
}) {
  const params = useSearchParams();
  const write = useParamWriter();
  const [value, setValue] = useState(params.get(paramKey) ?? '');
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keeps the box in step when the URL changes from elsewhere (Back, a reset
  // button) without fighting the user's typing.
  useEffect(() => {
    setValue(params.get(paramKey) ?? '');
  }, [params, paramKey]);

  const onChange = (next: string) => {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    // Debounced so a five-character query is one navigation, not five.
    timer.current = setTimeout(() => {
      startTransition(() => write({ [paramKey]: next || null }));
    }, 300);
  };

  return (
    <div className="relative flex-1 min-w-[190px] max-w-[340px]">
      <label htmlFor={`search-${paramKey}`} className="sr-only">
        {label || placeholder}
      </label>
      <Icon
        name={pending ? 'refresh' : 'search'}
        size={14}
        className={`absolute left-3 top-1/2 -translate-y-1/2 text-text-faint ${pending ? 'spin' : ''}`}
      />
      <input
        id={`search-${paramKey}`}
        type="search"
        className="input !pl-9"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function FilterSelect({
  paramKey,
  label,
  options,
  allLabel = 'All',
}: {
  paramKey: string;
  label: string;
  options: { value: string; label: string }[];
  allLabel?: string;
}) {
  const params = useSearchParams();
  const write = useParamWriter();
  const current = params.get(paramKey) ?? '';

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={`filter-${paramKey}`} className="t-small text-text-faint whitespace-nowrap">
        {label}
      </label>
      <select
        id={`filter-${paramKey}`}
        className="select !w-auto min-w-[132px]"
        value={current}
        onChange={(e) => write({ [paramKey]: e.target.value || null })}
      >
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ResetFilters({ keys }: { keys: string[] }) {
  const params = useSearchParams();
  const write = useParamWriter();
  const active = keys.some((k) => params.get(k));

  if (!active) return null;

  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={() => write(Object.fromEntries(keys.map((k) => [k, null])))}
    >
      <Icon name="x" size={12} />
      Clear filters
    </button>
  );
}

/**
 * Server-side paging. Shows the real total so an operator knows whether they are
 * looking at everything — the old console silently truncated at 500 rows with
 * nothing on screen admitting it.
 */
export function Pagination({
  total,
  page,
  limit,
}: {
  total: number;
  page: number;
  limit: number;
}) {
  const write = useParamWriter();
  const pages = Math.max(1, Math.ceil(total / limit));
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <nav
      className="flex items-center justify-between gap-3 px-4 py-3 border-t border-line"
      aria-label="Pagination"
    >
      <p className="t-small text-text-faint num">
        {total === 0 ? 'No results' : `${from}–${to} of ${total.toLocaleString('en-GH')}`}
      </p>
      <div className="flex items-center gap-1.5">
        <select
          className="select !w-auto !h-7 !text-xs mr-1"
          value={String(limit)}
          onChange={(e) => write({ limit: e.target.value, page: '1' })}
          aria-label="Rows per page"
        >
          {[20, 50, 100].map((n) => (
            <option key={n} value={n}>
              {n} / page
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-secondary btn-sm btn-icon"
          disabled={page <= 1}
          aria-label="Previous page"
          onClick={() => write({ page: String(page - 1) })}
        >
          <Icon name="chevron-left" size={14} />
        </button>
        <span className="t-small text-text-dim num tabular-nums px-1">
          {page} / {pages}
        </span>
        <button
          type="button"
          className="btn btn-secondary btn-sm btn-icon"
          disabled={page >= pages}
          aria-label="Next page"
          onClick={() => write({ page: String(page + 1) })}
        >
          <Icon name="chevron-right" size={14} />
        </button>
      </div>
    </nav>
  );
}

/**
 * Manual refresh plus an optional live poll for the pages where staleness is
 * dangerous (dispatch, SOS). The interval is opt-in and visible, never a hidden
 * background poll — an operator has to be able to tell how old what they are
 * looking at is.
 */
export function RefreshControl({
  intervalSeconds,
  label = 'Refresh',
}: {
  intervalSeconds?: number;
  label?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [live, setLive] = useState(!!intervalSeconds);
  const [lastAt, setLastAt] = useState<Date | null>(null);

  const refresh = useCallback(() => {
    startTransition(() => {
      router.refresh();
      setLastAt(new Date());
    });
  }, [router]);

  useEffect(() => {
    if (!live || !intervalSeconds) return;
    const id = setInterval(refresh, intervalSeconds * 1000);
    return () => clearInterval(id);
  }, [live, intervalSeconds, refresh]);

  return (
    <div className="flex items-center gap-2">
      {lastAt ? (
        <span className="t-small text-text-faint num" title={lastAt.toISOString()}>
          {lastAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
      ) : null}
      {intervalSeconds ? (
        <button
          type="button"
          className={`btn btn-sm ${live ? 'btn-secondary' : 'btn-ghost'}`}
          onClick={() => setLive((v) => !v)}
          aria-pressed={live}
        >
          <span className={`dot ${live ? 'dot-live text-accent' : 'text-text-faint'}`} />
          {live ? `Live · ${intervalSeconds}s` : 'Paused'}
        </button>
      ) : null}
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={refresh}
        disabled={pending}
        aria-busy={pending}
      >
        <Icon name="refresh" size={13} className={pending ? 'spin' : ''} />
        {label}
      </button>
    </div>
  );
}
