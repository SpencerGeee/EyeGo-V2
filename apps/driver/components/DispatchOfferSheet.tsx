import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Modal, Pressable } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { ridesApi } from '@eyego/api';
import { spacing, springs } from '@eyego/config';
import type { Coord } from '@eyego/maps';

import { useColors, type DriverColors } from '../utils/useColors';
import { useDriverStore } from '../stores/driver.store';
import { useDriverTripStore } from '../stores/trip.store';
import { lastKnownReportedFix } from '../hooks/useDriverLocation';
import { DispatchOfferCard, type DispatchOfferView } from './dispatch/DispatchOfferCard';

/**
 * THE OFFER TAKEOVER — a ride is being held for THIS driver, right now.
 *
 * `trip.store.listenForOffers()` has always parked the incoming offer in the
 * store; this is what renders it. Mounted once at the root so it can appear
 * over any screen — a driver should never have to be on a particular tab to be
 * offered work.
 *
 * ── WHY IT IS A FULL TAKEOVER AND NOT A CARD ON A SCRIM ─────────────────────
 * It used to be a small card floating on a dimmed screen, dismissable by
 * tapping the scrim — which meant the single most consequential twenty seconds
 * in the driver's day could be thrown away by a stray thumb on the way to
 * anything else, and "decline" was the action that stray thumb performed. The
 * sheet now covers the screen, the scrim is inert, and passing takes a
 * deliberate double tap inside the card.
 *
 * Everything below the chrome is `DispatchOfferCard`, which is also what the
 * Dispatch list's screen renders. The two surfaces used to disagree about the
 * countdown, the copy, the accept endpoint and what an offer even contains.
 */
export default function DispatchOfferSheet() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const setActiveTripId = useDriverStore((s) => s.setActiveTripId);

  const offer = useDriverTripStore((s) => s.offer);
  const clearOffer = useDriverTripStore((s) => s.clearOffer);
  const offerSecondsLeft = useDriverTripStore((s) => s.offerSecondsLeft);
  const serverNow = useDriverTripStore((s) => s.now);

  const [secondsLeft, setSecondsLeft] = useState(0);
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [accepted, setAccepted] = useState(false);
  const announced = useRef<string | null>(null);
  /** The window this particular offer opened with, so the ring starts full. */
  const windowMsRef = useRef(20_000);

  // One interval, alive only while an offer is on screen. Reading the deadline
  // from the store each tick (rather than counting down local state) means a
  // re-offer of the same trip cannot leave a stale timer running.
  useEffect(() => {
    if (!offer) {
      setSecondsLeft(0);
      setBusy(null);
      setAccepted(false);
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
    windowMsRef.current = Math.max(1000, offer.expiresAtServerMs - serverNow());
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, [offer, serverNow]);

  // Expired. The server has already moved on to the next candidate; holding a
  // dead card on screen only invites a tap that 409s.
  useEffect(() => {
    if (offer && secondsLeft <= 0 && !busy && !accepted) clearOffer();
  }, [offer, secondsLeft, busy, accepted, clearOffer]);

  // ── Entrance: the sheet rises, it does not blink into existence ──────────
  const rise = useSharedValue(0);
  useEffect(() => {
    if (!offer) {
      rise.value = 0;
      return;
    }
    rise.value = withDelay(20, withSpring(1, springs.emphasized));
  }, [offer, rise]);

  const riseStyle = useAnimatedStyle(() => ({
    opacity: rise.value,
    transform: [{ translateY: (1 - rise.value) * 28 }, { scale: 0.97 + rise.value * 0.03 }],
  }));

  const scrim = useSharedValue(0);
  useEffect(() => {
    scrim.value = withTiming(offer ? 1 : 0, { duration: 220, easing: Easing.out(Easing.quad) });
  }, [offer, scrim]);
  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));

  const handleAccept = async () => {
    if (!offer || busy) return;
    setBusy('accept');
    const tripId = offer.tripId;
    try {
      await ridesApi.accept(tripId);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setAccepted(true);
      setActiveTripId(tripId);
      // Rehydrate before navigating so the trip screen opens onto a real
      // snapshot rather than a spinner waiting for its first socket frame.
      await useDriverTripStore.getState().hydrate();
      setTimeout(() => {
        clearOffer();
        router.push({ pathname: '/(trip)/active/[id]', params: { id: tripId } } as Href);
      }, 420);
    } catch (err: any) {
      const status = err?.response?.status;
      setBusy(null);
      clearOffer();
      // 409/410 is the normal race, not a failure worth an alert box: someone
      // else took it, or it expired while the tap was in flight.
      if (status !== 409 && status !== 410) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      }
    }
  };

  const handleDecline = async () => {
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
  };

  if (!offer) return null;

  const view: DispatchOfferView = {
    tripId: offer.tripId,
    pickupAddress: offer.pickupAddress,
    dropoffAddress: offer.dropoffAddress,
    pickup: coordOf(offer.pickupLng, offer.pickupLat),
    dropoff: coordOf(offer.dropoffLng, offer.dropoffLat),
    driverEarningsPesewas: offer.driverEarningsPesewas,
    farePesewas: offer.farePesewas,
    tier: offer.tier,
    etaSeconds: offer.etaSeconds,
    expiresAtServerMs: offer.expiresAtServerMs,
    attempt: offer.attempt,
    totalCandidates: offer.totalCandidates,
    kind: 'DISPATCH',
  };

  const fix = lastKnownReportedFix();
  const driverAt = fix ? coordOf(fix.lng, fix.lat) : null;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={() => {}}>
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, scrimStyle]}>
          <LinearGradient
            colors={['rgba(3,12,24,0.92)', 'rgba(3,12,24,0.97)']}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        {/* Inert. Passing on a ride is a decision, not a miss — see the header. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          accessible={false}
          onPress={() => {
            void Haptics.selectionAsync().catch(() => {});
          }}
        />

        <Animated.View style={[styles.sheet, riseStyle]} pointerEvents="box-none">
          <DispatchOfferCard
            offer={view}
            driverAt={driverAt}
            nowMs={serverNow()}
            windowMs={windowMsRef.current}
            secondsLeft={secondsLeft}
            onAccept={handleAccept}
            onDecline={handleDecline}
            busy={busy}
            accepted={accepted}
            mapHeight={196}
          />
        </Animated.View>
      </View>
    </Modal>
  );
}

/** `[lng, lat]`, or null unless BOTH are real finite numbers. */
function coordOf(lng: unknown, lat: unknown): Coord | null {
  if (typeof lng !== 'number' || typeof lat !== 'number') return null;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}

const makeStyles = (_colors: DriverColors) =>
  StyleSheet.create({
    root: { flex: 1, justifyContent: 'center', padding: spacing.lg },
    sheet: { width: '100%' },
  });
