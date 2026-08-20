'use client';

import { useState } from 'react';

import { Icon } from './Icon';
import { WalletAdjustDialog } from './MoneyDialogs';

/**
 * The trigger for a wallet adjustment.
 *
 * A thin client wrapper so the detail pages can stay server components: they
 * render this, it owns the open/closed state, and the dialog itself is only
 * mounted once somebody actually intends to move money.
 */
export function WalletAdjustControl({
  kind,
  id,
  name,
  balancePesewas,
}: {
  kind: 'rider' | 'driver';
  id: string;
  name: string;
  balancePesewas: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
        <Icon name="cash" size={14} />
        Adjust wallet
      </button>
      <WalletAdjustDialog
        subject={open ? { kind, id, name, balancePesewas } : null}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
