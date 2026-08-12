import type { Metadata } from 'next';
import Link from 'next/link';

import { SosList, type SosEvent } from './SosList';
import { FilterSelect, Pagination, RefreshControl } from '@/components/ui/Filters';
import { Card, PageHeader, StatCard, Toolbar } from '@/components/ui/primitives';
import { apiGetSafe, getAdmin } from '@/lib/api';
import { num } from '@/lib/format';
import { can, isReadOnly } from '@/lib/roles';

export const metadata: Metadata = { title: 'SOS events' };

type Response = { events: SosEvent[]; total: number; page: number; totalPages: number };

/**
 * Safety triage.
 *
 * The only page in the console that polls by default and that uses the reserved
 * critical colour. Everything here is ordered newest-first because on a safety
 * queue the most recent event is the one that may still be happening.
 */
export default async function SosPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; page?: string; limit?: string }>;
}) {
  const sp = await searchParams;
  const admin = await getAdmin();

  const page = Math.max(1, Number(sp.page) || 1);
  const limit = Math.min(100, Math.max(10, Number(sp.limit) || 20));
  // Unresolved is the default view: an operator opening this page wants the
  // things still needing action, not a history lesson.
  const unresolvedOnly = sp.show !== 'all';

  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (unresolvedOnly) query.set('unresolvedOnly', 'true');

  const [data, unresolved] = await Promise.all([
    apiGetSafe<Response>(`/sos-events?${query.toString()}`),
    apiGetSafe<Response>('/sos-events?unresolvedOnly=true&limit=1'),
  ]);

  const openCount = unresolved?.total ?? 0;

  return (
    <>
      <PageHeader
        title="SOS events"
        subtitle="Panic alerts raised from either app. Every one needs a human decision and a phone call."
        actions={<RefreshControl intervalSeconds={20} />}
      />

      <section aria-label="Safety summary" className="grid gap-3 mb-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Unresolved"
          value={num(openCount)}
          hint={openCount > 0 ? 'needs triage now' : 'nothing outstanding'}
          icon="siren"
          tone={openCount > 0 ? 'danger' : undefined}
        />
        <StatCard label="Total recorded" value={num(data?.total ?? 0)} hint="in the current view" icon="scroll" />
      </section>

      <Card flush>
        <Toolbar>
          <FilterSelect
            paramKey="show"
            label="Showing"
            options={[
              { value: 'all', label: 'All events' },
            ]}
            allLabel="Unresolved only"
          />
          <span className="t-small text-text-faint ml-auto">
            Resolving records who cleared it and when. It does not contact anyone.
          </span>
        </Toolbar>

        <SosList
          events={data?.events ?? null}
          error={data ? null : 'The SOS endpoint did not respond. Do not assume there are no alerts.'}
          canResolve={can(admin?.role, ['SUPPORT', 'OPS']) && !isReadOnly(admin?.role)}
        />

        {data ? <Pagination total={data.total} page={data.page} limit={limit} /> : null}
      </Card>

      <p className="t-small text-text-faint mt-3">
        Looking for driver-filed incident reports instead?{' '}
        <Link href="/trip-reports" className="text-accent hover:underline">
          Trip reports
        </Link>
        .
      </p>
    </>
  );
}
