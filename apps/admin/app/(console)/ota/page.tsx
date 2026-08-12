import type { Metadata } from 'next';

import { OtaPublisher, type OtaApp, type OtaRun } from './OtaPublisher';
import { RefreshControl } from '@/components/ui/Filters';
import { Icon } from '@/components/ui/Icon';
import { Card, CardBody, CardHead, ErrorPanel, PageHeader } from '@/components/ui/primitives';
import { apiGetSafe, getAdmin } from '@/lib/api';
import { isReadOnly } from '@/lib/roles';

export const metadata: Metadata = { title: 'App releases' };

type Overview = {
  config: Record<string, unknown>;
  apps: OtaApp[];
  runs: OtaRun[];
  /** Non-fatal upstream problems, e.g. an unset EXPO_TOKEN. */
  errors: string[];
};

/**
 * OTA releases. Superadmin only — this ships JavaScript to phones in the field.
 *
 * The page surfaces the API's own `errors` array rather than hiding it: the OTA
 * integration degrades to read-only when EXPO_TOKEN or the GitHub token is
 * unset, and an operator staring at an empty channel list deserves to know it is
 * a configuration gap and not a quiet platform.
 */
export default async function OtaPage() {
  const [overview, admin] = await Promise.all([
    apiGetSafe<Overview>('/ota/overview'),
    getAdmin(),
  ]);

  const canPublish = admin?.role === 'SUPERADMIN' && !isReadOnly(admin?.role);

  return (
    <>
      <PageHeader
        title="App releases"
        subtitle="Over-the-air updates for the rider and driver apps. A publish reaches real phones within minutes."
        actions={<RefreshControl />}
      />

      <div
        role="note"
        className="flex items-start gap-2.5 p-3.5 mb-4 rounded-lg bg-warn-soft border border-warn-rim"
      >
        <Icon name="alert" size={15} className="text-warn mt-0.5" />
        <div>
          <p className="t-heading text-warn">This is a production deploy control</p>
          <p className="t-small text-text-dim mt-1 max-w-[86ch]">
            An OTA update replaces the JavaScript bundle on every device on the
            chosen channel. It cannot fix a native crash — anything that changes
            native code needs a new store build. If a release goes wrong, publish
            a rollback from the run history below rather than waiting for a fix.
          </p>
        </div>
      </div>

      {!overview ? (
        <Card>
          <ErrorPanel
            title="Release console unavailable"
            message="The OTA endpoint did not respond, or your role is not permitted to read it."
          />
        </Card>
      ) : (
        <>
          {overview.errors?.length ? (
            <Card className="mb-4">
              <CardHead title="Integration warnings" icon="alert" />
              <CardBody>
                <ul className="space-y-1.5">
                  {overview.errors.map((err, i) => (
                    <li key={i} className="t-small text-warn flex items-start gap-1.5">
                      <Icon name="alert" size={12} className="mt-0.5" />
                      <span className="mono break-words">{err}</span>
                    </li>
                  ))}
                </ul>
                <p className="hint mt-2">
                  Publishing needs EXPO_TOKEN and a GitHub token with{' '}
                  <code className="mono">actions:write</code> configured on the API.
                </p>
              </CardBody>
            </Card>
          ) : null}

          <OtaPublisher apps={overview.apps ?? []} runs={overview.runs ?? []} canPublish={canPublish} />
        </>
      )}
    </>
  );
}
