import React, { useMemo } from 'react';
import { View, StyleSheet, Pressable, Linking } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, GlassSurface, RollingDigits, SheetSections, goDeeper } from '@eyego/ui';
import { DriverStrip } from './DriverStrip';
import { formatGhs, clockTime } from '@eyego/utils';
import { SheetContent } from '../sheetSlot';
import { useColors, Colors } from '../../../utils/useColors';
import { useTripStore } from '../../../stores/trip.store';
import { useChatUnread } from '../../../stores/chatUnread.store';
import { shareLiveTracking } from '../../../utils/safety';
import { useRouteChange } from '../../../hooks/useRouteChange';
import { useTripCall } from '../../../hooks/useTripCall';

/**
 * The in-car stage (IN_PROGRESS): the rider is aboard and the only questions
 * left are "how long" and "how do I get help".
 *
 * Deliberately quieter than `AssignedStage`. Before pickup the rider is looking
 * for a specific car and needs the plate, the driver's face and a countdown;
 * once they are in it, the driver's identity is settled and the panel that was
 * useful becomes clutter over the map. Uber and Bolt both shrink here, and the
 * old 1754-line tracking screen did not — it kept the full driver card, the
 * tier badge and the fare breakdown on screen for the whole ride.
 *
 * Owns no map and no routing: `TripMap` draws the store's `path`, and the ETA
 * is the server's, per leg.
 */
function TrackingStageImpl() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();

  const snapshot = useTripStore((s) => s.snapshot);
  const eta = useTripStore((s) => s.eta);
  const connected = useTripStore((s) => s.connected);
  const recovering = useTripStore((s) => s.recovering);
  // The driver's phone has stopped reporting — see the chip below, and
  // eyego-api/src/services/driver-link-watch.service.js for who decides that.
  const driverLinkLostSinceMs = useTripStore((s) => s.driverLinkLostSinceMs);

  const tripId = snapshot?.tripId ?? null;
  // Change destination / add a stop — hailed rides only (a bus follows its route).
  const routeChange = useRouteChange(tripId);
  const isHailed = !!(snapshot as { isOnDemand?: boolean } | null)?.isOnDemand;
  const stops = ((snapshot as { stops?: { address?: string | null }[] } | null)?.stops ?? []);
  const unreadChats = useChatUnread((s) => (tripId ? s.counts[tripId] ?? 0 : 0));
  const driver = snapshot?.driver ?? null;
  const vehicle = snapshot?.vehicle ?? null;

  // Only a `toDropoff` ETA belongs on this stage — see AssignedStage for why
  // the leg has to be checked rather than assumed.
  const minutes = eta && eta.leg === 'toDropoff' ? eta.minutes : null;

  // Masked through EyeGo's number when the server has it on — see useTripCall.
  const tripCall = useTripCall();
  const handleCall = () => void tripCall({ tripId: snapshot?.tripId, phone: driver?.phone, name: driver?.name });

  const handleShare = () =>
    shareLiveTracking(
      snapshot?.shortId ?? tripId ?? '',
      driver?.name ?? 'Your driver',
      vehicle?.plate ?? 'Unknown',
    );

  return (
    <View style={styles.root} pointerEvents="box-none">
      {/*
        THREE DIFFERENT PROBLEMS, ONE CHIP — AND THEY ARE NOT THE SAME PROBLEM.

        `!connected` / `recovering` are about THIS phone: our socket is down or
        catching up, and the fix is to wait a moment. `driverLinkLost` is about
        the OTHER phone: ours is fine, the server's is fine, and the driver's has
        stopped reporting. It takes precedence because it is the one the rider
        can act on — the puck they are watching is a last known position, not a
        live one, and "Reconnecting…" would tell them to keep waiting for
        something that is not coming back on its own.
      */}
      {driverLinkLostSinceMs != null ? (
        <View style={styles.chip} pointerEvents="none">
          <View style={[StyleSheet.absoluteFill, { borderRadius: radii.lg, backgroundColor: colors.surfaceCard }]} pointerEvents="none" />
          <Ionicons name="warning-outline" size={13} color={colors.error} />
          <Text variant="caption" color={colors.error}>
            Driver&apos;s signal lost — location may be out of date
          </Text>
        </View>
      ) : (!connected || recovering) && (
        <View style={styles.chip} pointerEvents="none">
          <View style={[StyleSheet.absoluteFill, { borderRadius: radii.lg, backgroundColor: colors.surfaceCard }]} pointerEvents="none" />
          <Ionicons name="cloud-offline-outline" size={13} color={colors.onSurfaceVariant} />
          <Text variant="caption" color={colors.onSurfaceVariant}>
            {recovering ? 'Catching up…' : 'Reconnecting…'}
          </Text>
        </View>
      )}

      {/*
        The panel body no longer renders here. It is published into the trip
        surface's ONE sheet, which is mounted above every stage and deforms
        between them — so moving from `assigned` to `tracking` is the same
        surface changing shape rather than one panel unmounting and another
        springing up in its place. Its detents (0.34 resting here, 0.44 while
        assigned) live in TripSheetHost's SHEET_STYLE table, and the map's
        camera padding is now read from the sheet's live edge rather than from
        a matching table of guesses.
      */}
      {/*
        IN THE CAR, THE WAY UBER SAYS IT: the arrival time first, the place
        under it, the driver settled into one quiet row. A drag up gives the
        journey and the fare; full gives the things you rarely need mid-ride.
        Same sheet as the assigned stage - it re-fits, it is not replaced.
      */}
      <SheetContent stage="tracking">
        <SheetSections
          peek={
            <>
              <View style={styles.headline}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>
                    {minutes != null ? `Arriving ${clockTime(new Date(Date.now() + minutes * 60_000))}` : 'On your way'}
                  </Text>
                  <Text variant="bodySmall" color={colors.onSurfaceVariant} numberOfLines={1}>
                    {snapshot?.dropoff?.address ?? 'Your destination'}
                  </Text>
                </View>
                {minutes != null && (
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
                )}
              </View>
              {driver ? (
                <DriverStrip
                  colors={colors}
                  name={driver.name}
                  photo={driver.photo}
                  plate={vehicle?.plate ?? null}
                  car={vehicle ? `${vehicle.make} ${vehicle.model}`.trim() : null}
                  emphasisePlate={false}
                  unread={unreadChats}
                  onCall={handleCall}
                  onChat={() => tripId && goDeeper(`/ride/${tripId}/chat` as Href)}
                />
              ) : null}
            </>
          }
          half={
            <>
              <View style={styles.journey}>
                <View style={styles.journeyTimeline}>
                  <View style={[styles.journeyDot, { backgroundColor: colors.onSurfaceVariant }]} />
                  <View style={[styles.journeyConnector, { backgroundColor: colors.outline }]} />
                  <Ionicons name="location" size={12} color={colors.primary} />
                </View>
                <View style={styles.journeyText}>
                  <View>
                    <Text style={styles.journeyLabel}>PICKUP</Text>
                    <Text variant="bodySmall" numberOfLines={1}>{snapshot?.pickup?.address ?? 'Your pickup point'}</Text>
                  </View>
                  <View>
                    <Text style={styles.journeyLabel}>DROP-OFF</Text>
                    <Text variant="bodySmall" numberOfLines={1}>{snapshot?.dropoff?.address ?? 'Your destination'}</Text>
                  </View>
                </View>
              </View>
              {stops.length > 0 && (
                <View style={styles.stopsRow}>
                  <Ionicons name="flag-outline" size={15} color={colors.onSurfaceVariant} />
                  <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ flex: 1 }} numberOfLines={2}>
                    {stops.length === 1 ? 'Stop' : 'Stops'}: {stops.map((st) => st.address ?? 'Pinned place').join(' → ')}, then your destination
                  </Text>
                </View>
              )}
              {snapshot?.fare.amountPesewas != null && (
                <View style={styles.fareRow}>
                  <Ionicons name={snapshot.fare.paymentMethod === 'CASH' ? 'cash-outline' : 'card-outline'} size={16} color={colors.onSurfaceVariant} />
                  <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ flex: 1 }}>
                    {snapshot.fare.paymentStatus === 'PAID'
                      ? 'Paid'
                      : snapshot.fare.paymentMethod === 'CASH' ? 'Pay cash on arrival' : 'Fare'}
                    {((snapshot.fare as { seatsPaidFor?: number | null }).seatsPaidFor ?? 1) > 1
                      ? ` · ${(snapshot.fare as { seatsPaidFor?: number | null }).seatsPaidFor} seats`
                      : ''}
                  </Text>
                  <Text style={styles.fareValue}>{formatGhs(snapshot.fare.amountPesewas)}</Text>
                </View>
              )}
              <View style={styles.actions}>
                <Pressable onPress={handleShare} style={styles.action} accessibilityRole="button" accessibilityLabel="Share trip">
                  <Ionicons name="share-outline" size={18} color={colors.onSurface} />
                  <Text style={[styles.actionLabel, { color: colors.onSurface }]}>Share trip</Text>
                </Pressable>
                <Pressable
                  onPress={() => tripId && goDeeper(`/ride/${tripId}/sos` as Href)}
                  style={[styles.action, { borderColor: colors.error }]}
                  accessibilityRole="button"
                  accessibilityLabel="Emergency and safety"
                >
                  <Ionicons name="shield-checkmark-outline" size={18} color={colors.error} />
                  <Text style={[styles.actionLabel, { color: colors.error }]}>Safety</Text>
                </Pressable>
              </View>
            </>
          }
        >
          {isHailed ? (
            <View style={styles.actions}>
              <Pressable onPress={routeChange.changeDestination} style={styles.action} accessibilityRole="button" accessibilityLabel="Change destination">
                <Ionicons name="navigate-outline" size={18} color={colors.onSurface} />
                <Text style={[styles.actionLabel, { color: colors.onSurface }]}>Change destination</Text>
              </Pressable>
              <Pressable onPress={routeChange.addStop} style={styles.action} accessibilityRole="button" accessibilityLabel="Add a stop">
                <Ionicons name="add-circle-outline" size={18} color={colors.onSurface} />
                <Text style={[styles.actionLabel, { color: colors.onSurface }]}>Add a stop</Text>
              </Pressable>
            </View>
          ) : null}
        </SheetSections>
      </SheetContent>
    </View>
  );
}

// Memoized so the outgoing stage stays static during trip.tsx crossfades.
export const TrackingStage = React.memo(TrackingStageImpl);

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  chip: {
    position: 'absolute',
    top: 60, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    borderRadius: radii.lg, overflow: 'hidden',
  },
  // Horizontal gutter and bottom safe area belong to the shared sheet now
  // (TripSheetHost's body style + MorphSheet's inset), so this is only the
  // rhythm between the panel's own blocks. Keeping the old padding here as
  // well would double every gutter.
  sheetBody: { gap: spacing.lg },
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
    minWidth: 64, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: colors.primary,
  },
  /* No border or background of its own any more: GradientGlowBorder paints
     both, and a second flat border under the ring reads as a doubled edge. */
  /** Pickup → drop-off. See the render site. */
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
  /** The dot/line/pin rail, sized so each end lines up with its own text block. */
  journeyTimeline: { alignItems: 'center', paddingTop: 5, width: 12 },
  journeyDot: { width: 8, height: 8, borderRadius: 4 },
  /** Explicit height rather than `flex: 1` — this is a cross-axis child of a row
   *  whose height is intrinsic, and a flex here resolves to zero. */
  journeyConnector: { width: 2, height: 26, marginVertical: 3 },
  journeyText: { flex: 1, gap: spacing.md },
  journeyLabel: {
    fontFamily: fonts.medium,
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 0.7,
    color: colors.onSurfaceVariant,
  },
  driverRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.outlineVariant,
  },
  chatBadge: {
    position: 'absolute', top: -3, right: -3,
    minWidth: 16, minHeight: 16, borderRadius: 8,
    paddingHorizontal: 3,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: colors.surfaceContainer,
  },
  chatBadgeText: {
    fontFamily: fonts.semiBold,
    fontSize: 9,
    lineHeight: Math.round(9 * 1.3),
  },
  fareRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  fareValue: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyLarge, color: colors.onSurface },
  actions: { flexDirection: 'row', gap: spacing.md },
  action: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.outlineVariant,
    backgroundColor: colors.surfaceContainer,
  },
  actionLabel: { fontFamily: fonts.medium, fontSize: fontSizes.bodySmall },
  stopsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
});
