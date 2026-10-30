import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, Pressable, Linking } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, GlassSurface, RollingDigits, WaitingMeter, SheetSections, goDeeper, Reveal, LottieMoment } from '@eyego/ui';
import Animated, { FadeOut } from 'react-native-reanimated';
import { useRideStore } from '../../../stores/ride.store';
import { DriverStrip } from './DriverStrip';
import { usePlatformConfig } from '../../../hooks/usePlatformConfig';
import { useRouteChange } from '../../../hooks/useRouteChange';
import { useTripCall } from '../../../hooks/useTripCall';
import { formatGhs, clockTime } from '@eyego/utils';
import { SheetContent } from '../sheetSlot';
import { useColors, Colors } from '../../../utils/useColors';
import { useTripStore } from '../../../stores/trip.store';
import { useChatUnread } from '../../../stores/chatUnread.store';
import { shareLiveTracking } from '../../../utils/safety';

/**
 * "Your driver is on the way" — the stage between a driver being attached and
 * the rider being in the car (DRIVER_ASSIGNED / DRIVER_EN_ROUTE /
 * ARRIVED_AT_PICKUP).
 *
 * WHAT THIS REPLACES. `app/ride/[id]/tracking.tsx`: 1754 lines that owned their
 * own MapView, their own camera (a `setCamera` per GPS fix), their own Mapbox
 * Directions call behind a 2→4→8→15 s retry ladder, and their own ETA derived
 * from that call. Every navigation tore the map down, and the rider's ETA was a
 * different number from the driver's because it came from a different request.
 *
 * This stage owns NO map and NO routing. It reads the trip store — which is fed
 * by the sequenced `trip:event` channel plus `trip:eta` — and renders a panel
 * over the persistent `TripMap`. The whole surface stays mounted from search
 * through drop-off, which is the difference the rider actually feels.
 */

/**
 * What to call the phase, and what the rider should be doing about it.
 *
 * BUGFIX ("when the driver is filling up and hasn't started, the tracking page
 * says driver confirmed and draws the route to the destination — the trip hasn't
 * even started"). Exactly right, and it was this `default`. SCHEDULED, FILLING
 * and CONFIRMED all fell through to the DRIVER_ASSIGNED copy, so a group trip
 * still collecting passengers told the rider their driver was "setting off now".
 * The rider then watched nothing happen until the trip moved to DRIVER_EN_ROUTE,
 * at which point the screen finally started telling the truth — which is why it
 * looked like it "goes back to normal" on the way to you.
 *
 * The pre-departure states now say what they are. `default` is deliberately no
 * longer a catch-all for them.
 */
/** Trip ids already celebrated this session — the burst plays once, not on every re-hydrate. */
const CELEBRATED = new Set<string>();

function metres(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = Math.PI / 180;
  const dLat = (bLat - aLat) * r;
  const dLng = (bLng - aLng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

function phaseCopy(
  status: string | null,
  etaMinutes: number | null,
  departsAt?: string | null,
) {
  const departureText = (() => {
    if (!departsAt) return null;
    const d = new Date(departsAt);
    if (Number.isNaN(d.getTime())) return null;
    return clockTime(d);
  })();

  switch (status) {
    case 'ARRIVED_AT_PICKUP':
      return { title: 'Your driver is here', sub: 'Check the plate before getting in.' };
    case 'DRIVER_EN_ROUTE':
      return {
        title: etaMinutes != null ? `Arriving in ${etaMinutes} min` : 'On the way to you',
        sub: 'Head to your pickup point.',
      };
    case 'SCHEDULED':
    case 'FILLING':
      return {
        title: 'Waiting to fill up',
        sub: departureText
          ? `Your driver is collecting passengers. Departure around ${departureText}.`
          : 'Your driver is collecting passengers. You will be told when they set off.',
      };
    case 'CONFIRMED':
      return {
        title: 'Seat confirmed',
        sub: departureText
          ? `Your driver sets off around ${departureText}.`
          : 'Your driver will set off shortly.',
      };
    case 'DRIVER_ASSIGNED':
    default:
      return { title: 'Driver confirmed', sub: 'They are setting off now.' };
  }
}

function AssignedStageImpl() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();

  const snapshot = useTripStore((s) => s.snapshot);
  const eta = useTripStore((s) => s.eta);
  const connected = useTripStore((s) => s.connected);
  const recovering = useTripStore((s) => s.recovering);

  const status = snapshot?.status ?? null;
  const tripId = snapshot?.tripId ?? null;
  const routeChange = useRouteChange(tripId);
  const unreadChats = useChatUnread((s) => (tripId ? s.counts[tripId] ?? 0 : 0));
  const driver = snapshot?.driver ?? null;
  const vehicle = snapshot?.vehicle ?? null;

  // ETA is shown ONLY for the leg it describes. A `toDropoff` ETA arriving
  // while the driver is still coming to fetch you is not "your driver is 4
  // minutes away" — it is the length of your ride, and showing it here is
  // exactly the confusion the per-leg field was added to end.
  const etaMinutes = eta && eta.leg === 'toPickup' ? eta.minutes : null;

  /** "Verify My Ride". Present only for riders who turned the setting on, and
   *  only until the driver enters it — the server nulls it once verified. */
  const boardingPin = snapshot?.booking?.boardingPin ?? null;
  const copy = phaseCopy(status, etaMinutes, (snapshot as any)?.departureTime ?? null);

  const arrived = status === 'ARRIVED_AT_PICKUP';
  const platform = usePlatformConfig();

  // SIGNATURE MOMENT: bus found / seat booked — one burst, once per trip per session.
  const [burst, setBurst] = useState<string | null>(null);
  useEffect(() => {
    if (!tripId || CELEBRATED.has(tripId) || snapshot?.booking?.status === 'BOARDED') return;
    CELEBRATED.add(tripId);
    setBurst(tripId);
    const t = setTimeout(() => setBurst(null), 1800);
    return () => clearTimeout(t);
  }, [tripId]); // eslint-disable-line react-hooks/exhaustive-deps

  // SIGNATURE MOMENT: the walk to the stop (Yango "walk to pickup"), measured
  // from where the rider searched to the pickup this ride will stop at.
  const from = useRideStore((s) => s.origin);
  const pickup = (snapshot as any)?.pickup as { lat: number | null; lng: number | null; address: string | null } | undefined;
  const walkM =
    from && pickup?.lat != null && pickup?.lng != null ? metres(from.latitude, from.longitude, pickup.lat, pickup.lng) : null;
  const walkMin = walkM != null && walkM >= 50 && walkM <= 2500 ? Math.max(1, Math.round(walkM / 80)) : null;
  /**
   * The driver has put this rider in the vehicle. See the row below for why
   * this cannot be derived from `status`: boarding leaves the TRIP where it is
   * and moves only this rider's BOOKING.
   */
  const boarded = snapshot?.booking?.status === 'BOARDED';
  const seatNumber = snapshot?.booking?.seatNumber ?? null;

  // Masked through EyeGo's number when the server has it on — see useTripCall.
  const tripCall = useTripCall();
  const handleCall = () => void tripCall({ tripId: snapshot?.tripId, phone: driver?.phone, name: driver?.name });

  const handleShare = () =>
    shareLiveTracking(
      snapshot?.shortId ?? tripId ?? '',
      driver?.name ?? 'Your driver',
      vehicle?.plate ?? 'Unknown',
    );

  const handleCancel = () => {
    if (!tripId) return;
    goDeeper(`/ride/${tripId}/cancel` as Href);
  };

  return (
    <View style={styles.root} pointerEvents="box-none">
      {/* Connection truth, not a spinner. A rider whose socket dropped used to
          see a frozen ETA with no indication anything was wrong. */}
      {(!connected || recovering) && (
        <View style={styles.chip} pointerEvents="none">
          <View style={[StyleSheet.absoluteFill, { borderRadius: radii.lg, backgroundColor: colors.surfaceCard }]} pointerEvents="none" />
          <Ionicons name="cloud-offline-outline" size={13} color={colors.onSurfaceVariant} />
          <Text variant="caption" color={colors.onSurfaceVariant}>
            {recovering ? 'Catching up…' : 'Reconnecting…'}
          </Text>
        </View>
      )}

      {/* Published into the trip surface's ONE sheet — see TrackingStage for
          the reasoning. The 0.44 resting detent moved to TripSheetHost, which
          is also where the transition to tracking's 0.34 now happens as a
          single spring on one surface rather than as two panels swapping. */}
      {/*
        UBER'S THREE DETENTS ("the card on the tracking page isn't nice ... no
        animation between snap points ... redesign it like Uber and Bolt").
          peek - what is happening, how long, which car, how to reach them
          half - where from and to, what it costs, share / safety
          full - change the ride, cancel it
        Published as SheetSections, so the trip surface's ONE sheet snaps
        between them under the finger and carries straight on into the
        tracking stage's own sections without a new card appearing.
      */}
      <SheetContent stage="assigned">
        <SheetSections
          peek={
            <>
              <View style={styles.headline}>
                {/* SIGNATURE MOMENT (Lottie): the tick for a car on its way, confetti
                    for a seat on a bus. Holds its last frame, then fades. */}
                {burst ? (
                  <Animated.View
                    key={burst}
                    exiting={FadeOut.duration(260)}
                    pointerEvents="none"
                    style={(snapshot as any)?.isOnDemand ? styles.burstTick : styles.burstConfetti}
                  >
                    <LottieMoment
                      name={(snapshot as any)?.isOnDemand ? 'bus_found' : 'seat_booked_confetti'}
                      size={(snapshot as any)?.isOnDemand ? 112 : 300}
                    />
                  </Animated.View>
                ) : null}
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>{boarded ? 'On board' : copy.title}</Text>
                  <Text variant="bodySmall" color={colors.onSurfaceVariant} numberOfLines={2}>
                    {boarded
                      ? seatNumber != null ? `Seat ${seatNumber} · the trip starts when the driver sets off.` : 'The trip starts when the driver sets off.'
                      : copy.sub}
                  </Text>
                  {walkMin != null && !arrived && !boarded && (
                    <Reveal>
                      <View style={styles.walkRow}>
                        <Ionicons name="walk" size={14} color={colors.primary} />
                        <LottieMoment name="walk_to_stop" size={66} />
                        <Text variant="caption" color={colors.onSurfaceVariant} numberOfLines={1} style={{ flex: 1 }}>
                          {walkMin} min walk{pickup?.address ? ` to ${pickup.address.split(',')[0]}` : ''}
                        </Text>
                      </View>
                    </Reveal>
                  )}
                  {arrived && !boarded && (snapshot as any)?.isOnDemand && (
                    <Reveal><WaitingMeter
                      who="rider"
                      arrivedAt={(snapshot as any)?.timestamps?.arrivedAt ?? null}
                      freeMinutes={platform.waitFreeMinutes}
                      perMinPesewas={platform.tiers[(snapshot?.tier ?? 'ECO') as 'ECO']?.waitPerMinPesewas ?? 0}
                      capPesewas={platform.waitFeeCapPesewas}
                    /></Reveal>
                  )}
                </View>
                {etaMinutes != null && !arrived ? (
                  <View style={styles.etaBadge}>
                    <RollingDigits
                      text={String(etaMinutes)}
                      value={etaMinutes}
                      fontSize={fontSizes.titleLarge}
                      color={colors.onPrimary}
                      fontFamily={fonts.displayBold}
                    />
                    <Text variant="caption" color={colors.onPrimary}>min</Text>
                  </View>
                ) : boarded ? (
                  <Ionicons name="checkmark-circle" size={30} color={colors.statusSuccess} />
                ) : null}
              </View>

              {/* "Verify My Ride": read at the kerb, so it lives in the peek. */}
              {boardingPin ? (
                <View style={[styles.pinCard, { backgroundColor: colors.surfaceContainerHigh }]}>
                  <View style={{ flex: 1 }}>
                    <Text variant="caption" color={colors.onSurfaceVariant}>VERIFY YOUR RIDE</Text>
                    <Text variant="bodySmall" color={colors.onSurfaceVariant}>Read this code to your driver</Text>
                  </View>
                  <Text style={styles.pinDigits} accessibilityLabel={`Your ride code is ${boardingPin.split('').join(' ')}`}>
                    {boardingPin}
                  </Text>
                </View>
              ) : null}

              {driver ? (
                <DriverStrip
                  colors={colors}
                  name={driver.name}
                  photo={driver.photo}
                  plate={vehicle?.plate ?? null}
                  car={vehicle ? `${vehicle.make} ${vehicle.model}`.trim() : null}
                  unread={unreadChats}
                  onCall={driver.phone || driver.callable ? handleCall : undefined}
                  onChat={() => tripId && goDeeper(`/ride/${tripId}/chat` as Href)}
                />
              ) : null}
            </>
          }
          half={
            <>
              <View style={styles.divider} />
              <View style={styles.stops}>
                <View style={styles.stopRow}>
                  <View style={[styles.stopDot, { backgroundColor: colors.onSurface }]} />
                  <Text style={styles.stopText} numberOfLines={1}>
                    {snapshot?.pickup?.address ?? 'Pickup'}
                  </Text>
                </View>
                <View style={styles.stopRule} />
                <View style={styles.stopRow}>
                  <View style={[styles.stopDot, { backgroundColor: colors.primary, borderRadius: 3 }]} />
                  <Text style={styles.stopText} numberOfLines={1}>
                    {snapshot?.dropoff?.address ?? 'Destination'}
                  </Text>
                </View>
              </View>
              {snapshot?.fare.amountPesewas != null ? (
                <View style={styles.fareRow}>
                  <Ionicons name={snapshot.fare.paymentMethod === 'CASH' ? 'cash-outline' : 'card-outline'} size={20} color={colors.onSurface} />
                  <Text style={[styles.stopText, { flex: 1 }]}>
                    {snapshot.fare.paymentMethod === 'CASH' ? 'Cash' : 'Card'}
                  </Text>
                  <Text style={styles.fareValue}>{formatGhs(snapshot.fare.amountPesewas)}</Text>
                </View>
              ) : null}
              <View style={styles.actions}>
                <Action icon="share-outline" label="Share trip" onPress={handleShare} colors={colors} />
                <Action
                  icon="shield-checkmark-outline"
                  label="Safety"
                  onPress={() => tripId && goDeeper(`/ride/${tripId}/sos` as Href)}
                  colors={colors}
                />
              </View>
            </>
          }
        >
          {(snapshot as any)?.isOnDemand ? (
            <View style={styles.actions}>
              <Action icon="navigate-outline" label="Change destination" onPress={routeChange.changeDestination} colors={colors} />
              <Action icon="add-circle-outline" label="Add a stop" onPress={routeChange.addStop} colors={colors} />
            </View>
          ) : null}
          <Pressable onPress={handleCancel} style={styles.cancelRow} accessibilityRole="button" accessibilityLabel="Cancel ride">
            <Ionicons name="close-circle-outline" size={18} color={colors.error} />
            <Text style={[styles.cancelText, { color: colors.error }]}>Cancel ride</Text>
          </Pressable>
        </SheetSections>
      </SheetContent>
    </View>
  );
}

function Action({
  icon, label, onPress, colors, tint,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  colors: Colors;
  tint?: string;
}) {
  const color = tint ?? colors.onSurface;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      // Uber's sheet actions: a round icon over its word, no box around it.
      style={{ flex: 1, alignItems: 'center', gap: spacing.sm }}
    >
      <View
        style={{
          width: 56, height: 56, borderRadius: 28,
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: colors.surfaceContainerHigh,
        }}
      >
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <Text style={{ fontFamily: fonts.medium, fontSize: fontSizes.bodySmall, lineHeight: 18, color }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

// Memoized so the outgoing stage stays static during trip.tsx crossfades.
export const AssignedStage = React.memo(AssignedStageImpl);

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  chip: {
    position: 'absolute',
    top: 60, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    borderRadius: radii.lg, overflow: 'hidden',
  },
  // Gutter and bottom safe area belong to the shared sheet now — see the same
  // note in TrackingStage.
  pinCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.base,
    borderRadius: radii.xl,
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.outlineVariant },
  cancelRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    paddingVertical: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.outline,
  },
  cancelText: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium },
  /** Sized to be read out loud at a kerb, at night, at arm's length. Tabular
   *  so the four digits do not shuffle width as they render. */
  pinDigits: {
    fontFamily: fonts.displayBold,
    fontSize: fontSizes.headlineMedium,
    lineHeight: Math.round(fontSizes.headlineMedium * 1.15),
    letterSpacing: 4,
    color: colors.primary,
    fontVariant: ['tabular-nums'],
  },
  boardedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  headline: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  burstTick: { position: 'absolute', right: -20, top: -34, zIndex: 5 },
  burstConfetti: { position: 'absolute', left: 0, right: 0, top: -96, alignItems: 'center', zIndex: 5 },
  walkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  title: {
    fontFamily: fonts.displayBold,
    fontSize: fontSizes.headlineSmall,
    lineHeight: Math.round(fontSizes.headlineSmall * 1.2),
    color: colors.onSurface,
    letterSpacing: -0.4,
  },
  etaBadge: {
    alignItems: 'center', justifyContent: 'center',
    minWidth: 60, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: colors.primary,
  },
  // Uber's trip rows: full-width, 56 pt, one line of 16 pt type, a hairline
  // between them — not a stack of small grey captions.
  stops: {},
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.base, minHeight: 56 },
  stopDot: { width: 10, height: 10, borderRadius: 5 },
  stopText: { flex: 1, fontFamily: fonts.medium, fontSize: fontSizes.bodyLarge, lineHeight: 22, color: colors.onSurface },
  stopRule: { height: StyleSheet.hairlineWidth, marginLeft: 26, backgroundColor: colors.outline },
  fareRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.base, minHeight: 56,
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.outline,
  },
  fareValue: { fontFamily: fonts.displayBold, fontSize: fontSizes.titleMedium, color: colors.onSurface },
  actions: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.sm },
});
