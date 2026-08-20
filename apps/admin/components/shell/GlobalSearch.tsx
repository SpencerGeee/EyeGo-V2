'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Icon } from '@/components/ui/Icon';

type Result = {
  type: 'rider' | 'driver' | 'trip' | 'booking';
  id: string;
  title: string;
  subtitle: string;
  badge: string | null;
  href: string;
};

const TYPE_LABEL: Record<Result['type'], string> = {
  rider: 'Rider',
  driver: 'Driver',
  trip: 'Trip',
  booking: 'Booking',
};

/**
 * One box that finds anything.
 *
 * Each entity used to be searchable only from its own page, so an agent holding
 * a phone number had to guess whether it belonged to a rider or a driver and
 * check both lists. The API matches on the last nine digits, so "+233 24 100
 * 0001" and "0241000001" find the same person — an agent types what the caller
 * reads out, not what the database happens to store.
 *
 * Ctrl/Cmd+K from anywhere, Escape to leave, arrows and Enter to pick.
 */
export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Lets a slow response for an earlier query lose to a faster later one,
  // instead of overwriting it and showing results for something already retyped.
  const seq = useRef(0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else {
      setQuery('');
      setResults([]);
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    // Debounced: an agent types a whole phone number in well under a second,
    // and a request per keystroke is nine queries to answer one question.
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const body = await res.json();
        if (mine !== seq.current) return;
        setResults(body.results ?? []);
        setActive(0);
      } catch {
        if (mine === seq.current) setResults([]);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [query]);

  const go = useCallback(
    (r: Result) => {
      setOpen(false);
      router.push(r.href);
    },
    [router]
  );

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => setOpen(true)}
        aria-label="Search riders, drivers and trips"
      >
        <Icon name="search" size={14} />
        <span className="hidden sm:inline">Search</span>
        <kbd className="hidden md:inline t-small text-text-dim">⌘K</kbd>
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-24 px-4"
      onClick={() => setOpen(false)}
      role="presentation"
    >
      <div
        className="w-full max-w-xl bg-surface-1 border border-border rounded-lg shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Search"
      >
        <div className="flex items-center gap-2 px-3 border-b border-border">
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent py-3 outline-none t-body"
            placeholder="Name, phone number, trip code or booking id…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, results.length - 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              }
              if (e.key === 'Enter' && results[active]) go(results[active]);
            }}
          />
          {loading ? <span className="t-small text-text-dim">…</span> : null}
        </div>

        <div className="max-h-80 overflow-y-auto">
          {query.trim().length < 2 ? (
            <p className="p-4 t-small text-text-dim">
              Type at least two characters. Phone numbers match however they are written.
            </p>
          ) : results.length === 0 && !loading ? (
            <p className="p-4 t-small text-text-dim">
              Nothing matches “{query.trim()}”.
            </p>
          ) : (
            <ul>
              {results.map((r, i) => (
                <li key={`${r.type}-${r.id}`}>
                  <button
                    type="button"
                    className={`w-full text-left px-3 py-2 flex items-center gap-3 ${
                      i === active ? 'bg-surface-2' : ''
                    }`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(r)}
                  >
                    <span className="t-small text-text-dim w-14 flex-none">{TYPE_LABEL[r.type]}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block t-body truncate">{r.title}</span>
                      {r.subtitle ? (
                        <span className="block t-small text-text-dim truncate">{r.subtitle}</span>
                      ) : null}
                    </span>
                    {r.badge ? <span className="t-small text-text-dim">{r.badge}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
