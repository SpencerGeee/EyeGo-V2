import type { Metadata } from 'next';
import Link from 'next/link';

import { Pagination, RefreshControl } from '@/components/ui/Filters';
import { Badge, Card, EmptyState, ErrorPanel, PageHeader, Toolbar } from '@/components/ui/primitives';
import { apiGetSafe } from '@/lib/api';
import { dateTime, ghs, num, phone as fmtPhone, relative, shortId } from '@/lib/format';
import { bookingStatusMeta, paymentStatusMeta } from '@/lib/status';

export const metadata: Metadata = { title: 'Bookings' };

type Booking = {
  id: string;
  status: string;
  paymentStatus?: string | null;
  paymentMethod?: string | null;
  seatNumber?: number | null;
  fareAmountPesewas?: number;
  isCoverAll?: boolean;
  guestName?: string | null;
  createdAt: string;
  user?: { id?: string; name?: string; phone?: string } | null;
  trip?: {
    id: string;
    shortId?: string;
    status?: string;
    route?: { originName?: string; destinationName?: string } | null;
  } | null;
};

type Response = { bookings: Booking[]; total: number; page: number; totalPages: number };

/**
 * Seat-level ledger.
 *
 * Booking is seat + money state only — it never answers "where is my ride", which
 * is Trip.status. That is why this page shows the booking status and the payment
 * status as two separate columns: a PAID booking on a CANCELLED trip is a refund
 * waiting to happen, and collapsing them into one column hides exactly that.
 */
export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; limit?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const limit = Math.min(100, Math.max(10, Number(sp.limit) || 20));

  const data = await apiGetSafe<Response>(`/bookings?page=${page}&limit=${limit}`);

  return (
    <>
      <PageHeader
        title="Bookings"
        subtitle="Every seat ever booked. Booking status is seat and money state; the ride's own state lives on the trip."
        actions={<RefreshControl />}
      />

      <Card flush>
        <Toolbar>
          {data ? (
            <span className="t-small text-text-faint num">{num(data.total)} bookings</span>
          ) : null}
          <span className="t-small text-text-faint ml-auto">
            A cover-all host owns one booking per covered seat.
          </span>
        </Toolbar>

        {!data ? (
          <ErrorPanel message="The bookings endpoint did not respond." />
        ) : data.bookings.length === 0 ? (
          <EmptyState icon="ticket" title="No bookings" body="No seat has been booked yet." />
        ) : (
          <>
            <div className="table-scroll">
              <table className="table">
                <caption className="sr-only">All bookings, newest first</caption>
                <thead>
                  <tr>
                    <th scope="col">Booking</th>
                    <th scope="col">Seat state</th>
                    <th scope="col">Payment</th>
                    <th scope="col">Rider</th>
                    <th scope="col" className="hidden lg:table-cell">Trip</th>
                    <th scope="col" className="text-right">Seat</th>
                    <th scope="col" className="text-right">Fare</th>
                    <th scope="col" className="text-right hidden md:table-cell">Booked</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bookings.map((b) => {
                    const seat = bookingStatusMeta(b.status);
                    const pay = paymentStatusMeta(b.paymentStatus);
                    return (
                      <tr key={b.id}>
                        <td className="mono text-text-dim" title={b.id}>
                          {shortId(b.id)}
                        </td>
                        <td>
                          <Badge tone={seat.tone}>{seat.label}</Badge>
                        </td>
                        <td>
                          <Badge tone={pay.tone}>{pay.label}</Badge>
                          {b.paymentMethod ? (
                            <span className="block text-[11px] text-text-faint mt-0.5">
                              {b.paymentMethod.toLowerCase()}
                            </span>
                          ) : null}
                        </td>
                        <td className="truncate-1 max-w-[160px]">
                          {b.guestName ? (
                            <>
                              <span>{b.guestName}</span>
                              <span className="block text-[11px] text-text-faint">guest</span>
                            </>
                          ) : b.user?.id ? (
                            <Link href={`/users/${b.user.id}`} className="hover:text-accent">
                              {b.user.name || 'Rider'}
                              {b.user.phone ? (
                                <span className="block text-[11.5px] text-text-faint mono">
                                  {fmtPhone(b.user.phone)}
                                </span>
                              ) : null}
                            </Link>
                          ) : (
                            <span className="text-text-faint">unknown</span>
                          )}
                        </td>
                        <td className="hidden lg:table-cell">
                          {b.trip ? (
                            <Link href={`/trips/${b.trip.id}`} className="mono hover:text-accent">
                              {shortId(b.trip.shortId || b.trip.id)}
                            </Link>
                          ) : (
                            <span className="text-text-faint">—</span>
                          )}
                        </td>
                        <td className="num">
                          {b.seatNumber ?? <span className="text-text-faint">released</span>}
                          {b.isCoverAll ? (
                            <span className="block text-[11px] text-accent">cover-all</span>
                          ) : null}
                        </td>
                        <td className="num">{ghs(b.fareAmountPesewas ?? 0)}</td>
                        <td
                          className="num text-text-faint hidden md:table-cell"
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
            <Pagination total={data.total} page={data.page} limit={limit} />
          </>
        )}
      </Card>
    </>
  );
}
