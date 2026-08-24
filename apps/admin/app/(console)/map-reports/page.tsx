import type { Metadata } from 'next';

import { MapReportsList, type MapReport } from './MapReportsList';
import { FilterSelect, Pagination, RefreshControl, ResetFilters } from '@/components/ui/Filters';
import { Card, ErrorPanel, PageHeader, Toolbar } from '@/components/ui/primitives';
import { apiGetSafe, getAdmin } from '@/lib/api';
import { num } from '@/lib/format';
import { isReadOnly } from '@/lib/roles';

export const metadata: Metadata = { title: 'Map reports' };

type Response = {
  reports: MapReport[];
  total: number;
  page: number;
  totalPages: number;
  pendingCount: number;
};

/**
 * "IMPROVE MAPS" — what riders and drivers know that the geocoder does not.
 *
 * A shop that moved, a gate that is always locked so the pin lands on the wrong
 * side of a wall, a road that is one-way now. Each of these costs a driver
 * minutes every single time somebody books through it, and until this queue
 * existed none of it reached anybody.
 *
 * ── THE QUEUE IS OLDEST-FIRST WITHIN A STATUS ───────────────────────────────
 * Deliberately, and it is the API that orders it. A queue worked newest-first
 * starves its own tail, and the report that has been waiting longest is the one
 * whose reporter is most likely to conclude that nobody read it — which is how
 * a feedback channel dies.
 *
 * Reads are open to any operator: knowing a junction has been reported eleven
 * times is dispatch context, not a privileged fact. Deciding is a write, so it
 * is audited and refused to a read-only account like every other write.
 */
export default async function MapReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string; page?: string; limit?: string }>;
}) {
  const sp = await searchParams;
  const admin = await getAdmin();

  const page = Math.max(1, Number(sp.page) || 1);
  const limit = Math.min(100, Math.max(10, Number(sp.limit) || 25));
  const status = sp.status ?? 'PENDING';
  const type = sp.type ?? 'ALL';

  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (status !== 'ALL') query.set('status', status);
  if (type !== 'ALL') query.set('type', type);

  const data = await apiGetSafe<Response>(`/map-reports?${query.toString()}`);

  return (
    <>
      <PageHeader
        title="Map reports"
        subtitle="Corrections riders and drivers filed about the real world — places, addresses, road problems."
        actions={<RefreshControl />}
      />

      <Card flush>
        <Toolbar>
          <FilterSelect
            paramKey="status"
            label="Status"
            options={[
              { value: 'PENDING', label: 'New' },
              { value: 'IN_REVIEW', label: 'Being checked' },
              { value: 'ACCEPTED', label: 'Applied' },
              { value: 'REJECTED', label: 'Rejected' },
              { value: 'DUPLICATE', label: 'Duplicate' },
              { value: 'ALL', label: 'All reports' },
            ]}
            allLabel="New (default)"
          />
          <FilterSelect
            paramKey="type"
            label="Type"
            options={[
              { value: 'ALL', label: 'Every type' },
              { value: 'ADD_PLACE', label: 'New place' },
              { value: 'EDIT_PLACE', label: 'Place fix' },
              { value: 'EDIT_ADDRESS', label: 'Address fix' },
              { value: 'ADD_OBJECT', label: 'Road object' },
              { value: 'ROAD_ISSUE', label: 'Road problem' },
              { value: 'COMMENT', label: 'Comment' },
            ]}
            allLabel="Every type"
          />
          <ResetFilters keys={['status', 'type']} />
          {data ? (
            <span className="t-small text-text-faint ml-auto num">
              {num(data.total)} shown · {num(data.pendingCount)} waiting
            </span>
          ) : null}
        </Toolbar>

        {!data ? (
          <ErrorPanel message="The map reports endpoint did not respond." />
        ) : (
          <>
            <MapReportsList reports={data.reports} canReview={!isReadOnly(admin?.role)} />
            <Pagination total={data.total} page={data.page} limit={limit} />
          </>
        )}
      </Card>
    </>
  );
}
