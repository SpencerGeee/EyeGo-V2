import type { Metadata } from 'next';
import Link from 'next/link';

import { PaymentMixChart, RevenueChart, StatusBreakdown, TripsChart } from '@/components/charts/Charts';
import { RefreshControl } from '@/components/ui/Filters';
import { Icon } from '@/components/ui/Icon';
import {
  Badge,
  Card,
  CardBody,
  CardHead,
  EmptyState,
  ErrorPanel,
  PageHeader,
  StatCard,
} from '@/components/ui/primitives';
import { apiGetSafe, getAdmin } from '@/lib/api';
import { ghsCompact, num, pct, relative } from '@/lib/format';
import { can } from '@/lib/roles';
import { tripStatusMeta } from '@/lib/status';

export const metadata: Metadata = { title: 'Dashboard' };

type Metrics = {
  activeTrips: number;
  driversOnline: number;
  todayRevenuePesewas: number;
  todayCommissionPesewas: number;
  totalUsers: number;
  totalDrivers: number;
  pendingApprovals: number;
};

type Overview = {
  totalRevenuePesewas: number;
  todayRevenuePesewas: number;
  weekRevenuePesewas: number;
  monthRevenuePesewas: number;
  totalCommissionPesewas: number;
  revenueByDay: { date: string; valuePesewas: number }[];
  tripsByStatus: Record<string, number>;
  tripsByDay: { date: string; value: number }[];
  completedTripsCount: number;
  cancelledTripsCount: number;
  cancellationRate: number;
  activeTripsNow: number;
  driversOnlineNow: number;
  totalDrivers: number;
  activeDrivers: number;
  pendingDriverApprovals: number;
  suspendedDrivers: number;
  totalRiders: number;
  newRidersThisWeek: number;
  avgFarePesewas: number;
  totalBookings: number;
  paymentMethodBreakdown: { cash: number; card: number };
};

type ActiveTrip = {
  id: string;
  shortId?: string;
  status: string;
  createdAt: string;
  driver?: { id: string; name: string } | null;
  route?: { originName?: string; destinationName?: string } | null;
  _count?: { bookings: number };
};

type SosEvent = { id: string; createdAt: string; resolved?: boolean; type?: string };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const { denied } = await searchParams;
  const admin = await getAdmin();

  // Every panel is fetched independently and tolerates its own failure. One
  // dead endpoint must degrade one card, not blank the operator's whole screen.
  const [metrics, overview, active, sos] = await Promise.all([
    apiGetSafe<Metrics>('/metrics'),
    apiGetSafe<Overview>('/analytics/overview'),
    apiGetSafe<{ trips: ActiveTrip[] }>('/trips/active'),
    apiGetSafe<{ events: SosEvent[]; total: number }>('/sos-events?unresolvedOnly=true&limit=5'),
  ]);

  const unresolvedSos = sos?.total ?? 0;

  return (
    <>
      <PageHeader
        title={`Good day, ${admin?.name?.split(' ')[0] ?? 'there'}`}
        subtitle="Live state of the platform. All money is settled cash and card together; all times UTC."
        actions={<RefreshControl intervalSeconds={30} />}
      />

      {denied ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 p-3 mb-5 rounded-md bg-warn-soft border border-warn-rim"
        >
          <Icon name="lock" size={15} className="text-warn mt-0.5" />
          <p className="t-small text-warn">
            Your role cannot open <code className="mono">{denied}</code>, so you were sent here
            instead. Ask a superadmin if you need that access.
          </p>
        </div>
      ) : null}

      {/* SOS is the one thing that jumps the queue. It sits above every other
          panel, uses the reserved critical colour, and is never collapsed. */}
      {unresolvedSos > 0 ? (
        <Link
          href="/sos"
          className="flex items-center gap-3 p-3.5 mb-5 rounded-lg border border-critical bg-critical-soft hover:border-critical transition-colors"
        >
          <span className="dot dot-live text-critical" />
          <div className="flex-1 min-w-0">
            <p className="t-heading text-critical">
              {unresolvedSos} unresolved SOS {unresolvedSos === 1 ? 'event' : 'events'}
            </p>
            <p className="t-small text-text-dim mt-0.5">
              Oldest raised {relative(sos?.events?.[sos.events.length - 1]?.createdAt)}. Triage now.
            </p>
          </div>
          <Icon name="chevron-right" size={17} className="text-critical" />
        </Link>
      ) : null}

      {/* ── KPIs ── */}
      {metrics ? (
        <section
          aria-label="Key figures"
          className="grid gap-3 mb-5 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
        >
          <StatCard
            label="Trips live now"
            value={num(metrics.activeTrips)}
            hint="en route, at pickup or moving"
            icon="route"
            href="/dispatch"
          />
          <StatCard
            label="Drivers online"
            value={num(metrics.driversOnline)}
            hint={`of ${num(metrics.totalDrivers)} total`}
            icon="wheel"
            href="/dispatch"
          />
          <StatCard
            label="Revenue today"
            value={ghsCompact(metrics.todayRevenuePesewas)}
            hint="settled fares, cash + card"
            icon="cash"
            href={can(admin?.role, ['FINANCE']) ? '/revenue' : undefined}
          />
          <StatCard
            label="Commission today"
            value={ghsCompact(metrics.todayCommissionPesewas)}
            hint="platform share"
            icon="tag"
          />
          <StatCard
            label="Riders"
            value={num(metrics.totalUsers)}
            hint={overview ? `+${num(overview.newRidersThisWeek)} this week` : undefined}
            icon="users"
            href="/users"
          />
          <StatCard
            label="Awaiting approval"
            value={num(metrics.pendingApprovals)}
            hint={metrics.pendingApprovals > 0 ? 'drivers blocked from earning' : 'queue clear'}
            icon="badge-check"
            tone={metrics.pendingApprovals > 0 ? 'warn' : undefined}
            href="/drivers/pending"
          />
        </section>
      ) : (
        <Card className="mb-5">
          <ErrorPanel
            title="Key figures unavailable"
            message="The /metrics endpoint did not respond. The numbers below may also be incomplete."
          />
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        {/* ── Revenue ── */}
        <Card flush className="xl:col-span-2">
          <CardHead
            title="Revenue, last 14 days"
            subtitle={
              overview
                ? `${ghsCompact(overview.weekRevenuePesewas)} this week · ${ghsCompact(
                    overview.monthRevenuePesewas
                  )} this month · ${ghsCompact(overview.avgFarePesewas)} average fare`
                : undefined
            }
            icon="cash"
          />
          <CardBody>
            <RevenueChart data={overview?.revenueByDay ?? null} />
          </CardBody>
        </Card>

        {/* ── Payment mix ── */}
        <Card flush>
          <CardHead
            title="How riders pay"
            subtitle="Cash dominance is why revenue is counted from bookings, not card transactions"
            icon="cash"
          />
          <CardBody>
            <PaymentMixChart mix={overview?.paymentMethodBreakdown ?? null} />
          </CardBody>
        </Card>

        {/* ── Trip volume ── */}
        <Card flush className="xl:col-span-2">
          <CardHead
            title="Trips created, last 14 days"
            subtitle={
              overview
                ? `${num(overview.completedTripsCount)} completed · ${num(
                    overview.cancelledTripsCount
                  )} cancelled · ${pct(overview.cancellationRate)} cancellation rate`
                : undefined
            }
            icon="chart"
          />
          <CardBody>
            <TripsChart data={overview?.tripsByDay ?? null} />
          </CardBody>
        </Card>

        {/* ── Status mix ── */}
        <Card flush>
          <CardHead title="Trip outcomes" subtitle="All time, by status" icon="grid" />
          <CardBody>
            <StatusBreakdown data={overview?.tripsByStatus ?? null} />
          </CardBody>
        </Card>

        {/* ── Live trips ── */}
        <Card flush className="xl:col-span-3">
          <CardHead
            title="On the road right now"
            subtitle="Includes drivers waiting at the pickup point"
            icon="radar"
            actions={
              <Link href="/dispatch" className="btn btn-secondary btn-sm">
                Open dispatch
                <Icon name="chevron-right" size={13} />
              </Link>
            }
          />
          {!active ? (
            <ErrorPanel message="Could not load live trips." />
          ) : active.trips.length === 0 ? (
            <EmptyState
              icon="radar"
              title="Nothing on the road"
              body="No trip is currently en route, at a pickup point or in progress."
            />
          ) : (
            <div className="table-scroll">
              <table className="table">
                <caption className="sr-only">Trips currently in progress</caption>
                <thead>
                  <tr>
                    <th scope="col">Trip</th>
                    <th scope="col">Status</th>
                    <th scope="col">Driver</th>
                    <th scope="col" className="hidden md:table-cell">
                      Route
                    </th>
                    <th scope="col" className="text-right">
                      Seats
                    </th>
                    <th scope="col" className="text-right">
                      Started
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {active.trips.slice(0, 8).map((trip) => {
                    const meta = tripStatusMeta(trip.status);
                    return (
                      <tr key={trip.id}>
                        <td>
                          <Link href={`/trips/${trip.id}`} className="mono hover:text-accent">
                            {(trip.shortId || trip.id).slice(0, 8)}
                          </Link>
                        </td>
                        <td>
                          <Badge tone={meta.tone} live={trip.status === 'IN_PROGRESS'}>
                            {meta.label}
                          </Badge>
                        </td>
                        <td className="truncate-1 max-w-[170px]">
                          {trip.driver ? (
                            <Link href={`/drivers/${trip.driver.id}`} className="hover:text-accent">
                              {trip.driver.name}
                            </Link>
                          ) : (
                            <span className="text-text-faint">unassigned</span>
                          )}
                        </td>
                        <td className="hidden md:table-cell truncate-1 max-w-[280px] text-text-dim">
                          {trip.route?.originName || '—'} → {trip.route?.destinationName || '—'}
                        </td>
                        <td className="num">{num(trip._count?.bookings ?? 0)}</td>
                        <td className="num text-text-faint">{relative(trip.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
