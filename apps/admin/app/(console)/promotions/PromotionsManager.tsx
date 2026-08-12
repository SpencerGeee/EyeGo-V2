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

/**
 * THE PROMOTION MODEL, AS IT ACTUALLY IS.
 *
 * Prisma `Promotion` has exactly these columns: code, discountPercent (Int),
 * maxDiscountPesewas (Int), active, usageCount, maxRedemptions (Int?), expiry
 * (DateTime, NOT NULL).
 *
 * There is no discountType, no description and no minimum-fare column — this
 * console previously offered all three, plus a "fixed amount off" option that
 * the schema cannot store, and sent `discountValue`/`expiresAt` field names the
 * API does not read. That is why creating a code failed with
 * `Discount must be a whole number between 1 and 100 (received "undefined")`:
 * the API read `discountPercent`, which was never sent.
 *
 * Two fields the old form never collected are REQUIRED by the API and by the
 * NOT NULL columns: the maximum discount cap and the expiry date. A percentage
 * with no cap on a long trip is an unbounded giveaway, which is why the cap is
 * not optional.
 */
export type Promotion = {
  id: string;
  code: string;
  discountPercent: number;
  maxDiscountPesewas: number;
  active: boolean;
  usageCount?: number;
  maxRedemptions?: number | null;
  expiry: string;
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
      render: (p) => <span className="mono font-medium">{p.code}</span>,
    },
    {
      key: 'state',
      header: 'State',
      sortValue: (p) => (p.active ? 1 : 0),
      render: (p) => {
        const expired = new Date(p.expiry) < new Date();
        const exhausted = !!p.maxRedemptions && (p.usageCount ?? 0) >= p.maxRedemptions;
        // Expired, exhausted and disabled are shown distinctly: all three stop a
        // code working, but only one of them is somebody's decision.
        if (!p.active) return <Badge tone="neutral" icon="ban">Disabled</Badge>;
        if (expired) return <Badge tone="warn" icon="clock">Expired</Badge>;
        if (exhausted) return <Badge tone="warn">Fully used</Badge>;
        return <Badge tone="accent" live>Live</Badge>;
      },
    },
    {
      key: 'discount',
      header: 'Discount',
      sortValue: (p) => p.discountPercent,
      render: (p) => <span className="num">{p.discountPercent}%</span>,
    },
    {
      key: 'cap',
      header: 'Capped at',
      align: 'right',
      sortValue: (p) => p.maxDiscountPesewas,
      render: (p) => <span className="num">{ghs(p.maxDiscountPesewas)}</span>,
    },
    {
      key: 'used',
      header: 'Redemptions',
      align: 'right',
      sortValue: (p) => p._count?.bookings ?? p.usageCount ?? 0,
      render: (p) => (
        <>
          {num(p._count?.bookings ?? p.usageCount ?? 0)}
          {p.maxRedemptions ? <span className="text-text-dim"> / {num(p.maxRedemptions)}</span> : null}
        </>
      ),
    },
    {
      key: 'expires',
      header: 'Expires',
      align: 'right',
      hideBelow: 'md',
      sortValue: (p) => p.expiry,
      render: (p) => <span title={dateOnly(p.expiry)}>{relative(p.expiry)}</span>,
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
            <div className="t-small text-text-dim mt-0.5">
              {num(promotions.filter((p) => p.active).length)} currently enabled
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
          empty={<EmptyState icon="tag" title="No promotions" body="No discount codes exist yet." />}
          rowActions={(p) =>
            canManage ? (
              <ActionButton
                action={() => togglePromotion(p.id)}
                label={p.active ? 'Disable' : 'Enable'}
                icon={p.active ? 'ban' : 'check'}
                variant={p.active ? 'danger' : 'secondary'}
                confirm={{
                  title: p.active ? `Disable ${p.code}?` : `Enable ${p.code}?`,
                  body: p.active
                    ? 'Riders can no longer apply this code. Discounts already granted are not reversed.'
                    : 'Riders can apply this code again immediately. Every redemption is a real discount.',
                  confirmLabel: p.active ? 'Disable code' : 'Enable code',
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

/** Tomorrow, as the default expiry — a code with no end date is not an option. */
function defaultExpiry(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

function CreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [percent, setPercent] = useState('10');
  const [capGhs, setCapGhs] = useState('20');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [expiry, setExpiry] = useState(defaultExpiry);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const percentNum = Number(percent);
  const capNum = Number(capGhs);

  const close = () => {
    setCode('');
    setPercent('10');
    setCapGhs('20');
    setMaxRedemptions('');
    setExpiry(defaultExpiry());
    setError(null);
    onClose();
  };

  const submit = async () => {
    setError(null);
    setBusy(true);
    const result = await createPromotion({
      code,
      discountPercent: percentNum,
      // The operator types cedis; the column is pesewas. Converted here, once.
      maxDiscountGhs: capNum,
      maxRedemptions: maxRedemptions ? Number(maxRedemptions) : undefined,
      expiry,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    toast.success(result.message);
    close();
  };

  const valid =
    code.trim().length >= 3 &&
    Number.isInteger(percentNum) &&
    percentNum >= 1 &&
    percentNum <= 100 &&
    capNum > 0 &&
    !!expiry;

  // Worked example, live. A percentage is abstract; "₵4.00 off a ₵40 fare, and
  // never more than ₵20" is the thing the operator is actually deciding.
  const example = Number.isFinite(percentNum) && percentNum > 0
    ? Math.min(Math.round(4000 * (percentNum / 100)), Math.round(capNum * 100) || Infinity)
    : 0;

  return (
    <Modal
      open={open}
      onClose={close}
      title="New promotion"
      description="The code becomes usable immediately once created."
      confirmOnDismiss={!!code}
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
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s+/g, ''))}
            placeholder="ACCRA20"
            required
          />
          <p className="hint">Riders type this exactly. Uppercase, no spaces.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="promo-percent">
              Percent off
            </label>
            <input
              id="promo-percent"
              type="number"
              inputMode="numeric"
              min="1"
              max="100"
              step="1"
              className="input"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              required
            />
            <p className="hint">Whole number, 1–100.</p>
          </div>
          <div>
            <label className="label" htmlFor="promo-cap">
              Maximum discount
            </label>
            <input
              id="promo-cap"
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              className="input"
              value={capGhs}
              onChange={(e) => setCapGhs(e.target.value)}
              required
            />
            <p className="hint">In cedis. Required — an uncapped percentage is unbounded.</p>
          </div>
        </div>

        {example > 0 ? (
          <p className="t-small text-text-dim">
            On a {ghs(4000)} fare this takes off <strong className="text-accent">{ghs(example)}</strong>
            {Math.round(4000 * (percentNum / 100)) > Math.round(capNum * 100) ? ' (the cap binds)' : null}.
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="promo-max">
              Max redemptions <span className="text-text-dim">(optional)</span>
            </label>
            <input
              id="promo-max"
              type="number"
              inputMode="numeric"
              min="1"
              className="input"
              value={maxRedemptions}
              onChange={(e) => setMaxRedemptions(e.target.value)}
              placeholder="unlimited"
            />
          </div>
          <div>
            <label className="label" htmlFor="promo-expiry">
              Expires
            </label>
            <input
              id="promo-expiry"
              type="date"
              className="input"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              required
            />
            <p className="hint">Required by the API.</p>
          </div>
        </div>
      </div>
    </Modal>
  );
}
