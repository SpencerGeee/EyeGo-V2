import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { UserModeration } from './UserModeration';
import { Icon } from '@/components/ui/Icon';
import {
  Avatar,
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
import { dateTime, ghs, num, phone as fmtPhone, relative, shortId, tripRef } from '@/lib/format';
import { can, isReadOnly } from '@/lib/roles';
import { bookingStatusMeta, paymentStatusMeta, tierMeta, tripStatusMeta } from '@/lib/status';

type Rider = {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  profilePhoto?: string | null;
  preferredTier?: string | null;
  isActive?: boolean;
  isBanned?: boolean;
  businessMode?: boolean;
  businessCompanyName?: string | null;
  requireBoardingPin?: boolean;
  walletBalancePesewas?: number;
  createdAt: string;
  bookings?: {
    id: string;
    status: string;
    paymentStatus?: string | null;
    seatNumber?: number | null;
    fareAmountPesewas?: number;
    createdAt: string;
    trip?: {
      id: string;
      shortId?: string;
      status?: string;
      route?: { originName?: string; destinationName?: string } | null;
      driver?: { name?: string; phone?: string } | null;
    } | null;
  }[];
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const data = await apiGetSafe<{ user: Rider }>(`/users/${id}`);
  return { title: data?.user?.name ? `${data.user.name} · Rider` : 'Rider' };
}

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, admin] = await Promise.all([
    apiGetSafe<{ user: Rider }>(`/users/${id}`),
    getAdmin(),
  ]);

  if (data === null) {
    return (
      <Card>
        <ErrorPanel
          title="Could not load this rider"
          message="The API did not respond. The rider may still exist."
          action={
            <Link href="/users" className="btn btn-secondary btn-sm">
              Back to riders
            </Link>
          }
        />
      </Card>
    );
  }

  const user = data.user;
  if (!user) notFound();

  const bookings = user.bookings ?? [];
  const settled = bookings.filter((b) => b.paymentStatus === 'PAID');
  const spent = settled.reduce((sum, b) => sum + (b.fareAmountPesewas || 0), 0);
  const canModerate = can(admin?.role, ['OPS', 'SUPPORT']) && !isReadOnly(admin?.role);

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3">
        <Link href="/users" className="t-small text-text-faint hover:text-text inline-flex items-center gap-1">
          <Icon name="chevron-left" size={12} />
          All riders
        </Link>
      </nav>

      <PageHeader
        title={user.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {user.isBanned ? (
              <Badge tone="danger" icon="ban">Banned</Badge>
            ) : (
              <Badge tone="accent" icon="check">Good standing</Badge>
            )}
            <span className="mono">{fmtPhone(user.phone)}</span>
            <span className="text-text-faint">·</span>
            <span>joined {relative(user.createdAt)}</span>
            {user.businessMode ? <Badge tone="info">Business</Badge> : null}
            {user.requireBoardingPin ? (
              <Badge tone="info" icon="lock">
                Verify My Ride on
              </Badge>
            ) : null}
          </span>
        }
        actions={
          canModerate ? (
            <UserModeration userId={user.id} name={user.name} isBanned={!!user.isBanned} />
          ) : (
            <ReadOnlyNote>
              {can(admin?.role, ['OPS', 'SUPPORT'])
                ? 'Your role is read-only.'
                : 'Only Operations and Support can ban a rider.'}
            </ReadOnlyNote>
          )
        }
      />

      <section aria-label="Rider summary" className="grid gap-3 mb-4 grid-cols-2 lg:grid-cols-4">
        <StatCard label="Seats booked" value={num(bookings.length)} hint="recent 20 shown below" icon="ticket" />
        <StatCard label="Settled spend" value={ghs(spent)} hint={`${num(settled.length)} paid`} icon="cash" />
        <StatCard
          label="Wallet"
          value={ghs(user.walletBalancePesewas ?? 0)}
          tone={(user.walletBalancePesewas ?? 0) < 0 ? 'danger' : undefined}
          icon="cash"
        />
        <StatCard
          label="Preferred tier"
          value={user.preferredTier ? tierMeta(user.preferredTier).label : '—'}
          icon="sparkle"
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card flush className="lg:col-span-2">
          <CardHead
            title="Recent bookings"
            subtitle="Seat-occupying bookings only — cancelled and no-show rows are excluded by the API"
            icon="ticket"
          />
          {bookings.length === 0 ? (
            <EmptyState icon="ticket" title="No bookings" body="This rider has never booked a seat." />
          ) : (
            <div className="table-scroll">
              <table className="table">
                <caption className="sr-only">Recent bookings for {user.name}</caption>
                <thead>
                  <tr>
                    <th scope="col">Trip</th>
                    <th scope="col">Trip state</th>
                    <th scope="col">Seat state</th>
                    <th scope="col" className="hidden md:table-cell">Route</th>
                    <th scope="col" className="text-right">Fare</th>
                    <th scope="col" className="text-right hidden lg:table-cell">When</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((b) => {
                    const seat = bookingStatusMeta(b.status);
                    const trip = b.trip ? tripStatusMeta(b.trip.status) : null;
                    const pay = paymentStatusMeta(b.paymentStatus);
                    return (
                      <tr key={b.id}>
                        <td>
                          {b.trip ? (
                            <Link href={`/trips/${b.trip.id}`} className="mono hover:text-accent">
                              {tripRef(b.trip)}
                            </Link>
                          ) : (
                            <span className="text-text-faint">—</span>
                          )}
                        </td>
                        <td>
                          {trip ? <Badge tone={trip.tone}>{trip.label}</Badge> : <span className="text-text-faint">—</span>}
                        </td>
                        <td>
                          <Badge tone={seat.tone}>{seat.label}</Badge>
                          <span className="block mt-0.5">
                            <Badge tone={pay.tone}>{pay.label}</Badge>
                          </span>
                        </td>
                        <td className="hidden md:table-cell text-text-dim truncate-1 max-w-[240px]">
                          {b.trip?.route?.originName || '—'} → {b.trip?.route?.destinationName || '—'}
                        </td>
                        <td className="num">{ghs(b.fareAmountPesewas ?? 0)}</td>
                        <td
                          className="num text-text-faint hidden lg:table-cell"
                          title={dateTime(b.createdAt)}
                        >
                          {relative(b.createdAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHead title="Account" icon="users" />
          <CardBody>
            <div className="flex items-center gap-3 mb-3 pb-3 border-b border-line">
              <Avatar name={user.name} src={user.profilePhoto} size={40} />
              <div className="min-w-0">
                <p className="t-heading truncate-1">{user.name}</p>
                <p className="t-small text-text-faint mono">{fmtPhone(user.phone)}</p>
              </div>
            </div>
            <dl>
              <Detail label="Rider ID" mono>
                {shortId(user.id)}
              </Detail>
              <Detail label="Email">{user.email || '—'}</Detail>
              <Detail label="Account active">{user.isActive === false ? 'No' : 'Yes'}</Detail>
              <Detail label="Business account">
                {user.businessMode ? user.businessCompanyName || 'Yes' : 'No'}
              </Detail>
              <Detail label="Joined">{dateTime(user.createdAt)}</Detail>
            </dl>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
