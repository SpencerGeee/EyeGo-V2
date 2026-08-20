import type { Metadata } from 'next';

import { AuditTable, type AuditRow } from './AuditTable';
import { ExportButton } from '@/components/ui/ExportButton';
import { FilterSelect, Pagination, RefreshControl, ResetFilters, SearchBox } from '@/components/ui/Filters';
import { Card, ErrorPanel, PageHeader, Toolbar } from '@/components/ui/primitives';
import { apiGetSafe } from '@/lib/api';

export const metadata: Metadata = { title: 'Audit log' };

type Response = { data: AuditRow[]; total: number; page: number; limit: number };

/**
 * The append-only record of every mutating console action.
 *
 * Rows are never edited and never deleted, the same discipline TripEvent follows.
 * A failed attempt is recorded too — an attempted ban that the API refused is
 * exactly what an audit trail exists to show — but it is stored with its status
 * code so a refused attempt can never be mistaken for a completed action.
 */
export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; adminId?: string; targetId?: string; from?: string; to?: string; page?: string; limit?: string }>;
}) {
  const sp = await searchParams;

  const page = Math.max(1, Number(sp.page) || 1);
  const limit = Math.min(200, Math.max(20, Number(sp.limit) || 50));

  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  for (const key of ['action', 'adminId', 'targetId', 'from', 'to'] as const) {
    if (sp[key]) query.set(key, sp[key]!);
  }

  const data = await apiGetSafe<Response>(`/audit-logs?${query.toString()}`);

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Every mutating action, with who did it and what the API answered. Append-only — nothing here can be edited or removed."
        actions={
          <>
            <ExportButton dataset="audit-logs" />
            <RefreshControl />
          </>
        }
      />

      <Card flush>
        <Toolbar>
          <SearchBox paramKey="action" placeholder="Action, e.g. driver.suspend" label="Filter by action" />
          <FilterSelect
            paramKey="action"
            label="Common"
            options={[
              { value: 'driver.', label: 'Driver moderation' },
              { value: 'user.', label: 'Rider moderation' },
              { value: 'trip.assign', label: 'Trip assignment' },
              { value: 'sos.', label: 'SOS' },
              { value: 'promotion.', label: 'Promotions' },
              { value: 'ota.', label: 'App releases' },
              { value: 'admin.', label: 'Admin accounts' },
            ]}
            allLabel="All actions"
          />
          <div className="flex items-center gap-2">
            <label htmlFor="from" className="t-small text-text-faint">
              From
            </label>
            {/* Uncontrolled and form-submitted so a date filter is one navigation
                rather than one per keystroke. */}
            <form className="flex items-center gap-2">
              <input
                id="from"
                name="from"
                type="date"
                className="input !w-auto !h-8 !text-xs"
                defaultValue={sp.from ?? ''}
              />
              <label htmlFor="to" className="t-small text-text-faint">
                To
              </label>
              <input
                id="to"
                name="to"
                type="date"
                className="input !w-auto !h-8 !text-xs"
                defaultValue={sp.to ?? ''}
              />
              <button type="submit" className="btn btn-secondary btn-sm">
                Apply
              </button>
            </form>
          </div>
          <ResetFilters keys={['action', 'adminId', 'targetId', 'from', 'to']} />
        </Toolbar>

        {!data ? (
          <ErrorPanel
            title="Could not load the audit log"
            message="Either the API is unreachable or your role is not permitted to read the audit log."
          />
        ) : (
          <>
            <AuditTable rows={data.data} />
            <Pagination total={data.total} page={data.page} limit={data.limit} />
          </>
        )}
      </Card>
    </>
  );
}
