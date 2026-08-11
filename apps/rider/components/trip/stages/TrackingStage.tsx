import React, { useMemo } from 'react';
import { View, StyleSheet, Pressable, Alert, Linking } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, GlassSurface, InlayPanel, RollingDigits, Avatar, GradientGlowBorder } from '@eyego/ui';
import { formatGhs } from '@eyego/utils';
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
      {(!connected || recovering) && (
        <View style={styles.chip} pointerEvents="none">
          <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii.lg} intensity="low" />
          <Ionicons name="cloud-offline-outline" size={13} color={colors.onSurfaceVariant} />
          <Text variant="caption" color={colors.onSurfaceVariant}>
            {recovering ? 'Catching up…' : 'Reconnecting…'}
          </Text>
        </View>
      )}

      {/* 0.34 collapsed, against AssignedStage's 0.44 — the map gets more room
          once the rider is moving through it, and TripMap's SHEET_FRACTION for
          this stage matches so the camera pads to the same visible window. */}
      <InlayPanel
        snapPointsPct={[0.34, 0.66]}
        initialState="collapsed"
        sheetStyle={styles.sheet}
        grabberColor={colors.outline}
      >
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
      </InlayPanel>
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
  sheet: { backgroundColor: colors.background },
  sheetBody: { paddingHorizontal: spacing['2xl'], paddingBottom: spacing['2xl'], gap: spacing.lg },
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
