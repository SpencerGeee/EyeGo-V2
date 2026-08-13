import React, { useMemo } from 'react';
import { View, StyleSheet, Pressable, Alert, Linking } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, GlassSurface, DriverInfoCard, RollingDigits, GradientGlowBorder } from '@eyego/ui';
import { formatGhs } from '@eyego/utils';
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

/** What to call the phase, and what the rider should be doing about it. */
function phaseCopy(status: string | null, etaMinutes: number | null) {
  switch (status) {
    case 'ARRIVED_AT_PICKUP':
      return { title: 'Your driver is here', sub: 'Check the plate before getting in.' };
    case 'DRIVER_EN_ROUTE':
      return {
        title: etaMinutes != null ? `Arriving in ${etaMinutes} min` : 'On the way to you',
        sub: 'Head to your pickup point.',
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
  const copy = phaseCopy(status, etaMinutes);

  const arrived = status === 'ARRIVED_AT_PICKUP';

  const handleCall = () => {
    if (!driver?.phone) {
      Alert.alert('No number available', 'Use the in-app chat to reach your driver.');
      return;
    }
    void Linking.openURL(`tel:${driver.phone}`);
  };

  const handleShare = () =>
    shareLiveTracking(
      snapshot?.shortId ?? tripId ?? '',
      driver?.name ?? 'Your driver',
      vehicle?.plate ?? 'Unknown',
    );

  const handleCancel = () => {
    if (!tripId) return;
    router.push(`/ride/${tripId}/cancel` as Href);
  };

  return (
    <View style={styles.root} pointerEvents="box-none">
      {/* Connection truth, not a spinner. A rider whose socket dropped used to
          see a frozen ETA with no indication anything was wrong. */}
      {(!connected || recovering) && (
        <View style={styles.chip} pointerEvents="none">
          <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii.lg} intensity="low" />
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
      <SheetContent stage="assigned">
        <View style={styles.sheetBody}>
          {/*
            "VERIFY MY RIDE" — the code, on the stage where it matters.

            This sits above everything else deliberately. It is only useful in
            the seconds before the rider opens a car door, which is exactly this
            stage, and it has to be readable at a glance in the dark at the
            kerb — hence the size and the letter spacing.

            The instruction is phrased as "read it to your driver", not "show
            your driver", because the check only proves anything if the DRIVER
            demonstrates they were told: a rider who hands over their phone has
            verified nothing.

            Disappears the moment the driver enters it (the server nulls the pin
            once `pinVerifiedAt` is set), so a used code never lingers on screen.
          */}
          {boardingPin && (
            <GradientGlowBorder
              palette="brandGreen"
              fillColor={colors.surfaceContainerHigh}
              borderRadius={radii.xl}
              thickness="thin"
              glow
              glowIntensity={0.8}
              maxGlowRadius={16}
              style={styles.pinCard}
            >
              <View style={{ flex: 1 }}>
                <Text variant="caption" color={colors.onSurfaceVariant}>
                  VERIFY YOUR RIDE
                </Text>
                <Text variant="bodySmall" color={colors.onSurfaceVariant}>
                  Read this code to your driver before you get in
                </Text>
              </View>
              <Text style={styles.pinDigits} accessibilityLabel={`Your ride code is ${boardingPin.split('').join(' ')}`}>
                {boardingPin}
              </Text>
            </GradientGlowBorder>
          )}

          <View style={styles.headline}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{copy.title}</Text>
              <Text variant="bodySmall" color={colors.onSurfaceVariant}>{copy.sub}</Text>
            </View>
            {/* Digits roll rather than swap so a countdown ticking down reads as
                one number changing, not as the panel re-rendering. */}
            {etaMinutes != null && !arrived && (
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
            )}
          </View>

          {driver && (
            <DriverInfoCard
              driver={{
                id: driver.id,
                name: driver.name,
                avatarUrl: driver.photo,
                // Null once the ride is terminal: the server stops sending the
                // driver's real number the moment there is no reason to call
                // them. See `onCall` below — the button goes with it.
                phone: driver.phone ?? undefined,
              }}
              vehicle={
                vehicle
                  ? { plate: vehicle.plate, make: vehicle.make, model: vehicle.model }
                  : undefined
              }
              showActions
              premium={arrived}
              // DriverInfoCard renders its call button only when given a
              // handler, so no number means no button — rather than a button
              // that opens the dialler on nothing.
              onCall={driver.phone ? handleCall : undefined}
              onChat={() => tripId && router.push(`/ride/${tripId}/chat` as Href)}
              unreadChats={unreadChats}
            />
          )}

          <View style={styles.stops}>
            <View style={styles.stopRow}>
              <View style={[styles.stopDot, { backgroundColor: colors.onSurface }]} />
              <Text variant="bodySmall" numberOfLines={1} style={{ flex: 1 }}>
                {snapshot?.pickup?.address ?? 'Pickup'}
              </Text>
            </View>
            <View style={styles.stopLine} />
            <View style={styles.stopRow}>
              <View style={[styles.stopDot, { backgroundColor: colors.primary, borderRadius: 3 }]} />
              <Text variant="bodySmall" numberOfLines={1} style={{ flex: 1 }}>
                {snapshot?.dropoff?.address ?? 'Destination'}
              </Text>
            </View>
          </View>

          {/* Fare comes from the server as integer pesewas. Never recomputed
              here — a client-side total that disagrees with the receipt by a
              pesewa is a support ticket. */}
          {snapshot?.fare.amountPesewas != null && (
            <View style={styles.fareRow}>
              <Text variant="bodySmall" color={colors.onSurfaceVariant}>Fare</Text>
              <Text style={styles.fareValue}>{formatGhs(snapshot.fare.amountPesewas)}</Text>
              {snapshot.fare.paymentMethod && (
                <Text variant="caption" color={colors.onSurfaceVariant}>
                  · {snapshot.fare.paymentMethod === 'CASH' ? 'Cash' : 'Card'}
                </Text>
              )}
            </View>
          )}

          <View style={styles.actions}>
            <Action icon="share-outline" label="Share trip" onPress={handleShare} colors={colors} />
            <Action
              icon="shield-checkmark-outline"
              label="Safety"
              onPress={() => tripId && router.push(`/ride/${tripId}/sos` as Href)}
              colors={colors}
            />
            <Action
              icon="close-circle-outline"
              label="Cancel"
              onPress={handleCancel}
              colors={colors}
              tint={colors.error}
            />
          </View>
        </View>
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
      style={{
        flex: 1, alignItems: 'center', gap: 4,
        paddingVertical: spacing.md,
        borderRadius: radii.lg,
        borderWidth: 1, borderColor: colors.outlineVariant,
        backgroundColor: colors.surfaceContainer,
      }}
    >
      <Ionicons name={icon} size={19} color={color} />
      <Text style={{ fontFamily: fonts.medium, fontSize: 10, color }}>{label}</Text>
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
  sheetBody: { gap: spacing.lg },
  pinCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
  },
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
  headline: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: {
    fontFamily: fonts.displayBold,
    fontSize: fontSizes.titleLarge,
    lineHeight: Math.round(fontSizes.titleLarge * 1.3),
    color: colors.onSurface,
    letterSpacing: -0.4,
  },
  etaBadge: {
    alignItems: 'center', justifyContent: 'center',
    minWidth: 60, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: colors.primary,
  },
  stops: { gap: 2 },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stopDot: { width: 8, height: 8, borderRadius: 4 },
  stopLine: {
    width: 1, height: 14, marginLeft: 3.5,
    backgroundColor: colors.outlineVariant,
  },
  fareRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  fareValue: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyLarge, color: colors.onSurface },
  actions: { flexDirection: 'row', gap: spacing.md },
});
