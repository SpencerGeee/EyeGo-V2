import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { View, StyleSheet, Modal, Pressable, Platform } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ridesApi } from '@eyego/api';
import { formatGhs } from '@eyego/utils';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button, GlassSurface } from '@eyego/ui';
import { useColors, type DriverColors } from '../utils/useColors';
import { useDriverStore } from '../stores/driver.store';
import { useDriverTripStore } from '../stores/trip.store';

/**
 * THE DISPATCH OFFER, ON SCREEN.
 *
 * `trip.store.listenForOffers()` has always parked the incoming offer in the
 * store, and nothing in the app ever read it back out. That — not the cascade,
 * which was fine — is why a rider could request a ride and the driver phone
 * would sit there showing the home screen: the offer arrived, was stored, and
 * had no renderer.
 *
 * Mounted once, at the root, so it can appear over any screen. The driver
 * should never have to be on a particular tab to be offered work.
 *
 * The countdown is rendered against SERVER time (`offerSecondsLeft()`), so a
 * phone with a skewed clock shows the same number of seconds as every other
 * phone being offered the same trip.
 */
export default function DispatchOfferSheet() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const setActiveTripId = useDriverStore((s) => s.setActiveTripId);

  const offer = useDriverTripStore((s) => s.offer);
  const clearOffer = useDriverTripStore((s) => s.clearOffer);
  const offerSecondsLeft = useDriverTripStore((s) => s.offerSecondsLeft);

  const [secondsLeft, setSecondsLeft] = useState(0);
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const announced = useRef<string | null>(null);

  // One interval, alive only while an offer is on screen. Reading the deadline
  // from the store each tick (rather than counting down local state) means a
  // re-offer of the same trip cannot leave a stale timer running.
  useEffect(() => {
    if (!offer) {
      setSecondsLeft(0);
      setBusy(null);
      return;
    }
    setSecondsLeft(offerSecondsLeft() ?? 0);
    const t = setInterval(() => setSecondsLeft(offerSecondsLeft() ?? 0), 500);
    return () => clearInterval(t);
  }, [offer, offerSecondsLeft]);

  // Announce once per trip, not once per render — an offer re-published after a
  // socket reconnect must not buzz the phone a second time.
  useEffect(() => {
    if (!offer || announced.current === offer.tripId) return;
    announced.current = offer.tripId;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [offer]);

  // Expired. The server has already moved on to the next candidate; holding a
  // dead card on screen only invites a tap that 409s.
  useEffect(() => {
    if (offer && secondsLeft <= 0 && !busy) clearOffer();
  }, [offer, secondsLeft, busy, clearOffer]);

  const handleAccept = useCallback(async () => {
    if (!offer || busy) return;
    setBusy('accept');
    const tripId = offer.tripId;
    try {
      await ridesApi.accept(tripId);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      clearOffer();
      setActiveTripId(tripId);
      // Rehydrate before navigating so the trip screen opens onto a real
      // snapshot rather than a spinner waiting for its first socket frame.
      await useDriverTripStore.getState().hydrate();
      router.push({ pathname: '/(trip)/active/[id]', params: { id: tripId } } as Href);
    } catch (err: any) {
      const status = err?.response?.status;
      clearOffer();
      // 409/410 is the normal race, not a failure worth an alert box: someone
      // else took it, or it expired while the tap was in flight.
      if (status !== 409 && status !== 410) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } finally {
      setBusy(null);
    }
  }, [offer, busy, clearOffer, setActiveTripId, router]);

  const handleDecline = useCallback(async () => {
    if (!offer || busy) return;
    setBusy('decline');
    const tripId = offer.tripId;
    // Clear first: the driver has decided, and the card should not linger while
    // the request flies. The cascade moves to the next candidate regardless.
    clearOffer();
    try {
      await ridesApi.decline(tripId);
    } catch {
      // Declining is advisory — the offer times out on the server anyway.
    } finally {
      setBusy(null);
    }
  }, [offer, busy, clearOffer]);

  if (!offer) return null;

  const urgent = secondsLeft <= 8;
  const ringColor = urgent ? colors.error : colors.primary;
  const etaMinutes = offer.etaSeconds != null ? Math.max(1, Math.round(offer.etaSeconds / 60)) : null;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={handleDecline}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleDecline} accessibilityLabel="Dismiss offer" />
        <View style={styles.card}>
          <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii['3xl']} intensity="high" />

          <View style={styles.header}>
            <View style={[styles.badge, { backgroundColor: `${colors.primary}22`, borderColor: `${colors.primary}55` }]}>
              <View style={[styles.badgeDot, { backgroundColor: colors.primary }]} />
              <Text style={[styles.badgeLabel, { color: colors.primary }]}>NEW REQUEST</Text>
            </View>
            <View style={[styles.timerPill, { borderColor: `${ringColor}55`, backgroundColor: `${ringColor}18` }]}>
              <Text style={[styles.timerDigits, { color: ringColor }]}>{Math.max(0, secondsLeft)}s</Text>
            </View>
          </View>

          {offer.driverEarningsPesewas != null && (
            <View style={styles.earnings}>
              <Text style={[styles.earningsValue, { color: colors.onSurface }]}>
                {formatGhs(offer.driverEarningsPesewas)}
              </Text>
              <Text variant="caption" color={colors.onSurfaceVariant}>
                you earn{etaMinutes != null ? ` · ${etaMinutes} min away` : ''}
              </Text>
            </View>
          )}

          <View style={styles.route}>
            <View style={styles.routeRow}>
              <View style={[styles.pickupDot, { backgroundColor: colors.primary }]} />
              <Text style={styles.routeText} numberOfLines={2}>
                {offer.pickupAddress ?? 'Pickup point'}
              </Text>
            </View>
            <View style={[styles.routeLine, { backgroundColor: colors.outline }]} />
            <View style={styles.routeRow}>
              <Ionicons name="location" size={15} color={colors.error} style={{ marginLeft: 1 }} />
              <Text style={styles.routeText} numberOfLines={2}>
                {offer.dropoffAddress ?? 'Destination'}
              </Text>
            </View>
          </View>

          <View style={styles.actions}>
            <Button
              label="Accept"
              onPress={handleAccept}
              loading={busy === 'accept'}
              disabled={busy != null}
            />
            <Button
              label="Decline"
              variant="secondary"
              onPress={handleDecline}
              disabled={busy != null}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0,0,0,0.55)',
      padding: spacing.lg,
      paddingBottom: Platform.OS === 'ios' ? spacing['3xl'] : spacing.xl,
    },
    card: {
      borderRadius: radii['3xl'],
      overflow: 'hidden',
      padding: spacing.xl,
      gap: spacing.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.outline,
      backgroundColor: colors.surfaceContainer,
    },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radii.full,
      borderWidth: 1,
    },
    badgeDot: { width: 6, height: 6, borderRadius: 3 },
    badgeLabel: { fontFamily: fonts.semiBold, fontSize: 10, lineHeight: Math.round(10 * 1.4), letterSpacing: 0.6 },
    timerPill: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radii.full,
      borderWidth: 1,
      minWidth: 54,
      alignItems: 'center',
    },
    timerDigits: { fontFamily: fonts.displayBold, fontSize: 15, lineHeight: Math.round(15 * 1.4) },
    earnings: { gap: 2 },
    earningsValue: {
      fontFamily: fonts.displayBold,
      fontSize: 34,
      lineHeight: Math.round(34 * 1.25),
      letterSpacing: -1,
    },
    route: { gap: 2 },
    routeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    pickupDot: { width: 10, height: 10, borderRadius: 5, marginLeft: 2 },
    routeLine: { width: 2, height: 16, marginLeft: 7 },
    routeText: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.4),
      color: colors.onSurface,
    },
    actions: { gap: spacing.sm },
  });
