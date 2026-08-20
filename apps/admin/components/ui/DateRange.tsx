'use client';

import { useSearchParams } from 'next/navigation';

import { useParamWriter } from './Filters';
import { Icon } from './Icon';

/**
 * A window to look at.
 *
 * The analytics and revenue pages had hard-coded windows — today, 7 days, 30
 * days, and a 14-day chart — so "how did last month compare" was a question the
 * console simply could not be asked, and anyone needing it exported nothing
 * (there was no export either) and guessed.
 *
 * Presets carry the common cases; the two date inputs handle the rest. The
 * range lands in the URL, which makes it shareable and bookmarkable — "the view
 * I am looking at" is a link, and that is the cheapest form of a saved view.
 */

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const PRESETS = [
  { label: '7 days', from: () => isoDaysAgo(6) },
  { label: '30 days', from: () => isoDaysAgo(29) },
  { label: '90 days', from: () => isoDaysAgo(89) },
];

export function DateRange() {
  const params = useSearchParams();
  const write = useParamWriter();

  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const active = Boolean(from || to);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="label mb-0">Period</span>

      {PRESETS.map((p) => {
        const presetFrom = p.from();
        const selected = from === presetFrom && !to;
        return (
          <button
            key={p.label}
            type="button"
            className={`btn btn-sm ${selected ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => write({ from: presetFrom, to: null, page: null })}
          >
            {p.label}
          </button>
        );
      })}

      <label className="sr-only" htmlFor="range-from">
        From
      </label>
      <input
        id="range-from"
        type="date"
        className="input input-sm w-auto"
        value={from}
        max={to || today}
        onChange={(e) => write({ from: e.target.value || null, page: null })}
      />
      <span className="t-small text-text-dim" aria-hidden="true">
        to
      </span>
      <label className="sr-only" htmlFor="range-to">
        To
      </label>
      <input
        id="range-to"
        type="date"
        className="input input-sm w-auto"
        value={to}
        min={from || undefined}
        max={today}
        onChange={(e) => write({ to: e.target.value || null, page: null })}
      />

      {active ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => write({ from: null, to: null, page: null })}
        >
          <Icon name="x" size={13} />
          Clear
        </button>
      ) : (
        <span className="t-small text-text-faint">last 14 days</span>
      )}
    </div>
  );
}
