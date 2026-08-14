'use client';

import { useMemo, useState, useTransition } from 'react';

import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { setSurge } from '@/lib/actions';

export interface SurgeZone {
  zoneId: string;
  label: string | null;
  lat: number | null;
  lng: number | null;
  supplyCount: number;
  demandCount: number;
  autoMultiplier: number;
  manualMultiplier: number | null;
  manualExpiresInSeconds: number | null;
  effectiveMultiplier: number;
  recentTrips: number;
}

const GLOBAL = 'global';
/** Sentinel for "I know an id the directory has not seen yet". */
const CUSTOM = '__custom__';

function zoneName(z: SurgeZone): string {
  if (z.label) return `${z.label} (${z.zoneId})`;
  return z.zoneId;
}

/**
 * The picker the page used to apologise for not having.
 *
 * The free-text field survives as an explicit choice rather than as the only
 * option: a zone id is `{lat}:{lng}` at 2dp, so a cell that has not seen traffic
 * yet is a legitimate target that no directory can list. Choosing "Another zone
 * id" is now a deliberate act, and the hint tells you the exact shape — which is
 * the part that was actually missing. Typing `accra-central`, the old
 * placeholder, produced a key the fare path never reads.
 */
export function SurgeForm({
  zones,
  globalMultiplier,
  directoryAvailable,
}: {
  zones: SurgeZone[];
  globalMultiplier: number | null;
  directoryAvailable: boolean;
}) {
  const toast = useToast();
  const [selection, setSelection] = useState<string>(zones[0]?.zoneId ?? GLOBAL);
  const [customId, setCustomId] = useState('');
  const [multiplier, setMultiplier] = useState(1.5);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const zoneId = selection === CUSTOM ? customId.trim() : selection;
  const clearing = multiplier <= 1;

  const selected = useMemo(
    () => zones.find((z) => z.zoneId === zoneId) ?? null,
    [zones, zoneId],
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!zoneId || pending) return;

    setError(null);
    startTransition(async () => {
      const result = await setSurge(zoneId, multiplier);
      if (result.ok) {
        toast.success(result.message);
      } else {
        setError(result.message);
      }
    });
  };

  return (
    <form onSubmit={submit} noValidate>
      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2 p-3 mb-4 rounded-md bg-danger-soft border border-danger-rim"
        >
          <Icon name="alert" size={14} className="text-danger mt-0.5" />
          <p className="t-small text-danger">{error}</p>
        </div>
      ) : null}

      <div className="mb-4">
        <label className="label" htmlFor="zone">
          Zone
        </label>
        <select
          id="zone"
          className="input"
          value={selection}
          onChange={(e) => setSelection(e.target.value)}
          aria-describedby="zone-hint"
        >
          <option value={GLOBAL}>
            Every zone (platform-wide floor)
            {globalMultiplier != null ? ` — currently ${globalMultiplier.toFixed(1)}x` : ''}
          </option>
          {zones.map((z) => (
            <option key={z.zoneId} value={z.zoneId}>
              {zoneName(z)} — {z.effectiveMultiplier.toFixed(2)}x, {z.supplyCount} drivers,{' '}
              {z.demandCount} requests
            </option>
          ))}
          <option value={CUSTOM}>Another zone id…</option>
        </select>
        <p id="zone-hint" className="hint">
          {directoryAvailable
            ? 'Listed from the pricing service itself, so every id here is one the fare path actually reads.'
            : 'The directory could not be loaded — pick “Another zone id” and enter it manually.'}
        </p>
      </div>

      {selection === CUSTOM ? (
        <div className="mb-4">
          <label className="label" htmlFor="custom-zone">
            Zone id
          </label>
          <input
            id="custom-zone"
            className="input mono"
            value={customId}
            onChange={(e) => setCustomId(e.target.value)}
            placeholder="5.56:-0.18"
            spellCheck={false}
            autoCapitalize="none"
            required
            aria-describedby="custom-zone-hint"
          />
          <p id="custom-zone-hint" className="hint">
            Latitude and longitude rounded to 2 decimal places, separated by a colon — a ~1.1 km
            cell. Anything else is stored but never read when a fare is priced.
          </p>
        </div>
      ) : null}

      {selected ? (
        <div className="mb-4 p-3 rounded-md bg-surface-2 border border-rim">
          <p className="t-small text-text-dim">
            Right now this zone charges{' '}
            <strong className="text-text num">{selected.effectiveMultiplier.toFixed(2)}x</strong> —
            automatic surge is <span className="num">{selected.autoMultiplier.toFixed(2)}x</span>
            {selected.manualMultiplier != null ? (
              <>
                {' '}
                and an override of{' '}
                <span className="num">{selected.manualMultiplier.toFixed(1)}x</span> is in force
                {selected.manualExpiresInSeconds != null
                  ? ` for another ${Math.ceil(selected.manualExpiresInSeconds / 60)} min`
                  : ''}
              </>
            ) : (
              ' and there is no override'
            )}
            .
          </p>
        </div>
      ) : null}

      <div className="mb-5">
        <label className="label" htmlFor="multiplier">
          Multiplier
        </label>
        <div className="flex items-center gap-3">
          <input
            id="multiplier"
            type="range"
            min="1"
            max="3"
            step="0.1"
            value={multiplier}
            onChange={(e) => setMultiplier(Number(e.target.value))}
            className="flex-1 accent-[var(--accent)]"
            aria-describedby="multiplier-hint"
          />
          <output
            htmlFor="multiplier"
            className={`t-metric !text-[20px] num w-[72px] text-right ${
              multiplier >= 2.5 ? 'text-danger' : multiplier >= 1.8 ? 'text-warn' : 'text-text'
            }`}
          >
            {multiplier.toFixed(1)}x
          </output>
        </div>
        <p id="multiplier-hint" className="hint">
          {clearing
            ? 'At 1.0 the override is cleared and the zone returns to normal pricing.'
            : `A ₵20 fare becomes ₵${(20 * multiplier).toFixed(2)}. Expires automatically after one hour.`}
        </p>
      </div>

      <button
        type="submit"
        className={`btn btn-lg ${clearing ? 'btn-secondary' : 'btn-primary'}`}
        disabled={!zoneId || pending}
        aria-busy={pending}
      >
        {pending ? <Icon name="refresh" size={15} className="spin" /> : <Icon name="bolt" size={15} />}
        {pending
          ? 'Applying…'
          : clearing
            ? 'Clear surge for this zone'
            : `Apply ${multiplier.toFixed(1)}x surge`}
      </button>
    </form>
  );
}
