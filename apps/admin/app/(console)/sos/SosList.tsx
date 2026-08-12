'use client';

import Link from 'next/link';

import { ActionButton } from '@/components/ui/ActionButton';
import { Icon } from '@/components/ui/Icon';
import { Badge, EmptyState, ErrorPanel } from '@/components/ui/primitives';
import { resolveSosEvent } from '@/lib/actions';
import { dateTime, minutesSince, phone as fmtPhone, relative, shortId } from '@/lib/format';
import { tripStatusMeta } from '@/lib/status';

export type SosEvent = {
  id: string;
  tripId: string;
  userId: string;
  lat?: number | null;
  lng?: number | null;
  resolvedAt?: string | null;
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
}: {
  events: SosEvent[] | null;
  error: string | null;
  canResolve: boolean;
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
        const open = !e.resolvedAt;
        const age = minutesSince(e.createdAt) ?? 0;
        // Under 15 minutes an unresolved alert may still be live.
        const hot = open && age < 15;
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
                  {open ? (
                    <Badge tone="critical" live={hot}>
                      {hot ? 'Live — unresolved' : 'Unresolved'}
                    </Badge>
                  ) : (
                    <Badge tone="neutral" icon="check">
                      Resolved
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
                      {shortId(e.tripId)}
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
                      // Opens in whatever map app the operator has. Coordinates are
                      // shown too, so they can be read aloud to emergency services.
                      href={`https://www.google.com/maps/search/?api=1&query=${e.lat},${e.lng}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-accent hover:underline"
                    >
                      <Icon name="pin" size={12} />
                      <span className="mono">
                        {e.lat.toFixed(5)}, {e.lng.toFixed(5)}
                      </span>
                      <Icon name="external" size={11} />
                    </a>
                  ) : (
                    <span className="text-warn inline-flex items-center gap-1">
                      <Icon name="alert" size={12} />
                      no location captured
                    </span>
                  )}
                </div>

                {e.resolvedAt ? (
                  <p className="t-small text-text-faint mt-1.5">
                    Cleared {dateTime(e.resolvedAt)}
                  </p>
                ) : null}
              </div>

              {open && canResolve ? (
                <ActionButton
                  action={() => resolveSosEvent(e.id)}
                  label="Mark resolved"
                  icon="check"
                  variant="secondary"
                  confirm={{
                    title: 'Mark this SOS resolved?',
                    body: 'Confirm you have spoken to the person who raised it and they are safe. This is recorded against your name and does not contact anyone.',
                    confirmLabel: 'Mark resolved',
                  }}
                />
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
