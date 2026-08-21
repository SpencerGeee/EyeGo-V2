import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, Alert, ActivityIndicator, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { driverApi } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Entrance, AppBackground } from '@eyego/ui';
import type { Coord } from '@eyego/maps';

import { useColors, type DriverColors } from '../../../utils/useColors';
import { useDriverStore } from '../../../stores/driver.store';
import { useDriverTripStore } from '../../../stores/trip.store';
import { lastKnownReportedFix } from '../../../hooks/useDriverLocation';
import { DispatchOfferCard, type DispatchOfferView } from '../../../components/dispatch/DispatchOfferCard';

/** Fallback window when the payload carries no deadline (the REASSIGNMENT path). */
const DEFAULT_WINDOW_S = 30;

/**
 * THE OFFER SCREEN — what the Dispatch list opens.
 *
 * ── THE THREE BUGS THIS REWRITE CLOSES ──────────────────────────────────────
 *
 * 1. "the pickup and destination was blank like nothing to show"
 *    The screen read `origin` and `destination` out of NAVIGATION PARAMS.
 *    `PendingDispatchList` pushes `/(trip)/dispatch/<tripId>` and passes no
 *    params at all, so both were `undefined` and rendered as em-dashes. The
 *    offer is now read from the trip store, which already holds the server's
 *    own copy — addresses, coordinates, fare, deadline — for exactly this
 *    trip, and falls back to a REST re-read if the store is cold.
 *
 * 2. "when I clicked on the accept button, it said failed to accept"
 *    It called `driverApi.acceptDispatch`, whose first line is
 *    `findFirst({ id, driverId })`. On a cascade offer the trip's `driverId`
 *    is still NULL, so that found nothing and answered 404. The correct verb
 *    depended on a `kind` string the list also did not pass. The server now
 *    routes it — `drivers.service.claimTrip` reads the trip row and picks —
 *    so this screen has one accept call and cannot pick the wrong one.
 *
 * 3. "when I waited for it to expire, it brought me to unmatched route
 *    (eyego-driver:///)"
 *    `router.replace('/(tabs)')`. A group is not a route; expo-router has
 *    nothing to match and renders its unmatched screen. Every exit here now
 *    names the actual screen, `/(tabs)/home`.
 */
export default function DispatchScreen() {
  const colors = useColors();
  const theme = useDriverStore((s) => s.theme);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const qc = useQueryClient();
  const setActiveTripId = useDriverStore((s) => s.setActiveTripId);

  const params = useLocalSearchParams<{
    id: string;
    origin?: string;
    destination?: string;
    estimatedEarnings?: string;
    expiresAt?: string;
    kind?: string;
  }>();
  const id = params.id;

  const serverNow = useDriverTripStore((s) => s.now);
  const heldOffer = useDriverTripStore((s) => s.offer);
  const pendingRequests = useDriverTripStore((s) => s.pendingRequests);
  const resync = useDriverTripStore((s) => s.resync);

  /**
   * THE OFFER, FROM THE SERVER'S OWN COPY.
   *
   * Three sources, in descending order of authority: the exclusive offer this
   * driver holds; the live-search row for this trip; and finally the navigation
   * params, which are kept only because the FCM notification handler still
   * builds a link with them and a push that arrives before the socket does is
   * the one case where params are the only thing we have.
   */
  const [fetched, setFetched] = useState<DispatchOfferView | null>(null);
  const [loading, setLoading] = useState(false);

  const offer: DispatchOfferView | null = useMemo(() => {
    if (heldOffer?.tripId === id) {
      return {
        tripId: id,
        pickupAddress: heldOffer.pickupAddress,
        dropoffAddress: heldOffer.dropoffAddress,
        pickup: coordOf(heldOffer.pickupLng, heldOffer.pickupLat),
        dropoff: coordOf(heldOffer.dropoffLng, heldOffer.dropoffLat),
        driverEarningsPesewas: heldOffer.driverEarningsPesewas,
        farePesewas: heldOffer.farePesewas,
        tier: heldOffer.tier,
        etaSeconds: heldOffer.etaSeconds,
        expiresAtServerMs: heldOffer.expiresAtServerMs,
        attempt: heldOffer.attempt,
        totalCandidates: heldOffer.totalCandidates,
        kind: params.kind ?? 'DISPATCH',
      };
    }

    const row = pendingRequests.find((r) => r.tripId === id);
    if (row) {
      return {
        tripId: id,
        pickupAddress: row.pickupAddress,
        dropoffAddress: row.dropoffAddress,
        pickup: coordOf(row.pickupLng, row.pickupLat),
        dropoff: coordOf(row.dropoffLng, row.dropoffLat),
        driverEarningsPesewas: row.driverEarningsPesewas,
        farePesewas: row.farePesewas,
        tier: row.tier,
        expiresAtServerMs: row.expiresAtServerMs,
        kind: row.status === 'REASSIGNING' ? 'REASSIGNMENT' : (params.kind ?? 'DISPATCH'),
      };
    }

    if (fetched) return fetched;

    if (params.origin || params.destination) {
      return {
        tripId: id,
        pickupAddress: params.origin ?? null,
        dropoffAddress: params.destination ?? null,
        driverEarningsPesewas: params.estimatedEarnings
          ? Math.round(parseFloat(params.estimatedEarnings) * 100)
          : null,
        expiresAtServerMs: params.expiresAt ? new Date(params.expiresAt).getTime() : null,
        kind: params.kind ?? 'DISPATCH',
      };
    }
    return null;
  }, [heldOffer, pendingRequests, fetched, id, params.kind, params.origin, params.destination, params.estimatedEarnings, params.expiresAt]);

  /**
   * Cold store — the phone was asleep, or this is a deep link from a push.
   * `resync` is the cheapest way back: one call rebuilds the offer, the live
   * searches and the clock skew together.
   */
  useEffect(() => {
    if (offer || !id || loading) return;
    setLoading(true);
    void (async () => {
      try {
        await resync();
        // The trip itself, as a last resort — this covers a REASSIGNMENT, which
        // is not in `pendingRequests` for a driver who has not been offered it.
        const trip: any = await driverApi.getTripById(id).catch(() => null);
        const t = trip?.data?.data?.trip ?? trip?.trip ?? trip;
        if (t?.id) {
          setFetched({
            tripId: id,
            pickupAddress: t.pickupAddress ?? t.route?.originName ?? null,
            dropoffAddress: t.dropoffAddress ?? t.route?.destinationName ?? null,
            pickup: coordOf(t.pickupLng ?? t.route?.originLng, t.pickupLat ?? t.route?.originLat),
            dropoff: coordOf(t.dropoffLng ?? t.route?.destLng, t.dropoffLat ?? t.route?.destLat),
            farePesewas: t.pricing?.totalTripCostPesewas ?? null,
            driverEarningsPesewas: t.pricing?.driverEarningsPerSeatPesewas ?? null,
            tier: t.tier ?? null,
            expiresAtServerMs: null,
            kind: t.status === 'REASSIGNING' ? 'REASSIGNMENT' : 'DISPATCH',
          });
        }
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, offer]);

  // ── The clock ───────────────────────────────────────────────────────────
  // Declared before the memo that reads it: a useMemo factory runs during the
  // same render, so a ref declared below it is still in its temporal dead zone.
  const firstSeenRef = useRef(Date.now());

  const expiresAtMs = useMemo(() => {
    if (offer?.expiresAtServerMs) return offer.expiresAtServerMs;
    if (params.expiresAt) {
      const t = new Date(params.expiresAt).getTime();
      if (Number.isFinite(t)) return t;
    }
    return null;
  }, [offer?.expiresAtServerMs, params.expiresAt]);

  const windowMs = useMemo(() => {
    if (!expiresAtMs) return DEFAULT_WINDOW_S * 1000;
    // Measured from FIRST SIGHT rather than assumed, so a driver who opens the
    // offer with eight seconds left sees a ring that starts at eight seconds —
    // not one that claims to be nearly full.
    return Math.max(1000, expiresAtMs - firstSeenRef.current);
  }, [expiresAtMs]);

  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!expiresAtMs) {
      setSecondsLeft(null);
      return;
    }
    const tick = () => setSecondsLeft(Math.max(0, Math.round((expiresAtMs - serverNow()) / 1000)));
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [expiresAtMs, serverNow]);

  const goHome = useCallback(() => {
    // NOT '/(tabs)'. That is a group with no screen of its own, and routing to
    // it is what produced "Unmatched Route · eyego-driver:///".
    router.replace('/(tabs)/home' as Href);
  }, [router]);

  // Guard an id that is not a string at all (a malformed deep link).
  useEffect(() => {
    if (!id || typeof id !== 'string') goHome();
  }, [id, goHome]);

  // Expired: hold the dead card for a beat so the driver sees WHY it went away.
  const expired = secondsLeft != null && secondsLeft <= 0;
  useEffect(() => {
    if (!expired) return;
    const t = setTimeout(goHome, 2200);
    return () => clearTimeout(t);
  }, [expired, goHome]);

  // ── Accept / decline ────────────────────────────────────────────────────
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [accepted, setAccepted] = useState(false);

  const handleAccept = useCallback(async () => {
    if (!id || busy) return;
    setBusy('accept');
    try {
      // ONE call. `POST /driver/trips/:id/accept` now resolves which of the
      // three claim paths applies from the trip row itself.
      const res: any = await driverApi.acceptDispatch(id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      const trip = res?.data?.data?.trip ?? res?.data?.trip ?? res?.trip ?? null;
      const tripId = trip?.id ?? id;
      setAccepted(true);
      setActiveTripId(tripId);
      qc.invalidateQueries({ queryKey: ['driver', 'trips', 'all'] });
      qc.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
      // A beat on "Yours" before the trip screen takes over — the swipe
      // control holds its confirmed state and the transition reads as one move.
      setTimeout(
        () => router.replace({ pathname: '/(trip)/active/[id]', params: { id: tripId } } as Href),
        450,
      );
    } catch (err: any) {
      setBusy(null);
      const status = err?.response?.status;
      if (status === 409 || status === 410 || status === 404) {
        Alert.alert(
          'Gone already',
          'Another driver took this one, or the offer expired. You are still online.',
          [{ text: 'OK', onPress: goHome }],
        );
      } else {
        Alert.alert(
          'Could not accept',
          err?.response?.data?.message ?? 'Something went wrong. Try again, or pull to refresh on Home.',
        );
      }
    }
  }, [id, busy, qc, router, setActiveTripId, goHome]);

  const handleDecline = useCallback(async () => {
    if (!id || busy) return;
    setBusy('decline');
    try {
      await driverApi.declineDispatch(id);
    } catch {
      // A decline that fails is not worth a dialogue: the offer times out on
      // its own a few seconds later and the cascade moves on regardless.
    } finally {
      goHome();
    }
  }, [id, busy, goHome]);

  const driverAt = useMemo<Coord | null>(() => {
    const fix = lastKnownReportedFix();
    return fix ? coordOf(fix.lng, fix.lat) : null;
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <AppBackground isDark={theme !== 'light'} />

      <View style={styles.topBar}>
        <Pressable
          onPress={goHome}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back to home"
          style={styles.back}
        >
          <Ionicons name="chevron-down" size={20} color={colors.onSurfaceVariant} />
        </Pressable>
        <Text style={styles.topTitle}>Dispatch</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {offer ? (
          <Entrance animation="slideUp" delay={40}>
            <DispatchOfferCard
              offer={offer}
              driverAt={driverAt}
              nowMs={serverNow()}
              windowMs={windowMs}
              secondsLeft={secondsLeft}
              onAccept={handleAccept}
              onDecline={handleDecline}
              busy={busy}
              accepted={accepted}
            />
          </Entrance>
        ) : (
          <View style={styles.empty}>
            {loading ? (
              <>
                <ActivityIndicator color={colors.accent} />
                <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.emptyText}>
                  Pulling this ride up…
                </Text>
              </>
            ) : (
              <>
                <Ionicons name="cloud-offline-outline" size={30} color={colors.onSurfaceVariant} />
                <Text style={styles.emptyTitle}>This offer is gone</Text>
                <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.emptyText}>
                  It expired, or another driver took it. You are still online and still in the pool.
                </Text>
                <Pressable onPress={goHome} style={[styles.emptyBtn, { borderColor: colors.outline }]}>
                  <Text style={{ fontFamily: fonts.semiBold, color: colors.accent }}>Back to home</Text>
                </Pressable>
              </>
            )}
          </View>
        )}

        {expired && offer ? (
          <View style={[styles.expiredNote, { borderColor: colors.outline }]}>
            <Ionicons name="time-outline" size={15} color={colors.onSurfaceVariant} />
            <Text variant="bodySmall" color={colors.onSurfaceVariant}>
              Offer expired — taking you back
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/** `[lng, lat]`, or null unless BOTH are real finite numbers. */
function coordOf(lng: unknown, lat: unknown): Coord | null {
  if (typeof lng !== 'number' || typeof lat !== 'number') return null;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
    },
    back: {
      width: 36, height: 36, borderRadius: 18,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surfaceContainerHigh,
    },
    topTitle: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodyMedium,
      color: colors.onSurfaceVariant,
      letterSpacing: 0.4,
    },
    scroll: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.base },

    empty: {
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing['4xl'],
      paddingHorizontal: spacing.xl,
    },
    emptyTitle: {
      fontFamily: fonts.displayBold,
      fontSize: 20,
      lineHeight: 26,
      color: colors.onSurface,
    },
    emptyText: { textAlign: 'center', lineHeight: 20 },
    emptyBtn: {
      marginTop: spacing.sm,
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.md,
      borderRadius: radii.full,
      borderWidth: 1,
    },

    expiredNote: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.md,
      borderRadius: radii.full,
      borderWidth: StyleSheet.hairlineWidth,
    },
  });
