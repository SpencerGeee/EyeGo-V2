import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { DocumentReview, type DriverDocument } from './DocumentReview';
import { DriverModeration } from './DriverModeration';
import { Icon } from '@/components/ui/Icon';
import {
  Badge,
  Card,
  CardBody,
  CardHead,
  Detail,
  EmptyState,
  ErrorPanel,
  PageHeader,
  ReadOnlyNote,
  StatCard,
} from '@/components/ui/primitives';
import { apiGetSafe, getAdmin } from '@/lib/api';
import { dateTime, ghs, num, pct, phone as fmtPhone, relative, shortId } from '@/lib/format';
import { can, isReadOnly } from '@/lib/roles';
import { driverStatusMeta, tierMeta, tripStatusMeta } from '@/lib/status';

type Driver = {
  id: string;
  name: string;
  phone: string;
  profilePhoto?: string | null;
  ghanaCardNumber?: string | null;
  status: string;
  isOnline?: boolean;
  isAvailable?: boolean;
  requestsPaused?: boolean;
  walletBalancePesewas?: number;
  createdAt: string;
  currentLat?: number | null;
  currentLng?: number | null;
  vehicles?: {
    id: string;
    make?: string;
    model?: string;
    year?: number;
    colour?: string;
    plateNumber?: string;
    tier?: string;
    seaterCount?: number;
    isActive?: boolean;
  }[];
  walletTxs?: {
    id: string;
    type?: string;
    amountPesewas?: number;
    balanceAfterPesewas?: number;
    description?: string | null;
    createdAt: string;
  }[];
  stats?: {
    totalTrips: number;
    completedTrips: number;
    cancelledTrips: number;
    completionRate: number;
    cancellationRate: number;
    totalRevenue: number;
    totalCommission: number;
    netEarnings: number;
  };
  ratings?: { average: number | null; count: number };
  documents?: DriverDocument[];
};

type TripsResponse = {
  data: { id: string; shortId?: string; status: string; createdAt: string; route?: { originName?: string; destinationName?: string } | null; _count?: { bookings: number } }[];
  total: number;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const data = await apiGetSafe<{ driver: Driver }>(`/drivers/${id}`);
  return { title: data?.driver?.name ? `${data.driver.name} · Driver` : 'Driver' };
}

export default async function DriverDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await getAdmin();

  const [detail, trips] = await Promise.all([
    apiGetSafe<{ driver: Driver }>(`/drivers/${id}`),
    apiGetSafe<TripsResponse>(`/drivers/${id}/trips?limit=10`),
  ]);

  // A missing driver and an unreachable API are different failures and must not
  // look the same. Only the first is a 404.
  if (detail === null) {
    return (
      <Card>
        <ErrorPanel
          title="Could not load this driver"
          message="The API did not respond. The driver may still exist — retry before assuming otherwise."
          action={
            <Link href="/drivers" className="btn btn-secondary btn-sm">
              Back to drivers
            </Link>
          }
        />
      </Card>
    );
  }

  const driver = detail.driver;
  if (!driver) notFound();

  const status = driverStatusMeta({
    isApproved: driver.status === 'APPROVED',
    isSuspended: driver.status === 'SUSPENDED',
    isOnline: driver.isOnline,
    isAvailable: driver.isAvailable,
  });

  const vehicle = driver.vehicles?.find((v) => v.isActive) ?? driver.vehicles?.[0];
  const canModerate = can(admin?.role, ['OPS']) && !isReadOnly(admin?.role);
  const stats = driver.stats;

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3">
        <Link href="/drivers" className="t-small text-text-faint hover:text-text inline-flex items-center gap-1">
          <Icon name="chevron-left" size={12} />
          All drivers
        </Link>
      </nav>

      <PageHeader
        title={driver.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={status.tone} live={status.label === 'Available'}>
              {status.label}
            </Badge>
            <span className="mono">{fmtPhone(driver.phone)}</span>
            <span className="text-text-faint">·</span>
            <span>Joined {relative(driver.createdAt)}</span>
            {driver.requestsPaused ? (
              <Badge tone="warn" icon="clock">
                Requests paused
              </Badge>
            ) : null}
          </span>
        }
        actions={
          canModerate ? (
            <DriverModeration driverId={driver.id} name={driver.name} status={driver.status} />
          ) : (
            <ReadOnlyNote>
              {can(admin?.role, ['OPS'])
                ? 'Your role is read-only.'
                : 'Only Operations can approve or suspend drivers.'}
            </ReadOnlyNote>
          )
        }
      />

      {/* ── Performance ── */}
      {stats ? (
        <section aria-label="Driver performance" className="grid gap-3 mb-4 grid-cols-2 lg:grid-cols-5">
          <StatCard label="Completed trips" value={num(stats.completedTrips)} hint={`${num(stats.totalTrips)} total`} icon="route" />
          <StatCard
            label="Completion rate"
            value={pct(stats.completionRate, 0)}
            tone={stats.completionRate < 80 ? 'warn' : undefined}
            icon="check"
          />
          <StatCard
            label="Cancellation rate"
            value={pct(stats.cancellationRate, 0)}
            hint={stats.cancellationRate > 20 ? 'above tolerance' : undefined}
            tone={stats.cancellationRate > 20 ? 'danger' : undefined}
            icon="ban"
          />
          <StatCard
            label="Rating"
            value={driver.ratings?.average !== null && driver.ratings?.average !== undefined ? driver.ratings.average.toFixed(1) : 'unrated'}
            hint={`${num(driver.ratings?.count ?? 0)} ratings`}
            tone={(driver.ratings?.average ?? 5) < 4 ? 'warn' : undefined}
            icon="sparkle"
          />
          <StatCard
            label="Net earnings"
            value={ghs(stats.netEarnings)}
            hint={`${ghs(stats.totalRevenue)} gross · ${ghs(stats.totalCommission)} commission`}
            icon="cash"
          />
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ── Documents: the actual approval gate ── */}
        <Card flush className="lg:col-span-2">
          <CardHead
            title="Compliance documents"
            subtitle="A driver cannot go online until every document is verified"
            icon="badge-check"
          />
          {driver.documents?.length ? (
            <DocumentReview
              driverId={driver.id}
              documents={driver.documents}
              canReview={canModerate}
            />
          ) : (
            <EmptyState
              icon="scroll"
              title="No documents on file"
              body="This driver has not uploaded any compliance documents yet."
            />
          )}
        </Card>

        {/* ── Identity & vehicle ── */}
        <div className="space-y-4">
          <Card>
            <CardHead title="Identity" icon="users" />
            <CardBody>
              <dl>
                <Detail label="Driver ID" mono>
                  {shortId(driver.id)}
                </Detail>
                <Detail label="Phone" mono>
                  {fmtPhone(driver.phone)}
                </Detail>
                <Detail label="Ghana Card" mono>
                  {driver.ghanaCardNumber || '—'}
                </Detail>
                <Detail label="Wallet balance">
                  <span className={((driver.walletBalancePesewas ?? 0) < 0) ? 'text-danger' : undefined}>
                    {ghs(driver.walletBalancePesewas ?? 0)}
                  </span>
                </Detail>
                <Detail label="Last known position" mono>
                  {driver.currentLat && driver.currentLng
                    ? `${driver.currentLat.toFixed(4)}, ${driver.currentLng.toFixed(4)}`
                    : 'no GPS fix'}
                </Detail>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHead title="Vehicle" icon="car" />
            <CardBody>
              {vehicle ? (
                <dl>
                  <Detail label="Make & model">
                    {[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(' ') || '—'}
                  </Detail>
                  <Detail label="Plate" mono>
                    {vehicle.plateNumber || '—'}
                  </Detail>
                  <Detail label="Colour">{vehicle.colour || '—'}</Detail>
                  <Detail label="Tier">
                    {vehicle.tier ? (
                      <Badge tone={tierMeta(vehicle.tier).tone}>{tierMeta(vehicle.tier).label}</Badge>
                    ) : (
                      '—'
                    )}
                  </Detail>
                  <Detail label="Seats">{num(vehicle.seaterCount ?? 0)}</Detail>
                </dl>
              ) : (
                <p className="t-small text-text-faint">
                  No vehicle registered. This driver cannot be dispatched.
                </p>
              )}
            </CardBody>
          </Card>
        </div>

        {/* ── Recent trips ── */}
        <Card flush className="lg:col-span-2">
          <CardHead
            title="Recent trips"
            subtitle={trips ? `${num(trips.total)} in total` : undefined}
            icon="route"
          />
          {!trips ? (
            <ErrorPanel message="Could not load this driver's trips." />
          ) : trips.data.length === 0 ? (
            <EmptyState icon="route" title="No trips yet" body="This driver has not run a trip." />
          ) : (
            <div className="table-scroll">
              <table className="table">
                <caption className="sr-only">Recent trips for {driver.name}</caption>
                <thead>
                  <tr>
                    <th scope="col">Trip</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="hidden md:table-cell">Route</th>
                    <th scope="col" className="text-right">Seats</th>
                    <th scope="col" className="text-right">When</th>
                  </tr>
                </thead>
                <tbody>
                  {trips.data.map((t) => {
                    const meta = tripStatusMeta(t.status);
                    return (
                      <tr key={t.id}>
                        <td>
                          <Link href={`/trips/${t.id}`} className="mono hover:text-accent">
                            {(t.shortId || t.id).slice(0, 8)}
                          </Link>
                        </td>
                        <td>
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                        </td>
                        <td className="hidden md:table-cell text-text-dim truncate-1 max-w-[280px]">
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

        {/* ── Wallet ledger ── */}
        <Card flush>
          <CardHead title="Wallet ledger" subtitle="Most recent 20 entries" icon="cash" />
          {driver.walletTxs?.length ? (
            <ul className="divide-y divide-line">
              {driver.walletTxs.map((tx) => {
                const amount = tx.amountPesewas ?? 0;
                return (
                  <li key={tx.id} className="px-4 py-2.5 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="t-small truncate-1">{tx.description || tx.type || 'Adjustment'}</p>
                      <p className="text-[11.5px] text-text-faint">{dateTime(tx.createdAt)}</p>
                    </div>
                    <div className="text-right flex-none">
                      <p className={`t-small num font-medium ${amount < 0 ? 'text-danger' : 'text-accent'}`}>
                        {amount < 0 ? '−' : '+'}
                        {ghs(Math.abs(amount))}
                      </p>
                      {tx.balanceAfterPesewas !== undefined ? (
                        <p className="text-[11.5px] text-text-faint num">
                          bal {ghs(tx.balanceAfterPesewas)}
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon="cash" title="No wallet activity" body="No commission or payout entries yet." />
          )}
        </Card>
      </div>
    </>
  );
}
