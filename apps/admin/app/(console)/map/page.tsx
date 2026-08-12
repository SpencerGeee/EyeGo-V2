import type { Metadata } from 'next';

import { FleetMap, type MapDriver } from '@/components/map/FleetMap';
import { PageHeader, StatCard } from '@/components/ui/primitives';
import { apiGetSafe } from '@/lib/api';
import { num } from '@/lib/format';

export const metadata: Metadata = { title: 'Fleet map' };

/**
 * Where the fleet actually is.
 *
 * /drivers/live is the map-shaped read: online drivers that have a GPS fix,
 * each with its heading, plate and current trip id. It differs from
 * /live/drivers (used by dispatch) in that it is positional rather than
 * eligibility-shaped — this page answers "where", dispatch answers "who can
 * take this".
 *
 * The first paint is server-rendered so the operator never watches an empty map
 * fill in; polling after that happens in the client through /api/live/drivers,
 * which keeps the bearer token on the server.
 */
export default async function FleetMapPage() {
  const data = await apiGetSafe<{ drivers: MapDriver[] }>('/drivers/live');
  const drivers = data?.drivers ?? [];

  const busy = drivers.filter((d) => d.activeTripId).length;
  const located = drivers.filter((d) => typeof d.lat === 'number' && typeof d.lng === 'number').length;

  return (
    <>
      <PageHeader
        title="Fleet map"
        subtitle="Every driver who is online and reporting a position, refreshed continuously."
      />

      <section aria-label="Fleet summary" className="grid gap-3 mb-4 grid-cols-2 lg:grid-cols-4">
        <StatCard label="Online" value={num(drivers.length)} hint="app open, marked online" icon="wheel" />
        <StatCard label="On a trip" value={num(busy)} hint="cannot take new work" icon="route" />
        <StatCard label="Free" value={num(drivers.length - busy)} hint="dispatchable now" icon="radar" />
        <StatCard
          label="Placed on map"
          value={num(located)}
          hint={located === drivers.length ? 'all located' : `${drivers.length - located} without a fix`}
          icon="pin"
          tone={located === drivers.length ? undefined : 'warn'}
        />
      </section>

      <FleetMap
        initial={drivers}
        initialError={data === null ? 'Could not reach the API for the first read.' : null}
        intervalSeconds={15}
      />
    </>
  );
}
