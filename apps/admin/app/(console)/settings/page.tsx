import type { Metadata } from 'next';

import { ChangePasswordForm } from '@/app/change-password/ChangePasswordForm';
import { Card, CardBody, CardHead, Detail, PageHeader } from '@/components/ui/primitives';
import { apiGetSafe, getAdmin } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { ROLE_BLURB, ROLE_LABEL } from '@/lib/roles';

import { TwoFactorPanel } from './TwoFactorPanel';

export const metadata: Metadata = { title: 'Your account' };

type TotpStatus = {
  enabled: boolean;
  enabledAt: string | null;
  backupCodesRemaining: number;
  requiredByPolicy: boolean;
};

export default async function SettingsPage() {
  const [admin, totp] = await Promise.all([
    getAdmin(),
    apiGetSafe<TotpStatus>('/auth/totp'),
  ]);

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

        {/* Spans both columns: enrolment shows a QR and ten recovery codes, and
            cramming that into a half-width card makes the codes wrap badly at
            exactly the moment they must be transcribed accurately. */}
        <div className="lg:col-span-2">
          <TwoFactorPanel status={totp} />
        </div>
      </div>
    </>
  );
}
