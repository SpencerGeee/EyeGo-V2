import type { Metadata } from 'next';

import { ReportsList, type TripReport } from './ReportsList';
import { FilterSelect, Pagination, RefreshControl, ResetFilters } from '@/components/ui/Filters';
import { Card, ErrorPanel, PageHeader, Toolbar } from '@/components/ui/primitives';
import { apiGetSafe, getAdmin } from '@/lib/api';
import { num } from '@/lib/format';
import { can, isReadOnly } from '@/lib/roles';

export const metadata: Metadata = { title: 'Trip reports' };

type Response = { reports: TripReport[]; total: number; page: number; totalPages: number };

/**
 * Incidents filed by drivers against a trip.
 *
 * These were persisted for a long time before anything surfaced them, so the
 * backlog on first load may be large and old. Default view is OPEN, which is
 * the TripReport.status default — not 'PENDING', which does not exist.
 */
export default async function TripReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string; limit?: string }>;
}) {
  const sp = await searchParams;
  const admin = await getAdmin();

  const page = Math.max(1, Number(sp.page) || 1);
  const limit = Math.min(100, Math.max(10, Number(sp.limit) || 20));
  const status = sp.status ?? 'OPEN';

  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (status !== 'ALL') query.set('status', status);

  const data = await apiGetSafe<Response>(`/trip-reports?${query.toString()}`);

  return (
    <>
      <PageHeader
        title="Trip reports"
        subtitle="Incidents a driver filed against a trip — damage, disputes, rider behaviour."
        actions={<RefreshControl />}
      />

      <Card flush>
        <Toolbar>
          <FilterSelect
            paramKey="status"
            label="Status"
            options={[
              { value: 'OPEN', label: 'Open' },
              { value: 'RESOLVED', label: 'Resolved' },
              { value: 'ALL', label: 'All reports' },
            ]}
            allLabel="Open (default)"
          />
          <ResetFilters keys={['status']} />
          {data ? (
            <span className="t-small text-text-faint ml-auto num">{num(data.total)} reports</span>
          ) : null}
        </Toolbar>

        {!data ? (
          <ErrorPanel message="The trip reports endpoint did not respond." />
        ) : (
          <>
            <ReportsList
              reports={data.reports}
              canResolve={can(admin?.role, ['SUPPORT', 'OPS']) && !isReadOnly(admin?.role)}
            />
            <Pagination total={data.total} page={data.page} limit={limit} />
          </>
        )}
      </Card>
    </>
  );
}
