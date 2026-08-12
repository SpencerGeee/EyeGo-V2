import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { TicketThread, type TicketMessage } from './TicketThread';
import { Icon } from '@/components/ui/Icon';
import {
  Badge,
  Card,
  CardBody,
  CardHead,
  Detail,
  ErrorPanel,
  PageHeader,
  ReadOnlyNote,
} from '@/components/ui/primitives';
import { apiGetSafe, getAdmin } from '@/lib/api';
import { dateTime, ghs, phone as fmtPhone, relative, shortId } from '@/lib/format';
import { can, isReadOnly } from '@/lib/roles';
import { ticketStatusMeta } from '@/lib/status';

type Ticket = {
  id: string;
  subject?: string | null;
  category?: string | null;
  status: string;
  priority?: string | null;
  tripId?: string | null;
  createdAt: string;
  user?: {
    id: string;
    name?: string;
    phone?: string;
    email?: string | null;
    walletBalancePesewas?: number;
    isBanned?: boolean;
  } | null;
  driver?: { id: string; name: string; phone: string; status: string } | null;
  messages?: TicketMessage[];
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: `Ticket ${shortId(id)}` };
}

export default async function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, admin] = await Promise.all([
    apiGetSafe<{ ticket: Ticket }>(`/support-tickets/${id}`),
    getAdmin(),
  ]);

  if (data === null) {
    return (
      <Card>
        <ErrorPanel
          title="Could not load this ticket"
          message="The API did not respond. The ticket may still exist."
          action={
            <Link href="/tickets" className="btn btn-secondary btn-sm">
              Back to tickets
            </Link>
          }
        />
      </Card>
    );
  }

  const ticket = data.ticket;
  if (!ticket) notFound();

  const meta = ticketStatusMeta(ticket.status);
  const canRespond = can(admin?.role, ['SUPPORT', 'OPS']) && !isReadOnly(admin?.role);
  const closed = ticket.status === 'CLOSED' || ticket.status === 'RESOLVED';

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3">
        <Link href="/tickets" className="t-small text-text-faint hover:text-text inline-flex items-center gap-1">
          <Icon name="chevron-left" size={12} />
          All tickets
        </Link>
      </nav>

      <PageHeader
        title={ticket.subject || ticket.category || `Ticket ${shortId(ticket.id)}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={meta.tone}>{meta.label}</Badge>
            <span className="mono">{shortId(ticket.id)}</span>
            <span className="text-text-faint">·</span>
            <span>opened {relative(ticket.createdAt)}</span>
            {ticket.priority ? <Badge tone="info">{ticket.priority}</Badge> : null}
          </span>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card flush className="lg:col-span-2">
          <CardHead title="Conversation" icon="chat" />
          <TicketThread
            ticketId={ticket.id}
            messages={ticket.messages ?? []}
            canRespond={canRespond}
            closed={closed}
          />
          {!canRespond ? (
            <div className="px-4 py-3 border-t border-line">
              <ReadOnlyNote>
                {can(admin?.role, ['SUPPORT', 'OPS'])
                  ? 'Your role is read-only.'
                  : 'Only Support and Operations can reply to tickets.'}
              </ReadOnlyNote>
            </div>
          ) : null}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHead title="Rider" icon="users" />
            <CardBody>
              {ticket.user ? (
                <dl>
                  <Detail label="Name">
                    <Link href={`/users/${ticket.user.id}`} className="hover:text-accent">
                      {ticket.user.name || '—'}
                    </Link>
                  </Detail>
                  <Detail label="Phone" mono>
                    {ticket.user.phone ? (
                      <a href={`tel:${ticket.user.phone}`} className="text-accent hover:underline">
                        {fmtPhone(ticket.user.phone)}
                      </a>
                    ) : (
                      '—'
                    )}
                  </Detail>
                  <Detail label="Email">{ticket.user.email || '—'}</Detail>
                  <Detail label="Wallet">{ghs(ticket.user.walletBalancePesewas ?? 0)}</Detail>
                  <Detail label="Standing">
                    {ticket.user.isBanned ? (
                      <Badge tone="danger" icon="ban">Banned</Badge>
                    ) : (
                      <Badge tone="accent" icon="check">Good standing</Badge>
                    )}
                  </Detail>
                </dl>
              ) : (
                <p className="t-small text-text-faint">No rider attached to this ticket.</p>
              )}
            </CardBody>
          </Card>

          {ticket.driver ? (
            <Card>
              <CardHead title="Driver" icon="wheel" />
              <CardBody>
                <dl>
                  <Detail label="Name">
                    <Link href={`/drivers/${ticket.driver.id}`} className="hover:text-accent">
                      {ticket.driver.name}
                    </Link>
                  </Detail>
                  <Detail label="Phone" mono>
                    <a href={`tel:${ticket.driver.phone}`} className="text-accent hover:underline">
                      {fmtPhone(ticket.driver.phone)}
                    </a>
                  </Detail>
                  <Detail label="Status">{ticket.driver.status}</Detail>
                </dl>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHead title="Context" icon="info" />
            <CardBody>
              <dl>
                <Detail label="Category">{ticket.category || '—'}</Detail>
                <Detail label="Opened">{dateTime(ticket.createdAt)}</Detail>
                <Detail label="Related trip" mono>
                  {ticket.tripId ? (
                    <Link href={`/trips/${ticket.tripId}`} className="text-accent hover:underline">
                      {shortId(ticket.tripId)}
                    </Link>
                  ) : (
                    'none'
                  )}
                </Detail>
              </dl>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
