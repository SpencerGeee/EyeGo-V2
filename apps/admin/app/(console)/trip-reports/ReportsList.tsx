'use client';

import Link from 'next/link';

import { ActionButton } from '@/components/ui/ActionButton';
import { Icon } from '@/components/ui/Icon';
import { Badge, EmptyState } from '@/components/ui/primitives';
import { resolveTripReport } from '@/lib/actions';
import { dateTime, humanise, phone as fmtPhone, relative, shortId } from '@/lib/format';
import { tripStatusMeta } from '@/lib/status';

export type TripReport = {
  id: string;
  tripId: string;
  driverId: string;
  type: string;
  details?: string | null;
  status: string;
  resolvedAt?: string | null;
  createdAt: string;
  driver?: { id: string; name: string; phone: string } | null;
  trip?: { id: string; shortId?: string; status?: string; route?: { name?: string } | null } | null;
};

export function ReportsList({
  reports,
  canResolve,
}: {
  reports: TripReport[];
  canResolve: boolean;
}) {
  if (reports.length === 0) {
    return (
      <EmptyState
        icon="flag"
        title="No reports"
        body="Nothing matches this filter. If you are on the default Open view, the backlog is clear."
      />
    );
  }

  return (
    <ul className="divide-y divide-line">
      {reports.map((r) => {
        const open = r.status === 'OPEN' && !r.resolvedAt;
        // No status means the trip could not be hydrated — show no badge at
        // all rather than an "Unknown" one, which reads as a claim about the
        // trip rather than an absence of data.
        const tripMeta = r.trip?.status ? tripStatusMeta(r.trip.status) : null;

        return (
          <li key={r.id} className={`p-4 ${open ? 'bg-warn-soft/20' : ''}`}>
            <div className="flex flex-wrap items-start gap-3">
              <span
                className={`w-8 h-8 rounded-full grid place-items-center flex-none ${
                  open ? 'bg-warn-soft text-warn' : 'bg-surface-3 text-text-faint'
                }`}
              >
                <Icon name="flag" size={15} />
              </span>

              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="t-heading">{humanise(r.type)}</span>
                  {open ? (
                    <Badge tone="warn">Open</Badge>
                  ) : (
                    <Badge tone="accent" icon="check">Resolved</Badge>
                  )}
                  <span className="t-small text-text-faint" title={dateTime(r.createdAt)}>
                    filed {relative(r.createdAt)}
                  </span>
                </div>

                {r.details ? (
                  <p className="t-body text-text-dim whitespace-pre-wrap break-words max-w-[90ch]">
                    {r.details}
                  </p>
                ) : (
                  <p className="t-small text-text-faint">No details were provided.</p>
                )}

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 t-small text-text-dim">
                  <span>
                    Trip{' '}
                    {/*
                      The trip's own short code, which is what an operator reads
                      out on a call. This showed shortId(r.tripId) — the first
                      eight characters of the DATABASE id — so every report was
                      labelled with an opaque fragment while the real code sat
                      unused in the payload.
                    */}
                    <Link href={`/trips/${r.tripId}`} className="mono text-accent hover:underline">
                      {r.trip?.shortId ?? shortId(r.tripId)}
                    </Link>
                    {tripMeta ? (
                      <>
                        {' '}
                        <Badge tone={tripMeta.tone}>{tripMeta.label}</Badge>
                      </>
                    ) : null}
                  </span>
                  {r.driver ? (
                    <span>
                      Filed by{' '}
                      <Link href={`/drivers/${r.driver.id}`} className="hover:text-accent">
                        {r.driver.name}
                      </Link>
                      {' — '}
                      <a href={`tel:${r.driver.phone}`} className="mono text-accent hover:underline">
                        {fmtPhone(r.driver.phone)}
                      </a>
                    </span>
                  ) : (
                    <span className="text-text-faint">driver unknown</span>
                  )}
                  {r.resolvedAt ? <span>Cleared {dateTime(r.resolvedAt)}</span> : null}
                </div>
              </div>

              {open && canResolve ? (
                <ActionButton
                  action={() => resolveTripReport(r.id)}
                  label="Mark resolved"
                  icon="check"
                  variant="secondary"
                  confirm={{
                    title: 'Mark this report resolved?',
                    body: 'Confirm the incident has been investigated and actioned. Recorded against your name.',
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
