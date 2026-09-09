import React, { useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useNetworkStatus } from '../../../hooks/useNetworkStatus';
import { Ionicons } from '@expo/vector-icons';
import { tripsApi, bookingsApi, paymentsApi, walletApi, apiClient } from '@eyego/api';
import { fonts, fontSizes, spacing, radii, withOpacity } from '@eyego/config';
import { formatGhs } from '@eyego/utils';
import { useColors, Colors } from '../../../utils/useColors';
import { useThemeStore } from '../../../stores/theme.store';
import { Text, Button, Pressable, AppBackground, GlassSurface, EmptyState, goBack, notify, notifySuccess } from '@eyego/ui';

/**
 * ── SCAN TO PAY, WHICH NOW MEANS WHAT IT SAYS ───────────────────────────────
 *
 * BUGFIX ("I tried the scan and pay thing and when I scanned, it opened the
 * ride instead — it opened the ride for the user to book a seat. That's
 * contradictory to scan and pay").
 *
 * It was. The scanner accepts two kinds of code — a rider's `/pay/<phone>`
 * peer-payment code and a driver's `/ride/<id>` trip code — and the trip code
 * dropped the rider on the ordinary booking screen: pick a seat, choose a
 * payment method, confirm, pay. That is a booking flow with a camera in front
 * of it, and calling it "Scan & Pay" promised a payment it never made.
 *
 * This is the payment. A driver's code identifies exactly one trip, the fare
 * for one seat on it is already known, and the rider is standing at the
 * vehicle — so there is nothing left to decide. The screen states the ride, the
 * seat, the price and the balance it will come out of, and charges once.
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *
 *   - It does not let the rider pick a seat. They are getting into a vehicle,
 *     not choosing a window seat on a coach; the first free one is the answer,
 *     and the seat map is fetched only to find it.
 *   - It does not offer a payment method. "Scan & Pay" at a vehicle means the
 *     balance the rider already holds. Cash needs no scan, and sending someone
 *     to a card sheet at the kerb is the detour this screen exists to remove.
 *   - It does not fall back to the booking screen on an empty wallet. It says
 *     the balance is short and offers a top-up, because silently reopening the
 *     old flow is how the original bug read to the user.
 */

/** Seat rows as `GET /trips/:id/seats` returns them. */
type SeatRow = { id?: string; number?: number; seatNumber?: number; status?: string };

/** The first seat nobody is on, or null when the vehicle is full. */
function firstFreeSeat(rows: SeatRow[]): { id: string; number: number } | null {
  for (const s of rows) {
    const status = String(s?.status ?? '').toUpperCase();
    if (status !== 'AVAILABLE') continue;
    const number = Number(s?.number ?? s?.seatNumber);
    if (!Number.isFinite(number) || number < 1) continue;
    // `seatId` is required by POST /bookings and the group flow already uses
    // this shape — see the booking call in ride/[id]/invite.tsx.
    return { id: String(s?.id ?? `seat-${number}`), number };
  }
  return null;
}

export default function ScanPayTripScreen() {
  const colors = useColors();
  const isDark = useThemeStore((s) => s.isDark);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState(false);

  const { isOffline } = useNetworkStatus();
  const tripQ = useQuery({
    queryKey: ['trip', id],
    queryFn: async () => (await tripsApi.getById(String(id))).data?.data,
    enabled: !!id,
  });

  const seatsQ = useQuery({
    queryKey: ['seats', id],
    queryFn: async () => {
      const res = await apiClient.get<any>(`/trips/${id}/seats`);
      const body = res.data?.data ?? res.data;
      return (body?.seats ?? []) as SeatRow[];
    },
    enabled: !!id,
  });

  const walletQ = useQuery({
    queryKey: ['wallet', 'balance'],
    queryFn: async () => (await walletApi.getBalance()).data?.data,
  });

  const trip = tripQ.data as any;
  const seat = useMemo(() => firstFreeSeat(seatsQ.data ?? []), [seatsQ.data]);

  /**
   * One seat's fare.
   *
   * `farePerSeatPesewas` is the trip's own per-seat price. The fallback exists
   * because search payloads do not always join it, and a screen that renders
   * `NaN` next to a Pay button is worse than one that says it cannot price the
   * ride — see the guard on `canPay`.
   */
  const farePesewas: number | null = Number.isFinite(Number(trip?.farePerSeatPesewas))
    ? Number(trip.farePerSeatPesewas)
    : Number.isFinite(Number(trip?.baseFarePesewas))
      ? Number(trip.baseFarePesewas)
      : null;

  const balancePesewas = Number(walletQ.data?.balancePesewas ?? 0);
  const shortBy = farePesewas != null ? farePesewas - balancePesewas : 0;
  const canAfford = farePesewas != null && balancePesewas >= farePesewas;
  const loading = tripQ.isLoading || seatsQ.isLoading || walletQ.isLoading;

  const driverName = trip?.driver?.name ?? 'Your driver';
  const vehicle = trip?.vehicle
    ? [trip.vehicle.make, trip.vehicle.model].filter(Boolean).join(' ')
    : null;
  const plate = trip?.vehicle?.plateNumber ?? null;

  async function pay() {
    if (!id || !seat || farePesewas == null || paying) return;
    setPaying(true);
    try {
      const { data } = await bookingsApi.create({
        tripId: String(id),
        seatId: seat.id,
        seatNumber: seat.number,
        paymentMethod: 'WALLET',
      });
      /**
       * POST /bookings answers `{ booking, fareData, holdExpiry }`, NOT the
       * booking. Reading the wrapper as the booking is the exact mistake that
       * produced "validation failed" on the cash flow and left `bookingId` as
       * an empty string — see the note at the payment screen's own create call.
       */
      const payload = (data as any)?.data ?? data;
      const bookingId = payload?.booking?.id ?? payload?.id;
      if (!bookingId) throw new Error('The booking came back without an id, so there is nothing to charge.');

      await paymentsApi.initialize({ bookingId, method: 'WALLET' } as any);

      setPaid(true);
      notifySuccess(`Seat ${seat.number} is yours.`, 'Paid');
      // Straight to the ride they just paid for. `replace` so Back does not
      // return them to a Pay button that would charge a second seat.
      router.replace({ pathname: '/ride/[id]', params: { id: String(id) } } as any);
    } catch (e: any) {
      const msg =
        e?.response?.data?.message ??
        e?.message ??
        'That payment did not go through.';
      // `notify` defaults to the error tone — see notice.ts.
      notify("Couldn't pay", String(msg));
    } finally {
      setPaying(false);
    }
  }

  return (
    <View style={styles.root}>
      <AppBackground isDark={isDark} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable onPress={() => goBack()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={22} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.headerTitle}>Pay for your seat</Text>
          <View style={{ width: 22 }} />
        </View>

        {loading ? (
          <View style={styles.centre}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.muted}>Reading the code…</Text>
          </View>
        ) : tripQ.isError ? (
          /*
            "THAT CODE HAS EXPIRED" WAS BEING SAID TO A RIDER WITH A VALID CODE.
            `!trip` was true on a FAILED request as well as on a genuinely dead
            trip, so a dropped connection told a rider standing in front of a
            driver that the driver's code was no good — a specific, confident,
            wrong accusation, at the one moment they cannot afford it.
            The request failing and the trip being over are different facts.
          */
          <View style={styles.centre}>
            <EmptyState
              icon={isOffline ? 'cloud-offline-outline' : 'alert-circle-outline'}
              title={isOffline ? "You're offline" : "Couldn't read that code"}
              subtitle={
                isOffline
                  ? "The code is probably fine — we just can't reach the server. Try again when you have signal."
                  : 'Something went wrong on our side. The code is probably fine — try again.'
              }
              action={{ label: 'Try again', onPress: () => void tripQ.refetch() }}
            />
          </View>
        ) : !trip ? (
          <View style={styles.centre}>
            <EmptyState
              icon="qr-code-outline"
              title="That code has expired"
              subtitle="The trip this code points at is no longer taking passengers. Ask the driver for a fresh code."
            />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.body}>
            {/* Who and what — the rider is standing in front of this vehicle
                and the first job of the screen is to confirm it is the right
                one before it charges them. */}
            <View style={styles.card}>
              <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii.xl} intensity="high" />
              <View style={styles.rowBetween}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.driver}>{driverName}</Text>
                  {!!vehicle && <Text style={styles.muted}>{vehicle}{plate ? ` · ${plate}` : ''}</Text>}
                </View>
                <View style={styles.seatChip}>
                  <Ionicons name="person" size={13} color={colors.primary} />
                  <Text style={styles.seatChipText}>
                    {seat ? `Seat ${seat.number}` : 'Full'}
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.card}>
              <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii.xl} intensity="high" />
              <View style={styles.rowBetween}>
                <Text style={styles.label}>1 seat</Text>
                <Text style={styles.amount}>
                  {farePesewas != null ? formatGhs(farePesewas) : '—'}
                </Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.rowBetween}>
                <Text style={styles.label}>Wallet balance</Text>
                <Text style={[styles.label, !canAfford && { color: colors.statusError }]}>
                  {formatGhs(balancePesewas)}
                </Text>
              </View>
            </View>

            {!seat && (
              <Text style={styles.warn}>
                Every seat on this trip is taken. Nothing has been charged.
              </Text>
            )}

            {seat && farePesewas == null && (
              <Text style={styles.warn}>
                This trip has no per-seat price, so there is nothing to charge. Book it from the ride
                screen instead.
              </Text>
            )}

            {seat && farePesewas != null && !canAfford && (
              <Text style={styles.warn}>
                You need {formatGhs(Math.max(0, shortBy))} more to cover this seat.
              </Text>
            )}
          </ScrollView>
        )}

        {!loading && !!trip && (
          <View style={styles.footer}>
            {seat && farePesewas != null && canAfford ? (
              <Button
                label={paid ? 'Paid' : `Pay ${formatGhs(farePesewas)}`}
                variant="primary"
                fullWidth
                onPress={pay}
                loading={paying}
                disabled={paying || paid}
                accessibilityLabel={`Pay ${formatGhs(farePesewas)} for seat ${seat.number}`}
              />
            ) : seat && farePesewas != null ? (
              <Button
                label="Top up wallet"
                variant="primary"
                fullWidth
                onPress={() => router.push('/profile/wallet' as any)}
                accessibilityLabel="Top up your wallet"
              />
            ) : (
              <Button label="Close" variant="secondary" fullWidth onPress={() => goBack()} />
            )}
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.backgroundDeep },
    safe: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.sm,
    },
    headerTitle: { fontFamily: fonts.semiBold, fontSize: fontSizes.titleMedium, color: colors.onSurface },
    centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg },
    body: { padding: spacing.base, gap: spacing.base },
    card: {
      borderRadius: radii.xl,
      overflow: 'hidden',
      padding: spacing.base,
      gap: spacing.sm,
    },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    driver: { fontFamily: fonts.semiBold, fontSize: fontSizes.titleMedium, color: colors.onSurface },
    muted: { fontFamily: fonts.regular, fontSize: fontSizes.bodyMedium, color: colors.onSurfaceVariant },
    label: { fontFamily: fonts.medium, fontSize: fontSizes.bodyLarge, color: colors.onSurface },
    amount: { fontFamily: fonts.displaySemiBold, fontSize: fontSizes.fareSmall, color: colors.onSurface },
    divider: { height: 1, backgroundColor: withOpacity(colors.onSurface, 0.08) },
    seatChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: spacing.sm,
      paddingVertical: 5,
      borderRadius: radii.full,
      backgroundColor: withOpacity(colors.primary, 0.14),
    },
    seatChipText: { fontFamily: fonts.semiBold, fontSize: fontSizes.caption, color: colors.primary },
    warn: {
      fontFamily: fonts.regular,
      fontSize: fontSizes.bodyMedium,
      color: colors.statusError,
      paddingHorizontal: spacing.xs,
    },
    footer: { padding: spacing.base, gap: spacing.sm },
  });
