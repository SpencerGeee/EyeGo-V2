'use client';

import { useState, useTransition } from 'react';

import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { setSurge } from '@/lib/actions';

export function SurgeForm() {
  const toast = useToast();
  const [zoneId, setZoneId] = useState('');
  const [multiplier, setMultiplier] = useState(1.5);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const clearing = multiplier <= 1;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!zoneId.trim() || pending) return;

    setError(null);
    startTransition(async () => {
      const result = await setSurge(zoneId.trim(), multiplier);
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
          Zone id
        </label>
        <input
          id="zone"
          className="input mono"
          value={zoneId}
          onChange={(e) => setZoneId(e.target.value)}
          placeholder="e.g. accra-central"
          spellCheck={false}
          autoCapitalize="none"
          required
          aria-describedby="zone-hint"
        />
        <p id="zone-hint" className="hint">
          The zone identifier used by the pricing service. There is no directory
          endpoint, so this must be typed exactly.
        </p>
      </div>

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
        disabled={!zoneId.trim() || pending}
        aria-busy={pending}
      >
        {pending ? <Icon name="refresh" size={15} className="spin" /> : <Icon name="bolt" size={15} />}
        {pending ? 'Applying…' : clearing ? 'Clear surge for this zone' : `Apply ${multiplier.toFixed(1)}x surge`}
      </button>
    </form>
  );
}
