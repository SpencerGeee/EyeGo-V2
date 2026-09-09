import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import { driverApi } from '@eyego/api';
import { SheetContent, notify } from '@eyego/ui';
import { useDriverTripStore } from '../../stores/trip.store';
import { useDriverStore } from '../../stores/driver.store';
import { DispatchOfferCard, type DispatchOfferView } from '../dispatch/DispatchOfferCard';
import { useDriverSurface } from './driverStage';

/**
 * The offer, as a panel on the home surface rather than a screen of its own.
 *
 * BUGFIX ("tapping the live dispatch card, the morphing effect is super laggy…
 * take a new approach") and ("if I pass an offer, it doesn't stay forever on
 * the homepage").
 *
 * Everything expensive about the old `(trip)/dispatch/[id]` screen — the native
 * MapView, the road-leg fetches, the Skia canvas — is either already mounted on
 * home or deliberately absent here. This component owns NO map: home's map is
 * the map, and the camera re-frames when the stage changes. So opening an offer
 * costs one sheet crossfade and a camera ease, both on the UI thread, with no
 * mount and no navigation. That is why it cannot stutter, rather than merely
 * being faster than before.
 *
 * The pushed route still exists for push-notification and cold-start entry,
 * where there genuinely is no surface to land on yet. It renders the same card,
 * so the two paths look identical.
 */
export function DispatchOfferStage() {
  const focusedTripId = useDriverSurface((s) => s.focusedTripId);
  const closeOffer = useDriverSurface((s) => s.closeOffer);
  const heldOffer = useDriverTripStore((s) => s.offer);
  const pendingRequests = useDriverTripStore((s) => s.pendingRequests);
  const clockSkewMs = useDriverTripStore((s) => s.clockSkewMs);
  const setActiveTripId = useDriverStore((s) => s.setActiveTripId);
  const qc = useQueryClient();
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);

  /**
   * One offer view, from whichever source actually has it.
   *
   * The held offer wins: it is this driver's exclusive window and carries the
   * server's real deadline. A board row is the fallback for a ride that is
   * searching but not currently held by anyone — the driver can still claim it,
   * first-claim-wins, they just have no private clock on it.
   */
  const offer = useMemo<DispatchOfferView | null>(() => {
    if (!focusedTripId) return null;
    if (heldOffer?.tripId === focusedTripId) {
      return {
        tripId: heldOffer.tripId,
        pickupAddress: heldOffer.pickupAddress,
        dropoffAddress: heldOffer.dropoffAddress,
        farePesewas: heldOffer.farePesewas,
        driverEarningsPesewas: heldOffer.driverEarningsPesewas,
        walletRequiredPesewas: heldOffer.walletRequiredPesewas ?? null,
        tier: heldOffer.tier,
        expiresAtServerMs: heldOffer.expiresAtServerMs,
        kind: 'DISPATCH',
      } as DispatchOfferView;
    }
    const row = pendingRequests.find((r) => r.tripId === focusedTripId);
    if (!row) return null;
    return {
      tripId: row.tripId,
      pickupAddress: row.pickupAddress,
      dropoffAddress: row.dropoffAddress,
      farePesewas: row.farePesewas,
      driverEarningsPesewas: row.driverEarningsPesewas,
      walletRequiredPesewas: row.walletRequiredPesewas ?? null,
      tier: row.tier,
      /**
       * NOT a fabricated window. A row that has already lapsed on this driver
       * carries `offerExpiredForMe`, and inventing a fresh countdown for it is
       * exactly the bug that produced "it brings up the request again with a
       * fresh counter which is wrong cuz its supposed to be expired".
       */
      expiresAtServerMs: row.offerExpiredForMe ? null : row.expiresAtServerMs,
      kind: row.status === 'REASSIGNING' ? 'REASSIGNMENT' : 'DISPATCH',
    } as DispatchOfferView;
  }, [focusedTripId, heldOffer, pendingRequests]);

  /**
   * ── THE COUNTDOWN ───────────────────────────────────────────────────────
   *
   * One interval for the panel, started only while an offer is actually open,
   * so an idle home is not re-rendering once a second all day.
   *
   * `clockSkewMs` is why this is not a plain `Date.now()` comparison: the
   * deadline is the SERVER's instant, and a handset whose clock is a few
   * seconds fast would otherwise show a ring hitting zero on an offer that is
   * still live. Never compare `expiresAtServerMs` to `Date.now()` directly.
   */
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!offer) return;
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [offer?.tripId, offer]);

  const secondsLeft = useMemo(() => {
    const deadline = offer?.expiresAtServerMs ?? null;
    // Null is a real state, not a missing one: a board row nobody currently
    // holds has no private deadline, and a lapsed one has had its cleared.
    // Inventing a window here is the "fresh counter" bug.
    if (!deadline) return null;
    return Math.max(0, Math.ceil((deadline - (nowMs + clockSkewMs)) / 1000));
  }, [offer?.expiresAtServerMs, nowMs, clockSkewMs]);

  /** Length of the bar the countdown drains. Matches DISPATCH_OFFER_TTL_SECONDS. */
  const windowMs = 45_000;

  const handleAccept = useCallback(async () => {
    if (!offer || busy) return;
    setBusy('accept');
    try {
      await driverApi.acceptDispatch(offer.tripId);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setActiveTripId(offer.tripId);
      closeOffer();
      qc.invalidateQueries({ queryKey: ['driver'] });
    } catch (err: any) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      notify(
        'Could not take this ride',
        err?.response?.data?.message ??
          'Another driver may have taken it. The board will refresh.',
      );
      closeOffer();
    } finally {
      setBusy(null);
    }
  }, [offer, busy, setActiveTripId, closeOffer, qc]);

  const handleDecline = useCallback(async () => {
    if (!offer || busy) return;
    setBusy('decline');
    /**
     * The stage closes IMMEDIATELY, before the request settles.
     *
     * A pass is permanent now (see `noteDecline`'s `deliberate` flag on the
     * server), so there is nothing to wait for and nothing to undo — keeping
     * the panel up while the round trip completes would only make a decision
     * the driver has already made feel slow.
     */
    closeOffer();
    try {
      await driverApi.declineDispatch(offer.tripId);
    } catch {
      // A decline that fails is not worth a dialogue: the offer times out on
      // the server anyway, and the board is authoritative on the next frame.
    } finally {
      setBusy(null);
    }
  }, [offer, busy, closeOffer]);

  // The ride stopped being offerable while the panel was open — taken by
  // somebody else, cancelled by the rider. Leave rather than sit on a dead card.
  useEffect(() => {
    if (focusedTripId && !offer) closeOffer();
  }, [focusedTripId, offer, closeOffer]);

  if (!offer) return null;

  return (
    <SheetContent stage="offer">
      <View style={styles.body}>
        <DispatchOfferCard
          offer={offer}
          busy={busy}
          nowMs={nowMs}
          windowMs={windowMs}
          secondsLeft={secondsLeft}
          /**
           * HOME OWNS THE MAP. The card must not mount a second one.
           *
           * A MapView is a native GL surface; putting one inside a sheet that
           * is already sitting on top of a live map is the same mistake as the
           * stacked shader canvases that cooked the phone — and it would
           * reintroduce exactly the mount cost this stage exists to remove.
           */
          showMap={false}
          onAccept={handleAccept}
          onDecline={handleDecline}
        />
      </View>
    </SheetContent>
  );
}

const styles = StyleSheet.create({
  // The sheet host already applies the design gutter; this is only the
  // vertical rhythm the card needs inside it.
  body: { paddingTop: 4, gap: 12 },
});
