import type { Metadata } from 'next';

import { SurgeForm, type SurgeZone } from './SurgeForm';
import { Card, CardBody, CardHead, PageHeader, ReadOnlyNote } from '@/components/ui/primitives';
import { apiGetSafe, getAdmin } from '@/lib/api';
import { can, isReadOnly } from '@/lib/roles';

export const metadata: Metadata = { title: 'Surge' };

interface ZoneDirectory {
  zones: SurgeZone[];
  global: { zoneId: 'global'; manualMultiplier: number | null; expiresInSeconds: number | null };
  gridPrecision: { decimalPlaces: number; approxCellMetres: number; note: string };
  windowMs: number;
}

/**
 * Surge override.
 *
 * THE GAP IS CLOSED. This page used to say, in its own copy, that "the API
 * exposes no endpoint listing zone ids, so you need to know the id you are
 * targeting — this is a genuine gap, not a missing dropdown". It was right: a
 * zone was never a row, it is a 2dp lat/lng grid cell that comes into existence
 * the first time somebody pings or prices inside it.
 *
 * `GET /admin/surge/zones` now enumerates those cells out of Redis — the place
 * they actually live — and labels each one from a recent pickup address in the
 * same cell, so an operator picks "Osu (5.56:-0.18)" instead of typing decimals
 * and hoping they rounded the way `getGridKey` does. Nothing is hardcoded: an
 * empty directory means there genuinely is no priced traffic yet, which is a
 * true and useful thing for this page to say.
 *
 * Overrides expire on their own after one hour — that is the API's behaviour, and
 * it is stated on screen because an override that quietly lapses is otherwise
 * indistinguishable from one that never applied.
 */
export default async function SurgePage() {
  const [admin, directory] = await Promise.all([
    getAdmin(),
    apiGetSafe<ZoneDirectory>('/surge/zones'),
  ]);
  const canSet = can(admin?.role, ['OPS']) && !isReadOnly(admin?.role);

  const zones = directory?.zones ?? [];
  const globalOverride = directory?.global ?? null;

  return (
    <>
      <PageHeader
        title="Surge"
        subtitle="Temporarily multiply fares in a zone to pull supply toward demand."
      />

      <div className="grid gap-4 lg:grid-cols-2 max-w-[900px]">
        <Card>
          <CardHead title="Set an override" icon="bolt" />
          <CardBody>
            {canSet ? (
              <SurgeForm
                zones={zones}
                globalMultiplier={globalOverride?.manualMultiplier ?? null}
                directoryAvailable={directory != null}
              />
            ) : (
              <ReadOnlyNote>
                {can(admin?.role, ['OPS'])
                  ? 'Your role is read-only.'
                  : 'Only Operations can change surge pricing.'}
              </ReadOnlyNote>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHead title="How this behaves" icon="info" />
          <CardBody>
            <ul className="space-y-2.5 t-small text-text-dim">
              <li>
                <strong className="text-text">Overrides expire after one hour.</strong> The API sets a
                60-minute TTL. If demand is still high you must set it again.
              </li>
              <li>
                <strong className="text-text">The maximum is 3.0x.</strong> The API caps anything
                higher, so a typo cannot become a pricing incident.
              </li>
              <li>
                <strong className="text-text">Setting 1.0 clears the override</strong> and returns the
                zone to normal pricing immediately.
              </li>
              <li>
                <strong className="text-text">Riders already quoted keep their price.</strong> A quote
                is locked when it is issued, so a surge change does not reprice a
                trip someone is midway through booking.
              </li>
              <li>
                <strong className="text-text">An override is a floor, not a replacement.</strong> The
                fare path charges <span className="mono">max(auto, your override)</span>, so
                automatic surge can still price above what you set.
              </li>
              <li>
                <strong className="text-text">A zone is a ~1.1 km grid cell.</strong>{' '}
                <span className="mono">{'{lat}:{lng}'}</span> rounded to 2 decimal places, or the
                literal <span className="mono">global</span> for a platform-wide floor.
              </li>
            </ul>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHead
            title="Live zones"
            icon="pin"
            subtitle={`${zones.length} known · supply and demand over the last 5 minutes`}
          />
          <CardBody>
            {directory == null ? (
              <p className="t-small text-text-dim">
                The zone directory could not be loaded. Surge can still be set by id above.
              </p>
            ) : zones.length === 0 ? (
              <p className="t-small text-text-dim">
                No zone has priced traffic yet. A cell appears here the first time a driver pings
                inside it, a rider asks for a fare from it, or a trip is picked up in it.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full t-small">
                  <thead>
                    <tr className="text-text-dim text-left">
                      <th className="py-2 pr-4 font-medium">Zone</th>
                      <th className="py-2 pr-4 font-medium">Id</th>
                      <th className="py-2 pr-4 font-medium num text-right">Drivers</th>
                      <th className="py-2 pr-4 font-medium num text-right">Requests</th>
                      <th className="py-2 pr-4 font-medium num text-right">Auto</th>
                      <th className="py-2 pr-4 font-medium num text-right">Override</th>
                      <th className="py-2 font-medium num text-right">Charged</th>
                    </tr>
                  </thead>
                  <tbody>
                    {zones.slice(0, 50).map((z) => (
                      <tr key={z.zoneId} className="border-t border-rim">
                        <td className="py-2 pr-4">{z.label ?? '—'}</td>
                        <td className="py-2 pr-4 mono text-text-dim">{z.zoneId}</td>
                        <td className="py-2 pr-4 num text-right">{z.supplyCount}</td>
                        <td className="py-2 pr-4 num text-right">{z.demandCount}</td>
                        <td className="py-2 pr-4 num text-right">{z.autoMultiplier.toFixed(2)}x</td>
                        <td className="py-2 pr-4 num text-right">
                          {z.manualMultiplier != null ? `${z.manualMultiplier.toFixed(1)}x` : '—'}
                        </td>
                        <td
                          className={`py-2 num text-right ${
                            z.effectiveMultiplier >= 2.5
                              ? 'text-danger'
                              : z.effectiveMultiplier >= 1.8
                                ? 'text-warn'
                                : 'text-text'
                          }`}
                        >
                          {z.effectiveMultiplier.toFixed(2)}x
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
