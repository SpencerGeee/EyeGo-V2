import type { Metadata } from 'next';

import { ChangePasswordForm } from '@/app/change-password/ChangePasswordForm';
import { Card, CardBody, CardHead, Detail, PageHeader } from '@/components/ui/primitives';
import { getAdmin } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { ROLE_BLURB, ROLE_LABEL } from '@/lib/roles';

export const metadata: Metadata = { title: 'Your account' };

export default async function SettingsPage() {
  const admin = await getAdmin();

  return (
    <>
      <PageHeader
        title="Your account"
        subtitle="Your own console identity. Only a superadmin can change your role."
      />

      <div className="grid gap-4 lg:grid-cols-2 max-w-[900px]">
        <Card>
          <CardHead title="Identity" icon="users" />
          <CardBody>
            <dl>
              <Detail label="Name">{admin?.name ?? '—'}</Detail>
              <Detail label="Email" mono>
                {admin?.email ?? '—'}
              </Detail>
              <Detail label="Role">{admin?.role ? ROLE_LABEL[admin.role] : '—'}</Detail>
              <Detail label="Last signed in">{dateTime(admin?.lastLoginAt ?? null)}</Detail>
            </dl>
            {admin?.role ? (
              <p className="hint mt-3">{ROLE_BLURB[admin.role]}</p>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHead
            title="Change your password"
            subtitle="Signs out every device, including this one"
            icon="lock"
          />
          <CardBody>
            {admin?.isLegacy ? (
              <p className="t-small text-warn">
                This session authenticated with the shared <code className="mono">ADMIN_SECRET_KEY</code>,
                which has no password to change. Create a real account for yourself on Admin accounts
                and sign in with that.
              </p>
            ) : (
              <ChangePasswordForm />
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
