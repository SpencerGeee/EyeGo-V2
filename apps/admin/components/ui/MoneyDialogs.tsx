'use client';

import { useState, useTransition } from 'react';

import { adjustDriverWallet, adjustRiderWallet, issueRefund } from '@/lib/actions';
import { ghs } from '@/lib/format';

import { Modal } from './Modal';
import { useToast } from './Toast';

/**
 * The two controls that move real money.
 *
 * DESIGN RULES, both of which exist because these are irreversible in practice:
 *
 *  1. AMOUNTS ARE TYPED IN CEDIS, STORED IN PESEWAS. Every operator thinks in
 *     cedis and every column is an integer of pesewas; the conversion happens
 *     once, here, and the confirm line restates the amount so a factor-of-100
 *     slip is visible before it is committed rather than after.
 *
 *  2. NOTHING SUBMITS WITHOUT A REASON. The API refuses one anyway, but the
 *     form should not let an operator get as far as being refused — and the
 *     reason is what makes the audit row mean something later.
 */

const toPesewas = (cedis: string) => Math.round(parseFloat(cedis || '0') * 100);

function useMoneyForm() {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [pending, start] = useTransition();
  const toast = useToast();
  return { amount, setAmount, reason, setReason, pending, start, toast };
}

// ── Refund ───────────────────────────────────────────────────────────────────

export function RefundDialog({
  booking,
  refundable,
  onClose,
}: {
  booking: { id: string; fareAmountPesewas: number; paymentMethod?: string } | null;
  refundable: { remainingPesewas: number; alreadyRefundedPesewas: number; gatewayAvailable: boolean } | null;
  onClose: () => void;
}) {
  const { amount, setAmount, reason, setReason, pending, start, toast } = useMoneyForm();
  const [destination, setDestination] = useState<'WALLET' | 'GATEWAY'>('WALLET');

  if (!booking) return null;

  const remaining = refundable?.remainingPesewas ?? booking.fareAmountPesewas;
  const requested = toPesewas(amount);
  const overRemaining = requested > remaining;

  function submit() {
    start(async () => {
      const result = await issueRefund(booking!.id, {
        amountPesewas: requested,
        reason: reason.trim(),
        destination,
      });
      if (result.ok) {
        toast.success(result.message);
        onClose();
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Refund this fare"
      description="The rider is told the money is on its way. Every refund is recorded against your name."
    >
      <div className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-2 t-small">
          <dt className="text-text-dim">Fare</dt>
          <dd className="text-right mono">{ghs(booking.fareAmountPesewas)}</dd>
          {refundable?.alreadyRefundedPesewas ? (
            <>
              <dt className="text-text-dim">Already refunded</dt>
              <dd className="text-right mono">{ghs(refundable.alreadyRefundedPesewas)}</dd>
            </>
          ) : null}
          <dt className="text-text-dim">Refundable now</dt>
          <dd className="text-right mono">{ghs(remaining)}</dd>
        </dl>

        <div>
          <label className="label" htmlFor="refund-amount">
            Amount (GH₵)
          </label>
          <div className="flex gap-2">
            <input
              id="refund-amount"
              className="input flex-1"
              type="number"
              step="0.01"
              min="0.01"
              max={(remaining / 100).toFixed(2)}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={(remaining / 100).toFixed(2)}
              disabled={pending}
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setAmount((remaining / 100).toFixed(2))}
              disabled={pending}
            >
              Full
            </button>
          </div>
          {overRemaining ? (
            <p className="t-small text-danger mt-1">
              That is more than the {ghs(remaining)} still refundable on this fare.
            </p>
          ) : null}
        </div>

        <fieldset>
          <legend className="label">Where does it go?</legend>
          <label className="flex items-start gap-2 py-1">
            <input
              type="radio"
              name="destination"
              checked={destination === 'WALLET'}
              onChange={() => setDestination('WALLET')}
              disabled={pending}
            />
            <span>
              <span className="block t-body">EyeGo wallet</span>
              <span className="block t-small text-text-dim">
                Instant, and they can spend it on the next trip. The right choice almost always.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 py-1">
            <input
              type="radio"
              name="destination"
              checked={destination === 'GATEWAY'}
              onChange={() => setDestination('GATEWAY')}
              disabled={pending || !refundable?.gatewayAvailable}
            />
            <span>
              <span className="block t-body">Back to their card or mobile money</span>
              <span className="block t-small text-text-dim">
                {refundable?.gatewayAvailable
                  ? 'Takes a few days to land — the bank decides when, not us.'
                  : booking.paymentMethod === 'CASH'
                    ? 'Unavailable: this fare was paid in cash, so there is nothing to send it back to.'
                    : 'Unavailable: this booking has no gateway payment to reverse.'}
              </span>
            </span>
          </label>
        </fieldset>

        <div>
          <label className="label" htmlFor="refund-reason">
            Why? <span className="text-text-dim">(recorded, and required)</span>
          </label>
          <textarea
            id="refund-reason"
            className="input min-h-16"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Charged twice for the same seat — confirmed on the trip record."
            disabled={pending}
          />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={pending || !reason.trim() || requested <= 0 || overRemaining}
          >
            {pending ? 'Refunding…' : `Refund ${requested > 0 ? ghs(requested) : ''}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Wallet adjustment ────────────────────────────────────────────────────────

export function WalletAdjustDialog({
  subject,
  onClose,
}: {
  subject: { kind: 'rider' | 'driver'; id: string; name: string; balancePesewas: number } | null;
  onClose: () => void;
}) {
  const { amount, setAmount, reason, setReason, pending, start, toast } = useMoneyForm();
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit');

  if (!subject) return null;

  const magnitude = Math.abs(toPesewas(amount));
  const signed = direction === 'credit' ? magnitude : -magnitude;
  const after = subject.balancePesewas + signed;
  const wouldOverdraw = after < 0;

  function submit() {
    start(async () => {
      const fn = subject!.kind === 'rider' ? adjustRiderWallet : adjustDriverWallet;
      const result = await fn(subject!.id, { amountPesewas: signed, reason: reason.trim() });
      if (result.ok) {
        toast.success(result.message);
        onClose();
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Adjust ${subject.name}'s wallet`}
      description="Goes onto their ledger with your name against it. They can see the balance change."
    >
      <div className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-2 t-small">
          <dt className="text-text-dim">Balance now</dt>
          <dd className="text-right mono">{ghs(subject.balancePesewas)}</dd>
          {magnitude > 0 ? (
            <>
              <dt className="text-text-dim">After this</dt>
              <dd className={`text-right mono ${wouldOverdraw ? 'text-danger' : ''}`}>{ghs(after)}</dd>
            </>
          ) : null}
        </dl>

        <div className="flex gap-2">
          <button
            type="button"
            className={`btn btn-sm flex-1 ${direction === 'credit' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setDirection('credit')}
            disabled={pending}
          >
            Credit (give)
          </button>
          <button
            type="button"
            className={`btn btn-sm flex-1 ${direction === 'debit' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setDirection('debit')}
            disabled={pending}
          >
            Debit (take back)
          </button>
        </div>

        <div>
          <label className="label" htmlFor="adjust-amount">
            Amount (GH₵)
          </label>
          <input
            id="adjust-amount"
            className="input"
            type="number"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={pending}
          />
          {wouldOverdraw ? (
            <p className="t-small text-danger mt-1">
              That would take them below zero. Wallets cannot go negative.
            </p>
          ) : null}
        </div>

        <div>
          <label className="label" htmlFor="adjust-reason">
            Why? <span className="text-text-dim">(recorded, and required)</span>
          </label>
          <textarea
            id="adjust-reason"
            className="input min-h-16"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Goodwill for a 40-minute wait caused by a cancelled driver."
            disabled={pending}
          />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={pending || !reason.trim() || magnitude <= 0 || wouldOverdraw}
          >
            {pending ? 'Saving…' : `${direction === 'credit' ? 'Credit' : 'Debit'} ${magnitude > 0 ? ghs(magnitude) : ''}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
