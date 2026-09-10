import React, { useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button, GlassSurface } from '@eyego/ui';
import { useColors, type Colors } from '../utils/useColors';
import { useTripStore } from '../stores/trip.store';

/**
 * "VERIFY MY RIDE" — THE CODE, ON THE RIDER'S SCREEN.
 *
 * BUGFIX ("the rider app isn't showing the pin verification — when the driver
 * marks as boarded it should bring up the popup on the tracking page with the
 * verifying pin").
 *
 * The whole feature existed except this. The server mints the code on booking
 * (boarding-pin.service.js), puts it in the rider's own trip snapshot and
 * nobody else's (trip-view.js), and refuses to board the passenger without it
 * (drivers.service#boardPassenger). The one thing missing was any way for the
 * rider to READ it — so a rider who turned the setting on could never board,
 * and a driver asking for a code got a blank stare.
 *
 * Two triggers, because the code is needed at two different moments:
 *
 *   • ARRIVED_AT_PICKUP — the driver is at the kerb, so the code goes up
 *     unprompted. A rider hunting through a screen for it while a driver waits
 *     is the failure mode that makes people stop using the feature.
 *   • BOARDING_PIN_REQUESTED — the driver has actually tapped "mark boarded".
 *     This raises it again even if the rider dismissed it, which is the
 *     behaviour asked for.
 *
 * Mounted at the root so it can appear over the tracking surface, the chat, or
 * anything else the rider happens to be looking at. There is nothing to render
 * unless this rider's own booking has an unverified code.
 */
export default function BoardingPinSheet() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const booking = useTripStore((s) => s.snapshot?.booking ?? null);
  const status = useTripStore((s) => s.snapshot?.status ?? null);
  const requestedFor = useTripStore((s) => s.boardingPinRequestedFor);
  const dismiss = useTripStore((s) => s.dismissBoardingPinRequest);

  const pin = booking?.boardingPin ?? null;
  const verified = !!booking?.pinVerified;

  // Local dismissal, so a rider who has read the code can put it away — but a
  // fresh request from the driver overrides it (the ref below is keyed on the
  // request, not on the booking).
  const [dismissed, setDismissed] = React.useState(false);
  const lastRequestRef = useRef<string | null>(null);
  useEffect(() => {
    if (requestedFor && requestedFor !== lastRequestRef.current) {
      lastRequestRef.current = requestedFor;
      setDismissed(false);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
  }, [requestedFor]);

  // Once the driver has entered it, the trip moves on and the snapshot drops
  // the code — take the sheet down with it rather than leaving a used number up.
  useEffect(() => {
    if (verified || !pin) {
      setDismissed(false);
      lastRequestRef.current = null;
      if (requestedFor) dismiss();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verified, pin]);

  const atPickup = status === 'ARRIVED_AT_PICKUP';
  const visible = !!pin && !verified && !dismissed && (atPickup || !!requestedFor);

  if (!visible) return null;

  const digits = pin!.split('');

  /**
   * ── NO `<Modal>` HERE, DELIBERATELY ─────────────────────────────────────
   *
   * BUGFIX ("when its on the on the way to you status, the app freezes. even on
   * the your driver is here status. it only comes back when im on board").
   *
   * This component is mounted at the root INSIDE `OverlayPortal`, which on iOS
   * is a `FullWindowOverlay` — a sibling UIWindow above the whole application
   * window, presented view controllers included. That is already the highest
   * layer there is; it is the entire reason the sheet is mounted where it is.
   *
   * Wrapping the contents in a native `<Modal>` on top of that asked UIKit to
   * present a view controller from inside a window that is not a view
   * controller context, while the trip surface was itself a presented
   * transparentModal. The presentation never completed and never went away, so
   * it sat there swallowing every touch in the app — frozen, with nothing
   * visibly wrong.
   *
   * It matched the reported window exactly: the sheet becomes visible when the
   * driver asks for the code or arrives (DRIVER_EN_ROUTE / ARRIVED_AT_PICKUP)
   * and unmounts when `verified` flips on boarding, which is why the app "came
   * back" at exactly the moment the rider got aboard.
   *
   * A plain absolutely-filled View is all this needs. The portal is `box-none`,
   * so this backdrop opting into touches is how a child is meant to become
   * interactive there.
   */
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => setDismissed(true)}
          accessibilityLabel="Hide ride code"
        />
        <View style={styles.card}>
          <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii['3xl']} intensity="high" />

          <View style={[styles.badge, { backgroundColor: `${colors.primary}22`, borderColor: `${colors.primary}55` }]}>
            <Ionicons name="shield-checkmark-outline" size={13} color={colors.primary} />
            <Text style={[styles.badgeLabel, { color: colors.primary }]}>VERIFY MY RIDE</Text>
          </View>

          <Text style={styles.title}>Show your driver this code</Text>
          <Text style={styles.subtitle}>
            They must type it in before you are marked aboard. If they cannot read it back to you,
            you are at the wrong vehicle.
          </Text>

          <View
            style={styles.digitsRow}
            accessibilityLabel={`Your boarding code is ${digits.join(' ')}`}
          >
            {digits.map((d, i) => (
              <View key={i} style={styles.digitBox}>
                <Text style={styles.digit}>{d}</Text>
              </View>
            ))}
          </View>

          <Button label="Done" onPress={() => setDismissed(true)} />
        </View>
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.62)',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing['2xl'],
    },
    card: {
      width: '100%',
      borderRadius: radii['3xl'],
      borderWidth: 1,
      borderColor: colors.rimLight,
      backgroundColor: colors.surfaceContainerHigh,
      padding: spacing['2xl'],
      gap: spacing.base,
      overflow: 'hidden',
    },
    badge: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRadius: radii.full,
      borderWidth: 1,
      paddingHorizontal: spacing.md,
      paddingVertical: 4,
    },
    badgeLabel: { fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1 },
    title: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.titleMedium,
      color: colors.onSurface,
    },
    subtitle: {
      fontFamily: fonts.regular,
      fontSize: fontSizes.bodySmall,
      lineHeight: Math.round(fontSizes.bodySmall * 1.45),
      color: colors.onSurfaceVariant,
    },
    digitsRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      justifyContent: 'center',
      marginVertical: spacing.md,
    },
    digitBox: {
      flex: 1,
      aspectRatio: 0.86,
      maxWidth: 74,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: `${colors.primary}55`,
      backgroundColor: `${colors.primary}14`,
      alignItems: 'center',
      justifyContent: 'center',
    },
    digit: {
      fontFamily: fonts.displayBold,
      // Deliberately large: this is read aloud across a car window, at night.
      fontSize: 34,
      lineHeight: 40,
      color: colors.onSurface,
    },
  });
