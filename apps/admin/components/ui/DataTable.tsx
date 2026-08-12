'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';

import { Icon } from './Icon';

/**
 * The console's one table.
 *
 * Built rather than pulled in so the accessibility contract is guaranteed
 * everywhere: sortable headers are real buttons carrying aria-sort, the caption
 * describes the table for screen readers, wide content scrolls inside the
 * table's own container (the page body must never scroll sideways), and the
 * empty, error and loading states are part of the component instead of being
 * re-invented per page — which is how a page ends up rendering an empty table
 * when the request actually failed.
 *
 * Sorting is client-side and therefore sorts THE CURRENT PAGE ONLY. That is
 * stated in the UI, because a column sort that silently reorders 20 of 4,000
 * rows looks like a data error.
 */

export type Column<T> = {
  key: string;
  header: string;
  /** Right-align numerics so digits line up. */
  align?: 'left' | 'right';
  render: (row: T) => ReactNode;
  /** Value used for sorting; omit to make the column unsortable. */
  sortValue?: (row: T) => string | number | null | undefined;
  width?: string;
  /** Hide below this breakpoint to keep narrow screens readable. */
  hideBelow?: 'sm' | 'md' | 'lg';
};

type Props<T> = {
  rows: T[] | null;
  columns: Column<T>[];
  rowKey: (row: T) => string;
  /** Makes the whole row a link to a detail page. */
  rowHref?: (row: T) => string;
  caption: string;
  loading?: boolean;
  error?: string | null;
  empty?: ReactNode;
  /** Rendered at the far right of each row; not part of the row link. */
  rowActions?: (row: T) => ReactNode;
  /** Highlights rows needing attention, e.g. an unresolved SOS. */
  rowTone?: (row: T) => 'danger' | 'warn' | null;
};

const HIDE_CLASS: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
};

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  rowHref,
  caption,
  loading,
  error,
  empty,
  rowActions,
  rowTone,
}: Props<T>) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);

  const sorted = useMemo(() => {
    if (!rows) return null;
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;

    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      // Missing values sort last in both directions — they are absent, not small.
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * factor;
      return String(av).localeCompare(String(bv), 'en') * factor;
    });
  }, [rows, sort, columns]);

  const toggle = (key: string) => {
    setSort((s) =>
      s?.key === key ? (s.dir === 'asc' ? { key, dir: 'desc' } : null) : { key, dir: 'asc' }
    );
  };

  if (error) {
    return (
      <div role="alert" className="flex flex-col items-center text-center px-6 py-12 gap-3">
        <div className="w-10 h-10 rounded-full bg-danger-soft text-danger grid place-items-center">
          <Icon name="alert" size={19} />
        </div>
        <div>
          <div className="t-heading text-danger">Could not load this table</div>
          <p className="t-small text-text-dim mt-1 max-w-[52ch]">{error}</p>
          <p className="t-small text-text-faint mt-2">
            This is an error, not an empty result. No rows were returned at all.
          </p>
        </div>
      </div>
    );
  }

  if (loading || rows === null) {
    return (
      <div className="p-4 space-y-2.5" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading {caption}…</span>
        {Array.from({ length: 8 }).map((_, r) => (
          <div key={r} className="flex gap-3">
            {columns.map((c, i) => (
              <div
                key={c.key}
                className={`skeleton h-4 ${i === 0 ? 'w-[22%]' : 'flex-1'}`}
                aria-hidden="true"
              />
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (sorted && sorted.length === 0) {
    return <>{empty ?? <p className="t-small text-text-faint px-4 py-10 text-center">Nothing here.</p>}</>;
  }

  return (
    <>
      <div className="table-scroll">
        <table className="table">
          <caption className="sr-only">
            {caption}
            {sort ? `, sorted by ${sort.key} ${sort.dir}ending, current page only` : ''}
          </caption>
          <thead>
            <tr>
              {columns.map((col) => {
                const active = sort?.key === col.key;
                const ariaSort = active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none';
                return (
                  <th
                    key={col.key}
                    scope="col"
                    style={col.width ? { width: col.width } : undefined}
                    className={`${col.align === 'right' ? 'text-right' : ''} ${
                      col.hideBelow ? HIDE_CLASS[col.hideBelow] : ''
                    }`}
                    aria-sort={col.sortValue ? (ariaSort as 'ascending' | 'descending' | 'none') : undefined}
                  >
                    {col.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggle(col.key)}
                        className={`th-sortable inline-flex items-center gap-1 ${
                          col.align === 'right' ? 'flex-row-reverse' : ''
                        } ${active ? 'text-text-dim' : ''}`}
                      >
                        {col.header}
                        <Icon
                          name={active ? (sort!.dir === 'asc' ? 'arrow-up' : 'arrow-down') : 'chevron-down'}
                          size={11}
                          className={active ? 'text-accent' : 'opacity-35'}
                        />
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
              {rowActions ? (
                <th scope="col" className="text-right" style={{ width: '1%' }}>
                  <span className="sr-only">Actions</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {(sorted ?? []).map((row) => {
              const tone = rowTone?.(row);
              const href = rowHref?.(row);
              return (
                <tr
                  key={rowKey(row)}
                  className={
                    tone === 'danger'
                      ? 'bg-danger-soft/40'
                      : tone === 'warn'
                        ? 'bg-warn-soft/30'
                        : undefined
                  }
                >
                  {columns.map((col, i) => (
                    <td
                      key={col.key}
                      className={`${col.align === 'right' ? 'num' : ''} ${
                        col.hideBelow ? HIDE_CLASS[col.hideBelow] : ''
                      }`}
                    >
                      {/* The link lives on the first cell's content rather than
                          wrapping the row: a nested <a> inside <tr> is invalid,
                          and making every cell a link would flood the tab order. */}
                      {i === 0 && href ? (
                        <Link
                          href={href}
                          className="inline-flex items-center gap-2 hover:text-accent transition-colors"
                        >
                          {col.render(row)}
                        </Link>
                      ) : (
                        col.render(row)
                      )}
                    </td>
                  ))}
                  {rowActions ? (
                    <td className="text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5 justify-end">
                        {rowActions(row)}
                      </div>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {sort ? (
        <p className="t-small text-text-faint px-4 py-2 border-t border-line">
          Sorted within this page only. Use the filters to narrow the full set.
        </p>
      ) : null}
    </>
  );
}
