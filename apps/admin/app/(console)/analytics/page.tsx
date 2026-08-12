import type { Metadata } from 'next';

import { PaymentMixChart, RevenueChart, StatusBreakdown, TripsChart } from '@/components/charts/Charts';
import { RefreshControl } from '@/components/ui/Filters';
import {
  Card,
  CardBody,
  CardHead,
  Detail,
  ErrorPanel,
  PageHeader,
  StatCard,
} from '@/components/ui/primitives';
import { apiGetSafe } from '@/lib/api';
import { ghsCompact, num, pct } from '@/lib/format';

export const metadata: Metadata = { title: 'Analytics' };

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

type Drivers = Record<string, unknown>;
type Safety = Record<string, unknown>;
type Scheduled = Record<string, unknown>;

/**
 * Platform analytics.
 *
 * Every figure here derives from settled bookings (paymentStatus PAID), which is
 * the only correct revenue source on a cash-majority platform — counting card
 * transactions is why revenue once appeared to be near zero.
 */
export default async function AnalyticsPage() {
  const [overview, drivers, safety, scheduled] = await Promise.all([
    apiGetSafe<Overview>('/analytics/overview'),
    apiGetSafe<Drivers>('/analytics/drivers'),
    apiGetSafe<Safety>('/analytics/safety'),
    apiGetSafe<Scheduled>('/analytics/scheduled'),
  ]);

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="Revenue, supply and demand across the platform. All money is settled fares, cash and card together."
        actions={<RefreshControl intervalSeconds={120} />}
      />

      {!overview ? (
        <Card className="mb-4">
          <ErrorPanel
            title="Analytics unavailable"
            message="The /analytics/overview endpoint did not respond."
          />
        </Card>
      ) : (
        <>
          <section aria-label="Revenue" className="grid gap-3 mb-4 grid-cols-2 lg:grid-cols-5">
            <StatCard label="Revenue today" value={ghsCompact(overview.todayRevenuePesewas)} icon="cash" />
            <StatCard label="This week" value={ghsCompact(overview.weekRevenuePesewas)} icon="cash" />
            <StatCard label="This month" value={ghsCompact(overview.monthRevenuePesewas)} icon="cash" />
            <StatCard label="All time" value={ghsCompact(overview.totalRevenuePesewas)} icon="cash" />
            <StatCard
              label="Platform commission"
              value={ghsCompact(overview.totalCommissionPesewas)}
              hint="all time"
              icon="tag"
            />
          </section>

          <div className="grid gap-4 xl:grid-cols-3 mb-4">
            <Card flush className="xl:col-span-2">
              <CardHead
                title="Revenue, last 14 days"
                subtitle={`Average fare ${ghsCompact(overview.avgFarePesewas)}`}
                icon="cash"
              />
              <CardBody>
                <RevenueChart data={overview.revenueByDay} />
              </CardBody>
            </Card>

            <Card flush>
              <CardHead title="Payment mix" subtitle={`${num(overview.totalBookings)} bookings`} icon="cash" />
              <CardBody>
                <PaymentMixChart mix={overview.paymentMethodBreakdown} />
              </CardBody>
            </Card>

            <Card flush className="xl:col-span-2">
              <CardHead
                title="Trips created, last 14 days"
                subtitle={`${pct(overview.cancellationRate)} cancellation rate`}
                icon="chart"
              />
              <CardBody>
                <TripsChart data={overview.tripsByDay} />
              </CardBody>
            </Card>

            <Card flush>
              <CardHead title="Trip outcomes" subtitle="All time" icon="grid" />
              <CardBody>
                <StatusBreakdown data={overview.tripsByStatus} />
              </CardBody>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHead title="Supply" icon="wheel" />
              <CardBody>
                <dl>
                  <Detail label="Drivers online now">{num(overview.driversOnlineNow)}</Detail>
                  <Detail label="Total drivers">{num(overview.totalDrivers)}</Detail>
                  <Detail label="Active drivers">{num(overview.activeDrivers)}</Detail>
                  <Detail label="Awaiting approval">{num(overview.pendingDriverApprovals)}</Detail>
                  <Detail label="Suspended">{num(overview.suspendedDrivers)}</Detail>
                </dl>
              </CardBody>
            </Card>

            <Card>
              <CardHead title="Demand" icon="users" />
              <CardBody>
                <dl>
                  <Detail label="Total riders">{num(overview.totalRiders)}</Detail>
                  <Detail label="New this week">{num(overview.newRidersThisWeek)}</Detail>
                  <Detail label="Trips live now">{num(overview.activeTripsNow)}</Detail>
                  <Detail label="Completed trips">{num(overview.completedTripsCount)}</Detail>
                  <Detail label="Cancelled trips">{num(overview.cancelledTripsCount)}</Detail>
                </dl>
              </CardBody>
            </Card>

            {/* The three secondary analytics endpoints return open-ended shapes.
                Rather than inventing a layout that silently drops fields when the
                backend adds one, they are rendered generically — every key that
                comes back is shown. */}
            <Card>
              <CardHead title="Fleet, safety & scheduling" subtitle="Secondary analytics" icon="chart" />
              <CardBody>
                <RawMetrics label="Drivers" data={drivers} />
                <RawMetrics label="Safety" data={safety} />
                <RawMetrics label="Scheduled" data={scheduled} />
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </>
  );
}

function RawMetrics({ label, data }: { label: string; data: Record<string, unknown> | null }) {
  if (!data) {
    return (
      <div className="mb-3">
        <p className="t-eyebrow mb-1">{label}</p>
        <p className="t-small text-danger">Could not load.</p>
      </div>
    );
  }

  const scalars = Object.entries(data).filter(
    ([, v]) => typeof v === 'number' || typeof v === 'string'
  );

  if (scalars.length === 0) {
    return (
      <div className="mb-3">
        <p className="t-eyebrow mb-1">{label}</p>
        <p className="t-small text-text-faint">No scalar metrics returned.</p>
      </div>
    );
  }

  return (
    <div className="mb-3 last:mb-0">
      <p className="t-eyebrow mb-1">{label}</p>
      <dl>
        {scalars.map(([key, value]) => (
          <Detail key={key} label={humaniseKey(key)}>
            {typeof value === 'number'
              ? // Any *Pesewas field is money and must be divided by 100 exactly
                // once, here, at the formatting boundary.
                key.endsWith('Pesewas')
                ? ghsCompact(value)
                : num(value)
              : String(value)}
          </Detail>
        ))}
      </dl>
    </div>
  );
}

function humaniseKey(key: string): string {
  return key
    .replace(/Pesewas$/, '')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}
