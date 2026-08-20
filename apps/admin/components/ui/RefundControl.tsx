'use client';

import { useState } from 'react';

import { Icon } from './Icon';
import { RefundDialog } from './MoneyDialogs';

type Refundable = {
  remainingPesewas: number;
  alreadyRefundedPesewas: number;
  gatewayAvailable: boolean;
};

/**
 * The "Refund" control on a booking row.
 *
 * The ceiling is fetched only when the operator opens the dialog, not for every
 * row on page load: a trip with fourteen seats would otherwise fire fourteen
 * requests to answer a question nobody has asked yet.
 *
 * A booking that was never settled has nothing to refund, so the control is
 * simply absent rather than present-and-refused — an operator should not be
 * offered an action the API is going to turn down.
 */
export function RefundControl({
  booking,
}: {
  booking: {
    id: string;
    fareAmountPesewas: number;
    paymentStatus?: string | null;
    paymentMethod?: string;
    status?: string;
  };
}) {
  const [open, setOpen] = useState(false);
  const [refundable, setRefundable] = useState<Refundable | null>(null);
  const [loading, setLoading] = useState(false);

  if (booking.paymentStatus !== 'PAID') return null;

  async function openDialog() {
    setLoading(true);
    try {
      const res = await fetch(`/api/refundable/${booking.id}`);
      const body = await res.json();
      setRefundable(res.ok ? body : null);
    } catch {
      // A failed lookup must not block the refund: the dialog falls back to the
      // full fare as its ceiling and the API re-checks it properly on submit.
      setRefundable(null);
    } finally {
      setLoading(false);
      setOpen(true);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={openDialog}
        disabled={loading}
        title="Return some or all of this fare"
      >
        <Icon name="refresh" size={13} />
        {loading ? '…' : 'Refund'}
      </button>
      <RefundDialog
        booking={open ? booking : null}
        refundable={refundable}
        onClose={() => {
          setOpen(false);
          setRefundable(null);
        }}
      />
    </>
  );
}
