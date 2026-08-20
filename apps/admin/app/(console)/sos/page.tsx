import type { Metadata } from 'next';
import Link from 'next/link';

import { SosList, type SosEvent } from './SosList';
import { FilterSelect, Pagination, RefreshControl } from '@/components/ui/Filters';
import { Card, PageHeader, StatCard, Toolbar } from '@/components/ui/primitives';
import { apiGetSafe, getAdmin } from '@/lib/api';
import { num } from '@/lib/format';
import { can, isReadOnly } from '@/lib/roles';

export const metadata: Metadata = { title: 'SOS events' };

type Response = {
  events: SosEvent[];
  total: number;
  page: number;
  totalPages: number;
  counts?: { open: number; acknowledged: number };
  staleAfterMinutes?: number;
};

/** Whether an alert would actually reach anybody right now. */
type AlertingHealth = {
  smsEnabled: boolean;
  onCallCount: number;
  onCallMasked: string[];
  pushDeviceCount: number;
  smsConfigured?: boolean;
  reachable: boolean;
};

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

  const [data, unresolved, health] = await Promise.all([
    apiGetSafe<Response>(`/sos-events?${query.toString()}`),
    apiGetSafe<Response>('/sos-events?unresolvedOnly=true&limit=1'),
    apiGetSafe<AlertingHealth>('/sos-events/alerting-health'),
  ]);

  const openCount = unresolved?.total ?? 0;
  const counts = data?.counts;

  return (
    <>
      <PageHeader
        title="SOS events"
        subtitle="Panic alerts raised from either app. Every one needs a human decision and a phone call."
        actions={<RefreshControl intervalSeconds={20} />}
      />

      {/*
        WHETHER AN ALERT WOULD REACH ANYBODY, stated before the queue rather
        than discovered during an emergency. The SMS fan-out is the only channel
        that wakes someone who is not already looking at this screen, and it is
        silent unless an on-call roster has been configured — which is exactly
        the kind of thing that is never noticed until it matters.
      */}
      {health && !health.reachable ? (
        <div className="banner banner-danger mb-4" role="alert">
          <strong>Nobody would be alerted.</strong>{' '}
          {health.onCallCount === 0
            ? 'No on-call phone numbers are set, and no admin device is registered for push.'
            : 'SMS alerting is switched off and no admin device is registered for push.'}{' '}
          A panic alert would sit in this queue until somebody happened to look.{' '}
          <Link href="/config" className="underline">
            Set the on-call roster in Platform config
          </Link>
          .
        </div>
      ) : null}

      <section aria-label="Safety summary" className="grid gap-3 mb-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Unclaimed"
          value={num(counts?.open ?? openCount)}
          hint={(counts?.open ?? openCount) > 0 ? 'nobody is on these yet' : 'nothing waiting'}
          icon="siren"
          tone={(counts?.open ?? openCount) > 0 ? 'danger' : undefined}
        />
        <StatCard
          label="Being handled"
          value={num(counts?.acknowledged ?? 0)}
          hint="someone has picked these up"
          icon="check"
        />
        <StatCard label="Total recorded" value={num(data?.total ?? 0)} hint="in the current view" icon="scroll" />
        <StatCard
          label="Alert channels"
          value={health ? String(health.onCallCount + health.pushDeviceCount) : '—'}
          hint={
            health
              ? `${health.onCallCount} on call · ${health.pushDeviceCount} device${health.pushDeviceCount === 1 ? '' : 's'}${health.smsConfigured === false ? ' · SMS not live' : ''}`
              : 'unknown'
          }
          icon="phone"
          tone={health && !health.reachable ? 'danger' : undefined}
        />
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
          currentAdminId={admin?.id}
          staleAfterMinutes={data?.staleAfterMinutes ?? 10}
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
