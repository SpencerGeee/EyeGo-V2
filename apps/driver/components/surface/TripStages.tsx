import React, { useCallback, useMemo, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { formatGhs } from '@eyego/utils';
import {
  Text,
  Pressable,
  SheetContent,
  SwipeToConfirm,
  GlassSurface,
  GradientGlowBorder,
  RollingDigits,
  Avatar,
  callNumber,
  goDeeper,
} from '@eyego/ui';
import { useColors, type DriverColors } from '../../utils/useColors';
import { useTripStops, type StopPassenger } from '../trip/useTripStops';
import { openExternalNavigation } from '../../utils/externalNav';
import { useTripAdvance } from './useTripAdvance';
import type { DriverStage } from './driverStage';

/**
 * THE DRIVING STAGES, AS SHEET BODIES — in the rider's tracking language.
 *
 * "The rider app tracking page is really cool. Adopt that design language for
 * the driver app so it's similar — the glow borders, the font, the placements."
 *
 * This publishes into the same `MapSheetHost` the rider's TrackingStage
 * publishes into, over the same never-unmounting map, with the same detents
 * and the same chrome table — and now the same VOCABULARY: a headline with the
 * ETA rolling in a badge beside it, the journey as a glass card with a dot,
 * a connector and a pin, the people as ringed rows, the money as a ringed row,
 * and a row of quiet actions. The two apps are the same surface with
 * different content, which is what the report asked for.
 *
 * ── WHAT LIVES HERE AND WHAT STAYS A SCREEN ─────────────────────────────────
 * The sheet carries the FLOW: where the next stop is, who is on board, and the
 * one action that moves the trip forward. That is what a driver reads at a
 * junction, and it is all Uber puts in front of one.
 *
 * The detailed work — the full roster, PIN boarding, adding an offline
 * passenger, seat management — stays on `(trip)/active/[id]`, reached from
 * "Manage". Those are two-handed, stopped-vehicle tasks that want a full
 * screen, and that screen no longer carries a map of its own to fight with.
 */

export interface TripStagesProps {
  stage: DriverStage;
  trip: any | null;
  /** Live leg ETA from the surface map — see DriverTripMap's `onEta`. */
  eta?: { leg: 'toPickup' | 'toDropoff'; minutes: number; distanceKm: number | null } | null;
  /** Opens the full manage screen for roster / PIN / seat work. */
  onManage?: () => void;
}

export function TripStages({ stage, trip, eta, onManage }: TripStagesProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  /**
   * Every hook runs before any early return — the exact rule the manage
   * screen broke when it called `useTripStops` below its loading guard.
   * `scripts/e2e/conditional-hooks.mjs` enforces it.
   */
  const { stops, currentIndex, passengers, seatsTotal, seatsTaken } = useTripStops(trip);
  const underMinimumAck = useRef(false);
  const { advance, label, busy, canAdvance } = useTripAdvance({
    tripId: trip?.id ?? '',
    status: trip?.status,
    underMinimumAck,
  });

  const handleNavigate = useCallback(() => {
    const stop = stops[currentIndex] ?? stops.find((s) => s.state !== 'DONE') ?? null;
    if (!stop) return;
    void openExternalNavigation(
      { lat: stop.lat, lng: stop.lng, name: stop.title ?? null, address: stop.address ?? null } as any,
      { origin: null },
    );
  }, [stops, currentIndex]);

  const isDriving = stage === 'enroute' || stage === 'arrived' || stage === 'intrip';
  if (!isDriving || !trip) return null;

  const status = String(trip.status ?? '').toUpperCase();
  const waitingToDepart = ['SCHEDULED', 'FILLING', 'CONFIRMED'].includes(status);
  const pickupStop = stops.find((s) => s.kind === 'PICKUP') ?? null;
  const dropStop = stops.find((s) => s.kind === 'DROP') ?? null;

  // ETA is shown ONLY for the leg it describes — the same rule the rider's
  // stages keep. A drop-off ETA on the way to the pickup is the ride's length,
  // not the driver's next arrival.
  const legWanted: 'toPickup' | 'toDropoff' = stage === 'intrip' ? 'toDropoff' : 'toPickup';
  const minutes = eta && eta.leg === legWanted && stage !== 'arrived' && !waitingToDepart ? eta.minutes : null;

  const departsAt = (() => {
    const raw = trip.departureTime ?? trip.scheduledAt ?? null;
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  })();

  const headline =
    stage === 'intrip'
      ? { title: minutes != null ? 'Arriving in' : 'On the way', sub: dropStop?.title ?? 'Your destination' }
      : stage === 'arrived'
        ? {
            title: 'At the pickup',
            sub: passengers.length
              ? `Boarding ${passengers.length} passenger${passengers.length === 1 ? '' : 's'}`
              : 'Waiting for your passenger',
          }
        : waitingToDepart
          ? {
              title: 'Waiting to depart',
              sub: `${seatsTaken} of ${seatsTotal} seats filled${departsAt ? ` · departs ${departsAt}` : ''}`,
            }
          : { title: minutes != null ? 'Pickup in' : 'Heading to pickup', sub: pickupStop?.title ?? 'Pickup point' };

  // The money on the sheet is what this trip pays in fares; the split is on
  // the receipt. Summed from the live bookings the roster already projects.
  const farePesewas = passengers.reduce((n, p) => n + (p.farePesewas ?? 0), 0);
  const cashOwed = passengers.reduce((n, p) => n + (p.owesPesewas ?? 0), 0);
  const shownPassengers = passengers.slice(0, 2);
  const morePassengers = passengers.length - shownPassengers.length;

  return (
    <SheetContent stage={stage}>
      <View style={styles.body}>
        <View style={styles.headline}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{headline.title}</Text>
            <Text variant="bodySmall" color={colors.onSurfaceVariant} numberOfLines={1}>
              {headline.sub}
            </Text>
          </View>
          {minutes != null ? (
            <View style={styles.etaBadge}>
              <RollingDigits
                text={String(minutes)}
                value={minutes}
                fontSize={fontSizes.headlineSmall}
                color={colors.onPrimary}
                fontFamily={fonts.displayBold}
              />
              <Text variant="caption" color={colors.onPrimary}>min</Text>
            </View>
          ) : null}
        </View>

        {/* The journey, both ends of it — the rider's dot → connector → pin. */}
        <View style={styles.journey}>
          <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii.xl} intensity="low" />
          <View style={styles.journeyTimeline}>
            <View
              style={[
                styles.journeyDot,
                { backgroundColor: stage === 'intrip' ? colors.statusSuccess : colors.onSurfaceVariant },
              ]}
            />
            <View style={[styles.journeyConnector, { backgroundColor: colors.outline }]} />
            <Ionicons name="location" size={12} color={colors.primary} />
          </View>
          <View style={styles.journeyText}>
            <View>
              <Text style={styles.journeyLabel}>PICKUP</Text>
              <Text variant="bodySmall" numberOfLines={1}>{pickupStop?.title ?? 'Pickup point'}</Text>
            </View>
            <View>
              <Text style={styles.journeyLabel}>DROP-OFF</Text>
              <Text variant="bodySmall" numberOfLines={1}>{dropStop?.title ?? 'Destination'}</Text>
            </View>
          </View>
        </View>

        {shownPassengers.map((p) => (
          <PassengerRow key={p.bookingId} passenger={p} tripId={trip.id} colors={colors} styles={styles} />
        ))}
        {morePassengers > 0 && onManage ? (
          <Pressable onPress={onManage} accessibilityRole="button" style={styles.moreRow}>
            <Text variant="bodySmall" color={colors.onSurfaceVariant}>
              +{morePassengers} more passenger{morePassengers === 1 ? '' : 's'} · Manage
            </Text>
            <Ionicons name="chevron-forward" size={14} color={colors.onSurfaceVariant} />
          </Pressable>
        ) : null}

        {farePesewas > 0 ? (
          <GradientGlowBorder
            palette="driver"
            fillColor={colors.surfaceContainerHigh}
            borderRadius={radii.xl}
            thickness="thin"
            glow
            glowIntensity={0.55}
            maxGlowRadius={16}
            style={styles.fareRow}
          >
            <Text variant="bodySmall" color={colors.onSurfaceVariant}>Trip fare</Text>
            <Text style={styles.fareValue}>{formatGhs(farePesewas)}</Text>
            {passengers.length > 1 ? (
              <Text variant="caption" color={colors.onSurfaceVariant}>· {passengers.length} seats</Text>
            ) : null}
            {cashOwed > 0 ? (
              <Text variant="caption" color={colors.statusWarning}>· {formatGhs(cashOwed)} cash to collect</Text>
            ) : null}
          </GradientGlowBorder>
        ) : null}

        <View style={styles.actions}>
          <Action icon="navigate-outline" label="Navigate" onPress={handleNavigate} colors={colors} styles={styles} />
          <Action
            icon="chatbubble-outline"
            label="Chat"
            onPress={() => goDeeper({ pathname: '/(trip)/chat/[id]', params: { id: trip.id } } as never)}
            colors={colors}
            styles={styles}
          />
          {onManage ? (
            <Action icon="people-outline" label="Manage" onPress={onManage} colors={colors} styles={styles} />
          ) : null}
        </View>

        {/*
          A SWIPE, NOT A TAP. Every action here is one-way and legal exactly
          once; a cradled phone on a rough road taps itself.

          KEYED ON THE STATUS. BUGFIX ("I swiped that I was at the pickup point
          and the animation on the swiping thing is frozen"). The control holds
          at the end of its track while the action is in flight and then reset
          only when `loading` flipped back — which the surface never told it,
          so the thumb sat at the end of the track over a label for the NEXT
          step. A status change is a different action, so it is a different
          control: the old one unmounts full, the new one mounts at rest.
        */}
        {canAdvance && label ? (
          <SwipeToConfirm
            key={status}
            label={label}
            loadingLabel="Updating…"
            onConfirm={advance}
            loading={busy}
            color={colors.primary}
            onColor={colors.onPrimary ?? '#0A0D14'}
            trackColor={colors.surfaceContainer}
            borderColor={colors.outline}
          />
        ) : null}
      </View>
    </SheetContent>
  );
}

function PassengerRow({
  passenger: p,
  tripId,
  colors,
  styles,
}: {
  passenger: StopPassenger;
  tripId: string;
  colors: DriverColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <GradientGlowBorder
      palette="driver"
      fillColor={colors.surfaceContainerHigh}
      borderRadius={radii.xl}
      thickness="thin"
      glow
      glowIntensity={0.7}
      maxGlowRadius={16}
      style={styles.passengerRow}
    >
      <Avatar name={p.name} size={36} />
      <View style={{ flex: 1 }}>
        <Text variant="bodySmall" numberOfLines={1}>{p.name}</Text>
        <Text variant="caption" color={colors.onSurfaceVariant} numberOfLines={1}>
          {[
            p.seatNumber != null ? `Seat ${p.seatNumber}` : null,
            p.boarded ? 'On board' : p.noShow ? 'No-show' : p.paid ? 'Paid' : p.owesPesewas ? 'Pays cash' : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      {p.phone ? (
        <Pressable
          onPress={() => callNumber(p.phone!)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Call ${p.name}`}
          style={styles.iconBtn}
        >
          <Ionicons name="call-outline" size={17} color={colors.onSurface} />
        </Pressable>
      ) : null}
      <Pressable
        onPress={() => goDeeper({ pathname: '/(trip)/chat/[id]', params: { id: tripId } } as never)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Message ${p.name}`}
        style={styles.iconBtn}
      >
        <Ionicons name="chatbubble-outline" size={17} color={colors.onSurface} />
      </Pressable>
    </GradientGlowBorder>
  );
}

function Action({
  icon,
  label,
  onPress,
  colors,
  styles,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  colors: DriverColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <Pressable onPress={onPress} style={styles.action} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={18} color={colors.onSurface} />
      <Text style={[styles.actionLabel, { color: colors.onSurface }]}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    body: { gap: spacing.lg, paddingTop: 2 },
    headline: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    title: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.titleLarge,
      lineHeight: Math.round(fontSizes.titleLarge * 1.3),
      color: colors.onSurface,
      letterSpacing: -0.4,
    },
    etaBadge: {
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 64,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radii.lg,
      backgroundColor: colors.primary,
    },
    journey: {
      flexDirection: 'row',
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      overflow: 'hidden',
    },
    journeyTimeline: { alignItems: 'center', paddingTop: 5, width: 12 },
    journeyDot: { width: 8, height: 8, borderRadius: 4 },
    journeyConnector: { width: 2, height: 26, marginVertical: 3 },
    journeyText: { flex: 1, gap: spacing.md },
    journeyLabel: {
      fontFamily: fonts.medium,
      fontSize: 10,
      lineHeight: 13,
      letterSpacing: 0.7,
      color: colors.onSurfaceVariant,
    },
    passengerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
    },
    moreRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 44,
      paddingHorizontal: spacing.md,
    },
    iconBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.outlineVariant,
    },
    fareRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
    },
    fareValue: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyLarge, color: colors.onSurface },
    actions: { flexDirection: 'row', gap: spacing.md },
    action: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      minHeight: 44,
      paddingVertical: spacing.md,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      backgroundColor: colors.surfaceContainer,
    },
    actionLabel: { fontFamily: fonts.medium, fontSize: fontSizes.bodySmall },
  });
