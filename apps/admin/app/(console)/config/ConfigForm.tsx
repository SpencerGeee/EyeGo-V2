'use client';

import { useMemo, useState } from 'react';

import { Icon } from '@/components/ui/Icon';
import { Badge, ReadOnlyNote } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { updatePlatformSettings } from '@/lib/actions';
import { ghs } from '@/lib/format';

export type SettingType = 'money' | 'ratio' | 'int' | 'decimal' | 'boolean' | 'text' | 'enum';

export type Setting = {
  key: string;
  label: string;
  help: string | null;
  type: SettingType;
  unit: string | null;
  options: string[] | null;
  min: number | null;
  max: number | null;
  maxLength: number | null;
  value: number | string | boolean | null;
  defaultValue: number | string | boolean | null;
  source: 'override' | 'default';
  updatedAt: string | null;
  updatedByEmail: string | null;
};

export type SettingGroup = { id: string; label: string; help?: string; settings: Setting[] };

/**
 * ── HOW A VALUE IS DISPLAYED VS HOW IT IS STORED ─────────────────────────────
 * Money is stored in integer pesewas and typed in cedis. A ratio is stored as
 * 0.15 and typed as 15 (percent). Everything else is stored as typed.
 *
 * The conversion happens HERE and nowhere else, which is the same rule the rest
 * of the console follows for money: one boundary, at the edge, so no intermediate
 * value is ever off by a factor of a hundred.
 */
function toInput(s: Setting): string {
  if (s.value === null || s.value === undefined) return '';
  if (s.type === 'money') return (Number(s.value) / 100).toFixed(2);
  if (s.type === 'ratio') return String(Math.round(Number(s.value) * 10000) / 100);
  return String(s.value);
}

function fromInput(s: Setting, raw: string): number | string | boolean {
  if (s.type === 'money') return Math.round(Number(raw) * 100);
  if (s.type === 'ratio') return Number(raw) / 100;
  if (s.type === 'int') return Math.round(Number(raw));
  if (s.type === 'decimal') return Number(raw);
  return raw;
}

/** What the operator sees next to the field, in the unit they think in. */
function formatCurrent(s: Setting): string {
  if (s.value === null || s.value === undefined || s.value === '') return 'not set';
  if (s.type === 'money') return ghs(Number(s.value));
  if (s.type === 'ratio') return `${(Number(s.value) * 100).toFixed(1)}%`;
  if (s.type === 'boolean') return s.value ? 'on' : 'off';
  return `${s.value}${s.unit ? ` ${s.unit}` : ''}`;
}

function inputSuffix(s: Setting): string | null {
  if (s.type === 'money') return 'GH₵';
  if (s.type === 'ratio') return '%';
  return s.unit;
}

export function ConfigForm({
  groups,
  canEdit,
  readOnlyReason,
}: {
  groups: SettingGroup[];
  canEdit: boolean;
  readOnlyReason: string;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const all = useMemo(() => groups.flatMap((g) => g.settings), [groups]);
  const byKey = useMemo(() => new Map(all.map((s) => [s.key, s])), [all]);

  // A field counts as dirty only when it differs from what is stored, so
  // clicking into a box and out again does not arm the Save button.
  const dirty = Object.entries(draft).filter(([key, v]) => {
    const s = byKey.get(key);
    if (!s) return false;
    if (s.type === 'boolean') return Boolean(v) !== Boolean(s.value);
    return String(v) !== toInput(s);
  });

  const save = async () => {
    setError(null);
    setBusy(true);
    const payload: Record<string, number | string | boolean | null> = {};
    for (const [key, v] of dirty) {
      const s = byKey.get(key)!;
      payload[key] = s.type === 'boolean' ? Boolean(v) : fromInput(s, String(v));
    }
    const result = await updatePlatformSettings(payload);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    toast.success(result.message);
    setDraft({});
  };

  const reset = async (key: string) => {
    setBusy(true);
    // null is the reset signal: the server deletes the override row, which
    // restores the env default.
    const result = await updatePlatformSettings({ [key]: null });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    toast.success('Reset to the platform default');
    setDraft((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });
  };

  return (
    <>
      {error ? (
        <div role="alert" className="flex items-start gap-2 p-3 mb-4 rounded-lg bg-danger-soft border border-danger-rim">
          <Icon name="alert" size={14} className="text-danger mt-0.5" />
          <p className="t-small text-danger">{error}</p>
        </div>
      ) : null}

      {/* Sticky save bar. A pricing page where the operator has to hunt for the
          button is a page where half-finished edits get abandoned. */}
      {canEdit ? (
        <div
          className={`sticky top-[calc(var(--topbar-h)+8px)] z-30 mb-4 flex items-center gap-3 px-4 py-3 rounded-lg glass ${
            dirty.length ? 'card-glow' : ''
          }`}
        >
          <span className="t-small flex-1">
            {dirty.length === 0 ? (
              <span className="text-text-dim">No unsaved changes.</span>
            ) : (
              <span>
                <strong>{dirty.length}</strong> unsaved change{dirty.length === 1 ? '' : 's'} —{' '}
                <span className="text-text-dim">
                  {dirty.map(([k]) => byKey.get(k)?.label).join(', ')}
                </span>
              </span>
            )}
          </span>
          {dirty.length > 0 ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft({})} disabled={busy}>
              Discard
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={save}
            disabled={busy || dirty.length === 0}
            aria-busy={busy}
          >
            {busy ? <Icon name="refresh" size={13} className="spin" /> : <Icon name="check" size={13} />}
            Apply now
          </button>
        </div>
      ) : (
        <div className="card p-3 mb-4">
          <ReadOnlyNote>{readOnlyReason}</ReadOnlyNote>
        </div>
      )}

      <div className="space-y-4">
        {groups.map((group) => (
          <section key={group.id} className="card-flush">
            <div className="card-head">
              <div>
                <div className="t-heading">{group.label}</div>
                {group.help ? <div className="t-small text-text-dim mt-0.5">{group.help}</div> : null}
              </div>
              <span className="t-small text-text-dim num">
                {group.settings.filter((s) => s.source === 'override').length} of {group.settings.length} customised
              </span>
            </div>

            <div className="divide-y divide-line">
              {group.settings.map((s) => {
                const current = draft[s.key];
                const value = current === undefined ? toInput(s) : current;
                const changed = dirty.some(([k]) => k === s.key);

                return (
                  <div key={s.key} className="p-4 grid gap-3 md:grid-cols-[1fr_260px] md:items-start">
                    <div className="min-w-0">
                      <label className="label !mb-1" htmlFor={`set-${s.key}`}>
                        {s.label}
                        {s.source === 'override' ? (
                          <span className="ml-2 align-middle">
                            <Badge tone="accent">Customised</Badge>
                          </span>
                        ) : null}
                        {changed ? (
                          <span className="ml-2 align-middle">
                            <Badge tone="warn">Unsaved</Badge>
                          </span>
                        ) : null}
                      </label>
                      {s.help ? <p className="t-small text-text-dim max-w-[80ch]">{s.help}</p> : null}
                      <p className="t-small text-text-faint mt-1">
                        <span className="mono">{s.key}</span>
                        {' · live value '}
                        <strong className="text-text-dim">{formatCurrent(s)}</strong>
                        {s.source === 'override' && s.updatedByEmail ? (
                          <> · set by {s.updatedByEmail}</>
                        ) : null}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {s.type === 'boolean' ? (
                        <button
                          type="button"
                          role="switch"
                          aria-checked={Boolean(value)}
                          disabled={!canEdit || busy}
                          onClick={() => setDraft((d) => ({ ...d, [s.key]: !Boolean(value) }))}
                          className={`btn btn-sm ${Boolean(value) ? 'btn-primary' : 'btn-secondary'}`}
                        >
                          <Icon name={Boolean(value) ? 'check' : 'x'} size={13} />
                          {Boolean(value) ? 'On' : 'Off'}
                        </button>
                      ) : s.type === 'enum' ? (
                        <select
                          id={`set-${s.key}`}
                          className="select"
                          value={String(value)}
                          disabled={!canEdit || busy}
                          onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.value }))}
                        >
                          {(s.options ?? []).map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      ) : s.type === 'text' ? (
                        <input
                          id={`set-${s.key}`}
                          className="input"
                          value={String(value)}
                          maxLength={s.maxLength ?? undefined}
                          disabled={!canEdit || busy}
                          onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.value }))}
                        />
                      ) : (
                        <div className="relative flex-1">
                          <input
                            id={`set-${s.key}`}
                            type="number"
                            inputMode="decimal"
                            className="input num pr-12"
                            step={s.type === 'money' ? '0.01' : s.type === 'int' ? '1' : '0.1'}
                            value={String(value)}
                            disabled={!canEdit || busy}
                            onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.value }))}
                          />
                          {inputSuffix(s) ? (
                            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 t-small text-text-faint pointer-events-none">
                              {inputSuffix(s)}
                            </span>
                          ) : null}
                        </div>
                      )}

                      {canEdit && s.source === 'override' ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-icon"
                          title={`Reset to the platform default${
                            s.defaultValue !== null ? ` (${formatCurrent({ ...s, value: s.defaultValue })})` : ''
                          }`}
                          aria-label={`Reset ${s.label} to default`}
                          onClick={() => reset(s.key)}
                          disabled={busy}
                        >
                          <Icon name="refresh" size={14} />
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
