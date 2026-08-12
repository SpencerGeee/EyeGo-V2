import type { Metadata } from 'next';
import Link from 'next/link';

import { FilterSelect, Pagination, RefreshControl, ResetFilters } from '@/components/ui/Filters';
import { Badge, Card, EmptyState, ErrorPanel, PageHeader, Toolbar } from '@/components/ui/primitives';
import { apiGetSafe } from '@/lib/api';
import { dateTime, num, phone as fmtPhone, relative, shortId } from '@/lib/format';
import { ticketStatusMeta } from '@/lib/status';

export const metadata: Metadata = { title: 'Support tickets' };

type Ticket = {
  id: string;
  subject?: string | null;
  category?: string | null;
  status: string;
  priority?: string | null;
  createdAt: string;
  updatedAt?: string;
  user?: { name?: string; phone?: string } | null;
  _count?: { messages: number };
};

type Response = { tickets: Ticket[]; total: number; page: number; totalPages: number };

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string; limit?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const limit = Math.min(100, Math.max(10, Number(sp.limit) || 20));

  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (sp.status) query.set('status', sp.status);

  const data = await apiGetSafe<Response>(`/support-tickets?${query.toString()}`);

  return (
    <>
      <PageHeader
        title="Support tickets"
        subtitle="Rider and driver enquiries. Oldest open ticket is the one that hurts."
        actions={<RefreshControl intervalSeconds={60} />}
      />

      <Card flush>
        <Toolbar>
          <FilterSelect
            paramKey="status"
            label="Status"
            options={[
              { value: 'OPEN', label: 'Open' },
              { value: 'IN_PROGRESS', label: 'In progress' },
              { value: 'RESOLVED', label: 'Resolved' },
              { value: 'CLOSED', label: 'Closed' },
            ]}
            allLabel="Any status"
          />
          <ResetFilters keys={['status']} />
          {data ? (
            <span className="t-small text-text-faint ml-auto num">{num(data.total)} tickets</span>
          ) : null}
        </Toolbar>

        {!data ? (
          <ErrorPanel message="The support tickets endpoint did not respond." />
        ) : data.tickets.length === 0 ? (
          <EmptyState
            icon="chat"
            title="No tickets"
            body="Nothing matches this filter. An empty open queue is a good sign."
          />
        ) : (
          <>
            <div className="table-scroll">
              <table className="table">
                <caption className="sr-only">Support tickets</caption>
                <thead>
                  <tr>
                    <th scope="col">Ticket</th>
                    <th scope="col">Status</th>
                    <th scope="col">Subject</th>
                    <th scope="col" className="hidden md:table-cell">From</th>
                    <th scope="col" className="text-right hidden lg:table-cell">Messages</th>
                    <th scope="col" className="text-right">Opened</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tickets.map((t) => {
                    const meta = ticketStatusMeta(t.status);
                    const stale = t.status === 'OPEN';
                    return (
                      <tr key={t.id} className={stale ? 'bg-warn-soft/25' : undefined}>
                        <td>
                          <Link href={`/tickets/${t.id}`} className="mono hover:text-accent">
                            {shortId(t.id)}
                          </Link>
                        </td>
                        <td>
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                        </td>
                        <td className="truncate-1 max-w-[280px]">
                          <Link href={`/tickets/${t.id}`} className="hover:text-accent">
                            {t.subject || t.category || 'No subject'}
                          </Link>
                        </td>
                        <td className="hidden md:table-cell text-text-dim truncate-1 max-w-[180px]">
                          {t.user?.name || 'Unknown'}
                          {t.user?.phone ? (
                            <span className="block text-[11.5px] text-text-faint mono">
                              {fmtPhone(t.user.phone)}
                            </span>
                          ) : null}
                        </td>
                        <td className="num hidden lg:table-cell">{num(t._count?.messages ?? 0)}</td>
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
