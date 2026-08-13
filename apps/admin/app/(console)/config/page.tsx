import type { Metadata } from 'next';

import { ConfigForm, type SettingGroup } from './ConfigForm';
import { RefreshControl } from '@/components/ui/Filters';
import { Icon } from '@/components/ui/Icon';
import { Card, ErrorPanel, PageHeader, StatCard } from '@/components/ui/primitives';
import { apiGetSafe, getAdmin } from '@/lib/api';
import { can, isReadOnly } from '@/lib/roles';

export const metadata: Metadata = { title: 'Platform config' };

/**
 * Live platform configuration.
 *
 * Everything on this page used to live in the API's `.env`: tier fares, the
 * commission, the fare floor, the seat-hold window, dispatch radii, the driver
 * wallet minimum. Changing any of them meant editing an env file and restarting —
 * and for the values the apps display, an app-store release too.
 *
 * Now a `PlatformSetting` row overrides the env default and every API instance
 * picks it up over Redis within a round trip. The fare calculator reads through
 * the same registry, so the NEXT quote after a save uses the new number.
 *
 * The apps read the client-visible subset from `GET /v1/config/public`, which is
 * an explicit allow-list — the announcement banner, the support number, the
 * booking kill switch and the tier rates reach a phone without a release.
 */
export default async function ConfigPage() {
  const [data, admin] = await Promise.all([
    apiGetSafe<{ groups: SettingGroup[]; loaded: boolean }>('/settings'),
    getAdmin(),
  ]);

  const canEdit = can(admin?.role, ['FINANCE']) && !isReadOnly(admin?.role);
  const groups = data?.groups ?? [];
  const all = groups.flatMap((g) => g.settings);
  const customised = all.filter((s) => s.source === 'override');

  return (
    <>
      <PageHeader
        title="Platform config"
        subtitle="Fares, commission, dispatch tuning and what the apps show. Every change is live on save — no deploy, no app-store release."
        actions={<RefreshControl />}
      />

      <div
        role="note"
        className="flex items-start gap-2.5 p-3.5 mb-4 rounded-lg bg-warn-soft border border-warn-rim"
      >
        <Icon name="alert" size={15} className="text-warn mt-0.5" />
        <div>
          <p className="t-heading text-warn">These numbers price real rides</p>
          <p className="t-small text-text-dim mt-1 max-w-[86ch]">
            A saved fare change applies to the next quote, not to trips already
            booked — those keep the rates they locked in, which is why an old trip
            still shows its original price. Every change here is recorded in the
            audit log against your name.
          </p>
        </div>
      </div>

      <section aria-label="Configuration summary" className="grid gap-3 mb-4 grid-cols-2 lg:grid-cols-4">
        <StatCard label="Settings" value={String(all.length)} hint="all editable live" icon="bolt" />
        <StatCard
          label="Customised"
          value={String(customised.length)}
          hint={customised.length ? 'differ from the deploy defaults' : 'all on defaults'}
          icon="check"
        />
        <StatCard
          label="Groups"
          value={String(groups.length)}
          hint="pricing, dispatch, apps"
          icon="grid"
        />
        <StatCard
          label="Takes effect"
          value="Immediately"
          hint="propagated to every API instance"
          icon="rocket"
        />
      </section>

      {!data ? (
        <Card>
          <ErrorPanel
            title="Could not load the configuration"
            message="The settings endpoint did not respond. Nothing has been changed."
          />
        </Card>
      ) : (
        <ConfigForm
          groups={groups}
          canEdit={canEdit}
          readOnlyReason={
            can(admin?.role, ['FINANCE'])
              ? 'Your role is read-only.'
              : 'Only Finance and superadmins can change platform configuration. You can read every value here.'
          }
        />
      )}
    </>
  );
}
