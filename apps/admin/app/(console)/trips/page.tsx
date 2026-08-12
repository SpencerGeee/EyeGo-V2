import type { Metadata } from 'next';
import Link from 'next/link';

import { FilterSelect, Pagination, RefreshControl, ResetFilters } from '@/components/ui/Filters';
import { Badge, Card, EmptyState, ErrorPanel, PageHeader, Toolbar } from '@/components/ui/primitives';
import { apiGetSafe } from '@/lib/api';
import { dateTime, ghs, num, relative, shortId, tripRef } from '@/lib/format';
import { TRIP_STATUSES, tripStatusMeta, isLiveTrip, tierMeta } from '@/lib/status';

export const metadata: Metadata = { title: 'Trips' };

type Trip = {
  id: string;
  shortId?: string;
  status: string;
  tier?: string | null;
  createdAt: string;
  departureTime?: string | null;
  maxSeats?: number;
  farePerSeatPesewas?: number;
  driver?: { id: string; name: string } | null;
  route?: { originName?: string; destinationName?: string } | null;
  // getAllTrips returns the seat-occupying bookings themselves, already filtered
  // through seatOccupyingWhere() — not a _count. Reading _count here would have
  // silently rendered every seat column as 0.
  bookings?: { id: string; seatNumber?: number | null }[];
};

// getAllTrips returns `trips`, not `data`. Matching the API exactly rather than
// assuming a house style it does not follow.
type Response = { trips: Trip[]; total: number; page: number; totalPages: number };

/**
 * Trip ledger. Rendered as a server component with no client JavaScript: there
 * are no row actions here, and shipping a table component to the browser to
 * render static rows is waste on a page that can hold a hundred of them.
 */
export default async function TripsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string; limit?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const limit = Math.min(100, Math.max(10, Number(sp.limit) || 20));

  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (sp.status) query.set('status', sp.status);

  const data = await apiGetSafe<Response>(`/trips?${query.toString()}`);

  return (
    <>
      <PageHeader
        title="Trips"
        subtitle="Every trip the platform has created, newest first. Seat counts exclude cancelled, expired, refunded and no-show bookings."
        actions={<RefreshControl />}
      />

      <Card flush>
        <Toolbar>
          <FilterSelect
            paramKey="status"
            label="Status"
            options={TRIP_STATUSES.map((s) => ({ value: s, label: tripStatusMeta(s).label }))}
            allLabel="Any status"
          />
          <ResetFilters keys={['status']} />
          {data ? (
            <span className="t-small text-text-faint ml-auto num">{num(data.total)} trips</span>
          ) : null}
        </Toolbar>

        {!data ? (
          <ErrorPanel message="The trips endpoint did not respond. No rows were returned at all — this is not an empty result." />
        ) : data.trips.length === 0 ? (
          <EmptyState
            icon="route"
            title="No trips match"
            body="Nothing matches the current filter. Clear it to see every trip."
          />
        ) : (
          <>
            <div className="table-scroll">
              <table className="table">
                <caption className="sr-only">All trips, newest first</caption>
                <thead>
                  <tr>
                    <th scope="col">Trip</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="hidden lg:table-cell">Tier</th>
                    <th scope="col">Driver</th>
                    <th scope="col" className="hidden md:table-cell">Route</th>
                    <th scope="col" className="text-right">Seats</th>
                    <th scope="col" className="text-right hidden lg:table-cell">Per seat</th>
                    <th scope="col" className="text-right">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {data.trips.map((t) => {
                    const meta = tripStatusMeta(t.status);
                    const tier = t.tier ? tierMeta(t.tier) : null;
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
                        <td className="hidden lg:table-cell">
                          {tier ? <Badge tone={tier.tone}>{tier.label}</Badge> : <span className="text-text-faint">—</span>}
                        </td>
                        <td className="truncate-1 max-w-[150px]">
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
                        <td className="num">
                          {num(t.bookings?.length ?? 0)}
                          {t.maxSeats ? <span className="text-text-faint"> / {t.maxSeats}</span> : null}
                        </td>
                        <td className="num hidden lg:table-cell">
                          {t.farePerSeatPesewas ? ghs(t.farePerSeatPesewas) : '—'}
                        </td>
                        <td className="num text-text-faint" title={dateTime(t.createdAt)}>
                          {relative(t.createdAt)}
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
