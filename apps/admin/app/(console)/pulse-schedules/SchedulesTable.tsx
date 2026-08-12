'use client';

import { ActionButton } from '@/components/ui/ActionButton';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Badge, Card, EmptyState, ReadOnlyNote } from '@/components/ui/primitives';
import { deletePulseSchedule } from '@/lib/actions';
import { num } from '@/lib/format';
import { tierMeta } from '@/lib/status';

export type PulseSchedule = {
  id: string;
  routeId: string;
  tier: string;
  /** Stored as a plain "HH:MM" string, not a timestamp. */
  departureTime: string;
  /** Comma-separated day numbers or names, depending on how it was created. */
  daysOfWeek: string;
  maxSeats: number;
  isActive: boolean;
  createdAt: string;
  route?: { id?: string; name?: string; originName?: string; destinationName?: string } | null;
  _count?: { trips: number };
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * daysOfWeek is a free-form string in the schema, so it may arrive as "1,2,3" or
 * as "MON,TUE". Both are rendered rather than assuming one and showing the raw
 * value — or worse, showing nothing — when the other turns up.
 */
function formatDays(raw: string): string {
  if (!raw) return '—';
  const parts = raw
    .split(/[,\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 7) return 'Every day';

  return parts
    .map((p) => {
      const n = Number(p);
      if (Number.isInteger(n) && n >= 0 && n <= 6) return DAY_NAMES[n];
      return p.slice(0, 3).replace(/^./, (c) => c.toUpperCase());
    })
    .join(', ');
}

export function SchedulesTable({
  schedules,
  canManage,
  readOnlyReason,
}: {
  schedules: PulseSchedule[];
  canManage: boolean;
  readOnlyReason: string;
}) {
  const columns: Column<PulseSchedule>[] = [
    {
      key: 'route',
      header: 'Route',
      sortValue: (s) => s.route?.name ?? s.routeId,
      render: (s) => (
        <span className="min-w-0">
          <span className="block truncate-1 max-w-[220px]">
            {s.route?.name ||
              [s.route?.originName, s.route?.destinationName].filter(Boolean).join(' → ') ||
              'Unnamed route'}
          </span>
          <span className="block text-[11.5px] text-text-faint mono">{s.routeId.slice(0, 8)}</span>
        </span>
      ),
    },
    {
      key: 'departure',
      header: 'Departs',
      sortValue: (s) => s.departureTime,
      render: (s) => <span className="mono">{s.departureTime || '—'}</span>,
    },
    {
      key: 'days',
      header: 'Days',
      render: (s) => <span className="text-text-dim">{formatDays(s.daysOfWeek)}</span>,
    },
    {
      key: 'tier',
      header: 'Tier',
      hideBelow: 'md',
      render: (s) => <Badge tone={tierMeta(s.tier).tone}>{tierMeta(s.tier).label}</Badge>,
    },
    {
      key: 'seats',
      header: 'Seats',
      align: 'right',
      sortValue: (s) => s.maxSeats,
      render: (s) => num(s.maxSeats),
    },
    {
      key: 'trips',
      header: 'Trips spawned',
      align: 'right',
      hideBelow: 'lg',
      sortValue: (s) => s._count?.trips ?? 0,
      render: (s) => num(s._count?.trips ?? 0),
    },
    {
      key: 'state',
      header: 'State',
      render: (s) =>
        s.isActive ? (
          <Badge tone="accent" icon="check">Active</Badge>
        ) : (
          <Badge tone="neutral" icon="ban">Paused</Badge>
        ),
    },
  ];

  return (
    <Card flush>
      <div className="card-head">
        <div>
          <div className="t-heading">
            {schedules.length} schedule{schedules.length === 1 ? '' : 's'}
          </div>
          <div className="t-small text-text-faint mt-0.5">
            {num(schedules.filter((s) => s.isActive).length)} active
          </div>
        </div>
      </div>

      <DataTable
        rows={schedules}
        columns={columns}
        rowKey={(s) => s.id}
        caption="Pulse schedules"
        rowTone={(s) => (!s.isActive ? 'warn' : null)}
        empty={
          <EmptyState
            icon="clock"
            title="No pulse schedules"
            body="No recurring departures are configured. Trips are only created on demand."
          />
        }
        rowActions={(s) =>
          canManage ? (
            <ActionButton
              action={() => deletePulseSchedule(s.id)}
              label="Delete"
              icon="x"
              variant="danger"
              confirm={{
                title: 'Delete this schedule?',
                body: 'No further trips will be spawned from it. Trips it already created are not affected.',
                confirmLabel: 'Delete schedule',
              }}
            />
          ) : null
        }
      />

      {!canManage ? (
        <div className="px-4 py-3 border-t border-line">
          <ReadOnlyNote>{readOnlyReason}</ReadOnlyNote>
        </div>
      ) : null}
    </Card>
  );
}
