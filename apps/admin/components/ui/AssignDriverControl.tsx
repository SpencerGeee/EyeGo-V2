'use client';

import { useMemo, useState, useTransition } from 'react';

import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Badge, ReadOnlyNote } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { assignDriverToTrip } from '@/lib/actions';

/**
 * ASSIGN A DRIVER, FROM WHEREVER AN OPERATOR IS LOOKING AT THE TRIP.
 *
 * BUGFIX — "I don't see where I can assign a trip to the driver on the admin
 * side."
 *
 * The capability existed end to end: `POST /admin/trips/:id/assign`, the
 * `assignDriverToTrip` server action, and a working picker dialog. What it did
 * not have was a way in. The only mount point was the Dispatch board's
 * "stranded" list, and a trip only lands there once it has been unassigned for
 * longer than the stranded grace OR its driver has gone offline. Every other
 * trip — including the one an operator is staring at on its own detail page,
 * asking exactly this question — had no control at all.
 *
 * So the picker moves here, where any surface can mount it, and the detail page
 * gets one. The dialog itself is unchanged in behaviour; the gate is now the
 * trip's status and the admin's role, which is where the gate belonged.
 */

export type AssignCandidate = {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  activeTripId: string | null;
  vehiclePlate: string | null;
};

/** Straight-line distance, only to rank candidates — not an ETA and not labelled as one. */
function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function AssignDriverControl({
  tripId,
  tripRef,
  pickupLat,
  pickupLng,
  candidates,
  currentDriverName,
  canAssign,
  readOnlyReason,
  label,
}: {
  tripId: string;
  tripRef: string;
  pickupLat?: number | null;
  pickupLng?: number | null;
  candidates: AssignCandidate[];
  currentDriverName?: string | null;
  canAssign: boolean;
  readOnlyReason: string;
  label?: string;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const [pending, startTransition] = useTransition();

  // Only drivers with nothing in hand. A driver already on a trip cannot be
  // given a second one — the API refuses it, and offering it here would be a
  // control that exists to fail.
  const free = useMemo(() => candidates.filter((d) => !d.activeTripId), [candidates]);

  const ranked = useMemo(() => {
    return [...free]
      .map((driver) => ({
        driver,
        km:
          pickupLat != null && pickupLng != null && driver.lat !== null && driver.lng !== null
            ? haversineKm(pickupLat, pickupLng, driver.lat, driver.lng)
            : null,
      }))
      .sort((a, b) => {
        if (a.km === null) return 1;
        if (b.km === null) return -1;
        return a.km - b.km;
      });
  }, [free, pickupLat, pickupLng]);

  const close = () => {
    setSelected('');
    setOpen(false);
  };

  const submit = () => {
    if (!selected) return;
    startTransition(async () => {
      const result = await assignDriverToTrip(tripId, selected);
      if (result.ok) {
        toast.success(result.message);
        close();
      } else {
        toast.error(result.message);
      }
    });
  };

  if (!canAssign) return <ReadOnlyNote>{readOnlyReason}</ReadOnlyNote>;

  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm w-full" onClick={() => setOpen(true)}>
        <Icon name="wheel" />
        {label ?? (currentDriverName ? 'Reassign driver' : 'Assign a driver')}
      </button>

      <Modal
        open={open}
        onClose={close}
        title={currentDriverName ? `Reassign ${tripRef}` : `Assign ${tripRef}`}
        footer={
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={close} disabled={pending}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={submit}
              disabled={!selected || pending}
            >
              {pending ? 'Assigning…' : 'Assign driver'}
            </button>
          </>
        }
      >
        {currentDriverName ? (
          <p className="t-small text-text-dim mb-3">
            This trip is currently with <strong>{currentDriverName}</strong>. Assigning replaces
            them, and they lose the trip immediately.
          </p>
        ) : null}

        {ranked.length === 0 ? (
          <p className="t-small text-text-faint">
            No driver is both online and free right now. Nothing can be assigned until one is.
          </p>
        ) : (
          <ul className="space-y-1.5 max-h-[340px] overflow-y-auto" role="radiogroup" aria-label="Free drivers">
            {ranked.map(({ driver, km }) => {
              const isOn = selected === driver.id;
              return (
                <li key={driver.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={isOn}
                    onClick={() => setSelected(driver.id)}
                    className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                      isOn
                        ? 'border-accent bg-accent-soft'
                        : 'border-line hover:border-line-strong'
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block t-heading truncate">{driver.name}</span>
                      <span className="block t-small text-text-faint mono">
                        {driver.vehiclePlate || 'no plate on file'}
                      </span>
                    </span>
                    <span className="shrink-0 flex items-center gap-2">
                      {km !== null ? (
                        <span className="t-small text-text-dim num">{km.toFixed(1)} km away</span>
                      ) : (
                        <span className="t-small text-warn">no GPS fix</span>
                      )}
                      {isOn ? <Badge tone="accent">Selected</Badge> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <p className="t-small text-text-faint mt-3">
          Distance is straight-line from the pickup point. It ignores roads and traffic, so treat
          it as a ranking, never as an ETA to quote a rider.
        </p>
      </Modal>
    </>
  );
}

export default AssignDriverControl;
