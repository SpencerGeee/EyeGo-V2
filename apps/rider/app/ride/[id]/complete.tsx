import React, { useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { MotiView } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useRideStore } from '../../../stores/ride.store';
import { fonts, fontSizes, spacing, radii, withOpacity, springs } from '@eyego/config';
import { useColors, Colors } from '../../../utils/useColors';
import { formatGhs, formatDistance, formatDuration, originLabel, destinationLabel } from '@eyego/utils';
import { useQuery } from '@tanstack/react-query';
import { bookingsApi, ridesApi } from '@eyego/api';
import { Text, GlassSurface, GradientGlowBorder, AnimatedCheckmark, PREMIUM_RING_COLORS, PREMIUM_RING_LOCATIONS } from '@eyego/ui';

export default function TripCompleteScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id, bookingId: paramBookingId, viewOnly } = useLocalSearchParams<{ id: string; bookingId?: string; viewOnly?: string }>();
  const isViewOnly = viewOnly === '1';
  const router = useRouter();
  const { activeBooking, selectedTrip: storeTrip } = useRideStore();
  const navigated = useRef(false);

  /**
   * THE TRIP THIS RECEIPT IS FOR — FETCHED, NOT REMEMBERED.
   *
   * BUGFIX (item 7: "the complete page that comes before the rate driver had a
   * dash for the destination").
   *
   * Every fact on this card came from `selectedTrip`, a ride-store slice that is
   * only ever populated by the GROUP flow's trip picker. An on-demand rider
   * never picks a trip — they name a destination and a car is dispatched — so
   * the slice is null for the primary product, and the card fell through to its
   * placeholders: "Destination" for the address and a literal em-dash for the
   * distance. It also survives a cold start, an app kill mid-ride, or arriving
   * here from a push, none of which repopulate an in-memory store.
   *
   * `ridesApi.events(id, 0)` answers with the canonical snapshot
   * (services/trip-view.js) — the same shape the tracking screen renders — so
   * the receipt and the ride it describes cannot disagree. The store slice
   * stays as the instant-paint fallback for the group flow that does have it.
   */
  const { data: ride } = useQuery({
    queryKey: ['ride', 'snapshot', id],
    queryFn: () => ridesApi.events(id, 0),
    select: (r: any) => {
      const payload = r?.snapshot ? r : r?.data;
      return {
        snapshot: payload?.snapshot ?? null,
        /**
         * THE DISTANCE THE RIDE WAS PRICED ON.
         *
         * There is no `distanceKm` column on `Trip` and no route row on an
         * on-demand ride, so the snapshot cannot carry one — which is why this
         * card printed an em-dash for every hailed trip. The REQUESTED event
         * (seq 0) records the quote it was booked against, distance included,
         * and the event log is append-only, so it is still there when the
         * receipt is opened weeks later. The number the rider was charged for
         * is the honest one to show them.
         */
        quotedKm:
          (payload?.events ?? []).find((e: any) => e?.seq === 0)?.payload?.distanceKm ?? null,
      };
    },
    enabled: !!id,
    staleTime: 5 * 60_000,
  });
  const snapshot = ride?.snapshot ?? null;

  /**
   * One object for the render, whichever source answered.
   *
   * Shapes differ — the snapshot says `pickup.address`, the store says
   * `origin.address` — so this normalises once rather than making every field
   * below carry a two-branch chain. `originLabel`/`destinationLabel` already
   * know both shapes; distance and vehicle are named explicitly.
   */
  const selectedTrip = useMemo(() => {
    const snapDistance = ride?.quotedKm ?? (snapshot as any)?.route?.distanceKm ?? null;
    const origin = originLabel(snapshot as any) ?? originLabel(storeTrip as any);
    const destination = destinationLabel(snapshot as any) ?? destinationLabel(storeTrip as any);
    return {
      origin: origin ? { address: origin } : (storeTrip as any)?.origin ?? null,
      destination: destination ? { address: destination } : (storeTrip as any)?.destination ?? null,
      distanceKm: snapDistance ?? (storeTrip as any)?.distanceKm ?? null,
      durationMinutes: (storeTrip as any)?.durationMinutes ?? null,
      vehicle: (snapshot as any)?.vehicle ?? (storeTrip as any)?.vehicle ?? null,
      farePerSeatPesewas: (storeTrip as any)?.farePerSeatPesewas ?? null,
    };
  }, [snapshot, storeTrip, ride?.quotedKm]);

  const bookingId = paramBookingId || activeBooking?.id || '';
  const { data: receiptData } = useQuery({
    queryKey: ['receipt', bookingId],
    queryFn: () => bookingsApi.getReceipt(bookingId),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (r: any) => r.data?.data?.receipt ?? r.data?.data ?? r?.data ?? r,
    enabled: !!bookingId,
    staleTime: 60_000,
  });

  const receiptNumber = receiptData?.receiptNumber;
  const fareBreakdown = receiptData?.fareBreakdown ?? (receiptData?.totalPaidPesewas != null ? {
    total: receiptData.totalPaidPesewas,
    platformFeePesewas: receiptData.platformFeePesewas ?? 0,
    baseFarePesewas: (receiptData.totalPaidPesewas ?? 0) - (receiptData.platformFeePesewas ?? 0),
    discount: receiptData.discountAppliedPesewas ?? 0,
    surcharges: 0,
    tip: 0,
  } : undefined);

  /**
   * THE FARE, OR THE ADMISSION THAT WE DO NOT KNOW IT YET.
   *
   * BUGFIX ("I'm still seeing the 0 before it snaps to the actual price"). The
   * `?? 0` at the end of this chain is what produced it: while the receipt query
   * is in flight and the store has no booking to fall back on, every source is
   * nullish, so the screen rendered a confident "GH₵ 0.00" and then replaced it
   * a moment later. Zero is not a neutral placeholder for money — for the two
   * hundred milliseconds it is on screen it reads as "your ride was free", and
   * then as "you were just charged something you did not agree to".
   *
   * `null` here means unknown, and the render below shows a skeleton for it. The
   * zero fallback is gone rather than made conditional: there is no state in
   * which a completed ride genuinely costs nothing, so a real 0 would be a bug
   * worth seeing rather than a value worth printing.
   */
  const totalFare: number | null =
    fareBreakdown?.total ??
    activeBooking?.fareAmountPesewas ??
    activeBooking?.fare ??
    selectedTrip?.farePerSeatPesewas ??
    null;
  const fareIsKnown = typeof totalFare === 'number';
  /**
   * How many seats that total bought.
   *
   * BUGFIX. A `Receipt` row is per booking, and a rider who paid for the whole
   * group owns one booking per seat — so this screen announced one seat's fare for
   * a ride they had paid the van's price for. The server now returns the whole
   * obligation plus the seat count behind it (cancellation.service `getReceipt`);
   * saying "N seats" is what makes a bigger-than-expected total legible instead of
   * looking like an overcharge.
   */
  const fareSeatCount = fareBreakdown?.seatCount ?? 1;
  const farePerSeat = fareBreakdown?.perSeatPesewas ?? null;

  // Auto-navigate to rating after 4 s — but not when this screen was opened
  // to view an OLD completed trip's receipt from Activity (viewOnly=1). This
  // screen is also the "just finished a ride" celebration/rating funnel, so
  // without this guard, browsing a past receipt would forcibly kick the rider
  // into "rate your driver" for a ride they may have already rated.
  useEffect(() => {
    if (!id || isViewOnly) return;
    const timer = setTimeout(() => {
      if (!navigated.current) {
        navigated.current = true;
        router.push(`/ride/${id}/rate-tip${bookingId ? `?bookingId=${bookingId}` : ''}` as Href);
      }
    }, 4000);
    return () => clearTimeout(timer);
  }, [id, bookingId, router]);

  const handleRateAndTip = useCallback(() => {
    navigated.current = true;
    router.push(`/ride/${id}/rate-tip${bookingId ? `?bookingId=${bookingId}` : ''}` as Href);
  }, [router, id, bookingId]);

  /** Make + model only — never the plate. See the privacy note on the share. */
  const vehicleDisplay =
    [(selectedTrip as any)?.vehicle?.make, (selectedTrip as any)?.vehicle?.model]
      .filter(Boolean)
      .join(' ') || 'EyeGo';

  /**
   * ── A RECEIPT SOMEBODY COULD ACTUALLY EXPENSE ───────────────────────────
   *
   * BUGFIX ("the section that allows you to share the receipt just sends a
   * 4-line receipt, which is bad — you can make it a bit more filled with more
   * details that would be helpful. Don't compromise on security though").
   *
   * Four lines named the total and nothing that justifies it. Anyone sharing a
   * receipt is proving a journey to somebody — an employer, a client, a
   * housemate splitting a fare — and a bare number proves nothing.
   *
   * WHAT IS DELIBERATELY NOT IN HERE, because a shared receipt goes to people
   * outside the ride:
   *   • the driver's surname, phone number, photo or exact vehicle plate — a
   *     forwarded receipt must not become a way to find them. First name and
   *     the make/model are enough to identify the ride to the rider;
   *   • pickup and dropoff beyond the first component of each address, so a
   *     receipt shared in a group chat does not publish the rider's house;
   *   • the trip id and any share/tracking token — a live tracking link inside
   *     a receipt is a location feed with no expiry;
   *   • the rider's own name and phone.
   *
   * The receipt NUMBER is the one identifier included, because it is what
   * support asks for and it grants no access on its own.
   */
  const handleShareReceipt = useCallback(() => {
    const firstPart = (s?: string | null) => (s ? String(s).split(',')[0].trim() : null);
    const money = (p?: number | null) => (typeof p === 'number' ? formatGhs(p) : null);

    const when = receiptData?.issuedAt ?? (selectedTrip as any)?.completedAt ?? null;
    const whenText = when
      ? new Date(when).toLocaleString('en-GH', {
          weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        })
      : null;

    const journey =
      selectedTrip?.distanceKm || selectedTrip?.durationMinutes
        ? [
            selectedTrip?.distanceKm ? formatDistance(selectedTrip.distanceKm) : null,
            selectedTrip?.durationMinutes ? formatDuration(selectedTrip.durationMinutes) : null,
          ].filter(Boolean).join(' · ')
        : null;

    const lines = [
      'EYEGO — TRIP RECEIPT',
      receiptNumber ? `Receipt no.  ${receiptNumber}` : null,
      whenText ? `Date         ${whenText}` : null,
      '',
      `From         ${firstPart(selectedTrip?.origin?.address) ?? 'Pickup'}`,
      `To           ${firstPart(selectedTrip?.destination?.address) ?? 'Destination'}`,
      journey ? `Journey      ${journey}` : null,
      `Vehicle      ${vehicleDisplay}`,
      // First name only — see the note above.
      (selectedTrip as any)?.driver?.name
        ? `Driver       ${String((selectedTrip as any).driver.name).split(' ')[0]}`
        : null,
      fareSeatCount > 1 ? `Seats        ${fareSeatCount}` : null,
      '',
      '--- Fare ---',
      farePerSeat != null && fareSeatCount > 1
        ? `Per seat     ${money(farePerSeat)} × ${fareSeatCount}`
        : money(fareBreakdown?.baseFarePesewas)
          ? `Fare         ${money(fareBreakdown?.baseFarePesewas)}`
          : null,
      (fareBreakdown?.surcharges ?? 0) > 0 ? `Surcharges   ${money(fareBreakdown?.surcharges)}` : null,
      (fareBreakdown?.platformFeePesewas ?? 0) > 0
        ? `Service fee  ${money(fareBreakdown?.platformFeePesewas)}`
        : null,
      (fareBreakdown?.discount ?? 0) > 0 ? `Discount    -${money(fareBreakdown?.discount)}` : null,
      (fareBreakdown?.tip ?? 0) > 0 ? `Tip          ${money(fareBreakdown?.tip)}` : null,
      `TOTAL        ${money(totalFare) ?? '—'}`,
      (activeBooking as any)?.paymentMethod
        ? `Paid by      ${String((activeBooking as any).paymentMethod).replace(/_/g, ' ').toLowerCase()}`
        : null,
      '',
      'Thank you for riding with EyeGo.',
    ].filter((l) => l !== null);

    Share.share({ message: lines.join('\n'), title: 'EyeGo Receipt' }).catch(() => {});
  }, [receiptNumber, receiptData, totalFare, selectedTrip, fareBreakdown, farePerSeat, fareSeatCount, activeBooking, vehicleDisplay]);

  useEffect(() => { if (!id) router.back(); }, [id, router]);
  if (!id) return null;


  return (
    <SafeAreaView style={styles.safe}>
      {/* Ambient top glow */}
      <View style={[styles.topGlow, { backgroundColor: withOpacity(colors.primary, 0.06) }]} pointerEvents="none" />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Checkmark icon */}
        <MotiView
          from={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', ...springs.standard, delay: 100 }}
          style={styles.iconWrap}
        >
          <View style={styles.checkSquare}>
            <AnimatedCheckmark size={52} color={colors.primary} strokeWidth={3.5} />
          </View>
        </MotiView>

        {/* Headline */}
        <MotiView
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', ...springs.standard, delay: 200 }}
          style={styles.headlineSection}
        >
          <Text style={styles.headline}>Arrived Safely</Text>
        </MotiView>

        {/* Fare card — celebratory hero with premium green glow ring */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', ...springs.standard, delay: 300 }}
          style={styles.fareCardWrap}
        >
          <GradientGlowBorder
            colors={PREMIUM_RING_COLORS}
            locations={PREMIUM_RING_LOCATIONS}
            fillColor={colors.surfaceCard}
            borderRadius={radii['2xl']}
            glow
            glowColor={colors.primary}
            style={styles.fareCard}
          >
            <GlassSurface borderRadius={radii['2xl'] - 3} intensity="high" dark style={styles.glassInset} />
            <View style={styles.fareCardInner}>
          <Text style={styles.fareLabel}>Total Fare</Text>
          {/* A shimmer bar rather than a number we do not have yet — see the
              note on `totalFare`. Sized to the glyph box the real amount will
              occupy so the card does not resize when the receipt lands. */}
          {fareIsKnown ? (
            <Text style={styles.fareAmountPesewas}>{formatGhs(totalFare as number)}</Text>
          ) : (
            <View style={styles.fareSkeleton} />
          )}
          {fareSeatCount > 1 && (
            <Text variant="caption" color={colors.onSurfaceVariant}>
              {fareSeatCount} seats{farePerSeat != null ? ` · ${formatGhs(farePerSeat)} each` : ''}
              {(fareBreakdown?.surcharges ?? 0) > 0 ? ` + ${formatGhs(fareBreakdown?.surcharges ?? 0)} surcharges` : ''}
            </Text>
          )}

          {/* Route timeline */}
          <View style={styles.routeRow}>
            <View style={styles.routeDot} />
            <Text style={styles.routeText} numberOfLines={1}>
              {selectedTrip?.origin?.address?.split(',')[0] ?? 'Origin'}
            </Text>
          </View>
          <View style={styles.routeLine} />
          <View style={styles.routeRow}>
            <View style={[styles.routeDot, styles.routeDotDest]} />
            <Text style={styles.routeText} numberOfLines={1}>
              {selectedTrip?.destination?.address?.split(',')[0] ?? 'Destination'}
            </Text>
          </View>

          <View style={styles.fareCardDivider} />

          {/* Stats row */}
          <View style={styles.statsRow}>
            <View>
              <Text style={styles.statsLabel}>DISTANCE / TIME</Text>
              <Text style={styles.statsValue}>
                {selectedTrip?.distanceKm ? formatDistance(selectedTrip.distanceKm) : '—'}
                {selectedTrip?.durationMinutes ? ` · ${formatDuration(selectedTrip.durationMinutes)}` : ''}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.statsLabel}>VEHICLE</Text>
              <Text style={[styles.statsValue, { color: colors.primary }]}>{vehicleDisplay}</Text>
            </View>
          </View>

          {/* Receipt link */}
          {receiptNumber && (
            <Pressable onPress={handleShareReceipt} style={styles.receiptLink} accessibilityRole="button" accessibilityLabel="Share receipt">
              <Ionicons name="receipt-outline" size={13} color={colors.onSurfaceVariant} />
              <Text style={styles.receiptLinkText}>Receipt #{receiptNumber}</Text>
              <Ionicons name="share-outline" size={13} color={colors.primary} />
            </Pressable>
          )}
            </View>
          </GradientGlowBorder>
        </MotiView>

        {/* CTAs */}
        <MotiView
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', ...springs.standard, delay: 400 }}
          style={styles.ctaSection}
        >
          <Pressable style={styles.primaryBtn} onPress={handleRateAndTip} accessibilityRole="button" accessibilityLabel="Rate your driver">
            <Text style={styles.primaryBtnText}>Rate your Trip</Text>
          </Pressable>
          <Pressable style={styles.ghostBtn} onPress={() => router.replace('/(tabs)/home' as Href)} accessibilityRole="button" accessibilityLabel="Back to home">
            <Text style={styles.ghostBtnText}>Back to Home</Text>
          </Pressable>
        </MotiView>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  topGlow: {
    position: 'absolute',
    top: -200,
    left: -100,
    right: -100,
    height: 500,
    borderRadius: 250,
    zIndex: 0,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing['3xl'],
    paddingBottom: spacing['3xl'],
    alignItems: 'center',
    gap: spacing.xl,
  },
  iconWrap: { alignItems: 'center' },
  checkSquare: {
    width: 88,
    height: 88,
    borderRadius: 22,
    backgroundColor: colors.surfaceCard,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.rimLight,
  },
  headlineSection: { alignItems: 'center' },
  headline: {
    fontFamily: fonts.displayBold,
    fontSize: 28,
    lineHeight: 36,
    color: colors.onSurface,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  fareCardWrap: { width: '100%' },
  fareCard: {
    width: '100%',
    borderRadius: radii['2xl'],
    overflow: 'hidden',
  },
  glassInset: { position: 'absolute', top: 3, left: 3, right: 3, bottom: 3 },
  fareCardInner: {
    padding: spacing.xl,
    gap: spacing.md,
  },
  fareLabel: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodySmall,
    lineHeight: Math.round(fontSizes.bodySmall * 1.3),
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  fareAmountPesewas: {
    fontFamily: fonts.displayBold,
    fontSize: 40,
    lineHeight: 48,
    color: colors.onSurface,
    textAlign: 'center',
    letterSpacing: -1,
    marginBottom: spacing.sm,
  },
  /**
   * Placeholder for the fare while the receipt is still in flight. Matched to
   * `fareAmountPesewas`'s line box (48) and bottom margin so the card is exactly
   * the same height before and after the number arrives — a skeleton that
   * reflows on resolve is its own kind of flicker.
   */
  fareSkeleton: {
    height: 48,
    width: '55%',
    alignSelf: 'center',
    borderRadius: radii.md,
    backgroundColor: colors.surfaceVariant,
    opacity: 0.5,
    marginBottom: spacing.sm,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  routeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  routeDotDest: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: colors.onSurface,
  },
  routeLine: {
    width: 2,
    height: 16,
    backgroundColor: colors.rimLight,
    marginLeft: 4,
  },
  routeText: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
    lineHeight: Math.round(fontSizes.bodyMedium * 1.3),
    color: colors.onSurface,
    flex: 1,
  },
  fareCardDivider: {
    height: 1,
    backgroundColor: colors.rimLightSubtle,
    marginVertical: spacing.xs,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  statsLabel: {
    fontFamily: fonts.medium,
    fontSize: 10,
    lineHeight: 13,
    color: colors.onSurfaceVariant,
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  statsValue: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
    lineHeight: Math.round(fontSizes.bodyMedium * 1.3),
    color: colors.onSurface,
  },
  receiptLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.md,
    marginTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.rimLightSubtle,
  },
  receiptLinkText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodySmall,
    lineHeight: Math.round(fontSizes.bodySmall * 1.3),
    color: colors.onSurfaceVariant,
    flex: 1,
  },
  ctaSection: { width: '100%', gap: spacing.md },
  primaryBtn: {
    height: 56,
    borderRadius: radii.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyLarge,
    lineHeight: fontSizes.bodyLarge * 1.3,
    color: colors.onPrimary,
    letterSpacing: 0.2,
  },
  ghostBtn: {
    height: 56,
    borderRadius: radii.full,
    borderWidth: 1.5,
    borderColor: colors.rimLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyLarge,
    lineHeight: fontSizes.bodyLarge * 1.3,
    color: colors.onSurface,
    letterSpacing: 0.2,
  },
});
