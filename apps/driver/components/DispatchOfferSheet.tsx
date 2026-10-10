import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Pressable, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { useDriverSurface } from './surface/driverStage';
import { lastKnownReportedFix } from '../hooks/useDriverLocation';
import { startDispatchAlert, stopDispatchAlert } from '../utils/dispatchAlert';
import { fetchRoute } from '../utils/routing';
import { DispatchOfferCard, offerAccent, type DispatchOfferView } from './dispatch/DispatchOfferCard';
import { DispatchMiniMap } from './dispatch/DispatchMiniMap';
import { goDeeper, notify } from '@eyego/ui';

/**
 * THE OFFER — the ONE place a ride is put in front of a driver.
 *
 * ── WHY THERE IS ONLY ONE ───────────────────────────────────────────────────
 * BUGFIX ("nothing shows how long the offer is gonna last, I can stay stuck on
 * this page"; "the dispatch page I've been seeing all along, the one that's
 * dead with no countdown and no animation"). There were THREE renderers of an
 * offer: this takeover (sound, countdown, mini map — the one the driver said
 * looks right), a home-sheet stage for a tapped board row, and a pushed
 * `(trip)/dispatch/[id]` screen for the Alerts board, push taps and the legacy
 * `trip:assigned` frame. The last two showed a row that carried no exclusive
 * deadline as a card with no clock and nothing to end it. Same ride, three
 * looks, one of them dead.
 *
 * Now every path lands HERE. A ride is either HELD for this driver (the
 * cascade's exclusive window, with its server deadline and the alert tone) or
 * it is a row the driver TAPPED on the board (claimable, first-accept-wins,
 * counted against the search's own deadline — the row now carries one, see
 * `searchExpiresAtServerMs`). Both render the same card, the same countdown,
 * the same draining frame; the pushed route survives only as a shim that
 * hydrates, focuses the row and comes back to home.
 *
 * ── WHY IT IS A FULL TAKEOVER AND NOT A CARD ON A SCRIM ─────────────────────
 * It used to be a small card floating on a dimmed screen, dismissable by
 * tapping the scrim — which meant the single most consequential seconds in the
 * driver's day could be thrown away by a stray thumb on the way to anything
 * else. The sheet covers the screen, the scrim is inert, and passing takes a
 * deliberate double tap inside the card. A tapped row can additionally be put
 * away with the close chip: the driver opened it, they may shut it.
 */

/** The search window the server defaults to — the fallback ring for a row read before `searchExpiresAtServerMs` landed. */
const SEARCH_WINDOW_FALLBACK_MS = 300_000;
/** The exclusive-hold window — matches DISPATCH_OFFER_TTL_SECONDS. */
const HOLD_WINDOW_FALLBACK_MS = 45_000;

export default function DispatchOfferSheet() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const setActiveTripId = useDriverStore((s) => s.setActiveTripId);
  /** Driver-controlled — see Settings, and utils/dispatchAlert.ts. */
  const alertsEnabled = useDriverStore((s) => s.offerAlertsEnabled);

  const held = useDriverTripStore((s) => s.offer);
  const pendingRequests = useDriverTripStore((s) => s.pendingRequests);
  const clearOffer = useDriverTripStore((s) => s.clearOffer);
  const serverNow = useDriverTripStore((s) => s.now);
  const focusedTripId = useDriverSurface((s) => s.focusedTripId);
  const closeFocused = useDriverSurface((s) => s.closeOffer);

  /**
   * The subject. A held offer outranks a tapped row: it is the one with a
   * private clock running against this driver. When it resolves, a row the
   * driver had opened is still focused and shows again on its own.
   */
  const row = useMemo(
    () => (!held && focusedTripId ? pendingRequests.find((r) => r.tripId === focusedTripId) ?? null : null),
    [held, focusedTripId, pendingRequests],
  );
  const tripId = held?.tripId ?? row?.tripId ?? null;
  const isHeld = !!held;

  /**
   * The deadline this card counts down to. Never null while a card is up:
   *   held  → the exclusive window's server deadline
   *   row   → the driver's own window if the cascade is asking them right now,
   *           else the SEARCH's deadline — the moment the ride stops existing
   *           for everybody. A lapsed personal window falls through to it too.
   */
  const deadlineMs: number | null = held
    ? held.expiresAtServerMs
    : row
      ? (row.offeredToMe && !row.offerExpiredForMe && row.expiresAtServerMs) ||
        row.searchExpiresAtServerMs ||
        null
      : null;
  const searchClock = !isHeld && !!row && !(row.offeredToMe && !row.offerExpiredForMe && row.expiresAtServerMs);

  /**
   * The window the ring and the frame start full at. Keyed by trip AND by
   * deadline so a re-publish of the same offer (a reconnect, the geometry
   * follow-up) does not restart the drain, while a genuinely new window does.
   */
  const windowRef = useRef<{ key: string; ms: number } | null>(null);
  const windowKey = `${tripId ?? ''}:${deadlineMs ?? ''}`;
  if (tripId && deadlineMs && windowRef.current?.key !== windowKey) {
    const fallback = searchClock ? SEARCH_WINDOW_FALLBACK_MS : HOLD_WINDOW_FALLBACK_MS;
    const fromStart = searchClock && row?.requestedAtMs ? deadlineMs - row.requestedAtMs : null;
    windowRef.current = {
      key: windowKey,
      ms: Math.max(1000, fromStart ?? Math.min(fallback, deadlineMs - serverNow())),
    };
  }
  const windowMs = windowRef.current?.ms ?? HOLD_WINDOW_FALLBACK_MS;

  const [, setTick] = useState(0);
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [accepted, setAccepted] = useState(false);

  /**
   * DERIVED AT RENDER, NEVER HELD IN STATE.
   *
   * BUGFIX ("the driver homepage showed a new pending trip, I tap it, I only
   * feel the haptic but nothing happens"). This was `useState(0)` filled in by
   * the interval effect below — but the expiry effect further down runs in the
   * SAME commit as the card's first frame, still reading that initial 0. Every
   * card (tapped row AND held offer) therefore "expired" on the frame it opened
   * and closed itself. Reading the deadline here means no frame can ever see a
   * number the deadline does not support.
   */
  const secondsLeft =
    tripId && deadlineMs ? Math.max(0, Math.ceil((deadlineMs - serverNow()) / 1000)) : 0;

  // One interval, alive only while a card is on screen. It only re-renders;
  // the number itself is read from the deadline above, against SERVER time.
  useEffect(() => {
    if (!tripId || !deadlineMs) {
      setBusy(null);
      setAccepted(false);
      return;
    }
    const t = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [tripId, deadlineMs]);

  // Announce once per trip — a re-publish after a socket reconnect must not buzz twice.
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (!tripId || announced.current === tripId) return;
    announced.current = tripId;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, [tripId]);

  /**
   * The repeating alert is for a ride being HELD for this driver — the one
   * case where they may not be looking at the phone. A row they tapped open
   * themselves needs no siren; they are already here.
   */
  useEffect(() => {
    if (!held || accepted || busy) {
      stopDispatchAlert();
      return;
    }
    startDispatchAlert(held.tripId, { enabled: alertsEnabled });
    return () => stopDispatchAlert();
  }, [held, accepted, busy, alertsEnabled]);

  /**
   * The clock ran out. For a hold the server has moved on; for a search the
   * ride is over. Either way a dead card invites a tap that 409s.
   */
  useEffect(() => {
    if (!tripId || !deadlineMs || secondsLeft > 0 || busy || accepted) return;
    if (held) clearOffer();
    if (focusedTripId) closeFocused();
    void useDriverTripStore.getState().hydrate();
  }, [tripId, deadlineMs, secondsLeft, busy, accepted, held, focusedTripId, clearOffer, closeFocused]);

  /**
   * THE ROAD TO THE PICKUP, for a row that arrived without one.
   *
   * A held offer carries the leg the cascade fetched (`DispatchOffer.geometry`).
   * A board row does not — the server never routed it for this driver — so the
   * card asks for it once, from the driver's last fix to the pickup, through
   * the same `/geo/route` the trip screens use. Keyed on the trip so a second
   * open is free, and never blocking: the arc draws until the road lands.
   */
  const fix = lastKnownReportedFix();
  const driverAt = fix ? coordOf(fix.lng, fix.lat) : null;
  const pickup = coordOf(held?.pickupLng ?? row?.pickupLng, held?.pickupLat ?? row?.pickupLat);
  const [road, setRoad] = useState<{ tripId: string; coords: Coord[] } | null>(null);
  useEffect(() => {
    if (!tripId || held?.geometry || !driverAt || !pickup) return;
    if (road?.tripId === tripId) return;
    let cancelled = false;
    void fetchRoute(driverAt, pickup).then((r) => {
      if (cancelled || !r || r.coordinates.length < 2) return;
      setRoad({ tripId, coords: r.coordinates });
    });
    return () => {
      cancelled = true;
    };
    // The driver's fix moves every few seconds; the leg is asked for once per
    // trip, from wherever they were when the card opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, held?.geometry, !!driverAt, !!pickup]);

  // ── Entrance: the sheet rises, it does not blink into existence ──────────
  const rise = useSharedValue(0);
  useEffect(() => {
    if (!tripId) {
      rise.value = 0;
      return;
    }
    rise.value = withDelay(20, withSpring(1, springs.emphasized));
  }, [tripId, rise]);
  const riseStyle = useAnimatedStyle(() => ({
    opacity: rise.value,
    transform: [{ translateY: (1 - rise.value) * 28 }, { scale: 0.97 + rise.value * 0.03 }],
  }));
  const scrim = useSharedValue(0);
  useEffect(() => {
    scrim.value = withTiming(tripId ? 1 : 0, { duration: 220, easing: Easing.out(Easing.quad) });
  }, [tripId, scrim]);
  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));

  /**
   * The map frames the ride in the part of the screen the card leaves: the
   * card's measured height (it grows with a wallet notice or an armed pass)
   * plus the home indicator below it, the status bar above.
   */
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const [cardH, setCardH] = useState(0);
  const onCardLayout = (e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height);
    if (Math.abs(h - cardH) > 8) setCardH(h);
  };

  const dismiss = () => {
    if (held) clearOffer();
    if (focusedTripId) closeFocused();
  };

  const handleAccept = async () => {
    if (!tripId || busy) return;
    setBusy('accept');
    try {
      // The server routes the verb by the trip's own status (claimTrip), so a
      // held offer and a first-claim row are one call here.
      await ridesApi.accept(tripId);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setAccepted(true);
      setActiveTripId(tripId);
      // Rehydrate before leaving so home opens onto a real trip snapshot and
      // its driving stage, rather than a spinner waiting for the first frame.
      await useDriverTripStore.getState().hydrate();
      setTimeout(() => {
        dismiss();
        // The trip has its own screen — map, stages and manage in one place.
        goDeeper({ pathname: '/(trip)/active/[id]', params: { id: tripId } } as never);
      }, 420);
    } catch (err: any) {
      const status = err?.response?.status;
      const code: string | undefined = err?.response?.data?.code;
      setBusy(null);
      dismiss();
      /**
       * SAY WHY. BUGFIX ("when I swiped to accept, it got me to the homepage
       * then it went back to the dispatch screen… no error message was given").
       * Every refusal was swallowed, so a rule (your own ride, a short wallet)
       * looked exactly like a glitch and the offer came straight back.
       */
      if (status === 409 || status === 410) {
        notify('This ride is no longer available', 'Another driver took it or the request ended.', { tone: 'info' });
      } else {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        notify(
          code === 'SELF_RIDE_REFUSED' ? 'That’s your own ride request' : 'Could not accept this ride',
          code === 'SELF_RIDE_REFUSED'
            ? 'This request came from your own rider account (same phone number). Use a different number on the rider app to test.'
            : err?.response?.data?.message ?? 'Check your connection and try again.',
        );
      }
      // A ride this driver may never take is passed for good, so it does not
      // come straight back as a fresh offer.
      if (code === 'SELF_RIDE_REFUSED') void ridesApi.decline(tripId).catch(() => {});
      void useDriverTripStore.getState().hydrate();
    }
  };

  const handleDecline = async () => {
    if (!tripId || busy) return;
    setBusy('decline');
    // Clear first: the driver has decided, and the card should not linger while
    // the request flies. The cascade moves to the next candidate regardless.
    dismiss();
    try {
      await ridesApi.decline(tripId);
    } catch {
      // Declining is advisory — the offer times out on the server anyway.
    } finally {
      setBusy(null);
    }
  };

  if (!tripId) return null;

  const view: DispatchOfferView = held
    ? {
        tripId: held.tripId,
        pickupAddress: held.pickupAddress,
        dropoffAddress: held.dropoffAddress,
        dropoffBearing: held.dropoffBearing,
        dropoffDistanceKm: held.dropoffDistanceKm,
        tripKm: held.tripKm,
        tripMinutes: held.tripMinutes,
        pickup,
        dropoff: coordOf(held.dropoffLng, held.dropoffLat),
        geometry: held.geometry ?? (road?.tripId === held.tripId ? road.coords : null),
        driverEarningsPesewas: held.driverEarningsPesewas,
        farePesewas: held.farePesewas,
        walletRequiredPesewas: held.walletRequiredPesewas ?? null,
        pickupNote: held.pickupNote ?? null,
        ridePrefs: held.ridePrefs ?? [],
        boostPesewas: held.boostPesewas ?? null,
        partySize: held.partySize ?? null,
        tier: held.tier,
        etaSeconds: held.etaSeconds,
        expiresAtServerMs: deadlineMs,
        attempt: held.attempt,
        totalCandidates: held.totalCandidates,
        kind: held.kind === 'REASSIGNMENT' ? 'REASSIGNMENT' : 'DISPATCH',
      }
    : {
        tripId: row!.tripId,
        pickupAddress: row!.pickupAddress,
        dropoffAddress: row!.dropoffAddress,
        dropoffBearing: row!.dropoffBearing ?? null,
        dropoffDistanceKm: row!.dropoffDistanceKm ?? null,
        tripKm: row!.tripKm ?? null,
        tripMinutes: row!.tripMinutes ?? null,
        pickup,
        dropoff: coordOf(row!.dropoffLng, row!.dropoffLat),
        geometry: road?.tripId === row!.tripId ? road.coords : null,
        driverEarningsPesewas: row!.driverEarningsPesewas,
        farePesewas: row!.farePesewas,
        walletRequiredPesewas: row!.walletRequiredPesewas ?? null,
        pickupNote: row!.pickupNote ?? null,
        ridePrefs: row!.ridePrefs ?? [],
        boostPesewas: row!.boostPesewas ?? null,
        partySize: row!.partySize ?? null,
        tier: row!.tier,
        expiresAtServerMs: deadlineMs,
        kind: row!.status === 'REASSIGNING' ? 'REASSIGNMENT' : 'REQUEST',
      };

  const accent = offerAccent(colors, view.tier, secondsLeft);
  const pickupKm = driverAt && view.pickup ? haversineKm(driverAt, view.pickup) : null;
  const etaMin = view.etaSeconds != null ? Math.max(1, Math.round(view.etaSeconds / 60)) : null;
  const approachLabel = [etaMin != null ? `${etaMin} min` : null, pickupKm != null ? `${pickupKm.toFixed(1)} km` : null]
    .filter(Boolean)
    .join(' · ') || null;
  const framePadding = {
    top: insets.top + spacing.xl,
    // Never more than ~60% of the screen between the two — the camera adapter
    // clamps there anyway, and a frame squeezed to a sliver helps nobody.
    bottom: Math.min(cardH + insets.bottom + spacing.lg + 24, screenH * 0.6 - insets.top - spacing.xl),
    left: 48,
    right: 48,
  };

  /**
   * ── NO `<Modal>`: THIS IS ALREADY THE TOP LAYER ─────────────────────────
   * Mounted at the root inside `OverlayPortal` (a `FullWindowOverlay` on iOS).
   * Presenting a UIKit modal from inside that window does not reliably
   * complete — the offer could be live, the sound playing and the countdown
   * running, with no card on screen. The portal already provides the takeover;
   * `styles.root` fills it and accepts touches, so nothing behind can be reached.
   */
  /**
   * ── THE MAP IS THE PAGE ──────────────────────────────────────────────────
   * FEATURE ("the dispatch offer needs full immersion — ETA, distance to the
   * pickup, think about everything"). It was a card in the middle of a nearly
   * black scrim with a 196 pt map inside it. Now the map is the whole screen —
   * this bus, its road to the pickup drawing itself in, the pickup pulsing, the
   * minutes and kilometres sitting on the road — and the offer floats over it
   * as one card. The map pans and pinches (a driver may want to see what is
   * around the pickup) and still accepts every touch, so nothing behind the
   * takeover can be reached.
   */
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFill, scrimStyle]}>
        <DispatchMiniMap
          fill
          pickup={view.pickup}
          // The approach only: the destination stays withheld until the ride
          // starts (see the card) — it is told in numbers, never drawn.
          dropoff={null}
          driver={driverAt}
          approachGeometry={view.geometry ?? null}
          accent={accent}
          framePadding={framePadding}
          approachLabel={approachLabel}
        />
      </Animated.View>

      <View
        style={[styles.root, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.sm }]}
        pointerEvents="box-none"
      >
        <Animated.View style={[styles.sheet, riseStyle]} pointerEvents="box-none" onLayout={onCardLayout}>
          {/* A row the driver opened may be put away without passing on it. A
              held offer may not: the only ways out of a hold are the two the
              card offers, because closing it is indistinguishable from missing it. */}
          {!isHeld ? (
            <Pressable
              onPress={() => {
                void Haptics.selectionAsync().catch(() => {});
                closeFocused();
              }}
              accessibilityRole="button"
              accessibilityLabel="Put this request away"
              hitSlop={10}
              style={[styles.closeChip, { backgroundColor: colors.surfaceContainerHigh, borderColor: colors.outline }]}
            >
              <Animated.Text style={[styles.closeText, { color: colors.onSurfaceVariant }]}>Back to board</Animated.Text>
            </Pressable>
          ) : null}
          <View style={[styles.cardShadow, { backgroundColor: colors.surfaceCard }]}>
            <DispatchOfferCard
              offer={view}
              driverAt={driverAt}
              nowMs={serverNow()}
              windowMs={windowMs}
              secondsLeft={secondsLeft}
              onAccept={handleAccept}
              onDecline={handleDecline}
              busy={busy}
              accepted={accepted}
              variant="sheet"
            />
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

/** Straight-line km between two `[lng, lat]` points — for "1.2 km" beside an ETA. */
function haversineKm(a: Coord, b: Coord): number {
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** `[lng, lat]`, or null unless BOTH are real finite numbers. */
function coordOf(lng: unknown, lat: unknown): Coord | null {
  if (typeof lng !== 'number' || typeof lat !== 'number') return null;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}

const makeStyles = (_colors: DriverColors) =>
  StyleSheet.create({
    root: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: spacing.md },
    sheet: { width: '100%', gap: spacing.md },
    cardShadow: {
      borderRadius: 28,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.4,
      shadowRadius: 26,
      elevation: 18,
    },
    closeChip: {
      alignSelf: 'center',
      minHeight: 40,
      paddingHorizontal: spacing.lg,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      alignItems: 'center',
      justifyContent: 'center',
    },
    closeText: { fontSize: 13, fontWeight: '600', letterSpacing: 0.2 },
  });
