'use client';

import Link from 'next/link';
import { useState } from 'react';

import { DataTable, type Column } from '@/components/ui/DataTable';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Badge, EmptyState } from '@/components/ui/primitives';
import { dateTime, relative, shortId } from '@/lib/format';

export type AuditRow = {
  id: string;
  adminId?: string | null;
  adminEmail: string;
  adminRole: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  method: string;
  path: string;
  payload?: string | null;
  statusCode: number;
  ip?: string | null;
  userAgent?: string | null;
  createdAt: string;
};

/** Where a target id can be opened, so the log is navigable and not just readable. */
const TARGET_HREF: Record<string, (id: string) => string> = {
  Driver: (id) => `/drivers/${id}`,
  User: (id) => `/users/${id}`,
  Trip: (id) => `/trips/${id}`,
  SupportTicket: (id) => `/tickets/${id}`,
};

export function AuditTable({ rows }: { rows: AuditRow[] }) {
  const [detail, setDetail] = useState<AuditRow | null>(null);

  const columns: Column<AuditRow>[] = [
    {
      key: 'when',
      header: 'When',
      sortValue: (r) => r.createdAt,
      render: (r) => (
        <span title={dateTime(r.createdAt)}>
          <span className="block">{relative(r.createdAt)}</span>
          <span className="block text-[11.5px] text-text-faint num">{dateTime(r.createdAt)}</span>
        </span>
      ),
    },
    {
      key: 'admin',
      header: 'Who',
      sortValue: (r) => r.adminEmail,
      render: (r) => (
        <span className="min-w-0">
          <span className="block truncate-1 max-w-[190px]">{r.adminEmail}</span>
          <span className="block text-[11.5px] text-text-faint">{r.adminRole}</span>
        </span>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      sortValue: (r) => r.action,
      render: (r) => <span className="mono">{r.action}</span>,
    },
    {
      key: 'target',
      header: 'Target',
      hideBelow: 'md',
      render: (r) => {
        if (!r.targetId) return <span className="text-text-faint">—</span>;
        const href = r.targetType ? TARGET_HREF[r.targetType]?.(r.targetId) : undefined;
        const label = (
          <span className="mono" title={r.targetId}>
            {r.targetType ? `${r.targetType} ` : ''}
            {shortId(r.targetId)}
          </span>
        );
        return href ? (
          <Link href={href} className="hover:text-accent">
            {label}
          </Link>
        ) : (
          label
        );
      },
    },
    {
      key: 'result',
      header: 'Result',
      align: 'right',
      sortValue: (r) => r.statusCode,
      render: (r) => {
        // A refused attempt is not a completed action, and the log must never let
        // the two be confused.
        const ok = r.statusCode < 400;
        const forbidden = r.statusCode === 403;
        return (
          <Badge tone={ok ? 'accent' : forbidden ? 'warn' : 'danger'}>
            {r.statusCode} {ok ? 'applied' : forbidden ? 'refused' : 'failed'}
          </Badge>
        );
      },
    },
  ];

  return (
    <>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        caption="Admin audit log"
        rowTone={(r) => (r.statusCode >= 500 ? 'danger' : r.statusCode >= 400 ? 'warn' : null)}
        empty={
          <EmptyState
            icon="scroll"
            title="No audit entries"
            body="Nothing matches these filters. If this is a fresh deployment, the log fills as admins act."
          />
        }
        rowActions={(r) => (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setDetail(r)}
            aria-label={`Inspect ${r.action} entry`}
          >
            <Icon name="eye" size={12} />
            Inspect
          </button>
        )}
      />

      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail?.action ?? ''}
        description={detail ? `${detail.method} ${detail.path}` : undefined}
        width={560}
      >
        {detail ? (
          <dl className="space-y-0">
            <Row label="When">{dateTime(detail.createdAt)}</Row>
            <Row label="Admin">{detail.adminEmail}</Row>
            <Row label="Role">{detail.adminRole}</Row>
            <Row label="Result">
              {detail.statusCode} {detail.statusCode < 400 ? '(applied)' : '(not applied)'}
            </Row>
            <Row label="Target">
              {detail.targetType ? `${detail.targetType} · ` : ''}
              {detail.targetId || '—'}
            </Row>
            <Row label="IP">{detail.ip || '—'}</Row>
            <Row label="User agent">{detail.userAgent || '—'}</Row>

            <div className="pt-3">
              <p className="t-eyebrow mb-1.5">Request payload</p>
              {detail.payload ? (
                <pre className="mono text-[11.5px] p-3 rounded-md bg-bg-inset border border-line overflow-x-auto whitespace-pre-wrap break-words">
                  {prettyJson(detail.payload)}
                </pre>
              ) : (
                <p className="t-small text-text-faint">No body was sent.</p>
              )}
              <p className="hint">
                Passwords, tokens and secrets are replaced with{' '}
                <code className="mono">[redacted]</code> before the row is written.
              </p>
            </div>
          </dl>
        ) : null}
      </Modal>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 border-b border-line">
      <dt className="t-small text-text-faint flex-none">{label}</dt>
      <dd className="t-small text-right min-w-0 mono break-all">{children}</dd>
    </div>
  );
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    // Stored payloads are written by the API as JSON, but a malformed row must
    // still be inspectable rather than throwing inside the dialog.
    return raw;
  }
}
