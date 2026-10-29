'use client';

import { useState, useTransition } from 'react';

import { Card } from '@/components/ui/primitives';
import { createCorridor, updateCorridor } from '@/lib/actions';

export type Corridor = {
  id: string; name: string; originLat: number; originLng: number; destLat: number; destLng: number;
  radiusKm: number; seatPricePesewas: number; isActive: boolean;
};
type Usage = { id: string; trips: number; seats: number };

const ghs = (p: number) => `GH₵${(p / 100).toFixed(2)}`;

/**
 * Operator-fixed corridor seat prices (D5). A new trip whose two ends sit near
 * a corridor's ends, in the same direction, is pinned to its price at publish;
 * editing here never reprices a trip already selling seats.
 */
export function CorridorPanel({ corridors, usage, canManage }: { corridors: Corridor[]; usage: Usage[]; canManage: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', originLat: '', originLng: '', destLat: '', destLng: '', radiusKm: '2', seatPriceGhs: '' });
  const use = new Map(usage.map((u) => [u.id, u]));
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = () => start(async () => {
    const r = await createCorridor({
      name: form.name,
      originLat: Number(form.originLat), originLng: Number(form.originLng),
      destLat: Number(form.destLat), destLng: Number(form.destLng),
      radiusKm: Number(form.radiusKm) || 2, seatPriceGhs: Number(form.seatPriceGhs),
    });
    setMsg(r.message || (r.ok ? 'Corridor created.' : 'Could not create the corridor.'));
  });

  return (
    <Card>
      <h3 style={{ marginTop: 0 }}>Corridors</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th align="left">Name</th><th align="right">Seat price</th><th align="right">Radius</th><th align="right">Trips (7d)</th><th align="right">Seats (7d)</th><th align="right">Active</th></tr></thead>
        <tbody>
          {corridors.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td align="right">{ghs(c.seatPricePesewas)}</td>
              <td align="right">{c.radiusKm} km</td>
              <td align="right">{use.get(c.id)?.trips ?? 0}</td>
              <td align="right">{use.get(c.id)?.seats ?? 0}</td>
              <td align="right">
                <button
                  disabled={!canManage || pending}
                  onClick={() => start(async () => { const r = await updateCorridor(c.id, { isActive: !c.isActive }); setMsg(r.message || (r.ok ? 'Updated.' : 'Update failed.')); })}
                >
                  {c.isActive ? 'On' : 'Off'}
                </button>
              </td>
            </tr>
          ))}
          {corridors.length === 0 && <tr><td colSpan={6}>No corridors yet — every bus is priced by its own fare.</td></tr>}
        </tbody>
      </table>

      {canManage && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16, alignItems: 'center' }}>
          <input placeholder="Name (Kasoa → Shiashie)" value={form.name} onChange={set('name')} />
          <input placeholder="From lat" value={form.originLat} onChange={set('originLat')} size={8} />
          <input placeholder="From lng" value={form.originLng} onChange={set('originLng')} size={8} />
          <input placeholder="To lat" value={form.destLat} onChange={set('destLat')} size={8} />
          <input placeholder="To lng" value={form.destLng} onChange={set('destLng')} size={8} />
          <input placeholder="Radius km" value={form.radiusKm} onChange={set('radiusKm')} size={5} />
          <input placeholder="Seat price GH₵" value={form.seatPriceGhs} onChange={set('seatPriceGhs')} size={7} />
          <button disabled={pending} onClick={submit}>Add corridor</button>
        </div>
      )}
      {msg && <p>{msg}</p>}
    </Card>
  );
}
