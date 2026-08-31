import React, { useCallback, useRef, useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { MotiView, goDeeper, goBack } from '@eyego/ui';
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
    const snap = snapshot as any;
    /**
     * DISTANCE, FROM WHICHEVER SOURCE ACTUALLY HAS IT.
     *
     * BUGFIX ("on the trip complete page before the rate driver page, it doesn't
     * seem to be consistent — I can see dashes and it's very minimal").
     *
     * The chain stopped at `quotedKm` and `route.distanceKm`. `quotedKm` is read
     * off the REQUESTED event, which only exists for a hailed ride; `route` only
     * exists for a group/bus one. A ride that had been dispatched from the map
     * without a stored quote had neither, so the stats row printed an em-dash on
     * the one screen whose whole job is to account for the trip.
     *
     * `path.distanceKm` is the road geometry the ride was actually driven along,
     * which is present for every product and is the most honest of the three.
     */
    const snapDistance =
      ride?.quotedKm ??
      (typeof snap?.path?.distanceKm === 'number' ? snap.path.distanceKm : null) ??
      snap?.route?.distanceKm ??
      null;

    /**
     * DURATION — THE RIDE THAT HAPPENED, NOT THE ONE THAT WAS ESTIMATED.
     *
     * This only ever read `storeTrip.durationMinutes`, a field populated by the
     * GROUP flow's trip picker. An on-demand rider never touches that picker, so
     * for the primary product it was null on every single receipt and the value
     * beside the distance was permanently blank.
     *
     * The snapshot carries the real timestamps. Wall-clock between departure and
     * completion is what the rider experienced, so it is what the receipt should
     * state; the routed estimate is the fallback for a trip whose departure was
     * never stamped.
     */
    const departedAt = snap?.timestamps?.departedAt ? new Date(snap.timestamps.departedAt).getTime() : null;
    const completedAt = snap?.timestamps?.completedAt ? new Date(snap.timestamps.completedAt).getTime() : null;
    const elapsedMin =
      departedAt && completedAt && completedAt > departedAt
        ? Math.max(1, Math.round((completedAt - departedAt) / 60000))
        : null;

    const origin = originLabel(snap) ?? originLabel(storeTrip as any);
    const destination = destinationLabel(snap) ?? destinationLabel(storeTrip as any);
    return {
      origin: origin ? { address: origin } : (storeTrip as any)?.origin ?? null,
      destination: destination ? { address: destination } : (storeTrip as any)?.destination ?? null,
      distanceKm: snapDistance ?? (storeTrip as any)?.distanceKm ?? null,
      durationMinutes:
        elapsedMin ??
        (typeof snap?.path?.durationMin === 'number' ? Math.round(snap.path.durationMin) : null) ??
        (storeTrip as any)?.durationMinutes ??
        null,
      vehicle: snap?.vehicle ?? (storeTrip as any)?.vehicle ?? null,
      driver: snap?.driver ?? (storeTrip as any)?.driver ?? null,
      farePerSeatPesewas: (storeTrip as any)?.farePerSeatPesewas ?? null,
      /** Whichever of the two ends of the ride we can date the receipt from. */
      completedAt: snap?.timestamps?.completedAt ?? null,
      paymentMethod: snap?.fare?.paymentMethod ?? null,
      tier: snap?.tier ?? null,
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
    /**
     * The snapshot's own figure, ahead of the in-memory store.
     *
     * `fare.amountPesewas` is what this rider owes for this ride, summed across
     * every seat they are paying for, and it is on every snapshot. A receipt row
     * is generated asynchronously after completion, so for the first seconds on
     * this screen — which is most of the time anyone spends on it, given the 4 s
     * auto-advance — the receipt query is still in flight and this is the only
     * real number available. Without it the card showed a skeleton for its
     * headline and then, for a group flow, a per-seat price that disagreed with
     * the total once the receipt landed.
     */
    ((snapshot as any)?.fare?.amountPesewas as number | undefined) ??
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
  const fareSeatCount = fareBreakdown?.seatCount ?? (snapshot as any)?.fare?.seatsPaidFor ?? 1;
  const farePerSeat = fareBreakdown?.perSeatPesewas ?? (snapshot as any)?.fare?.perSeatPesewas ?? null;

  /**
   * ── THE LINES, AS THE SERVER ADDED THEM UP ─────────────────────────────────
   *
   * The old card showed a total and nothing else, which is what "it's very
   * minimal" is about: a receipt that states a figure and cannot account for it
   * is a number, not a receipt. Each of these is already on the snapshot's
   * `fare` block or on the generated receipt; none is computed here, and a line
   * with nothing behind it is dropped rather than shown as a zero.
   */
  const fareLines = useMemo(() => {
    const snapFare = (snapshot as any)?.fare ?? {};
    const n = (v: unknown) => (typeof v === 'number' && v > 0 ? v : 0);
    const rows: { label: string; value: string; accent?: boolean }[] = [];

    if (farePerSeat != null && fareSeatCount > 1) {
      rows.push({ label: `Seats (× ${fareSeatCount})`, value: formatGhs(farePerSeat * fareSeatCount) });
    } else if (n(fareBreakdown?.baseFarePesewas)) {
      rows.push({ label: 'Ride', value: formatGhs(fareBreakdown!.baseFarePesewas) });
    }

    const cargo = n(snapFare.cargoSurchargePesewas);
    if (cargo) rows.push({ label: 'Heavy cargo', value: formatGhs(cargo) });

    const deviation = n(snapFare.deviationSurchargePesewas);
    if (deviation) rows.push({ label: 'Pickup detour', value: formatGhs(deviation) });

    const surcharges = n(fareBreakdown?.surcharges);
    if (surcharges && !cargo && !deviation) {
      rows.push({ label: 'Surcharges', value: formatGhs(surcharges) });
    }

    const fee = n(fareBreakdown?.platformFeePesewas);
    if (fee) rows.push({ label: 'Service fee', value: formatGhs(fee) });

    const discount = n(fareBreakdown?.discount);
    if (discount) rows.push({ label: 'Discount', value: `− ${formatGhs(discount)}`, accent: true });

    const tip = n(fareBreakdown?.tip);
    if (tip) rows.push({ label: 'Tip', value: formatGhs(tip), accent: true });

    return rows;
  }, [snapshot, fareBreakdown, farePerSeat, fareSeatCount]);

  /** "Paid by mobile money" — sentence case, never the wire's SCREAMING_SNAKE. */
  const paymentLabel = useMemo(() => {
    const raw =
      selectedTrip?.paymentMethod ??
      (activeBooking as any)?.paymentMethod ??
      null;
    if (!raw) return null;
    const words = String(raw).replace(/_/g, ' ').toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }, [selectedTrip?.paymentMethod, activeBooking]);

  /** The day the ride ended, for the receipt's own dateline. */
  const completedLabel = useMemo(() => {
    const when = selectedTrip?.completedAt ?? receiptData?.issuedAt ?? null;
    if (!when) return null;
    const d = new Date(when);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString('en-GH', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  }, [selectedTrip?.completedAt, receiptData?.issuedAt]);

  // Auto-navigate to rating after 4 s — but not when this screen was opened
  // to view an OLD completed trip's receipt from Activity (viewOnly=1). This
  // screen is also the "just finished a ride" celebration/rating funnel, so
  // without this guard, browsing a past receipt would forcibly kick the rider
  // into "rate your driver" for a ride they may have already rated.
  /**
   * A READER IS NOT AN IDLE USER.
   *
   * The card now carries the itemised fare, the journey and the receipt number,
   * and four seconds is not enough to read any of it — the screen would snatch
   * itself away mid-sentence, which is its own kind of "not consistent". Eight
   * seconds is the unattended default, and touching the page at all cancels the
   * advance entirely: a rider who is reading their receipt has said what they
   * want, and the Rate button is right there when they are done.
   */
  const [autoAdvance, setAutoAdvance] = useState(true);
  useEffect(() => {
    if (!id || isViewOnly || !autoAdvance) return;
    const timer = setTimeout(() => {
      if (!navigated.current) {
        navigated.current = true;
        goDeeper(`/ride/${id}/rate-tip${bookingId ? `?bookingId=${bookingId}` : ''}` as Href);
      }
    }, 8000);
    return () => clearTimeout(timer);
  }, [id, bookingId, router, isViewOnly, autoAdvance]);

  const handleRateAndTip = useCallback(() => {
    navigated.current = true;
    goDeeper(`/ride/${id}/rate-tip${bookingId ? `?bookingId=${bookingId}` : ''}` as Href);
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
    /**
     * THE PLACE, ON A RECEIPT SOMEBODY ELSE WILL READ.
     *
     * BUGFIX — "on the receipt section of the rider app, when I choose to share
     * it and view the content, it shows that the destination was Home and not
     * the actual street name."
     *
     * This was `split(',')[0]` — the FIRST segment only. That is right for a
     * geocoded address ("Oxford Street, Osu, Accra" → "Oxford Street") and
     * exactly wrong for a saved place, because `placeLabel` composes those as
     * "<your name for it>, <the real address>". So the one segment it kept was
     * the rider's private alias and the one it threw away was the street — a
     * receipt that reads "To: Home" proves nothing to the person it was sent to,
     * which is the entire reason anyone shares one.
     *
     * Two segments, not one. A saved place keeps its alias AND gains its street;
     * a plain address gains its neighbourhood. Still short of the full string,
     * so the privacy note above still holds: this publishes a street, never a
     * house number and a city and a country.
     */
    const firstPart = (s?: string | null) =>
      s
        ? String(s)
            .split(',')
            .slice(0, 2)
            .map((t) => t.trim())
            .filter(Boolean)
            .join(', ') || null
        : null;
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

  useEffect(() => { if (!id) goBack(); }, [id, router]);
  if (!id) return null;


  return (
    <SafeAreaView style={styles.safe}>
      {/* Ambient top glow */}
      <View style={[styles.topGlow, { backgroundColor: withOpacity(colors.primary, 0.06) }]} pointerEvents="none" />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        // Any touch means the rider is reading — see `autoAdvance`.
        onScrollBeginDrag={() => setAutoAdvance(false)}
        onTouchStart={() => setAutoAdvance(false)}
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

          {/**
            * ── THE JOURNEY, AS A SPINE ────────────────────────────────────────
            *
            * The addresses were truncated at the first comma, which on a Ghanaian
            * address is often the whole useful part ("Ring Road East, Accra" kept
            * only "Ring Road East" — fine; "Shop 4, Oxford Street" kept "Shop 4").
            * Two lines each, full label, so a receipt names the places it is a
            * receipt for. The rail beside them is what turns two lines of text
            * into a trip that went from one to the other.
            */}
          <View style={styles.spine}>
            <View style={styles.spineRail}>
              <View style={styles.spineDot} />
              <View style={styles.spineLine} />
              <View style={[styles.spineDot, styles.spineDotDest]} />
            </View>
            <View style={styles.spineBody}>
              <View>
                <Text style={styles.spineLabel}>PICKED UP</Text>
                <Text style={styles.spineText} numberOfLines={2}>
                  {selectedTrip?.origin?.address ?? 'Your pickup point'}
                </Text>
              </View>
              <View style={styles.spineDrop}>
                <Text style={styles.spineLabel}>DROPPED OFF</Text>
                <Text style={styles.spineText} numberOfLines={2}>
                  {selectedTrip?.destination?.address ?? 'Your destination'}
                </Text>
              </View>
            </View>
          </View>

          {/**
            * ── THREE FACTS, NOT TWO AND A DASH ────────────────────────────────
            *
            * "DISTANCE / TIME" packed two values into one cell joined by a
            * slash, so when either was missing the cell read as a bare em-dash
            * and the other half vanished with it. Separate cells fail
            * separately: an unknown duration no longer erases a known distance.
            *
            * Each cell also hides itself when it has nothing, so the strip is
            * always full of real numbers rather than padded with placeholders —
            * which is the actual answer to "I can see dashes".
            */}
          <View style={styles.statsStrip}>
            {selectedTrip?.distanceKm ? (
              <Stat label="DISTANCE" value={formatDistance(selectedTrip.distanceKm)} styles={styles} />
            ) : null}
            {selectedTrip?.durationMinutes ? (
              <Stat label="DURATION" value={formatDuration(selectedTrip.durationMinutes)} styles={styles} />
            ) : null}
            <Stat label="VEHICLE" value={vehicleDisplay} styles={styles} accent={colors.primary} />
          </View>

          {/* The lines behind the total. See `fareLines`. */}
          {fareLines.length > 0 && (
            <View style={styles.lines}>
              {fareLines.map((row) => (
                <View key={row.label} style={styles.lineRow}>
                  <Text style={styles.lineLabel}>{row.label}</Text>
                  <Text style={[styles.lineValue, row.accent && { color: colors.primary }]}>
                    {row.value}
                  </Text>
                </View>
              ))}
              <View style={[styles.lineRow, styles.lineTotal]}>
                <Text style={styles.lineTotalLabel}>Total paid</Text>
                <Text style={styles.lineTotalValue}>
                  {fareIsKnown ? formatGhs(totalFare as number) : '…'}
                </Text>
              </View>
            </View>
          )}

          {/* Who drove it and how it was settled — the two things a rider looks
              for on a receipt after the amount. Each is omitted rather than
              placeholdered when unknown. */}
          {(selectedTrip?.driver?.name || paymentLabel || completedLabel) && (
            <View style={styles.footRow}>
              {selectedTrip?.driver?.name ? (
                <View style={styles.footItem}>
                  <Ionicons name="person-circle-outline" size={14} color={colors.onSurfaceVariant} />
                  {/* First name only — the same privacy rule as the share text. */}
                  <Text style={styles.footText} numberOfLines={1}>
                    {String(selectedTrip.driver.name).split(' ')[0]}
                  </Text>
                </View>
              ) : null}
              {paymentLabel ? (
                <View style={styles.footItem}>
                  <Ionicons name="card-outline" size={14} color={colors.onSurfaceVariant} />
                  <Text style={styles.footText} numberOfLines={1}>{paymentLabel}</Text>
                </View>
              ) : null}
              {completedLabel ? (
                <View style={styles.footItem}>
                  <Ionicons name="time-outline" size={14} color={colors.onSurfaceVariant} />
                  <Text style={styles.footText} numberOfLines={1}>{completedLabel}</Text>
                </View>
              ) : null}
            </View>
          )}

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

/**
 * One cell of the stats strip.
 *
 * Local and deliberately dumb: three cells with identical structure line up on
 * the baseline, which three hand-written blocks did not. A cell is only rendered
 * when its caller has a value, so this never has to decide what to print for
 * "unknown" — the answer is that the cell is absent.
 */
function Stat({
  label,
  value,
  styles,
  accent,
}: {
  label: string;
  value: string;
  styles: ReturnType<typeof makeStyles>;
  accent?: string;
}) {
  return (
    <View style={styles.statCell} accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, accent ? { color: accent } : null]} numberOfLines={1}>
        {value}
      </Text>
    </View>
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
  /** The journey rail. Aligned to the first line of text, not to the block. */
  spine: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs },
  spineRail: { width: 12, alignItems: 'center', paddingTop: 18 },
  spineDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary },
  spineDotDest: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: colors.onSurface,
  },
  spineLine: {
    width: 1.5,
    flex: 1,
    minHeight: 28,
    marginVertical: 5,
    borderRadius: 1,
    backgroundColor: colors.rimLight,
  },
  spineBody: { flex: 1 },
  spineDrop: { marginTop: spacing.base },
  spineLabel: {
    fontFamily: fonts.medium,
    fontSize: 9.5,
    lineHeight: 13,
    letterSpacing: 1,
    color: colors.onSurfaceVariant,
  },
  spineText: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
    lineHeight: Math.round(fontSizes.bodyMedium * 1.35),
    color: colors.onSurface,
    marginTop: 2,
  },

  /** The stats strip — an inset tray, one radius step in from the card. */
  statsStrip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceContainerHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rimLightSubtle,
    marginTop: spacing.xs,
  },
  statCell: { flex: 1, gap: 3 },
  statLabel: {
    fontFamily: fonts.medium,
    fontSize: 9.5,
    lineHeight: 13,
    color: colors.onSurfaceVariant,
    letterSpacing: 0.9,
  },
  statValue: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
    lineHeight: Math.round(fontSizes.bodyMedium * 1.3),
    color: colors.onSurface,
    // Figures must not shift width between renders as the receipt resolves.
    fontVariant: ['tabular-nums'],
  },

  /** The itemisation. Rows, then a ruled total. */
  lines: { gap: spacing.sm, marginTop: spacing.xs },
  lineRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  lineLabel: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodySmall,
    lineHeight: Math.round(fontSizes.bodySmall * 1.35),
    color: colors.onSurfaceVariant,
    flexShrink: 1,
  },
  lineValue: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodySmall,
    lineHeight: Math.round(fontSizes.bodySmall * 1.35),
    color: colors.onSurface,
    fontVariant: ['tabular-nums'],
  },
  lineTotal: {
    marginTop: spacing.xs,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.rimLightSubtle,
  },
  lineTotalLabel: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
    lineHeight: Math.round(fontSizes.bodyMedium * 1.3),
    color: colors.onSurface,
  },
  lineTotalValue: {
    fontFamily: fonts.displayBold,
    fontSize: fontSizes.titleSmall,
    lineHeight: Math.round(fontSizes.titleSmall * 1.25),
    color: colors.onSurface,
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },

  /** Driver, payment, time — quiet metadata, wrapping rather than truncating. */
  footRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  footItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  footText: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.caption,
    lineHeight: 16,
    color: colors.onSurfaceVariant,
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
