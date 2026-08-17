import React, { useMemo } from 'react';
import { View, StyleSheet, Pressable, Alert, Linking } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, GlassSurface, RollingDigits, Avatar, GradientGlowBorder } from '@eyego/ui';
import { formatGhs } from '@eyego/utils';
import { SheetContent } from '../sheetSlot';
import { useColors, Colors } from '../../../utils/useColors';
import { useTripStore } from '../../../stores/trip.store';
import { useChatUnread } from '../../../stores/chatUnread.store';
import { shareLiveTracking } from '../../../utils/safety';

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
  const unreadChats = useChatUnread((s) => (tripId ? s.counts[tripId] ?? 0 : 0));
  const driver = snapshot?.driver ?? null;
  const vehicle = snapshot?.vehicle ?? null;

  // Only a `toDropoff` ETA belongs on this stage — see AssignedStage for why
  // the leg has to be checked rather than assumed.
  const minutes = eta && eta.leg === 'toDropoff' ? eta.minutes : null;

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
          <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii.lg} intensity="low" />
          <Ionicons name="warning-outline" size={13} color={colors.error} />
          <Text variant="caption" color={colors.error}>
            Driver&apos;s signal lost — location may be out of date
          </Text>
        </View>
      ) : (!connected || recovering) && (
        <View style={styles.chip} pointerEvents="none">
          <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii.lg} intensity="low" />
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
      <SheetContent stage="tracking">
        {/*
          The green wash has moved to TripSheetHost's `background`. It was here,
          inside the panel body, where `absoluteFill` resolves against the body's
          PADDING box — so the gradient's rectangle stopped ~32 pt short of each
          edge and left two hard vertical seams up the card ("this visible cut on
          the left and right"). See the note at its new home; the light belongs
          to the sheet, not to whichever panel is inside it.
        */}
        <View style={styles.sheetBody}>
          <View style={styles.headline}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>
                {minutes != null ? 'Arriving in' : 'On your way'}
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

          {/*
            THE JOURNEY, BOTH ENDS OF IT.

            BUGFIX ("on the rider tracking page it doesn't show the pickup point
            — placeholder only — it just shows the destination").

            This panel rendered `snapshot.dropoff.address` under the headline and
            nothing else, so the one thing a rider in a moving car cannot verify
            from the window — that the driver is taking them from the right place
            to the right place — was half missing. The pickup was not wrong here,
            it was absent; the "placeholder" was the generic destination subtitle
            standing in for a route.

            `trip-view.js` already resolves `snapshot.pickup` to THIS rider's own
            collection point (their booking's, not the group trip's — see the
            note there), so the correct address is on the wire and was simply
            never read. Rendered as the same dot → connector → pin vocabulary the
            rider set the trip up with on the Where-To card, so the two screens
            describe one journey the same way.
          */}
          <View style={styles.journey}>
            <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii.xl} intensity="low" />
            <View style={styles.journeyTimeline}>
              <View style={[styles.journeyDot, { backgroundColor: colors.onSurfaceVariant }]} />
              <View style={[styles.journeyConnector, { backgroundColor: colors.outline }]} />
              <Ionicons name="location" size={12} color={colors.primary} />
            </View>
            <View style={styles.journeyText}>
              <View>
                <Text style={styles.journeyLabel}>PICKUP</Text>
                <Text variant="bodySmall" numberOfLines={1}>
                  {snapshot?.pickup?.address ?? 'Your pickup point'}
                </Text>
              </View>
              <View>
                <Text style={styles.journeyLabel}>DROP-OFF</Text>
                <Text variant="bodySmall" numberOfLines={1}>
                  {snapshot?.dropoff?.address ?? 'Your destination'}
                </Text>
              </View>
            </View>
          </View>

          {/* One compact row instead of the full driver card: who is driving is
              already established by this point. */}
          {/*
            THE LIGHT. "There isn't a glow border on any of the cards so it
            seems dead." These two rows are the live facts of the ride — who is
            driving, and what it costs — and they were flat panels on a flat
            sheet. `brandGreen` is the ring the Where-To field wears, which is
            what the rider last saw before this screen, so the same light
            carries through the whole booking rather than stopping at the door.
          */}
          {driver && (
            <GradientGlowBorder
              palette="brandGreen"
              fillColor={colors.surfaceContainerHigh}
              borderRadius={radii.xl}
              thickness="thin"
              glow
              glowIntensity={0.7}
              style={styles.driverRow}
            >
              <Avatar uri={driver.photo} name={driver.name} size={36} />
              <View style={{ flex: 1 }}>
                <Text variant="bodySmall" numberOfLines={1}>{driver.name}</Text>
                {vehicle?.plate && (
                  <Text variant="caption" color={colors.onSurfaceVariant}>{vehicle.plate}</Text>
                )}
              </View>
              <Pressable
                onPress={handleCall}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Call driver"
                style={styles.iconBtn}
              >
                <Ionicons name="call-outline" size={17} color={colors.onSurface} />
              </Pressable>
              <Pressable
                onPress={() => tripId && router.push(`/ride/${tripId}/chat` as Href)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={
                  unreadChats > 0
                    ? `Message driver, ${unreadChats} unread`
                    : 'Message driver'
                }
                style={styles.iconBtn}
              >
                <Ionicons name="chatbubble-outline" size={17} color={colors.onSurface} />
                {/* The whole point of the counter: on this screen the app-wide
                    chat banner is deliberately suppressed, so without a badge
                    a driver's message left no trace at all. */}
                {unreadChats > 0 && (
                  <View style={[styles.chatBadge, { backgroundColor: colors.primary }]}>
                    <Text style={[styles.chatBadgeText, { color: colors.onPrimary }]}>
                      {unreadChats > 9 ? '9+' : unreadChats}
                    </Text>
                  </View>
                )}
              </Pressable>
            </GradientGlowBorder>
          )}

          {/* Server-computed integer pesewas, rendered as-is. */}
          {snapshot?.fare.amountPesewas != null && (
            <GradientGlowBorder
              palette="brandGreen"
              fillColor={colors.surfaceContainerHigh}
              borderRadius={radii.xl}
              thickness="thin"
              glow
              glowIntensity={0.55}
              style={styles.fareRow}
            >
              <Text variant="bodySmall" color={colors.onSurfaceVariant}>
                {snapshot.fare.paymentStatus === 'PAID' ? 'Paid' : 'Fare'}
              </Text>
              <Text style={styles.fareValue}>{formatGhs(snapshot.fare.amountPesewas)}</Text>
              {/* One seat unless the rider is covering the group — see
                  trip-view's `seatsPaidFor`. Saying "for 4 seats" is the
                  difference between a fare that looks wrong and one that
                  explains itself. */}
              {(snapshot.fare as { seatsPaidFor?: number | null }).seatsPaidFor != null &&
                ((snapshot.fare as { seatsPaidFor?: number | null }).seatsPaidFor ?? 1) > 1 && (
                  <Text variant="caption" color={colors.onSurfaceVariant}>
                    · {(snapshot.fare as { seatsPaidFor?: number | null }).seatsPaidFor} seats
                  </Text>
                )}
              {snapshot.fare.paymentMethod === 'CASH' && snapshot.fare.paymentStatus !== 'PAID' && (
                <Text variant="caption" color={colors.onSurfaceVariant}>· pay cash on arrival</Text>
              )}
            </GradientGlowBorder>
          )}

          <View style={styles.actions}>
            <Pressable onPress={handleShare} style={styles.action} accessibilityRole="button" accessibilityLabel="Share trip">
              <Ionicons name="share-outline" size={18} color={colors.onSurface} />
              <Text style={[styles.actionLabel, { color: colors.onSurface }]}>Share trip</Text>
            </Pressable>
            <Pressable
              onPress={() => tripId && router.push(`/ride/${tripId}/sos` as Href)}
              style={[styles.action, { borderColor: colors.error }]}
              accessibilityRole="button"
              accessibilityLabel="Emergency and safety"
            >
              <Ionicons name="shield-checkmark-outline" size={18} color={colors.error} />
              <Text style={[styles.actionLabel, { color: colors.error }]}>Safety</Text>
            </Pressable>
          </View>
        </View>
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
    minWidth: 16, height: 16, borderRadius: 8,
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
});
