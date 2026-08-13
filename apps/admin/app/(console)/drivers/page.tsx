import type { Metadata } from 'next';

import { DriversTable, type DriverRow } from './DriversTable';
import { FilterSelect, Pagination, RefreshControl, ResetFilters, SearchBox } from '@/components/ui/Filters';
import { Card, PageHeader, Toolbar } from '@/components/ui/primitives';
import { apiGetSafe, getAdmin } from '@/lib/api';
import { can, isReadOnly } from '@/lib/roles';

export const metadata: Metadata = { title: 'Drivers' };

type Response = { drivers: DriverRow[]; total: number; page: number; limit: number };

const STATUS_OPTIONS = [
  { value: 'PENDING_REVIEW', label: 'Pending review' },
  // 'ACTIVE' is the API's word for approved (see lib/status.ts) — filtering on
  // 'APPROVED' matched no rows at all.
  { value: 'ACTIVE', label: 'Approved' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'REJECTED', label: 'Rejected' },
];

export default async function DriversPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; online?: string; page?: string; limit?: string }>;
}) {
  const sp = await searchParams;
  const admin = await getAdmin();

  const page = Math.max(1, Number(sp.page) || 1);
  const limit = Math.min(100, Math.max(10, Number(sp.limit) || 20));

  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (sp.q) query.set('q', sp.q);
  if (sp.status) query.set('status', sp.status);
  if (sp.online === 'true') query.set('onlineOnly', 'true');

  const data = await apiGetSafe<Response>(`/drivers?${query.toString()}`);

  return (
    <>
      <PageHeader
        title="Drivers"
        subtitle="The whole fleet. Search matches name, phone or Ghana Card number."
        actions={<RefreshControl />}
      />

      <Card flush>
        <Toolbar>
          <SearchBox placeholder="Name, phone or Ghana Card…" label="Search drivers" />
          <FilterSelect paramKey="status" label="Status" options={STATUS_OPTIONS} allLabel="Any status" />
          <FilterSelect
            paramKey="online"
            label="Presence"
            options={[{ value: 'true', label: 'Online now' }]}
            allLabel="Any"
          />
          <ResetFilters keys={['q', 'status', 'online']} />
        </Toolbar>

        <DriversTable
          rows={data?.drivers ?? null}
          error={data ? null : 'The drivers endpoint did not respond.'}
          canModerate={can(admin?.role, ['OPS'])}
          readOnly={isReadOnly(admin?.role)}
        />

        {data ? <Pagination total={data.total} page={data.page} limit={data.limit} /> : null}
      </Card>
    </>
  );
}
