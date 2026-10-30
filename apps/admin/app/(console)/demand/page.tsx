import type { Metadata } from 'next';

import { CorridorPanel, type Corridor } from './CorridorPanel';
import { LandmarkCell } from './LandmarkCell';
import { RefreshControl } from '@/components/ui/Filters';
import { Card, ErrorPanel, PageHeader } from '@/components/ui/primitives';
import { apiGetSafe, getAdmin } from '@/lib/api';
import { can, isReadOnly } from '@/lib/roles';

export const metadata: Metadata = { title: 'Demand & corridors' };

type Cell = { lat: number; lng: number; destLat: number | null; destLng: number | null; hourOfWeek: number; searches: number };
type Stop = { id: string; name: string; landmark: string | null; lat: number; lng: number; bookings: number; seats: number };
type CorridorUse = { id: string; name: string; seatPricePesewas: number; trips: number; seats: number };

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const when = (h: number) => `${DAYS[Math.floor(h / 24)] ?? '?'} ${String(h % 24).padStart(2, '0')}:00`;

/**
 * Where riders want a bus and could not get one, where seats already sell, and
 * the operator-priced corridors (client 2026-10-29, item 9 + D5: "start on the
 * highest-demand corridors… work out where demand peaks at stops").
 */
export default async function DemandPage() {
  const [demand, corridors, admin] = await Promise.all([
    apiGetSafe<{ days: number; cells: Cell[]; stops: Stop[]; corridors: CorridorUse[] }>('/demand?days=7'),
    apiGetSafe<{ corridors: Corridor[] }>('/corridors'),
    getAdmin(),
  ]);
  const canManage = can(admin?.role, ['OPS']) && !isReadOnly(admin?.role);

  return (
    <>
      <PageHeader
        title="Demand & corridors"
        subtitle="Last 7 days. Unmet searches show where to put buses; stops show what already sells; corridors fix the seat price for every bus on a road."
        actions={<RefreshControl />}
      />

      {!corridors ? (
        <Card><ErrorPanel message="The corridors endpoint did not respond." /></Card>
      ) : (
        <CorridorPanel corridors={corridors.corridors} usage={demand?.corridors ?? []} canManage={canManage} />
      )}

      {!demand ? (
        <Card><ErrorPanel message="The demand endpoint did not respond." /></Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, marginTop: 16 }}>
          <Card>
            <h3 style={{ marginTop: 0 }}>Searches with no bus</h3>
            {demand.cells.length === 0 ? <p>No unmet searches in this window.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th align="left">From (≈1 km)</th><th align="left">To</th><th align="left">When</th><th align="right">Searches</th></tr></thead>
                <tbody>
                  {demand.cells.slice(0, 40).map((c, i) => (
                    <tr key={i}>
                      <td>{c.lat.toFixed(2)}, {c.lng.toFixed(2)}</td>
                      <td>{c.destLat != null && c.destLng != null ? `${c.destLat.toFixed(2)}, ${c.destLng.toFixed(2)}` : '—'}</td>
                      <td>{when(c.hourOfWeek)}</td>
                      <td align="right">{c.searches}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card>
            <h3 style={{ marginTop: 0 }}>Busiest boarding stops</h3>
            {demand.stops.length === 0 ? <p>No stop boardings in this window.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th align="left">Stop</th><th align="left">Landmark (rider sees it)</th><th align="right">Bookings</th><th align="right">Seats</th></tr></thead>
                <tbody>
                  {demand.stops.slice(0, 40).map((s) => (
                    <tr key={s.id}><td>{s.name}</td><td><LandmarkCell id={s.id} value={s.landmark} canManage={canManage} /></td><td align="right">{s.bookings}</td><td align="right">{s.seats}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
