import type { Metadata } from 'next';
import Link from 'next/link';

import { FilterSelect, Pagination, RefreshControl, ResetFilters } from '@/components/ui/Filters';
import { Badge, Card, EmptyState, ErrorPanel, PageHeader, StatCard, Toolbar } from '@/components/ui/primitives';
import { apiGetSafe } from '@/lib/api';
import { dateTime, ghs, num, phone as fmtPhone, relative } from '@/lib/format';

export const metadata: Metadata = { title: 'Payouts' };

type Payout = {
  id: string;
  reference: string | null;
  amountPesewas: number;
  state: 'PAID' | 'PROCESSING' | 'FAILED';
  stale: boolean;
  ageHours: number;
  createdAt: string;
  failureNote: string | null;
  driver: { id: string; name: string | null; phone: string; walletBalancePesewas: number } | null;
};

type Response = {
  payouts: Payout[];
  total: number;
  page: number;
  totalPages: number;
  summary: {
    paidPesewas: number;
    processingPesewas: number;
    processingCount: number;
    staleCount: number;
    failedCount: number;
  };
};

const TONE = { PAID: 'accent', PROCESSING: 'warn', FAILED: 'danger' } as const;
const LABEL = { PAID: 'Paid', PROCESSING: 'Processing', FAILED: 'Failed · refunded to wallet' } as const;

/**
 * Driver payouts — every MoMo withdrawal and what became of it.
 *
 * The question this answers is the one a driver rings in with: "I withdrew
 * and the money never came". Paid means the provider confirmed it; failed
 * means it bounced and the amount went back into the driver's wallet;
 * processing past a day is flagged, because that is the one worth chasing
 * with the provider.
 */
export default async function PayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string; limit?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const limit = Math.min(100, Math.max(10, Number(sp.limit) || 25));
  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (sp.status) query.set('status', sp.status);

  const data = await apiGetSafe<Response>(`/payouts?${query.toString()}`);

  return (
    <>
      <PageHeader
        title="Payouts"
        subtitle="Driver withdrawals to MoMo, and whether each one arrived."
        actions={<RefreshControl intervalSeconds={120} />}
      />

      {!data ? (
        <Card>
          <ErrorPanel
            title="Payouts unavailable"
            message="The payouts endpoint did not respond. Do not read this as no withdrawals having been made."
          />
        </Card>
      ) : (
        <>
          <section aria-label="Payout summary" className="grid gap-3 mb-4 grid-cols-2 lg:grid-cols-4">
            <StatCard label="Paid out" value={ghs(data.summary.paidPesewas)} hint="confirmed by the provider" icon="cash" />
            <StatCard
              label="Processing"
              value={ghs(data.summary.processingPesewas)}
              hint={`${num(data.summary.processingCount)} withdrawal${data.summary.processingCount === 1 ? '' : 's'}`}
              icon="clock"
              tone={data.summary.processingCount > 0 ? 'warn' : undefined}
            />
            <StatCard
              label="Stuck over a day"
              value={num(data.summary.staleCount)}
              hint={data.summary.staleCount > 0 ? 'chase these with the provider' : 'none'}
              icon="alert"
              tone={data.summary.staleCount > 0 ? 'danger' : undefined}
            />
            <StatCard
              label="Failed"
              value={num(data.summary.failedCount)}
              hint="money returned to the driver's wallet"
              icon="refresh"
            />
          </section>

          <Card flush>
            <Toolbar>
              <FilterSelect
                paramKey="status"
                label="Status"
                options={[
                  { value: 'PROCESSING', label: 'Processing' },
                  { value: 'STALE', label: 'Stuck over a day' },
                  { value: 'PAID', label: 'Paid' },
                  { value: 'FAILED', label: 'Failed' },
                ]}
                allLabel="Any status"
              />
              <ResetFilters keys={['status']} />
            </Toolbar>

            {data.payouts.length === 0 ? (
              <EmptyState icon="cash" title="No payouts" body="Nothing matches this filter." />
            ) : (
              <ul className="divide-y divide-line">
                {data.payouts.map((p) => (
                  <li key={p.id} className="p-4">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="t-h4 mono">{ghs(p.amountPesewas)}</span>
                      <Badge tone={TONE[p.state]}>{LABEL[p.state]}</Badge>
                      {p.stale ? <Badge tone="danger">over {Math.floor(p.ageHours)} h</Badge> : null}
                      <span className="t-small text-text-faint">
                        {relative(p.createdAt)} · {dateTime(p.createdAt)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 t-small text-text-dim">
                      {p.driver ? (
                        <span>
                          <Link href={`/drivers/${p.driver.id}`} className="hover:text-accent">
                            {p.driver.name ?? 'Driver'}
                          </Link>{' '}
                          <span className="mono">{fmtPhone(p.driver.phone)}</span>
                        </span>
                      ) : (
                        <span className="text-text-faint">driver removed</span>
                      )}
                      {p.driver ? <span>wallet now {ghs(p.driver.walletBalancePesewas)}</span> : null}
                      {p.reference ? <span className="mono">ref {p.reference}</span> : null}
                    </div>
                    {p.failureNote ? <p className="t-small text-danger mt-1.5">{p.failureNote}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Pagination total={data.total} page={data.page} limit={limit} />
        </>
      )}
    </>
  );
}
