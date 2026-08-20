'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';

import { StaticMap } from '@/components/map/StaticMap';
import { ActionButton } from '@/components/ui/ActionButton';
import { Icon } from '@/components/ui/Icon';
import { Badge, EmptyState, ErrorPanel } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { acknowledgeSos, releaseSos, resolveSosWithOutcome } from '@/lib/actions';
import { dateTime, minutesSince, phone as fmtPhone, relative, tripRef } from '@/lib/format';
import { tripStatusMeta } from '@/lib/status';

export type SosEvent = {
  id: string;
  tripId: string;
  userId: string;
  lat?: number | null;
  lng?: number | null;
  /** Reverse-geocoded place name for lat/lng. Null when it could not be resolved. */
  address?: string | null;
  /** OPEN → ACKNOWLEDGED → RESOLVED. */
  status?: string;
  acknowledgedAt?: string | null;
  acknowledgedBy?: { id: string; name: string; email: string } | null;
  resolvedAt?: string | null;
  resolvedBy?: { id: string; name: string; email: string } | null;
  outcome?: string | null;
  ageMinutes?: number;
  createdAt: string;
  reporter?: { role: string; id: string; name: string; phone: string };
  trip?: {
    id: string;
    status: string;
    route?: { name?: string } | null;
    driver?: { id: string; name: string; phone: string } | null;
  } | null;
};

/**
 * Closing an alert requires saying what happened.
 *
 * A one-click "resolved" produces a queue full of cleared alerts and no account
 * of any of them, which is worthless precisely when it matters: the review
 * after a serious incident. One sentence is enough, and the field refuses to
 * submit empty.
 */
function ResolveSosButton({ eventId }: { eventId: string }) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState('');
  const [pending, start] = useTransition();
  const toast = useToast();

  if (!open) {
    return (
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>
        <Icon name="check" size={14} />
        Resolve
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 w-56">
      <textarea
        className="input min-h-16 t-small"
        autoFocus
        value={outcome}
        onChange={(e) => setOutcome(e.target.value)}
        placeholder="What happened? e.g. Called rider, false alarm, confirmed safe."
        disabled={pending}
      />
      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-secondary btn-sm flex-1"
          disabled={pending || !outcome.trim()}
          onClick={() =>
            start(async () => {
              const r = await resolveSosWithOutcome(eventId, outcome.trim());
              if (r.ok) {
                toast.success(r.message);
                setOpen(false);
              } else {
                toast.error(r.message);
              }
            })
          }
        >
          {pending ? 'Saving…' : 'Confirm'}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setOpen(false)}
          disabled={pending}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Cards, not a table.
 *
 * A safety alert needs the reporter's phone number tappable, a map link to their
 * coordinates, and the other party's number — all at once. Squeezing that into
 * table cells makes the operator hunt for the thing they need while someone is
 * waiting, so each event gets space.
 */
export function SosList({
  events,
  error,
  canResolve,
  currentAdminId,
  staleAfterMinutes = 10,
}: {
  events: SosEvent[] | null;
  error: string | null;
  canResolve: boolean;
  currentAdminId?: string | null;
  /** Past this, an unclaimed alert is shown as overdue rather than merely open. */
  staleAfterMinutes?: number;
}) {
  if (error) return <ErrorPanel title="Could not load SOS events" message={error} />;

  if (events === null) {
    return (
      <div className="p-4 space-y-3" aria-busy="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="skeleton h-[104px] rounded-lg" />
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <EmptyState
        icon="shield"
        title="No SOS events"
        body="Nothing matches the current view. If you are filtered to unresolved only, that means everything has been triaged."
      />
    );
  }

  return (
    <ul className="divide-y divide-line">
      {events.map((e) => {
        const status = e.status ?? (e.resolvedAt ? 'RESOLVED' : 'OPEN');
        const open = status !== 'RESOLVED';
        const claimed = status === 'ACKNOWLEDGED';
        const age = e.ageMinutes ?? minutesSince(e.createdAt) ?? 0;
        // Under 15 minutes an unresolved alert may still be live.
        const hot = open && !claimed && age < 15;
        // Nobody has picked this up and it has been waiting too long. This is
        // the state the whole triage flow exists to make visible — previously
        // every unresolved alert looked identical, so a three-day-old one
        // shouted exactly as loudly as one raised a minute ago.
        const overdue = open && !claimed && age >= staleAfterMinutes;
        const mine = claimed && e.acknowledgedBy?.id && e.acknowledgedBy.id === currentAdminId;
        const tripMeta = e.trip ? tripStatusMeta(e.trip.status) : null;

        return (
          <li key={e.id} className={`p-4 ${open ? 'bg-critical-soft/25' : ''}`}>
            <div className="flex flex-wrap items-start gap-3">
              <span
                className={`w-8 h-8 rounded-full grid place-items-center flex-none ${
                  open ? 'bg-critical-soft text-critical' : 'bg-surface-3 text-text-faint'
                }`}
              >
                <Icon name="siren" size={16} />
              </span>

              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  {claimed ? (
                    <Badge tone="warn" icon="eye">
                      {mine ? 'You are handling this' : `With ${e.acknowledgedBy?.name ?? 'an operator'}`}
                    </Badge>
                  ) : open ? (
                    <Badge tone="critical" live={hot}>
                      {hot ? 'Live — nobody on it' : overdue ? `Unclaimed for ${age}m` : 'Unclaimed'}
                    </Badge>
                  ) : (
                    <Badge tone="neutral" icon="check">
                      Resolved{e.resolvedBy ? ` by ${e.resolvedBy.name}` : ''}
                    </Badge>
                  )}
                  <span className="t-small text-text-faint">
                    raised {relative(e.createdAt)} · {dateTime(e.createdAt)}
                  </span>
                </div>

                <p className="t-body">
                  <strong>{e.reporter?.name || 'Unknown reporter'}</strong>
                  <span className="text-text-dim">
                    {' '}
                    ({(e.reporter?.role || 'unknown').toLowerCase()})
                  </span>
                  {e.reporter?.phone ? (
                    <>
                      {' — '}
                      <a href={`tel:${e.reporter.phone}`} className="mono text-accent hover:underline">
                        {fmtPhone(e.reporter.phone)}
                      </a>
                    </>
                  ) : null}
                </p>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 t-small text-text-dim">
                  <span>
                    Trip{' '}
                    <Link href={`/trips/${e.tripId}`} className="mono text-accent hover:underline">
                      {tripRef(e.tripId)}
                    </Link>
                    {tripMeta ? (
                      <>
                        {' '}
                        <Badge tone={tripMeta.tone}>{tripMeta.label}</Badge>
                      </>
                    ) : null}
                  </span>

                  {e.trip?.driver ? (
                    <span>
                      Driver{' '}
                      <Link href={`/drivers/${e.trip.driver.id}`} className="hover:text-accent">
                        {e.trip.driver.name}
                      </Link>
                      {' — '}
                      <a href={`tel:${e.trip.driver.phone}`} className="mono text-accent hover:underline">
                        {fmtPhone(e.trip.driver.phone)}
                      </a>
                    </span>
                  ) : (
                    <span className="text-text-faint">no driver on this trip</span>
                  )}

                  {e.lat && e.lng ? (
                    <a
                      // Opens in whatever map app the operator has.
                      href={`https://www.google.com/maps/search/?api=1&query=${e.lat},${e.lng}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-accent hover:underline"
                      // The coordinates are what gets read aloud to emergency
                      // services, so they stay one hover away rather than gone.
                      title={`${e.lat.toFixed(5)}, ${e.lng.toFixed(5)}`}
                    >
                      <Icon name="pin" size={12} />
                      {/*
                        THE PLACE, NOT THE NUMBERS.

                        BUGFIX ("on the admin side the sos is showing coordinates
                        instead of the actual location"). "5.62890, -0.17084" does
                        not tell an operator on a live safety call whether that is
                        a motorway shoulder or a market, and working it out means
                        leaving the console. The server now reverse-geocodes each
                        event (`address`), and the coordinate pair falls back in
                        only when it genuinely could not be resolved — where it is
                        the honest answer rather than a stand-in for one.
                      */}
                      {e.address ? (
                        <span>{e.address}</span>
                      ) : (
                        <span className="mono">
                          {e.lat.toFixed(5)}, {e.lng.toFixed(5)}
                        </span>
                      )}
                      <Icon name="external" size={11} />
                    </a>
                  ) : (
                    <span className="text-warn inline-flex items-center gap-1">
                      <Icon name="alert" size={12} />
                      no location captured
                    </span>
                  )}
                </div>

                {claimed && e.acknowledgedAt ? (
                  <p className="t-small text-warn mt-1.5">
                    Picked up by {e.acknowledgedBy?.name ?? 'an operator'} {relative(e.acknowledgedAt)}
                  </p>
                ) : null}

                {e.resolvedAt ? (
                  <p className="t-small text-text-faint mt-1.5">
                    Cleared {dateTime(e.resolvedAt)}
                    {e.resolvedBy ? ` by ${e.resolvedBy.name}` : ''}
                    {/* The account of what happened. This is the part that gets
                        read back after an incident, so it is shown inline
                        rather than hidden behind a detail view. */}
                    {e.outcome ? <span className="block text-text-dim mt-0.5">“{e.outcome}”</span> : null}
                  </p>
                ) : null}

                {/* WHERE IT WAS RAISED, ON A MAP.
                    Coordinates read aloud are what emergency services need, but
                    "5.62890, -0.17084" tells the operator nothing about whether
                    that is a motorway or a market. Unresolved alerts show the map
                    expanded; resolved ones keep it collapsed so a long history
                    stays scannable. */}
                {typeof e.lat === 'number' && typeof e.lng === 'number' ? (
                  open ? (
                    <div className="mt-3 rounded-lg overflow-hidden border border-critical/40">
                      <StaticMap
                        label={`Location of the SOS raised by ${e.reporter?.name ?? 'unknown reporter'}`}
                        height={200}
                        points={[
                          {
                            lat: e.lat,
                            lng: e.lng,
                            glyph: '!',
                            tone: 'critical',
                            label: 'SOS location',
                          },
                        ]}
                      />
                    </div>
                  ) : (
                    <details className="mt-2">
                      <summary className="t-small text-text-dim cursor-pointer hover:text-text">
                        Show location on a map
                      </summary>
                      <div className="mt-2 rounded-lg overflow-hidden border border-line">
                        <StaticMap
                          label="SOS location"
                          height={180}
                          points={[{ lat: e.lat, lng: e.lng, glyph: '!', tone: 'critical', label: 'SOS location' }]}
                        />
                      </div>
                    </details>
                  )
                ) : null}
              </div>

              {/*
                TWO STEPS, NOT ONE. "I am on this" and "this is finished" are
                different claims, and collapsing them meant the queue could not
                tell an alert nobody had touched from one a colleague was
                already on the phone about — so either two people rang the same
                frightened rider, or everybody assumed somebody else had.
              */}
              {open && canResolve ? (
                <div className="flex flex-col gap-2 flex-none">
                  {!claimed ? (
                    <ActionButton
                      action={() => acknowledgeSos(e.id)}
                      label="I'll take this"
                      icon="eye"
                      variant="primary"
                    />
                  ) : (
                    <>
                      <ResolveSosButton eventId={e.id} />
                      {mine ? (
                        <ActionButton
                          action={() => releaseSos(e.id)}
                          label="Hand back"
                          icon="refresh"
                          variant="ghost"
                        />
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
