import type { Metadata } from 'next';

import { AdminsManager, type AdminRow } from './AdminsManager';
import { Card, ErrorPanel, PageHeader } from '@/components/ui/primitives';
import { apiGetSafe, getAdmin } from '@/lib/api';
import { ROLE_BLURB, ROLE_LABEL, ROLES } from '@/lib/roles';

export const metadata: Metadata = { title: 'Admin accounts' };

/**
 * Console account management. Superadmin only, enforced by the API.
 *
 * This page exists because the platform previously had NO admin accounts at all:
 * one shared ADMIN_SECRET_KEY, with the acting admin's name taken from an
 * unverified request header. Nobody could be revoked individually, nobody could
 * be scoped, and the audit trail was whatever string the caller sent.
 */
export default async function AdminsPage() {
  const [data, me] = await Promise.all([
    apiGetSafe<{ admins: AdminRow[] }>('/admins'),
    getAdmin(),
  ]);

  return (
    <>
      <PageHeader
        title="Admin accounts"
        subtitle="Console access is personal and scoped. Disabling an account ends its sessions immediately."
      />

      {me?.isLegacy ? (
        <div
          role="alert"
          className="p-3.5 mb-4 rounded-lg bg-warn-soft border border-warn-rim"
        >
          <p className="t-heading text-warn">You are using the shared secret, not an account</p>
          <p className="t-small text-text-dim mt-1 max-w-[80ch]">
            This session authenticated with <code className="mono">ADMIN_SECRET_KEY</code>. Every
            action you take is logged as <code className="mono">legacy-shared-secret</code> and
            cannot be traced to a person. Create a real account for yourself below, sign in with it,
            then set <code className="mono">ADMIN_LEGACY_SECRET=false</code> on the API to close this
            door for good.
          </p>
        </div>
      ) : null}

      {!data ? (
        <Card>
          <ErrorPanel
            title="Could not load admin accounts"
            message="Either the API is unreachable or your role is not permitted to manage accounts."
          />
        </Card>
      ) : (
        <AdminsManager admins={data.admins} currentAdminId={me?.id ?? null} />
      )}

      {/* Roles are documented on the page that grants them. An operator choosing
          a role should not have to guess what it permits. */}
      <Card className="mt-4">
        <div className="card-head">
          <div className="t-heading">What each role can do</div>
        </div>
        <div className="card-body">
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ROLES.map((role) => (
              <div key={role} className="p-3 rounded-md bg-surface-2 border border-line">
                <dt className="t-heading mb-1">{ROLE_LABEL[role]}</dt>
                <dd className="t-small text-text-dim">{ROLE_BLURB[role]}</dd>
              </div>
            ))}
          </dl>
          <p className="hint mt-3">
            Superadmin satisfies every permission implicitly. Viewer is refused every
            write by the API, not just hidden from the interface.
          </p>
        </div>
      </Card>
    </>
  );
}
