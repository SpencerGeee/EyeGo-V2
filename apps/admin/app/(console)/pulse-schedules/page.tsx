import type { Metadata } from 'next';

import { SchedulesTable, type PulseSchedule } from './SchedulesTable';
import { RefreshControl } from '@/components/ui/Filters';
import { Card, ErrorPanel, PageHeader } from '@/components/ui/primitives';
import { apiGetSafe, getAdmin } from '@/lib/api';
import { can, isReadOnly } from '@/lib/roles';

export const metadata: Metadata = { title: 'Pulse schedules' };

export default async function PulseSchedulesPage() {
  const [data, admin] = await Promise.all([
    apiGetSafe<{ schedules: PulseSchedule[] }>('/pulse-schedules'),
    getAdmin(),
  ]);

  return (
    <>
      <PageHeader
        title="Pulse schedules"
        subtitle="Recurring departures the platform creates automatically. Each one spawns a trip on the days it covers."
        actions={<RefreshControl />}
      />

      {!data ? (
        <Card>
          <ErrorPanel message="The pulse schedules endpoint did not respond." />
        </Card>
      ) : (
        <SchedulesTable
          schedules={data.schedules}
          canManage={can(admin?.role, ['OPS']) && !isReadOnly(admin?.role)}
          readOnlyReason={
            can(admin?.role, ['OPS'])
              ? 'Your role is read-only.'
              : 'Only Operations can change pulse schedules.'
          }
        />
      )}
    </>
  );
}
