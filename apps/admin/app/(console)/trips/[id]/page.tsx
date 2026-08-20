import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { StaticMap } from '@/components/map/StaticMap';
import { Icon } from '@/components/ui/Icon';
import {
  Badge,
  Card,
  CardBody,
  CardHead,
  Detail,
  EmptyState,
  ErrorPanel,
  PageHeader,
  StatCard,
} from '@/components/ui/primitives';
import { RefundControl } from '@/components/ui/RefundControl';
import { apiGetSafe, getAdmin } from '@/lib/api';
import { can, isReadOnly } from '@/lib/roles';
import {
  dateTime,
  ghs,
  humanise,
  num,
  phone as fmtPhone,
  relative,
  shortId,
  tripRef,
  tripTitle,
} from '@/lib/format';
import {
  bookingStatusMeta,
  isLiveTrip,
  paymentStatusMeta,
  tierMeta,
  tripStatusMeta,
} from '@/lib/status';

type Trip = {
  id: string;
  shortId?: string;
  status: string;
  tier?: string | null;
  version?: number;
  maxSeats?: number;
  departureTime?: string | null;
  pickupAddress?: string | null;
  dropoffAddress?: string | null;
  surgeMultiplier?: number;
  /**
   * Derived server-side by fare.calculator from the rates the trip locked in.
   * There is no `farePerSeatPesewas` COLUMN — reading one is why this tile used
   * to render "—" on every trip.
   */
  pricing?: {
    farePerSeatPesewas: number;
    totalTripCostPesewas: number;
    driverEarningsPerSeatPesewas: number;
    commissionPerSeatPesewas: number;
    distanceKm: number;
    floorApplied: boolean;
    surchargePerSeatPesewas: number;
    heavyLoadSurchargePesewas: number;
    doorstepSurchargePesewas: number;
    distanceSource: 'ROUTE' | 'STRAIGHT_LINE';
  } | null;
  geometry?: {
    pickup?: { lat: number; lng: number; address?: string | null } | null;
    dropoff?: { lat: number; lng: number; address?: string | null } | null;
    driver?: { lat: number; lng: number } | null;
    line?: { type: 'LineString'; coordinates: [number, number][] } | null;
    lineSource?: 'DIRECTIONS' | 'NONE';
    roadDistanceKm?: number;
    roadDurationMin?: number;
  } | null;
  createdAt: string;
  cancelledBy?: string | null;
  cancellationReason?: string | null;
  route?: {
    name?: string;
    originName?: string;
    destinationName?: string;
    originLat?: number;
    originLng?: number;
    destLat?: number;
    destLng?: number;
    distanceKm?: number;
    isAdHoc?: boolean;
  } | null;
  vehicle?: { make?: string; model?: string; plateNumber?: string; seaterCount?: number } | null;
  driver?: {
    id: string;
    name: string;
    phone: string;
    status?: string;
    isOnline?: boolean;
    currentLat?: number | null;
    currentLng?: number | null;
  } | null;
  requester?: { id: string; name: string; phone: string } | null;
  bookings?: {
    id: string;
    status: string;
    paymentStatus?: string | null;
    paymentMethod?: string | null;
    seatNumber?: number | null;
    fareAmountPesewas?: number;
    isCoverAll?: boolean;
    guestName?: string | null;
    createdAt: string;
    user?: { id: string; name: string; phone: string } | null;
  }[];
  events?: {
    id: string;
    seq: number;
    type: string;
    actor: string;
    actorId?: string | null;
    createdAt: string;
  }[];
  occupancy?: {
    maxSeats: number;
    occupiedSeats: number;
    availableSeats: number;
    seatNumbers: (number | null)[];
  };
  money?: { settledBookings: number; settledPesewas: number; commissionPesewas: number };
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: `Trip ${tripRef(id)}` };
}

/**
 * Single-trip investigation view.
 *
 * The event timeline is the authoritative record: TripEvent is append-only with
 * seq === version, so a gap in the sequence means a write bypassed
 * applyTransition. That is worth being able to see, which is why the sequence
 * numbers are shown rather than hidden behind friendly labels.
 */
export default async function TripDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, admin] = await Promise.all([
    apiGetSafe<{ trip: Trip }>(`/trips/${id}`),
    getAdmin(),
  ]);
  // Refunds are FINANCE (and superadmin) only, enforced by the API. Hiding the
  // column keeps an OPS lead from reaching for an action that will be refused.
  const canRefund = can(admin?.role, ['FINANCE']) && !isReadOnly(admin?.role);

  if (data === null) {
    return (
      <Card>
        <ErrorPanel
          title="Could not load this trip"
          message="The API did not respond. The trip may still exist."
          action={
            <Link href="/trips" className="btn btn-secondary btn-sm">
              Back to trips
            </Link>
          }
        />
      </Card>
    );
  }

  const trip = data.trip;
  if (!trip) notFound();

  const meta = tripStatusMeta(trip.status);
  const tier = trip.tier ? tierMeta(trip.tier) : null;
  const bookings = trip.bookings ?? [];
  const events = trip.events ?? [];

  // seq must equal version and increase by exactly one. A gap means something
  // wrote Trip.status without appending an event, which breaks client replay.
  const sequenceGap = events.some((e, i) => i > 0 && e.seq !== (events[i - 1]!.seq ?? 0) + 1);

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3">
        <Link href="/trips" className="t-small text-text-faint hover:text-text inline-flex items-center gap-1">
          <Icon name="chevron-left" size={12} />
          All trips
        </Link>
      </nav>

      {/* The journey is the title; the reference is for looking it up. "Trip
          cmspzwr6" told an operator nothing — and because cuids lead with a
          timestamp, it also looked identical to every other id created that day
          (it was mistaken for a rider id, which shared the same prefix). */}
      <PageHeader
        title={tripTitle(trip) ?? `Trip ${tripRef(trip)}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={meta.tone} live={isLiveTrip(trip.status)}>
              {meta.label}
            </Badge>
            {tier ? <Badge tone={tier.tone}>{tier.label}</Badge> : null}
            <span className="mono" title="Trip reference">
              {tripRef(trip)}
            </span>
            <span className="text-text-faint">·</span>
            <span>created {relative(trip.createdAt)}</span>
            {trip.route?.isAdHoc ? <Badge tone="info">On-demand</Badge> : null}
          </span>
        }
      />

      {trip.cancelledBy ? (
        <div role="note" className="p-3.5 mb-4 rounded-lg bg-danger-soft border border-danger-rim">
          <p className="t-heading text-danger">Cancelled by {humanise(trip.cancelledBy)}</p>
          {trip.cancellationReason ? (
            <p className="t-small text-text-dim mt-1">{trip.cancellationReason}</p>
          ) : (
            <p className="t-small text-text-faint mt-1">No reason was recorded.</p>
          )}
        </div>
      ) : null}

      {sequenceGap ? (
        <div role="alert" className="p-3.5 mb-4 rounded-lg bg-warn-soft border border-warn-rim">
          <p className="t-heading text-warn">Event sequence has a gap</p>
          <p className="t-small text-text-dim mt-1 max-w-[86ch]">
            TripEvent seq numbers are not consecutive on this trip. Every status write is
            supposed to go through applyTransition, which appends exactly one event per
            version bump — a gap means something wrote the status directly, and clients
            replaying this trip will have missed a state.
          </p>
        </div>
      ) : null}

      <section aria-label="Trip summary" className="grid gap-3 mb-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Seats taken"
          value={`${num(trip.occupancy?.occupiedSeats ?? 0)} / ${num(trip.occupancy?.maxSeats ?? trip.maxSeats ?? 0)}`}
          hint={`${num(trip.occupancy?.availableSeats ?? 0)} still available`}
          icon="users"
        />
        <StatCard
          label="Settled"
          value={ghs(trip.money?.settledPesewas ?? 0)}
          hint={`${num(trip.money?.settledBookings ?? 0)} paid booking${
            (trip.money?.settledBookings ?? 0) === 1 ? '' : 's'
          }`}
          icon="cash"
        />
        <StatCard
          label="Commission"
          value={ghs(trip.money?.commissionPesewas ?? 0)}
          hint="platform share of settled fares"
          icon="tag"
        />
        <StatCard
          label="Fare per seat"
          value={trip.pricing ? ghs(trip.pricing.farePerSeatPesewas) : '—'}
          hint={
            trip.pricing
              ? `${trip.pricing.distanceKm.toFixed(1)} km${
                  trip.pricing.distanceSource === 'STRAIGHT_LINE' ? ' (straight line)' : ''
                }${trip.pricing.floorApplied ? ' · at the floor' : ''}`
              : 'no distance recorded'
          }
          icon="route"
        />
      </section>

      {/* ── Where it went ── */}
      <Card flush className="mb-4">
        <CardHead
          title="Route"
          subtitle={
            trip.geometry?.lineSource === 'DIRECTIONS'
              ? `Road route${
                  trip.geometry.roadDistanceKm ? ` · ${trip.geometry.roadDistanceKm.toFixed(1)} km by road` : ''
                }${trip.geometry.roadDurationMin ? ` · ~${Math.round(trip.geometry.roadDurationMin)} min` : ''}`
              : 'Straight line between pickup and destination — the road route could not be retrieved'
          }
          icon="pin"
        />
        <StaticMap
          label={`Route for trip ${tripRef(trip)}`}
          height={340}
          line={trip.geometry?.line ?? null}
          points={[
            ...(trip.geometry?.pickup
              ? [{
                  lat: trip.geometry.pickup.lat,
                  lng: trip.geometry.pickup.lng,
                  glyph: 'A',
                  tone: 'accent' as const,
                  label: `Pickup — ${trip.geometry.pickup.address ?? 'unnamed'}`,
                }]
              : []),
            ...(trip.geometry?.dropoff
              ? [{
                  lat: trip.geometry.dropoff.lat,
                  lng: trip.geometry.dropoff.lng,
                  glyph: 'B',
                  tone: 'info' as const,
                  label: `Destination — ${trip.geometry.dropoff.address ?? 'unnamed'}`,
                }]
              : []),
            ...(trip.geometry?.driver && isLiveTrip(trip.status)
              ? [{
                  lat: trip.geometry.driver.lat,
                  lng: trip.geometry.driver.lng,
                  glyph: '▲',
                  tone: 'neutral' as const,
                  label: 'Driver, last known position',
                }]
              : []),
          ]}
        />
        <div className="px-4 py-3 border-t border-line grid gap-2 sm:grid-cols-2">
          <div className="flex items-start gap-2">
            <span className="map-pin-static tone-accent flex-none mt-0.5">A</span>
            <span className="min-w-0">
              <span className="block t-eyebrow">Pickup</span>
              <span className="block t-small text-text-dim">
                {trip.geometry?.pickup?.address || trip.pickupAddress || trip.route?.originName || 'not recorded'}
              </span>
            </span>
          </div>
          <div className="flex items-start gap-2">
            <span className="map-pin-static tone-info flex-none mt-0.5">B</span>
            <span className="min-w-0">
              <span className="block t-eyebrow">Destination</span>
              <span className="block t-small text-text-dim">
                {trip.geometry?.dropoff?.address || trip.dropoffAddress || trip.route?.destinationName || 'not recorded'}
              </span>
            </span>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ── Seat map / bookings ── */}
        <Card flush className="lg:col-span-2">
          <CardHead
            title="Bookings"
            subtitle="Includes released seats — cancelled, expired, refunded and no-show rows are shown, not hidden"
            icon="ticket"
          />
          {bookings.length === 0 ? (
            <EmptyState icon="ticket" title="No bookings" body="Nobody has booked a seat on this trip." />
          ) : (
            <div className="table-scroll">
              <table className="table">
                <caption className="sr-only">Bookings on this trip</caption>
                <thead>
                  <tr>
                    <th scope="col">Seat</th>
                    <th scope="col">Rider</th>
                    <th scope="col">Seat state</th>
                    <th scope="col">Payment</th>
                    <th scope="col" className="text-right">Fare</th>
                    {canRefund ? (
                      <th scope="col" className="text-right">
                        <span className="sr-only">Refund</span>
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((b) => {
                    const seat = bookingStatusMeta(b.status);
                    const pay = paymentStatusMeta(b.paymentStatus);
                    return (
                      <tr key={b.id}>
                        <td className="num">
                          {b.seatNumber ?? <span className="text-text-faint">released</span>}
                          {b.isCoverAll ? (
                            <span className="block text-[11px] text-accent">cover-all</span>
                          ) : null}
                        </td>
                        <td className="truncate-1 max-w-[170px]">
                          {b.guestName ? (
                            <>
                              {b.guestName}
                              <span className="block text-[11px] text-text-faint">guest</span>
                            </>
                          ) : b.user ? (
                            <Link href={`/users/${b.user.id}`} className="hover:text-accent">
                              {b.user.name}
                              <span className="block text-[11.5px] text-text-faint mono">
                                {fmtPhone(b.user.phone)}
                              </span>
                            </Link>
                          ) : (
                            <span className="text-text-faint">unknown</span>
                          )}
                        </td>
                        <td>
                          <Badge tone={seat.tone}>{seat.label}</Badge>
                        </td>
                        <td>
                          <Badge tone={pay.tone}>{pay.label}</Badge>
                          {b.paymentMethod ? (
                            <span className="block text-[11px] text-text-faint mt-0.5">
                              {b.paymentMethod.toLowerCase()}
                            </span>
                          ) : null}
                        </td>
                        <td className="num">{ghs(b.fareAmountPesewas ?? 0)}</td>
                        {canRefund ? (
                          <td className="text-right">
                            {/* Only rendered for a settled booking — see RefundControl. */}
                            <RefundControl
                              booking={{
                                id: b.id,
                                fareAmountPesewas: b.fareAmountPesewas ?? 0,
                                paymentStatus: b.paymentStatus,
                                paymentMethod: b.paymentMethod ?? undefined,
                                status: b.status ?? undefined,
                              }}
                            />
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* ── Who ── */}
        <div className="space-y-4">
          <Card>
            <CardHead title="Driver" icon="wheel" />
            <CardBody>
              {trip.driver ? (
                <dl>
                  <Detail label="Name">
                    <Link href={`/drivers/${trip.driver.id}`} className="hover:text-accent">
                      {trip.driver.name}
                    </Link>
                  </Detail>
                  <Detail label="Phone" mono>
                    <a href={`tel:${trip.driver.phone}`} className="text-accent hover:underline">
                      {fmtPhone(trip.driver.phone)}
                    </a>
                  </Detail>
                  <Detail label="Presence">
                    {trip.driver.isOnline ? (
                      <Badge tone="accent" live>Online</Badge>
                    ) : (
                      <Badge tone="neutral">Offline</Badge>
                    )}
                  </Detail>
                  <Detail label="Last position" mono>
                    {trip.driver.currentLat && trip.driver.currentLng ? (
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${trip.driver.currentLat},${trip.driver.currentLng}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent hover:underline"
                      >
                        {trip.driver.currentLat.toFixed(4)}, {trip.driver.currentLng.toFixed(4)}
                      </a>
                    ) : (
                      'no GPS fix'
                    )}
                  </Detail>
                </dl>
              ) : (
                <p className="t-small text-text-faint">No driver is attached to this trip.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHead title="Route & vehicle" icon="pin" />
            <CardBody>
              <dl>
                <Detail label="From">{trip.route?.originName || '—'}</Detail>
                <Detail label="To">{trip.route?.destinationName || '—'}</Detail>
                <Detail label="Distance">
                  {trip.route?.distanceKm ? `${trip.route.distanceKm.toFixed(1)} km` : '—'}
                </Detail>
                <Detail label="Departure">{dateTime(trip.departureTime ?? null)}</Detail>
                <Detail label="Vehicle">
                  {trip.vehicle
                    ? [trip.vehicle.make, trip.vehicle.model].filter(Boolean).join(' ') || '—'
                    : 'none'}
                </Detail>
                <Detail label="Plate" mono>
                  {trip.vehicle?.plateNumber || '—'}
                </Detail>
                {trip.requester ? (
                  <Detail label="Requested by">
                    <Link href={`/users/${trip.requester.id}`} className="hover:text-accent">
                      {trip.requester.name}
                    </Link>
                  </Detail>
                ) : null}
              </dl>
            </CardBody>
          </Card>
        </div>

        {/* ── Lifecycle ── */}
        <Card flush className="lg:col-span-3">
          <CardHead
            title="Lifecycle"
            subtitle={`Append-only event history · version ${num(trip.version ?? events.length)}`}
            icon="scroll"
          />
          {events.length === 0 ? (
            <EmptyState
              icon="scroll"
              title="No events recorded"
              body="This trip has no TripEvent rows. Every status change should append one, so an active trip with no events is itself a finding."
            />
          ) : (
            <ol className="p-4 space-y-0">
              {events.map((e, i) => {
                const evMeta = tripStatusMeta(e.type);
                const last = i === events.length - 1;
                return (
                  <li key={e.id} className="flex gap-3">
                    <div className="flex flex-col items-center flex-none">
                      <span
                        className={`w-2 h-2 rounded-full mt-1.5 ${
                          last ? 'bg-accent' : 'bg-line-strong'
                        }`}
                      />
                      {!last ? <span className="w-px flex-1 bg-line my-1" /> : null}
                    </div>
                    <div className={`min-w-0 flex-1 ${last ? '' : 'pb-4'}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="mono text-[11px] text-text-faint">#{e.seq}</span>
                        <Badge tone={evMeta.tone}>{evMeta.label}</Badge>
                        <span className="t-small text-text-faint">
                          by {humanise(e.actor)}
                          {e.actorId ? (
                            <span className="mono"> ({shortId(e.actorId)})</span>
                          ) : null}
                        </span>
                      </div>
                      <p className="text-[11.5px] text-text-faint mt-0.5 num">
                        {dateTime(e.createdAt)} · {relative(e.createdAt)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      </div>
    </>
  );
}
