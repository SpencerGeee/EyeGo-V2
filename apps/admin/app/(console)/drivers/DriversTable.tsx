'use client';

import { ActionButton } from '@/components/ui/ActionButton';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Avatar, Badge, EmptyState } from '@/components/ui/primitives';
import { approveDriver, suspendDriver } from '@/lib/actions';
import { num, phone as fmtPhone, relative } from '@/lib/format';
import { driverStatusMeta, isDriverApproved, tierMeta } from '@/lib/status';

export type DriverRow = {
  id: string;
  name: string;
  phone: string;
  profilePhoto?: string | null;
  status: string;
  isOnline?: boolean;
  /** The driver's own "finishing this one, don't send me another" switch. */
  requestsPaused?: boolean;
  rating?: number | null;
  walletBalancePesewas?: number;
  createdAt: string;
  lastSeenAt?: string | null;
  vehicles?: { make?: string; model?: string; plateNumber?: string; tier?: string; seaterCount?: number }[];
  _count?: { trips: number };
};

export function DriversTable({
  rows,
  error,
  canModerate,
  readOnly,
}: {
  rows: DriverRow[] | null;
  error: string | null;
  canModerate: boolean;
  readOnly: boolean;
}) {
  const columns: Column<DriverRow>[] = [
    {
      key: 'name',
      header: 'Driver',
      sortValue: (d) => d.name?.toLowerCase(),
      render: (d) => (
        <>
          <Avatar name={d.name} src={d.profilePhoto} size={28} />
          <span className="min-w-0">
            <span className="block truncate-1 max-w-[170px]">{d.name}</span>
            <span className="block text-[11.5px] text-text-faint mono">{fmtPhone(d.phone)}</span>
          </span>
        </>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: (d) => d.status,
      render: (d) => {
        // Derived from the same helper the rest of the console uses, so a driver
        // is never described as free here and busy elsewhere.
        const meta = driverStatusMeta({
          status: d.status,
          isOnline: d.isOnline,
          requestsPaused: d.requestsPaused,
        });
        return (
          <Badge tone={meta.tone} live={meta.label === 'Available'}>
            {meta.label}
          </Badge>
        );
      },
    },
    {
      key: 'vehicle',
      header: 'Vehicle',
      hideBelow: 'md',
      render: (d) => {
        const v = d.vehicles?.[0];
        if (!v) return <span className="text-text-faint">none registered</span>;
        return (
          <span className="min-w-0">
            <span className="block truncate-1 max-w-[160px]">
              {[v.make, v.model].filter(Boolean).join(' ') || '—'}
            </span>
            <span className="block text-[11.5px] text-text-faint mono">{v.plateNumber || '—'}</span>
          </span>
        );
      },
    },
    {
      key: 'tier',
      header: 'Tier',
      hideBelow: 'lg',
      render: (d) => {
        const t = d.vehicles?.[0]?.tier;
        if (!t) return <span className="text-text-faint">—</span>;
        const meta = tierMeta(t);
        return <Badge tone={meta.tone}>{meta.label}</Badge>;
      },
    },
    {
      key: 'trips',
      header: 'Trips',
      align: 'right',
      sortValue: (d) => d._count?.trips ?? 0,
      render: (d) => num(d._count?.trips ?? 0),
    },
    {
      key: 'rating',
      header: 'Rating',
      align: 'right',
      sortValue: (d) => d.rating ?? null,
      render: (d) =>
        d.rating === null || d.rating === undefined ? (
          <span className="text-text-faint">unrated</span>
        ) : (
          <span className={d.rating < 4 ? 'text-warn' : undefined}>{d.rating.toFixed(1)}</span>
        ),
    },
    {
      key: 'joined',
      header: 'Joined',
      align: 'right',
      hideBelow: 'lg',
      sortValue: (d) => d.createdAt,
      render: (d) => <span className="text-text-faint">{relative(d.createdAt)}</span>,
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(d) => d.id}
      rowHref={(d) => `/drivers/${d.id}`}
      caption="All drivers"
      error={error}
      rowTone={(d) => (d.status === 'SUSPENDED' ? 'danger' : d.status === 'PENDING_REVIEW' ? 'warn' : null)}
      empty={
        <EmptyState
          icon="wheel"
          title="No drivers match"
          body="Nothing matches the current search and filters. Clear them to see the full fleet."
        />
      }
      rowActions={(d) => {
        if (readOnly || !canModerate) return null;
        return (
          <>
            {d.status === 'PENDING_REVIEW' ? (
              <ActionButton
                action={() => approveDriver(d.id)}
                label="Approve"
                icon="check"
                variant="primary"
                confirm={{
                  title: `Approve ${d.name}?`,
                  body: 'They will be able to go online and accept trips immediately.',
                  confirmLabel: 'Approve driver',
                }}
              />
            ) : null}
            {isDriverApproved(d.status) ? (
              <ActionButton
                action={(reason) => suspendDriver(d.id, reason)}
                label="Suspend"
                icon="ban"
                variant="danger"
                confirm={{
                  title: `Suspend ${d.name}?`,
                  body: 'They are taken offline at once and cannot accept trips until reinstated.',
                  confirmLabel: 'Suspend driver',
                  reason: {
                    label: 'Why are you suspending this driver?',
                    placeholder: 'e.g. Repeated no-shows reported by riders',
                    required: true,
                  },
                }}
              />
            ) : null}
          </>
        );
      }}
    />
  );
}
