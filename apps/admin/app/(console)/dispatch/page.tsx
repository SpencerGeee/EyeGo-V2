import type { Metadata } from 'next';
import Link from 'next/link';

import { DispatchBoard, type LiveDriver, type StrandedTrip } from './DispatchBoard';
import { RefreshControl } from '@/components/ui/Filters';
import { Badge, Card, CardHead, EmptyState, ErrorPanel, PageHeader, StatCard } from '@/components/ui/primitives';
import { apiGetSafe, getAdmin } from '@/lib/api';
import { num, relative, shortId } from '@/lib/format';
import { can, isReadOnly } from '@/lib/roles';
import { isLiveTrip, tripStatusMeta } from '@/lib/status';

export const metadata: Metadata = { title: 'Live dispatch' };

type ActiveTrip = {
  id: string;
  shortId?: string;
  status: string;
  createdAt: string;
  driver?: { id: string; name: string; phone?: string } | null;
  route?: { originName?: string; destinationName?: string } | null;
  _count?: { bookings: number };
};

/**
 * Dispatch.
 *
 * Three questions, in the order an operator asks them:
 *   1. what is stranded and needs a hand right now
 *   2. who is free to take it
 *   3. what is already moving
 *
 * "Stranded" means a non-terminal trip whose assigned driver has gone offline.
 * A driver counts as busy if they hold any trip in a driver-occupying status —
 * which includes ARRIVED_AT_PICKUP and DRIVER_ASSIGNED. Those omissions used to
 * make a driver with a rider walking up to their car look available, which is
 * how the same vehicle gets dispatched twice.
 */
export default async function DispatchPage() {
  const admin = await getAdmin();

  const [drivers, stranded, active] = await Promise.all([
    apiGetSafe<{ drivers: LiveDriver[] }>('/live/drivers'),
    apiGetSafe<{ trips: StrandedTrip[] }>('/trips/unassigned'),
    apiGetSafe<{ trips: ActiveTrip[] }>('/trips/active'),
  ]);

  const online = drivers?.drivers ?? [];
  const free = online.filter((d) => !d.activeTripId);
  const busy = online.filter((d) => d.activeTripId);
  const noGps = online.filter((d) => d.lat === null || d.lng === null);

  const canAssign = can(admin?.role, ['OPS']) && !isReadOnly(admin?.role);

  return (
    <>
      <PageHeader
        title="Live dispatch"
        subtitle="Drivers online now, trips that lost their driver, and everything currently moving."
        actions={<RefreshControl intervalSeconds={15} />}
      />

      <section aria-label="Dispatch summary" className="grid gap-3 mb-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Needs a driver"
          value={num(stranded?.trips.length ?? 0)}
          hint={stranded?.trips.length ? 'assigned driver is offline' : 'nothing stranded'}
          icon="alert"
          tone={stranded?.trips.length ? 'danger' : undefined}
        />
        <StatCard label="Free to dispatch" value={num(free.length)} hint="online with no active trip" icon="wheel" />
        <StatCard label="On a trip" value={num(busy.length)} hint="online and occupied" icon="route" />
        <StatCard
          label="No GPS fix"
          value={num(noGps.length)}
          hint={noGps.length ? 'cannot be placed on a map' : 'all drivers located'}
          icon="pin"
          tone={noGps.length ? 'warn' : undefined}
        />
      </section>

      {!drivers || !stranded ? (
        <Card className="mb-4">
          <ErrorPanel
            title="Dispatch data is incomplete"
            message="One or more dispatch endpoints did not respond. Do not treat the counts above as authoritative until this clears."
          />
        </Card>
      ) : (
        <DispatchBoard
          drivers={online}
          stranded={stranded.trips}
          canAssign={canAssign}
          readOnlyReason={
            can(admin?.role, ['OPS'])
              ? 'Your role is read-only.'
              : 'Only Operations can reassign a trip.'
          }
        />
      )}

      {/* ── Already moving ── */}
      <Card flush className="mt-4">
        <CardHead
          title="On the road"
          subtitle="En route to pickup, waiting at pickup, or carrying a rider"
          icon="radar"
        />
        {!active ? (
          <ErrorPanel message="Could not load active trips." />
        ) : active.trips.length === 0 ? (
          <EmptyState icon="radar" title="Nothing moving" body="No trip is currently on the road." />
        ) : (
          <div className="table-scroll">
            <table className="table">
              <caption className="sr-only">Trips currently on the road</caption>
              <thead>
                <tr>
                  <th scope="col">Trip</th>
                  <th scope="col">Status</th>
                  <th scope="col">Driver</th>
                  <th scope="col" className="hidden md:table-cell">Route</th>
                  <th scope="col" className="text-right">Riders</th>
                  <th scope="col" className="text-right">Age</th>
                </tr>
              </thead>
              <tbody>
                {active.trips.map((t) => {
                  const meta = tripStatusMeta(t.status);
                  return (
                    <tr key={t.id}>
                      <td>
                        <Link href={`/trips/${t.id}`} className="mono hover:text-accent">
                          {shortId(t.shortId || t.id)}
                        </Link>
                      </td>
                      <td>
                        <Badge tone={meta.tone} live={isLiveTrip(t.status)}>
                          {meta.label}
                        </Badge>
                      </td>
                      <td className="truncate-1 max-w-[170px]">
                        {t.driver ? (
                          <Link href={`/drivers/${t.driver.id}`} className="hover:text-accent">
                            {t.driver.name}
                          </Link>
                        ) : (
                          <span className="text-text-faint">unassigned</span>
                        )}
                      </td>
                      <td className="hidden md:table-cell text-text-dim truncate-1 max-w-[260px]">
                        {t.route?.originName || '—'} → {t.route?.destinationName || '—'}
                      </td>
                      <td className="num">{num(t._count?.bookings ?? 0)}</td>
                      <td className="num text-text-faint">{relative(t.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
