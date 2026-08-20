import type { Metadata } from 'next';
import Link from 'next/link';

import { ExportButton } from '@/components/ui/ExportButton';
import { FilterSelect, Pagination, RefreshControl, ResetFilters, SearchBox } from '@/components/ui/Filters';
import {
  Avatar,
  Badge,
  Card,
  EmptyState,
  ErrorPanel,
  PageHeader,
  Toolbar,
} from '@/components/ui/primitives';
import { apiGetSafe } from '@/lib/api';
import { ghs, num, phone as fmtPhone, relative } from '@/lib/format';
import { tierMeta } from '@/lib/status';

export const metadata: Metadata = { title: 'Riders' };

type Rider = {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  profilePhoto?: string | null;
  preferredTier?: string | null;
  isBanned?: boolean;
  isActive?: boolean;
  businessMode?: boolean;
  walletBalancePesewas?: number;
  createdAt: string;
  _count?: { bookings: number };
};

type Response = { users: Rider[]; total: number; page: number; limit: number };

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; banned?: string; page?: string; limit?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const limit = Math.min(100, Math.max(10, Number(sp.limit) || 20));

  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (sp.q) query.set('q', sp.q);
  if (sp.banned === 'true') query.set('bannedOnly', 'true');

  const data = await apiGetSafe<Response>(`/users?${query.toString()}`);

  return (
    <>
      <PageHeader
        title="Riders"
        subtitle="Search matches name, phone or email. Ride counts exclude cancelled and no-show bookings."
        actions={
          <>
            <ExportButton dataset="users" />
            <RefreshControl />
          </>
        }
      />

      <Card flush>
        <Toolbar>
          <SearchBox placeholder="Name, phone or email…" label="Search riders" />
          <FilterSelect
            paramKey="banned"
            label="Standing"
            options={[{ value: 'true', label: 'Banned only' }]}
            allLabel="All riders"
          />
          <ResetFilters keys={['q', 'banned']} />
          {data ? (
            <span className="t-small text-text-faint ml-auto num">{num(data.total)} riders</span>
          ) : null}
        </Toolbar>

        {!data ? (
          <ErrorPanel message="The riders endpoint did not respond." />
        ) : data.users.length === 0 ? (
          <EmptyState icon="users" title="No riders match" body="Nothing matches the current search." />
        ) : (
          <>
            <div className="table-scroll">
              <table className="table">
                <caption className="sr-only">All riders</caption>
                <thead>
                  <tr>
                    <th scope="col">Rider</th>
                    <th scope="col">Standing</th>
                    <th scope="col" className="hidden lg:table-cell">Preferred tier</th>
                    <th scope="col" className="text-right">Rides</th>
                    <th scope="col" className="text-right hidden md:table-cell">Wallet</th>
                    <th scope="col" className="text-right">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((u) => {
                    const tier = u.preferredTier ? tierMeta(u.preferredTier) : null;
                    return (
                      <tr key={u.id} className={u.isBanned ? 'bg-danger-soft/40' : undefined}>
                        <td>
                          <Link
                            href={`/users/${u.id}`}
                            className="inline-flex items-center gap-2 hover:text-accent"
                          >
                            <Avatar name={u.name} src={u.profilePhoto} size={28} />
                            <span className="min-w-0">
                              <span className="block truncate-1 max-w-[170px]">{u.name}</span>
                              <span className="block text-[11.5px] text-text-faint mono">
                                {fmtPhone(u.phone)}
                              </span>
                            </span>
                          </Link>
                        </td>
                        <td>
                          {u.isBanned ? (
                            <Badge tone="danger" icon="ban">Banned</Badge>
                          ) : u.isActive === false ? (
                            <Badge tone="neutral">Inactive</Badge>
                          ) : (
                            <Badge tone="accent" icon="check">Good standing</Badge>
                          )}
                          {u.businessMode ? (
                            <>
                              {' '}
                              <Badge tone="info">Business</Badge>
                            </>
                          ) : null}
                        </td>
                        <td className="hidden lg:table-cell">
                          {tier ? <Badge tone={tier.tone}>{tier.label}</Badge> : <span className="text-text-faint">—</span>}
                        </td>
                        <td className="num">{num(u._count?.bookings ?? 0)}</td>
                        <td className="num hidden md:table-cell">{ghs(u.walletBalancePesewas ?? 0)}</td>
                        <td className="num text-text-faint">{relative(u.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination total={data.total} page={data.page} limit={data.limit} />
          </>
        )}
      </Card>
    </>
  );
}
