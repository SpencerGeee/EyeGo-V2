import type { Metadata } from 'next';
import Link from 'next/link';

import { DispatchBoard, type LiveDriver, type StrandedTrip } from './DispatchBoard';
import { RefreshControl } from '@/components/ui/Filters';
import { Icon } from '@/components/ui/Icon';
import { Badge, Card, CardHead, EmptyState, ErrorPanel, PageHeader, StatCard } from '@/components/ui/primitives';
import { apiGetSafe, getAdmin } from '@/lib/api';
import { num, relative, tripRef } from '@/lib/format';
import { can, isReadOnly } from '@/lib/roles';
import { driverAccountMeta, isLiveTrip, tripStatusMeta } from '@/lib/status';

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
type DispatchHealth = {
  pool: { size: number; presenceTtlSeconds: number };
  drivers: {
    id: string;
    name: string;
    status: string;
    isOnline: boolean;
    requestsPaused: boolean;
    hasGps: boolean;
    inSupplyPool: boolean;
    dispatchable: boolean;
    canBeWoken: boolean;
    activeTrip?: { id: string; status: string } | null;
    vehicle?: { tier: string; plateNumber?: string; isVerified: boolean } | null;
    reason?: string | null;
  }[];
  awaiting: {
    id: string;
    shortId?: string;
    status: string;
    tier?: string;
    createdAt: string;
    pickupAddress?: string | null;
    hasPickupCoords: boolean;
    lastProgress?: Record<string, unknown> | null;
  }[];
};

export default async function DispatchPage() {
  const admin = await getAdmin();

  const [drivers, stranded, active, health] = await Promise.all([
    apiGetSafe<{ drivers: LiveDriver[] }>('/live/drivers'),
    apiGetSafe<{ trips: StrandedTrip[] }>('/trips/unassigned'),
    apiGetSafe<{ trips: ActiveTrip[] }>('/trips/active'),
    apiGetSafe<DispatchHealth>('/dispatch/health'),
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
          hint={stranded?.trips.length ? 'searching too long, or driver offline' : 'nothing stranded'}
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

      {/* ── WHY DISPATCH IS OR IS NOT MATCHING ──
          The panel that answers "the rider requested and nothing reached the
          driver phone" without a psql session.

          The distinction it exists to make: `isOnline` in Postgres is NOT the
          dispatch pool. The pool is a Redis geo-set refreshed by the driver app's
          location pings, with a 90-second presence key. A driver whose app is
          open but whose socket has stopped emitting drops out of the pool and
          receives nothing, while every other screen still shows them online. */}
      {health ? (
        <Card flush className="mt-4">
          <CardHead
            title="Dispatch health"
            subtitle={`Supply pool: ${num(health.pool.size)} driver${
              health.pool.size === 1 ? '' : 's'
            } pinging · presence expires after ${health.pool.presenceTtlSeconds}s without a ping`}
            icon="radar"
          />

          {health.pool.size === 0 ? (
            <div role="note" className="mx-4 mt-4 p-3.5 rounded-lg bg-warn-soft border border-warn-rim">
              <p className="t-heading text-warn">The supply pool is empty</p>
              <p className="t-small text-text-dim mt-1 max-w-[86ch]">
                No driver is currently reporting a position, so dispatch has nobody to
                offer a trip to and every request will end in{' '}
                <span className="mono">NO_DRIVERS_FOUND</span> after the search window.
                A driver must be online <em>and</em> sending location updates to be in
                the pool.
              </p>
            </div>
          ) : null}

          <div className="table-scroll">
            <table className="table">
              <caption className="sr-only">Per-driver dispatch eligibility</caption>
              <thead>
                <tr>
                  <th scope="col">Driver</th>
                  <th scope="col">Dispatchable</th>
                  <th scope="col">Account</th>
                  <th scope="col">In supply pool</th>
                  <th scope="col" className="hidden md:table-cell">Can be woken</th>
                  <th scope="col">Why not</th>
                </tr>
              </thead>
              <tbody>
                {health.drivers.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link href={`/drivers/${d.id}`} className="hover:text-accent">
                        {d.name}
                      </Link>
                      {d.vehicle ? (
                        <span className="block t-small text-text-dim mono">
                          {d.vehicle.plateNumber} · {d.vehicle.tier}
                          {d.vehicle.isVerified ? '' : ' · unverified'}
                        </span>
                      ) : (
                        <span className="block t-small text-warn">no active vehicle</span>
                      )}
                    </td>
                    <td>
                      {d.dispatchable ? (
                        <Badge tone="accent" icon="check">Yes</Badge>
                      ) : (
                        <Badge tone="neutral" icon="x">No</Badge>
                      )}
                    </td>
                    <td>
                      <Badge tone={driverAccountMeta(d.status).tone}>
                        {driverAccountMeta(d.status).label}
                      </Badge>
                    </td>
                    <td>
                      {d.inSupplyPool ? (
                        <Badge tone="accent">Pinging</Badge>
                      ) : d.isOnline ? (
                        // The case worth naming: the DB says online, the pool
                        // disagrees, and the pool is what dispatch searches.
                        <Badge tone="warn" icon="alert">Online but not pinging</Badge>
                      ) : (
                        <Badge tone="neutral">Offline</Badge>
                      )}
                    </td>
                    <td className="hidden md:table-cell">
                      {d.canBeWoken ? (
                        <span className="t-small text-text-dim">push registered</span>
                      ) : (
                        <span className="t-small text-warn inline-flex items-center gap-1">
                          <Icon name="alert" size={12} />
                          socket only
                        </span>
                      )}
                    </td>
                    <td className="t-small text-text-dim mono truncate-1 max-w-[240px]">
                      {d.reason ??
                        (d.dispatchable
                          ? '—'
                          : d.inSupplyPool
                            ? 'eligible, in pool'
                            : 'not in the supply pool')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {health.awaiting.length > 0 ? (
            <div className="px-4 py-3 border-t border-line">
              <p className="t-eyebrow mb-2">Still waiting for a driver</p>
              <ul className="space-y-1.5">
                {health.awaiting.map((t) => (
                  <li key={t.id} className="t-small flex flex-wrap items-center gap-2">
                    <Link href={`/trips/${t.id}`} className="mono text-accent hover:underline">
                      {tripRef(t)}
                    </Link>
                    <Badge tone={tripStatusMeta(t.status).tone}>{tripStatusMeta(t.status).label}</Badge>
                    <span className="text-text-dim">
                      {t.pickupAddress || 'pickup not named'} · requested {relative(t.createdAt)}
                    </span>
                    {!t.hasPickupCoords ? (
                      <Badge tone="danger" icon="alert">No pickup coordinates — cannot be matched</Badge>
                    ) : null}
                    {t.lastProgress ? (
                      <span className="text-text-faint mono">
                        {String((t.lastProgress as { phase?: string }).phase ?? 'searching')}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      ) : null}

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
                          {tripRef(t)}
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
