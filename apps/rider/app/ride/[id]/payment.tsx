import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  BackHandler,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { WebView } from 'react-native-webview';
import { useMutation } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { bookingsApi, paymentsApi, socketEvents, walletApi } from '@eyego/api';
import * as Haptics from 'expo-haptics';
import { useRideStore } from '../../../stores/ride.store';
import { useAuthStore } from '../../../stores/auth.store';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../../utils/useColors';
import { Text, Button, AnimatedFareText } from '@eyego/ui';
import { formatCurrency } from '@eyego/utils';
import { captureException } from '../../../lib/sentry';

type PaymentTab = 'momo' | 'card' | 'cash' | 'wallet';

export default function PaymentScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id, pickupStopId } = useLocalSearchParams<{ id: string; pickupStopId?: string }>();
  const router = useRouter();
  const { selectedTrip, selectedSeat, activeBooking, computedFare, setActiveBooking, setComputedFare, pendingPromoCode, setPendingPromoCode, guestInfo, setGuestInfo } = useRideStore();
  const { user } = useAuthStore();

  const [activeTab, setActiveTab] = useState<PaymentTab>('momo');
  const [momoPhone, setMomoPhone] = useState('');
  const [walletBalance, setWalletBalance] = useState(0);
  const [walletLoading, setWalletLoading] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [paymentRef, setPaymentRef] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const MAX_POLL_ATTEMPTS = 30; // ~60s timeout at 2s intervals
  // Stable idempotency key for the current payment attempt; cleared when the
  // rider switches payment method (which starts a genuinely new attempt).
  // BUGFIX: Removed Date.now() from key — idempotency must be STABLE per attempt so
  // retries collapse to a single charge on the server. Date.now() made each retry unique.
  const idempotencyKeyRef = useRef<string | null>(null);
  // Double-submit lock: prevents initPayment.mutate() from running twice in rapid succession
  const isSubmittingRef = useRef(false);
  // Mounted guard: prevents state updates and navigation on unmounted component
  const isMountedRef = useRef(true);
  const pendingTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [status, setStatus] = useState<'idle' | 'processing' | 'success' | 'failed'>('idle');
  const [promoExpanded, setPromoExpanded] = useState(false);
  const [promoInput, setPromoInput] = useState('');
  const [promoStatus, setPromoStatus] = useState<'idle' | 'applied'>('idle');

  // Cleanup on unmount: mark unmounted, reset submit lock, cancel all pending navigation timeouts
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      isSubmittingRef.current = false;
      pendingTimeoutsRef.current.forEach(clearTimeout);
      pendingTimeoutsRef.current = [];
    };
  }, []);

  // Android back button: dismiss WebView instead of navigating back in the app
  useEffect(() => {
    if (!checkoutUrl) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setCheckoutUrl(null);
      return true;
    });
    return () => sub.remove();
  }, [checkoutUrl]);

  // Switching method starts a new payment attempt → new idempotency key.
  useEffect(() => {
    idempotencyKeyRef.current = null;
  }, [activeTab]);

  // Fetch wallet balance on mount when wallet tab is active
  useEffect(() => {
    if (activeTab === 'wallet') {
      setWalletLoading(true);
      walletApi.getBalance().then((res: { data?: { data?: { balance?: number }; balance?: number } }) => {
        const bal = res?.data?.data?.balance ?? res?.data?.balance ?? 0;
        setWalletBalance(bal);
      }).catch((err: any) => {
        console.warn('[Payment] Failed to fetch wallet balance:', err?.message ?? err);
      }).finally(() => setWalletLoading(false));
    }
  }, [activeTab]);

  // Fare is server-calculated. Order: booking.fareAmount → Zustand computedFare →
  // trip.farePerSeat. Never compute on the client — env-driven rates on the
  // server are the only source of truth. booking.fareAmount already reflects any
  // en-route discount, so we never need a client-side adjustment here.
  const serverPerSeat =
    activeBooking?.fareAmount ??
    computedFare ??
    selectedTrip?.farePerSeat ??
    0;
  const enRouteRatio: number | null = (activeBooking as { enRouteRatio?: number })?.enRouteRatio ?? null;
  const enRouteStopName: string | null = (activeBooking as { pickupStop?: { name?: string } })?.pickupStop?.name ?? null;
  const cargoSurcharge = (selectedTrip as { heavyCargo?: boolean })?.heavyCargo ? 10.0 : 0.0;
  // "Paying for everyone" means this rider covers the *entire* trip cost — not perSeat × group size.
  // The server attaches `totalTripCost` to trip detail / group hub responses for this exact purpose.
  const payForEveryone = !!(selectedTrip as { payForEveryone?: boolean })?.payForEveryone;
  const totalTripCost = (selectedTrip as { totalTripCost?: number })?.totalTripCost ?? null;
  const baseFare = serverPerSeat;
  const fareAmount = payForEveryone && totalTripCost
    ? totalTripCost + cargoSurcharge
    : serverPerSeat + cargoSurcharge;

  // Free a SEAT_HELD booking immediately on a hard payment failure instead of
  // waiting up to ~15 min for the server seat-hold sweep. Best-effort and
  // idempotent: the backend cancelBooking refuses PAID bookings and re-setting
  // CANCELLED is a no-op, so this is safe to race against the sweep.
  const releaseHeldSeat = async () => {
    const heldId = activeBooking?.id;
    if (!heldId) return;
    // Never release a booking that already succeeded.
    if (status === 'success') return;
    try {
      await bookingsApi.cancel(heldId);
      if (isMountedRef.current) setActiveBooking(null);
    } catch (e) {
      // Non-blocking — the seat-hold sweep is the backstop if this fails.
      console.warn('[Payment] Failed to release held seat:', (e as any)?.message ?? e);
    }
  };

  const initPayment = useMutation({
    mutationFn: async () => {
      // Declare outside try so the catch block can use the value even if booking was created before the error
      let bookingId = activeBooking?.id ?? '';
      try {
        // BUGFIX: Double-submit lock — prevent concurrent mutations
        if (isSubmittingRef.current) {
          throw new Error('Payment already in progress');
        }
        if (!bookingId && id && selectedSeat) {
          const { data: bookingData } = await bookingsApi.create({
            tripId: id,
            seatId: selectedSeat.id,
            seatNumber: selectedSeat.number,
            paymentMethod: (activeTab === 'momo' ? 'MOMO' : activeTab === 'cash' ? 'CASH' : activeTab === 'wallet' ? 'WALLET' : 'CARD') as 'MOMO' | 'CARD' | 'WALLET',
            ...(pickupStopId ? { pickupStopId } : {}),
            ...(guestInfo ? { guestName: guestInfo.name, guestPhone: guestInfo.phone } : {}),
          });
          const newBooking = bookingData.data;
          bookingId = newBooking.id ?? '';
          // Store booking and server-calculated fare in Zustand so tracking/rating screens have them
          setActiveBooking(newBooking);
          if (newBooking.fareAmount) setComputedFare(newBooking.fareAmount);
        }

        if (bookingId && pendingPromoCode) {
          try {
            await bookingsApi.applyPromo(bookingId, pendingPromoCode);
          } catch {
            // non-blocking
          }
          setPendingPromoCode(null);
        }

        // Cash is collected in-person — no payment gateway initiation needed.
        // Booking already exists; navigate directly to tracking.
        if (activeTab === 'cash') {
          return { requiresVerification: false, bookingId, reference: null };
        }

        // One idempotency key per booking+method attempt — a retry of this exact
        // attempt collapses to a single charge on the server.
        // BUGFIX: Removed Date.now() from key format. A stable key (bookingId + method)
        // ensures retries are idempotent. Date.now() made every attempt unique.
        if (!idempotencyKeyRef.current) {
          idempotencyKeyRef.current = `pay_${bookingId}_${activeTab}`;
        }
        const { data } = await paymentsApi.initialize(
          {
            bookingId,
            method: ((activeTab as string) === 'momo' ? 'MOMO' : (activeTab as string) === 'cash' ? 'CASH' : (activeTab as string) === 'wallet' ? 'WALLET' : 'CARD') as 'MOMO' | 'CARD' | 'WALLET',
            momoPhone: activeTab === 'momo' ? `+233${momoPhone.replace(/\D/g, '')}` : undefined,
            // Paystack requires a real email for the card receipt. Use the
            // signed-in user's email — the card path is guarded below so this is
            // never undefined when activeTab === 'card'.
            email: activeTab === 'card' ? (user?.email ?? undefined) : undefined,
          },
          idempotencyKeyRef.current,
        );
        // No mock fallback: a failure here propagates to onError and the rider
        // sees a real error instead of a fake confirmation.
        return { ...data.data, bookingId };
      } catch (e) {
        captureException(e, { screen: 'payment', method: activeTab, bookingId });
        throw e;
      }
    },
    onSuccess: async (data: any) => {
      if (!isMountedRef.current) return;
      isSubmittingRef.current = false;
      setPaymentRef(data.reference);

      // Wallet & Cash are confirmed synchronously by the server — no polling.
      if (data.requiresVerification === false) {
        setStatus('success');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        walletApi.getBalance().catch(() => {});
        setGuestInfo(null); // clear guest info after successful booking
        socketEvents.emitPaymentConfirmed(data.bookingId ?? activeBooking?.id ?? '', id ?? '');
        const t = setTimeout(() => { if (isMountedRef.current) router.replace(`/ride/${id}/tracking` as any); }, 1500);
        pendingTimeoutsRef.current.push(t);
        return;
      }

      // Card → open Paystack hosted checkout in a WebView.
      if (activeTab === 'card' && data.authorizationUrl) {
        setCheckoutUrl(data.authorizationUrl);
        return;
      }

      // MoMo → the rider approves on their phone; confirmation arrives via the
      // Paystack webhook. Poll the verify endpoint until the booking is PAID.
      setIsPolling(true);
      setStatus('processing');
      try {
        await paymentsApi.pollStatus(data.reference, 2000, MAX_POLL_ATTEMPTS);
        if (!isMountedRef.current) return;
        setIsPolling(false);
        setStatus('success');
        setGuestInfo(null); // clear guest info after successful booking
        socketEvents.emitPaymentConfirmed(data.bookingId ?? activeBooking?.id ?? '', id ?? '');
        const t = setTimeout(() => { if (isMountedRef.current) router.replace(`/ride/${id}/tracking` as any); }, 1500);
        pendingTimeoutsRef.current.push(t);
      } catch (err) {
        if (!isMountedRef.current) return;
        setIsPolling(false);
        setStatus('idle');
        Alert.alert(
          'Payment Not Confirmed',
          'We could not confirm your payment. Please approve the prompt on your phone and try again.',
          [{ text: 'OK' }]
        );
      }
    },
    onError: (err: any) => {
      if (!isMountedRef.current) return;
      isSubmittingRef.current = false;
      setStatus('idle');
      // A genuine init failure created (or left) a SEAT_HELD booking — release it
      // now so the seat is freed immediately rather than after the sweep.
      void releaseHeldSeat();
      const errorMsg = err?.response?.data?.message || err?.message || 'Payment could not be processed. Please try again.';
      Alert.alert('Payment Failed', errorMsg);
    },
  });

  // WebView: detect Paystack success redirect with secure whitelist filtering
  const handleWebViewNavigate = (url: string) => {
    // BUGFIX: WebView URL validation — require reference= parameter for success detection
    // instead of matching loose keywords like 'callback' or 'success' which could appear
    // in any URL. Use a proper URL pattern match for Paystack callback references.
    const hasPaystackReference = /[?&]reference=/i.test(url);
    const isWhitelistedDomain =
      url.startsWith('https://checkout.paystack.com') ||
      url.startsWith('https://checkout.paystack.co') ||
      url.startsWith('https://api.paystack.co') ||
      url.startsWith('https://standard.paystack.co');

    // Strict WebView URL validation: only accept Paystack callback redirects
    // from whitelisted domains. Non-whitelisted domains are ALWAYS rejected —
    // even if they contain a reference= param — to prevent callback injection attacks.
    if (!isWhitelistedDomain) {
      // Block all non-whitelisted URLs immediately. Do NOT accept reference= param
      // from untrusted domains (could be an attacker's page mimicking the callback).
      console.warn('[Payment] Blocked non-whitelisted WebView redirect:', url.slice(0, 100));
      return;
    }

    // Whitelisted domain with reference parameter = payment success.
    // (Single block — this was previously duplicated, which double-fired
    // emitPaymentConfirmed and double-scheduled the tracking navigation.)
    if (hasPaystackReference) {
      setCheckoutUrl(null);
      setStatus('success');
      setGuestInfo(null); // clear guest info after successful booking
      // Notify the driver instantly!
      socketEvents.emitPaymentConfirmed(activeBooking?.id ?? '', id ?? '');
      const t = setTimeout(() => { if (isMountedRef.current) router.replace(`/ride/${id}/tracking` as any); }, 1500);
      pendingTimeoutsRef.current.push(t);
    }
  };

  if (checkoutUrl) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.webviewHeader}>
          <Pressable onPress={() => setCheckoutUrl(null)} hitSlop={12}>
            <Ionicons name="close" size={24} color={colors.onSurface} />
          </Pressable>
          <Text variant="titleSmall">Card Payment</Text>
          <View style={{ width: 24 }} />
        </View>
        <WebView
          source={{ uri: checkoutUrl }}
          style={{ flex: 1 }}
          onNavigationStateChange={({ url }) => handleWebViewNavigate(url)}
          onShouldStartLoadWithRequest={(request) => {
            const { url } = request;
            // iOS: intercept custom scheme redirects (e.g. eyego://) that the WebView cannot load
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
              handleWebViewNavigate(url);
              return false;
            }
            return true;
          }}
        />
      </SafeAreaView>
    );
  }

  if (status === 'success') {
    return (
      <SafeAreaView style={[styles.safe, styles.successScreen]}>
        <MotiView
          from={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34 }}
          style={styles.successContent}
        >
          <View style={styles.successIcon}>
            <Ionicons name="checkmark" size={36} color={colors.onPrimary} />
          </View>
          <Text variant="headlineMedium" style={{ marginTop: spacing.xl, textAlign: 'center' }}>
            Payment Confirmed!
          </Text>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={{ marginTop: spacing.sm, textAlign: 'center' }}>
            Your seat is booked. Tracking your ride now.
          </Text>
        </MotiView>
      </SafeAreaView>
    );
  }

  if (status === 'failed') {
    return (
      <SafeAreaView style={[styles.safe, styles.successScreen]}>
        <MotiView
          from={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          style={styles.successContent}
        >
          <View style={[styles.successIcon, { backgroundColor: colors.errorContainer }]}>
            <Ionicons name="close" size={36} color={colors.error} />
          </View>
          <Text variant="headlineMedium" style={{ marginTop: spacing.xl }}>Payment Failed</Text>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={{ marginTop: spacing.sm, textAlign: 'center' }}>
            Please try again or use a different method.
          </Text>
          <Button label="Try Again" onPress={() => setStatus('idle')} style={{ marginTop: spacing.xl }} />
        </MotiView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={styles.header}>
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <Ionicons name="arrow-back" size={24} color={colors.onSurface} />
            </Pressable>
            <Text variant="titleMedium">Payment</Text>
            <View style={{ width: 24 }} />
          </View>

          {/* Amount */}
          <MotiView
            from={{ opacity: 0, translateY: 10 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 50 }}
            style={styles.amountCard}
          >
            <Text variant="bodySmall" color={colors.onSurfaceVariant}>Amount to pay</Text>
            <AnimatedFareText value={fareAmount} variant="fareLarge" />
            <Text variant="caption" color={colors.onSurfaceVariant}>
              Seat #{selectedSeat?.number ?? '—'} · {selectedTrip?.origin?.address?.split(',')[0] ?? ''} → {selectedTrip?.destination?.address?.split(',')[0] ?? ''}
            </Text>
            {enRouteRatio != null && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs, backgroundColor: colors.primary + '18', borderRadius: radii.full, paddingHorizontal: spacing.sm, paddingVertical: 3 }}>
                <Ionicons name="location" size={11} color={colors.primary} />
                <Text variant="caption" color={colors.primary}>
                  En-route discount applied{enRouteStopName ? ` · boarding at ${enRouteStopName}` : ''} ({Math.round(enRouteRatio * 100)}% of route)
                </Text>
              </View>
            )}
          </MotiView>

          {/* Payment tabs */}
          <MotiView
            from={{ opacity: 0, translateY: 10 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 80 }}
          >
            <View style={styles.tabRow}>
              <PaymentTab
                label="Mobile Money"
                icon="phone-portrait-outline"
                isActive={activeTab === 'momo'}
                onPress={() => setActiveTab('momo')}
              />
              <PaymentTab
                label="Card"
                icon="card-outline"
                isActive={activeTab === 'card'}
                onPress={() => setActiveTab('card')}
              />
              <PaymentTab
                label="Pay in Cash"
                icon="cash-outline"
                isActive={activeTab === 'cash'}
                onPress={() => setActiveTab('cash')}
              />
              <PaymentTab
                label="Wallet"
                icon="wallet-outline"
                isActive={activeTab === 'wallet'}
                onPress={() => setActiveTab('wallet')}
              />
            </View>

            {/* MoMo form */}
            {activeTab === 'momo' && (
              <MotiView
                from={{ opacity: 0, translateY: 6 }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{ type: 'spring', stiffness: 600, damping: 34 }}
                style={styles.momoForm}
              >
                <Text variant="bodySmall" color={colors.onSurfaceVariant} style={styles.momoLabel}>
                  Mobile Money number
                </Text>
                <View style={styles.momoInput}>
                  <Text variant="bodyMedium" style={styles.momoPrefix}>+233</Text>
                  <View style={styles.momoDivider} />
                  <TextInput
                    style={styles.momoTextInput}
                    value={momoPhone}
                    onChangeText={(t) => setMomoPhone(t.replace(/\D/g, '').slice(0, 9))}
                    keyboardType="number-pad"
                    placeholder="24X XXX XXXX"
                    placeholderTextColor={colors.onSurfaceVariant}
                    maxLength={9}
                  />
                </View>
                <Text variant="caption" color={colors.onSurfaceVariant}>
                  You'll receive a prompt on your phone to approve the payment.
                </Text>
              </MotiView>
            )}

            {activeTab === 'card' && (
              <MotiView
                from={{ opacity: 0, translateY: 6 }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{ type: 'spring', stiffness: 600, damping: 34 }}
                style={styles.cardInfo}
              >
                <Ionicons name="lock-closed-outline" size={16} color={colors.primary} />
                <Text variant="bodySmall" color={colors.onSurfaceVariant}>
                  You'll be redirected to Paystack's secure checkout to enter your card details.
                </Text>
              </MotiView>
            )}

            {activeTab === 'cash' && (
              <MotiView
                from={{ opacity: 0, translateY: 6 }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{ type: 'spring', stiffness: 600, damping: 34 }}
                style={styles.cardInfo}
              >
                <Ionicons name="cash-outline" size={16} color={colors.primary} />
                <Text variant="bodySmall" color={colors.onSurfaceVariant}>
                  You'll pay your driver GHS {fareAmount} in cash upon boarding. Highly convenient!
                </Text>
              </MotiView>
            )}

            {activeTab === 'wallet' && (
              <MotiView
                from={{ opacity: 0, translateY: 6 }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{ type: 'spring', stiffness: 600, damping: 34 }}
                style={styles.cardInfo}
              >
                <Ionicons name="wallet-outline" size={16} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodySmall" color={colors.onSurfaceVariant}>
                    {walletLoading
                      ? 'Checking wallet balance...'
                      : walletBalance >= fareAmount
                      ? `You have ${formatCurrency(walletBalance)} in your wallet. Sufficient balance!`
                      : `Insufficient wallet balance (${formatCurrency(walletBalance)}). Please top up or use another method.`}
                  </Text>
                </View>
              </MotiView>
            )}
          </MotiView>

          {/* Processing overlay */}
          {isPolling && (
            <MotiView
              from={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              style={styles.processingBanner}
            >
              <MotiView
                from={{ rotate: '0deg' }}
                animate={{ rotate: '360deg' }}
                transition={{ type: 'timing', duration: 1000, loop: true }}
              >
                <Ionicons name="sync-outline" size={18} color={colors.primary} />
              </MotiView>
              <Text variant="bodySmall" color={colors.onSurfaceVariant}>
                Waiting for payment confirmation...
              </Text>
            </MotiView>
          )}

          {/* Promo code */}
          <MotiView
            from={{ opacity: 0, translateY: 6 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 110 }}
            style={{ marginHorizontal: spacing['2xl'] }}
          >
            <Pressable
              onPress={() => setPromoExpanded(!promoExpanded)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}
            >
              <Ionicons name="ticket-outline" size={16} color={colors.primary} />
              <Text variant="bodySmall" color={colors.primary}>
                {promoExpanded ? 'Hide' : 'Have a promo code?'}
              </Text>
            </Pressable>
            {promoExpanded && (
              <MotiView
                from={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 48 }}
                transition={{ type: 'spring', stiffness: 600, damping: 34 }}
                style={{
                  flexDirection: 'row',
                  gap: spacing.sm,
                  marginTop: spacing.sm,
                }}
              >
                <TextInput
                  style={{
                    flex: 1,
                    height: 48,
                    backgroundColor: colors.surfaceContainer,
                    borderRadius: radii.lg,
                    paddingHorizontal: spacing.base,
                    fontFamily: fonts.medium,
                    fontSize: fontSizes.bodyMedium,
                    color: colors.onSurface,
                    borderWidth: 1,
                    borderColor: colors.outline,
                  }}
                  placeholder="Enter code"
                  placeholderTextColor={colors.onSurfaceVariant}
                  value={promoInput}
                  onChangeText={(t) => {
                    setPromoInput(t.toUpperCase());
                    setPromoStatus('idle');
                  }}
                  autoCapitalize="characters"
                />
                <Pressable
                  style={{
                    height: 48,
                    paddingHorizontal: spacing.lg,
                    backgroundColor: colors.primary,
                    borderRadius: radii.lg,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  onPress={() => {
                    if (promoInput.trim()) {
                      setPendingPromoCode(promoInput.trim());
                      setPromoStatus('applied');
                    }
                  }}
                >
                  <Text variant="label" color={colors.backgroundDeep}>Apply</Text>
                </Pressable>
              </MotiView>
            )}
            {promoStatus === 'applied' && (
              <Text variant="caption" color={colors.primary} style={{ marginTop: spacing.xs }}>
                Promo code applied! ✓
              </Text>
            )}
          </MotiView>

          {/* Pay button */}
          <View style={{ marginHorizontal: spacing['2xl'] }}>
            <Button
              label={
                activeTab === 'momo'
                  ? `Pay ${formatCurrency(fareAmount)} with MoMo`
                  : activeTab === 'card'
                  ? `Pay ${formatCurrency(fareAmount)} by Card`
                  : activeTab === 'wallet'
                  ? `Pay ${formatCurrency(fareAmount)} with Wallet`
                  : `Confirm Cash Booking · ${formatCurrency(fareAmount)}`
              }
              onPress={() => {
                // Card payments need a real email for the payment provider receipt.
                if (activeTab === 'card' && !user?.email) {
                  Alert.alert(
                    'Email required',
                    'Card payments need an email for your receipt. Add one to your profile to continue.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Add email', onPress: () => router.push('/profile/edit') },
                    ]
                  );
                  return;
                }
                // BUGFIX: Double-submit lock — prevent rapid taps from creating multiple bookings
                if (isSubmittingRef.current) return;
                isSubmittingRef.current = true;
                initPayment.mutate();
              }}
              loading={initPayment.isPending || isPolling}
              disabled={activeTab === 'momo' && (momoPhone.length < 8 || momoPhone.length > 12) || activeTab === 'wallet' && walletBalance < fareAmount || (activeTab === 'card' && !user?.email)}
            />
          </View>

          {initPayment.isError && (
            <Text variant="caption" color={colors.error} style={{ textAlign: 'center' }}>
              Payment initialisation failed. Please try again.
            </Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function PaymentTab({
  label,
  icon,
  isActive,
  onPress,
}: {
  label: string;
  icon: any;
  isActive: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable
      style={[styles.paymentTab, isActive && styles.paymentTabActive]}
      onPress={onPress}
    >
      <Ionicons
        name={icon}
        size={18}
        color={isActive ? colors.primary : colors.onSurfaceVariant}
      />
      <Text
        variant="label"
        color={isActive ? colors.primary : colors.onSurfaceVariant}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  scroll: { paddingBottom: spacing['3xl'], gap: spacing.xl },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.base,
  },
  amountCard: {
    marginHorizontal: spacing['2xl'],
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii['2xl'],
    padding: spacing.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.primary + '30',
  },
  fareText: { marginVertical: spacing.sm },
  tabRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: spacing['2xl'],
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii['2xl'],
    padding: 4,
    gap: 4,
  },
  paymentTab: {
    flex: 1,
    flexBasis: '45%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm + 2,
    borderRadius: radii.xl,
    minHeight: 44,
    overflow: 'hidden',
  },
  paymentTabActive: {
    backgroundColor: 'rgba(75, 226, 119, 0.15)',
    borderWidth: 1.5,
    borderColor: colors.primary + '50',
  },
  momoForm: {
    marginHorizontal: spacing['2xl'],
    marginTop: spacing.base,
    gap: spacing.sm,
  },
  momoLabel: { marginLeft: spacing.xs },
  momoInput: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.outline,
    height: 56,
    overflow: 'hidden',
  },
  momoPrefix: {
    paddingHorizontal: spacing.base,
    color: colors.onSurface,
  },
  momoDivider: { width: 1, height: 28, backgroundColor: colors.outline },
  momoTextInput: {
    flex: 1,
    paddingHorizontal: spacing.base,
    fontFamily: fonts.medium,
    fontSize: fontSizes.titleSmall,
    color: colors.onSurface,
    letterSpacing: 1,
  },
  cardInfo: {
    marginHorizontal: spacing['2xl'],
    marginTop: spacing.base,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: 'rgba(75, 226, 119, 0.06)',
    padding: spacing.base,
    borderRadius: radii.lg,
  },
  processingBanner: {
    marginHorizontal: spacing['2xl'],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceContainer,
    padding: spacing.md,
    borderRadius: radii.lg,
  },
  payButton: { marginHorizontal: spacing['2xl'] },
  webviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
  },
  successScreen: { justifyContent: 'center', alignItems: 'center' },
  successContent: { alignItems: 'center', paddingHorizontal: spacing['3xl'] },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
