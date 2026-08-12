import type { Metadata } from 'next';
import Link from 'next/link';

import { PaymentMixChart, RevenueChart } from '@/components/charts/Charts';
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
import { ghs, ghsCompact, num, pct } from '@/lib/format';

export const metadata: Metadata = { title: 'Revenue' };

type Overview = {
  totalRevenuePesewas: number;
  todayRevenuePesewas: number;
  weekRevenuePesewas: number;
  monthRevenuePesewas: number;
  totalCommissionPesewas: number;
  revenueByDay: { date: string; valuePesewas: number }[];
  avgFarePesewas: number;
  totalBookings: number;
  completedTripsCount: number;
  paymentMethodBreakdown: { cash: number; card: number };
};

/**
 * The finance view.
 *
 * Deliberately states its own definition of revenue at the top, because the
 * single most expensive misunderstanding in this codebase was reading revenue
 * from card transactions on a platform where most fares are cash — which made
 * the number look like roughly zero and was mistaken for a collapse in trade.
 */
export default async function RevenuePage() {
  const overview = await apiGetSafe<Overview>('/analytics/overview');

  if (!overview) {
    return (
      <>
        <PageHeader title="Revenue" />
        <Card>
          <ErrorPanel
            title="Revenue unavailable"
            message="The analytics endpoint did not respond. Do not read this as zero revenue."
          />
        </Card>
      </>
    );
  }

  const cashShare =
    overview.paymentMethodBreakdown.cash + overview.paymentMethodBreakdown.card > 0
      ? (overview.paymentMethodBreakdown.cash /
          (overview.paymentMethodBreakdown.cash + overview.paymentMethodBreakdown.card)) *
        100
      : 0;

  const netToDrivers = overview.totalRevenuePesewas - overview.totalCommissionPesewas;

  return (
    <>
      <PageHeader
        title="Revenue"
        subtitle="Settled fares only. A fare counts once its booking reaches PAID — which covers cash collected in the car as well as card and mobile money."
        actions={<RefreshControl intervalSeconds={120} />}
      />

      <section aria-label="Revenue summary" className="grid gap-3 mb-4 grid-cols-2 lg:grid-cols-4">
        <StatCard label="Today" value={ghsCompact(overview.todayRevenuePesewas)} icon="cash" />
        <StatCard label="This week" value={ghsCompact(overview.weekRevenuePesewas)} icon="cash" />
        <StatCard label="This month" value={ghsCompact(overview.monthRevenuePesewas)} icon="cash" />
        <StatCard
          label="All time"
          value={ghsCompact(overview.totalRevenuePesewas)}
          hint={`${num(overview.completedTripsCount)} completed trips`}
          icon="cash"
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card flush className="xl:col-span-2">
          <CardHead title="Settled revenue, last 14 days" icon="chart" />
          <CardBody>
            <RevenueChart data={overview.revenueByDay} />
          </CardBody>
        </Card>

        <Card>
          <CardHead title="Split" subtitle="Commission versus driver earnings" icon="tag" />
          <CardBody>
            <dl>
              <Detail label="Gross settled fares">{ghs(overview.totalRevenuePesewas)}</Detail>
              <Detail label="Platform commission">{ghs(overview.totalCommissionPesewas)}</Detail>
              <Detail label="Net to drivers">{ghs(netToDrivers)}</Detail>
              <Detail label="Average fare">{ghs(overview.avgFarePesewas)}</Detail>
              <Detail label="Bookings">{num(overview.totalBookings)}</Detail>
            </dl>
          </CardBody>
        </Card>

        <Card flush>
          <CardHead
            title="Cash exposure"
            subtitle={`${pct(cashShare, 0)} of bookings are cash`}
            icon="cash"
          />
          <CardBody>
            <PaymentMixChart mix={overview.paymentMethodBreakdown} />
            <p className="hint mt-3">
              Cash is collected by the driver, so the platform&apos;s commission on
              those trips is recovered from the driver wallet rather than received
              directly. A driver wallet in deficit is unrecovered commission —
              check individual drivers from the{' '}
              <Link href="/drivers" className="text-accent hover:underline">
                fleet list
              </Link>
              .
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
