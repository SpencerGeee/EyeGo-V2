import type { Metadata } from 'next';
import Link from 'next/link';

import { RefreshControl } from '@/components/ui/Filters';
import { Icon } from '@/components/ui/Icon';
import {
  Avatar,
  Badge,
  Card,
  EmptyState,
  ErrorPanel,
  PageHeader,
} from '@/components/ui/primitives';
import { apiGetSafe } from '@/lib/api';
import { minutesSince, num, phone as fmtPhone, relative } from '@/lib/format';
import { tierMeta } from '@/lib/status';

export const metadata: Metadata = { title: 'Driver approvals' };

type PendingDriver = {
  id: string;
  name: string;
  phone: string;
  profilePhoto?: string | null;
  ghanaCardNumber?: string | null;
  createdAt: string;
  vehicles?: { make?: string; model?: string; plateNumber?: string; tier?: string; seaterCount?: number }[];
};

/**
 * The approval queue.
 *
 * Ordered oldest-first, and every row shows how long the applicant has been
 * waiting — an approval queue is a person who cannot earn until someone looks at
 * it, so waiting time is the number that matters, not the name.
 *
 * Approving happens on the driver's own page rather than from here, because
 * approval requires reading three documents and a one-click approve from a list
 * is an invitation to rubber-stamp.
 */
export default async function PendingDriversPage() {
  const data = await apiGetSafe<{ drivers: PendingDriver[] }>('/drivers/pending');

  const overdue = (createdAt: string) => (minutesSince(createdAt) ?? 0) > 60 * 24 * 2;

  return (
    <>
      <PageHeader
        title="Driver approvals"
        subtitle="Applicants waiting on a compliance review. Nobody in this list can earn yet."
        actions={<RefreshControl />}
      />

      {!data ? (
        <Card>
          <ErrorPanel message="Could not load the approval queue." />
        </Card>
      ) : data.drivers.length === 0 ? (
        <Card>
          <EmptyState
            icon="badge-check"
            title="Queue is clear"
            body="Every driver application has been reviewed. New applications appear here as they arrive."
            action={
              <Link href="/drivers" className="btn btn-secondary btn-sm">
                View all drivers
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          <p className="t-small text-text-dim mb-3">
            {num(data.drivers.length)} waiting · oldest {relative(data.drivers[0]?.createdAt)}
          </p>

          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.drivers.map((d) => {
              const vehicle = d.vehicles?.[0];
              const late = overdue(d.createdAt);
              return (
                <li key={d.id}>
                  <Link
                    href={`/drivers/${d.id}`}
                    className={`card block p-4 h-full transition-colors hover:border-line-strong ${
                      late ? '!border-warn-rim' : ''
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <Avatar name={d.name} src={d.profilePhoto} size={38} />
                      <div className="flex-1 min-w-0">
                        <p className="t-heading truncate-1">{d.name}</p>
                        <p className="t-small text-text-faint mono">{fmtPhone(d.phone)}</p>
                      </div>
                      <Icon name="chevron-right" size={15} className="text-text-faint mt-1" />
                    </div>

                    <div className="mt-3 pt-3 border-t border-line space-y-1.5">
                      <p className="t-small text-text-dim truncate-1">
                        {vehicle
                          ? [vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle registered'
                          : 'No vehicle registered'}
                        {vehicle?.plateNumber ? (
                          <span className="mono text-text-faint"> · {vehicle.plateNumber}</span>
                        ) : null}
                      </p>
                      <div className="flex items-center justify-between gap-2">
                        {vehicle?.tier ? (
                          <Badge tone={tierMeta(vehicle.tier).tone}>{tierMeta(vehicle.tier).label}</Badge>
                        ) : (
                          <Badge tone="neutral">No tier</Badge>
                        )}
                        <span className={`t-small ${late ? 'text-warn font-medium' : 'text-text-faint'}`}>
                          waiting {relative(d.createdAt).replace(' ago', '')}
                        </span>
                      </div>
                    </div>

                    {!vehicle ? (
                      <p className="t-small text-warn mt-2.5 flex items-start gap-1.5">
                        <Icon name="alert" size={12} className="mt-0.5" />
                        No vehicle on file — they cannot be dispatched even once approved.
                      </p>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
