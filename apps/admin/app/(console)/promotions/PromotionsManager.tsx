'use client';

import { useState } from 'react';

import { ActionButton } from '@/components/ui/ActionButton';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Badge, Card, EmptyState, ReadOnlyNote } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { createPromotion, togglePromotion } from '@/lib/actions';
import { dateOnly, ghs, num, relative } from '@/lib/format';

export type Promotion = {
  id: string;
  code: string;
  description?: string | null;
  discountType: string;
  discountValue: number;
  maxUses?: number | null;
  usedCount?: number;
  minFarePesewas?: number | null;
  isActive: boolean;
  expiresAt?: string | null;
  createdAt: string;
  _count?: { bookings: number };
};

export function PromotionsManager({
  promotions,
  canManage,
  readOnlyReason,
}: {
  promotions: Promotion[];
  canManage: boolean;
  readOnlyReason: string;
}) {
  const [creating, setCreating] = useState(false);

  const columns: Column<Promotion>[] = [
    {
      key: 'code',
      header: 'Code',
      sortValue: (p) => p.code,
      render: (p) => (
        <span className="min-w-0">
          <span className="block mono font-medium">{p.code}</span>
          {p.description ? (
            <span className="block text-[11.5px] text-text-faint truncate-1 max-w-[220px]">
              {p.description}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'state',
      header: 'State',
      sortValue: (p) => (p.isActive ? 1 : 0),
      render: (p) => {
        const expired = p.expiresAt ? new Date(p.expiresAt) < new Date() : false;
        const exhausted = !!p.maxUses && (p.usedCount ?? 0) >= p.maxUses;
        // Expired and exhausted are shown distinctly from "disabled": all three
        // stop a code working, but only one of them is somebody's decision.
        if (!p.isActive) return <Badge tone="neutral" icon="ban">Disabled</Badge>;
        if (expired) return <Badge tone="warn" icon="clock">Expired</Badge>;
        if (exhausted) return <Badge tone="warn">Fully used</Badge>;
        return <Badge tone="accent" live>Live</Badge>;
      },
    },
    {
      key: 'discount',
      header: 'Discount',
      render: (p) =>
        p.discountType === 'PERCENTAGE' ? (
          <span className="num">{p.discountValue}%</span>
        ) : (
          // A fixed discount is stored in pesewas like every other amount.
          <span className="num">{ghs(p.discountValue)}</span>
        ),
    },
    {
      key: 'minFare',
      header: 'Min fare',
      align: 'right',
      hideBelow: 'lg',
      render: (p) => (p.minFarePesewas ? ghs(p.minFarePesewas) : <span className="text-text-faint">none</span>),
    },
    {
      key: 'used',
      header: 'Redemptions',
      align: 'right',
      sortValue: (p) => p._count?.bookings ?? p.usedCount ?? 0,
      render: (p) => (
        <>
          {num(p._count?.bookings ?? p.usedCount ?? 0)}
          {p.maxUses ? <span className="text-text-faint"> / {num(p.maxUses)}</span> : null}
        </>
      ),
    },
    {
      key: 'expires',
      header: 'Expires',
      align: 'right',
      hideBelow: 'md',
      sortValue: (p) => p.expiresAt ?? null,
      render: (p) =>
        p.expiresAt ? (
          <span title={dateOnly(p.expiresAt)}>{relative(p.expiresAt)}</span>
        ) : (
          <span className="text-text-faint">never</span>
        ),
    },
  ];

  return (
    <>
      <Card flush>
        <div className="card-head">
          <div>
            <div className="t-heading">
              {promotions.length} code{promotions.length === 1 ? '' : 's'}
            </div>
            <div className="t-small text-text-faint mt-0.5">
              {num(promotions.filter((p) => p.isActive).length)} currently enabled
            </div>
          </div>
          {canManage ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
              <Icon name="plus" size={13} />
              New promotion
            </button>
          ) : null}
        </div>

        <DataTable
          rows={promotions}
          columns={columns}
          rowKey={(p) => p.id}
          caption="Promotion codes"
          empty={
            <EmptyState
              icon="tag"
              title="No promotions"
              body="No discount codes exist yet."
            />
          }
          rowActions={(p) =>
            canManage ? (
              <ActionButton
                action={() => togglePromotion(p.id)}
                label={p.isActive ? 'Disable' : 'Enable'}
                icon={p.isActive ? 'ban' : 'check'}
                variant={p.isActive ? 'danger' : 'secondary'}
                confirm={{
                  title: p.isActive ? `Disable ${p.code}?` : `Enable ${p.code}?`,
                  body: p.isActive
                    ? 'Riders can no longer apply this code. Discounts already granted are not reversed.'
                    : 'Riders can apply this code again immediately. Every redemption is a real discount.',
                  confirmLabel: p.isActive ? 'Disable code' : 'Enable code',
                }}
              />
            ) : null
          }
        />

        {!canManage ? (
          <div className="px-4 py-3 border-t border-line">
            <ReadOnlyNote>{readOnlyReason}</ReadOnlyNote>
          </div>
        ) : null}
      </Card>

      <CreateDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function CreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [discountType, setDiscountType] = useState('PERCENTAGE');
  const [value, setValue] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [minFare, setMinFare] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const percentage = discountType === 'PERCENTAGE';

  const close = () => {
    setCode('');
    setDescription('');
    setValue('');
    setMaxUses('');
    setMinFare('');
    setExpiresAt('');
    setError(null);
    onClose();
  };

  const submit = async () => {
    setError(null);
    setBusy(true);

    const numeric = Number(value);
    const result = await createPromotion({
      code,
      description: description || undefined,
      discountType,
      // Percentages go as whole percent; a fixed discount is converted from the
      // cedis the operator typed into the pesewas the API stores. Sending cedis
      // here would make every fixed discount 100x too small.
      discountValue: percentage ? numeric : Math.round(numeric * 100),
      maxUses: maxUses ? Number(maxUses) : undefined,
      minFarePesewas: minFare ? Math.round(Number(minFare) * 100) : undefined,
      expiresAt: expiresAt || undefined,
    });

    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    toast.success(result.message);
    close();
  };

  const valid = code.trim().length >= 3 && Number(value) > 0;

  return (
    <Modal
      open={open}
      onClose={close}
      title="New promotion"
      description="The code becomes usable immediately once created."
      confirmOnDismiss={!!code || !!value}
      width={520}
      footer={
        <>
          <button type="button" className="btn btn-secondary btn-sm" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={submit}
            disabled={!valid || busy}
            aria-busy={busy}
          >
            {busy ? <Icon name="refresh" size={13} className="spin" /> : null}
            Create promotion
          </button>
        </>
      }
    >
      {error ? (
        <div role="alert" className="flex items-start gap-2 p-3 mb-4 rounded-md bg-danger-soft border border-danger-rim">
          <Icon name="alert" size={14} className="text-danger mt-0.5" />
          <p className="t-small text-danger">{error}</p>
        </div>
      ) : null}

      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="promo-code">
            Code
          </label>
          <input
            id="promo-code"
            className="input mono"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ACCRA20"
            required
          />
          <p className="hint">Riders type this exactly. Uppercase, no spaces.</p>
        </div>

        <div>
          <label className="label" htmlFor="promo-desc">
            Description <span className="text-text-faint">(optional)</span>
          </label>
          <input
            id="promo-desc"
            className="input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Launch week discount"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="promo-type">
              Type
            </label>
            <select
              id="promo-type"
              className="select"
              value={discountType}
              onChange={(e) => setDiscountType(e.target.value)}
            >
              <option value="PERCENTAGE">Percentage off</option>
              <option value="FIXED">Fixed amount off</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="promo-value">
              {percentage ? 'Percent off' : 'Cedis off'}
            </label>
            <input
              id="promo-value"
              type="number"
              inputMode="decimal"
              min="0"
              max={percentage ? '100' : undefined}
              step={percentage ? '1' : '0.01'}
              className="input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
            />
            <p className="hint">{percentage ? 'Maximum 100.' : 'Entered in cedis, stored in pesewas.'}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="promo-max">
              Max redemptions <span className="text-text-faint">(optional)</span>
            </label>
            <input
              id="promo-max"
              type="number"
              inputMode="numeric"
              min="1"
              className="input"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              placeholder="unlimited"
            />
          </div>
          <div>
            <label className="label" htmlFor="promo-min">
              Minimum fare <span className="text-text-faint">(optional)</span>
            </label>
            <input
              id="promo-min"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              className="input"
              value={minFare}
              onChange={(e) => setMinFare(e.target.value)}
              placeholder="none"
            />
            <p className="hint">In cedis.</p>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="promo-expiry">
            Expires <span className="text-text-faint">(optional)</span>
          </label>
          <input
            id="promo-expiry"
            type="date"
            className="input"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
          <p className="hint">Leave blank for a code that never expires on its own.</p>
        </div>
      </div>
    </Modal>
  );
}
