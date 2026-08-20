import type { Metadata } from 'next';
import Link from 'next/link';

import { ExportButton } from '@/components/ui/ExportButton';
import { FilterSelect, Pagination, RefreshControl, ResetFilters } from '@/components/ui/Filters';
import {
  Badge,
  Card,
  EmptyState,
  ErrorPanel,
  PageHeader,
  StatCard,
  Toolbar,
} from '@/components/ui/primitives';
import { apiGetSafe } from '@/lib/api';
import { dateTime, ghs, num, phone as fmtPhone, relative } from '@/lib/format';

export const metadata: Metadata = { title: 'Refunds' };

type Refund = {
  id: string;
  amountPesewas: number;
  reason: string;
  destination: 'WALLET' | 'GATEWAY';
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  providerRef?: string | null;
  failureReason?: string | null;
  adminEmail: string;
  bookingId: string;
  createdAt: string;
  user?: { id: string; name: string; phone: string } | null;
  booking?: { id: string; tripId: string; fareAmountPesewas: number; paymentMethod: string } | null;
  admin?: { id: string; name: string; email: string } | null;
};

type Response = {
  refunds: Refund[];
  total: number;
  page: number;
  totalPages: number;
  totalRefundedPesewas: number;
};

const STATUS_TONE = {
  COMPLETED: 'accent',
  PENDING: 'warn',
  FAILED: 'danger',
} as const;

/**
 * The refund ledger.
 *
 * Every refund the platform has ever issued, who authorised it, and why. This
 * is the page a finance lead opens when reconciling against the payment
 * provider, and the page anyone opens when asking "who gave that money back".
 *
 * WALLET refunds are final the moment they appear here. GATEWAY ones sit at
 * PENDING until the provider settles them days later, so the two are never
 * shown as the same thing.
 */
export default async function RefundsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; from?: string; to?: string; page?: string; limit?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const limit = Math.min(100, Math.max(10, Number(sp.limit) || 25));

  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (sp.status) query.set('status', sp.status);
  if (sp.from) query.set('from', sp.from);
  if (sp.to) query.set('to', sp.to);

  const data = await apiGetSafe<Response>(`/refunds?${query.toString()}`);

  const pending = data?.refunds.filter((r) => r.status === 'PENDING').length ?? 0;
  const failed = data?.refunds.filter((r) => r.status === 'FAILED').length ?? 0;

  return (
    <>
      <PageHeader
        title="Refunds"
        subtitle="Money returned to riders. Each one names the person who authorised it and why."
        actions={
          <>
            <ExportButton dataset="refunds" />
            <RefreshControl intervalSeconds={120} />
          </>
        }
      />

      {!data ? (
        <Card>
          <ErrorPanel
            title="Refunds unavailable"
            message="The refunds endpoint did not respond. Do not read this as no refunds having been issued."
          />
        </Card>
      ) : (
        <>
          <section aria-label="Refund summary" className="grid gap-3 mb-4 grid-cols-2 lg:grid-cols-4">
            <StatCard label="Refunded" value={ghs(data.totalRefundedPesewas)} hint="in the current view" icon="cash" />
            <StatCard label="Refunds" value={num(data.total)} hint="matching these filters" icon="scroll" />
            <StatCard
              label="Awaiting the bank"
              value={num(pending)}
              hint="sent to the provider, not yet settled"
              icon="clock"
              tone={pending > 0 ? 'warn' : undefined}
            />
            <StatCard
              label="Failed"
              value={num(failed)}
              hint={failed > 0 ? 'these need re-issuing' : 'none'}
              icon="alert"
              tone={failed > 0 ? 'danger' : undefined}
            />
          </section>

          <Card flush>
            <Toolbar>
              <FilterSelect
                paramKey="status"
                label="Status"
                options={[
                  { value: 'COMPLETED', label: 'Completed' },
                  { value: 'PENDING', label: 'Awaiting the bank' },
                  { value: 'FAILED', label: 'Failed' },
                ]}
                allLabel="Any status"
              />
              <ResetFilters keys={['status', 'from', 'to']} />
            </Toolbar>

            {data.refunds.length === 0 ? (
              <EmptyState
                icon="cash"
                title="No refunds"
                body="Nothing matches these filters. Refunds are issued from a booking on the trip page."
              />
            ) : (
              <ul className="divide-y divide-line">
                {data.refunds.map((r) => (
                  <li key={r.id} className="p-4">
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className="t-h4 mono">{ghs(r.amountPesewas)}</span>
                          <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>
                            {r.status === 'PENDING' ? 'Awaiting the bank' : r.status.toLowerCase()}
                          </Badge>
                          <Badge tone="neutral">
                            {r.destination === 'WALLET' ? 'To wallet' : 'To card / MoMo'}
                          </Badge>
                          <span className="t-small text-text-faint">
                            {relative(r.createdAt)} · {dateTime(r.createdAt)}
                          </span>
                        </div>

                        <p className="t-body">{r.reason}</p>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 t-small text-text-dim">
                          {r.user ? (
                            <span>
                              <Link href={`/users/${r.user.id}`} className="hover:text-accent">
                                {r.user.name}
                              </Link>{' '}
                              <span className="mono">{fmtPhone(r.user.phone)}</span>
                            </span>
                          ) : (
                            <span className="text-text-faint">no rider account</span>
                          )}

                          {r.booking?.tripId ? (
                            <Link href={`/trips/${r.booking.tripId}`} className="text-accent hover:underline">
                              View the trip
                            </Link>
                          ) : null}

                          {r.booking ? (
                            <span>
                              fare {ghs(r.booking.fareAmountPesewas)} · paid by{' '}
                              {r.booking.paymentMethod?.toLowerCase()}
                            </span>
                          ) : null}

                          <span>authorised by {r.admin?.name ?? r.adminEmail}</span>

                          {r.providerRef ? <span className="mono">ref {r.providerRef}</span> : null}
                        </div>

                        {r.failureReason ? (
                          <p className="t-small text-danger mt-1.5">
                            The provider refused it: {r.failureReason}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <Pagination total={data.total} page={data.page} limit={limit} />
          </Card>
        </>
      )}
    </>
  );
}
