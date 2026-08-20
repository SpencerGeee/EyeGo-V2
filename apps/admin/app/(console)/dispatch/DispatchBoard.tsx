'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';

import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Badge, Card, CardHead, EmptyState, ReadOnlyNote } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { assignDriverToTrip } from '@/lib/actions';
import { num, relative, shortId, tripRef } from '@/lib/format';
import { tripStatusMeta } from '@/lib/status';

/**
 * The shape this board renders. Two of these fields are FLATTENED from what
 * `/live/drivers` actually sends — it reports `activeTrip: { id, … }` and
 * `vehicle: { plateNumber, … }` — so the page normalises the payload before
 * handing it over. The raw nested forms are declared here as optional inputs
 * to that normalisation, and nothing below reads them directly.
 */
export type LiveDriver = {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  heading: number | null;
  status: string;
  activeTripId: string | null;
  /** The trip's human short code, for display. Falls back to the id. */
  activeTripShortId?: string | null;
  vehiclePlate: string | null;
  /** Raw, as sent by /live/drivers. Normalised into the fields above. */
  activeTrip?: { id: string; shortId?: string; status: string } | null;
  vehicle?: { plateNumber?: string | null } | null;
};

export type StrandedTrip = {
  id: string;
  shortId?: string;
  status: string;
  departureTime?: string | null;
  createdAt?: string;
  maxSeats?: number;
  route?: {
    id?: string;
    name?: string;
    originName?: string;
    destinationName?: string;
    originLat?: number;
    originLng?: number;
  } | null;
  driver?: { id: string; name: string; isOnline?: boolean } | null;
  _count?: { bookings: number };
};

/** Straight-line distance, only to rank candidates — not an ETA and not labelled as one. */
function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function DispatchBoard({
  drivers,
  stranded,
  canAssign,
  readOnlyReason,
}: {
  drivers: LiveDriver[];
  stranded: StrandedTrip[];
  canAssign: boolean;
  readOnlyReason: string;
}) {
  const [assigning, setAssigning] = useState<StrandedTrip | null>(null);

  const free = drivers.filter((d) => !d.activeTripId);

  return (
    <>
      <div className="grid gap-4 xl:grid-cols-2">
        {/* ── Stranded ── */}
        <Card flush>
          <CardHead
            title="Needs a driver"
            subtitle="Live trips still searching, or whose driver went offline"
            icon="alert"
          />
          {stranded.length === 0 ? (
            <EmptyState
              icon="check"
              title="Nothing stranded"
              body="No live trip is waiting on dispatch or on an offline driver."
            />
          ) : (
            <ul className="divide-y divide-line">
              {stranded.map((t) => {
                const meta = tripStatusMeta(t.status);
                return (
                  <li key={t.id} className="p-4 flex flex-wrap items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <Link href={`/trips/${t.id}`} className="mono hover:text-accent">
                          {tripRef(t)}
                        </Link>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                        {t._count?.bookings ? (
                          <Badge tone="info" icon="users">
                            {num(t._count.bookings)} aboard
                          </Badge>
                        ) : (
                          <Badge tone="neutral">no riders yet</Badge>
                        )}
                      </div>
                      <p className="t-small text-text-dim truncate-1">
                        {t.route?.originName || '—'} → {t.route?.destinationName || '—'}
                      </p>
                      {/* Two different failures reach this list and they need
                          different words. A trip with no driver is still in
                          dispatch and nobody has taken it; a trip with one has
                          been abandoned by a driver who dropped off the network.
                          Saying "Driver unknown is offline" for the first case
                          — which is what this did — described a driver that
                          does not exist and hid the real problem. */}
                      <p className="t-small text-text-faint mt-0.5">
                        {t.driver ? (
                          <>
                            Driver{' '}
                            <Link href={`/drivers/${t.driver.id}`} className="hover:text-accent">
                              {t.driver.name}
                            </Link>{' '}
                            is offline
                          </>
                        ) : (
                          <>No driver assigned — still searching</>
                        )}
                        {t.departureTime ? ` · departs ${relative(t.departureTime)}` : ''}
                        {t.createdAt ? ` · requested ${relative(t.createdAt)}` : ''}
                      </p>
                    </div>

                    {canAssign ? (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => setAssigning(t)}
                      >
                        <Icon name="wheel" size={13} />
                        Reassign
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {!canAssign ? (
            <div className="px-4 py-3 border-t border-line">
              <ReadOnlyNote>{readOnlyReason}</ReadOnlyNote>
            </div>
          ) : null}
        </Card>

        {/* ── Who is online ── */}
        <Card flush>
          <CardHead
            title="Drivers online"
            subtitle={`${num(free.length)} free · ${num(drivers.length - free.length)} on a trip`}
            icon="wheel"
          />
          {drivers.length === 0 ? (
            <EmptyState
              icon="wheel"
              title="Nobody online"
              body="No driver is currently connected. Nothing can be dispatched."
            />
          ) : (
            <div className="table-scroll max-h-[420px] overflow-y-auto">
              <table className="table">
                <caption className="sr-only">Drivers currently online</caption>
                <thead>
                  <tr>
                    <th scope="col">Driver</th>
                    <th scope="col">Availability</th>
                    <th scope="col" className="hidden sm:table-cell">Plate</th>
                    <th scope="col" className="text-right">Position</th>
                  </tr>
                </thead>
                <tbody>
                  {drivers.map((d) => (
                    <tr key={d.id}>
                      <td className="truncate-1 max-w-[160px]">
                        <Link href={`/drivers/${d.id}`} className="hover:text-accent">
                          {d.name}
                        </Link>
                      </td>
                      <td>
                        {d.activeTripId ? (
                          <Link href={`/trips/${d.activeTripId}`}>
                            {/* The trip's short code, not eight characters of its database id. */}
                            <Badge tone="info">On trip {d.activeTripShortId ?? shortId(d.activeTripId)}</Badge>
                          </Link>
                        ) : (
                          <Badge tone="accent" live>
                            Free
                          </Badge>
                        )}
                      </td>
                      <td className="hidden sm:table-cell mono text-text-dim">
                        {d.vehiclePlate || '—'}
                      </td>
                      <td className="num text-text-faint">
                        {d.lat !== null && d.lng !== null ? (
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${d.lat},${d.lng}`}
                            target="_blank"
                            rel="noreferrer"
                            className="mono hover:text-accent"
                          >
                            {d.lat.toFixed(3)}, {d.lng.toFixed(3)}
                          </a>
                        ) : (
                          <span className="text-warn">no fix</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <AssignDialog
        trip={assigning}
        candidates={free}
        onClose={() => setAssigning(null)}
      />
    </>
  );
}

function AssignDialog({
  trip,
  candidates,
  onClose,
}: {
  trip: StrandedTrip | null;
  candidates: LiveDriver[];
  onClose: () => void;
}) {
  const toast = useToast();
  const [selected, setSelected] = useState<string>('');
  const [pending, startTransition] = useTransition();

  // Ranked by straight-line distance from the pickup point where both are known.
  // Explicitly not an ETA: it ignores roads, traffic and the Volta, and calling
  // it an ETA would invite an operator to promise a rider something.
  const ranked = useMemo(() => {
    const oLat = trip?.route?.originLat;
    const oLng = trip?.route?.originLng;
    return [...candidates]
      .map((d) => ({
        driver: d,
        km:
          oLat !== undefined && oLng !== undefined && d.lat !== null && d.lng !== null
            ? haversineKm(oLat, oLng, d.lat, d.lng)
            : null,
      }))
      .sort((a, b) => {
        if (a.km === null) return 1;
        if (b.km === null) return -1;
        return a.km - b.km;
      });
  }, [candidates, trip]);

  const close = () => {
    setSelected('');
    onClose();
  };

  const submit = () => {
    if (!trip || !selected) return;
    startTransition(async () => {
      const result = await assignDriverToTrip(trip.id, selected);
      if (result.ok) {
        toast.success(result.message);
        close();
      } else {
        toast.error(result.message);
      }
    });
  };

  return (
    <Modal
      open={!!trip}
      onClose={close}
      title={trip ? `Reassign trip ${tripRef(trip)}` : ''}
      description="The chosen driver is notified immediately and has two minutes to accept."
      width={560}
      footer={
        <>
          <button type="button" className="btn btn-secondary btn-sm" onClick={close} disabled={pending}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={submit}
            disabled={!selected || pending}
            aria-busy={pending}
          >
            {pending ? <Icon name="refresh" size={13} className="spin" /> : null}
            Assign driver
          </button>
        </>
      }
    >
      {trip?._count?.bookings ? (
        <div className="flex items-start gap-2 p-3 mb-4 rounded-md bg-warn-soft border border-warn-rim">
          <Icon name="alert" size={14} className="text-warn mt-0.5" />
          <p className="t-small text-warn">
            {num(trip._count.bookings)} rider{trip._count.bookings === 1 ? '' : 's'} already booked on
            this trip. They keep their seats — only the driver changes.
          </p>
        </div>
      ) : null}

      {ranked.length === 0 ? (
        <EmptyState
          icon="wheel"
          title="No free driver online"
          body="Every online driver is already on a trip. Nothing can be assigned until one frees up or another comes online."
        />
      ) : (
        <fieldset>
          <legend className="label">Choose a driver ({ranked.length} free)</legend>
          <ul className="space-y-1.5 max-h-[300px] overflow-y-auto">
            {ranked.map(({ driver, km }) => (
              <li key={driver.id}>
                <label
                  className={`flex items-center gap-3 p-2.5 rounded-md border cursor-pointer transition-colors ${
                    selected === driver.id
                      ? 'border-accent bg-accent-soft'
                      : 'border-line hover:border-line-strong hover:bg-surface-2'
                  }`}
                >
                  <input
                    type="radio"
                    name="driver"
                    value={driver.id}
                    checked={selected === driver.id}
                    onChange={() => setSelected(driver.id)}
                    className="accent-[var(--accent)]"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block t-small font-medium truncate-1">{driver.name}</span>
                    <span className="block text-[11.5px] text-text-faint mono">
                      {driver.vehiclePlate || 'no plate on file'}
                    </span>
                  </span>
                  <span className="t-small num text-text-faint flex-none">
                    {km === null ? 'position unknown' : `${km.toFixed(1)} km away`}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <p className="hint">
            Distance is straight-line from the pickup point, used only to order this
            list. It is not a driving time.
          </p>
        </fieldset>
      )}
    </Modal>
  );
}
