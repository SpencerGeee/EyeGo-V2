import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  TextInput,
  Alert,
  BackHandler,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MotiView } from '@eyego/ui';
import { WebView } from 'react-native-webview';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { queryKeys } from '@eyego/api';
import { Ionicons } from '@expo/vector-icons';
import { bookingsApi, paymentsApi, socketEvents, walletApi } from '@eyego/api';
import * as Haptics from 'expo-haptics';
import { useRideStore } from '../../../stores/ride.store';
import { useAuthStore } from '../../../stores/auth.store';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../../utils/useColors';
import { Text, Button, AnimatedFareText } from '@eyego/ui';
import { formatGhs } from '@eyego/utils';
import { captureException } from '../../../lib/sentry';

type PaymentTab = 'momo' | 'card' | 'cash' | 'wallet';

export default function PaymentScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id, pickupStopId } = useLocalSearchParams<{ id: string; pickupStopId?: string }>();
  const router = useRouter();
  const { selectedTrip, selectedSeat, activeBooking, computedFare, setActiveBooking, setComputedFare, pendingPromoCode, setPendingPromoCode, guestInfo, setGuestInfo } = useRideStore();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const [activeTab, setActiveTab] = useState<PaymentTab>('momo');
  const [momoPhone, setMomoPhone] = useState('');
  const [walletBalancePesewas, setWalletBalancePesewas] = useState(0);
  const [walletLoading, setWalletLoading] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [paymentRef, setPaymentRef] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [useSavedCard, setUseSavedCard] = useState(true);
  const { data: savedCardsData } = useQuery({
    queryKey: ['payment-methods'],
    queryFn: walletApi.getPaymentMethods,
  });
  const savedCards = (savedCardsData as any) ?? [];
  const defaultSavedCard = savedCards.find((c: any) => c.isDefault) ?? savedCards[0] ?? null;
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
      walletApi.getBalance().then((res) => {
        const bal = (res?.data as any)?.data?.balancePesewas ?? (res?.data as any)?.balancePesewas ?? 0;
        setWalletBalancePesewas(bal);
      }).catch((err: any) => {
        console.warn('[Payment] Failed to fetch wallet balance:', err?.message ?? err);
      }).finally(() => setWalletLoading(false));
    }
  }, [activeTab]);

  // Fare is server-calculated. Order: booking.fareAmountPesewas → Zustand computedFare →
  // trip.farePerSeatPesewas. Never compute on the client — env-driven rates on the
  // server are the only source of truth. booking.fareAmountPesewas already reflects any
  // en-route discount, so we never need a client-side adjustment here.
  // BUGFIX ("the seat said 3 cedis, the payment page said 4.80, then the
  // tracking page said 3 again").
  //
  // `activeBooking` is PERSISTED in the ride store, so it outlives the flow that
  // created it. The mutation below already knows this — it computes `resumable`
  // before it will touch a stored booking — but the price on screen did not, and
  // read `activeBooking.fareAmountPesewas` unconditionally. A leftover booking
  // from an earlier, abandoned checkout (a different trip, a different seat, its
  // own deviation surcharge baked in) therefore priced this screen, while the
  // booking actually created on confirm was priced correctly from THIS trip.
  // That is the whole 3 → 4.80 → 3 sequence: only the middle number came from
  // the stale row, and the tracking page was right all along.
  //
  // Same predicate as `resumable`: a stored booking may only speak for this
  // screen if it is this trip's, this seat's, this passenger's and still held.
  const bookingIsForThisCheckout =
    !!activeBooking &&
    activeBooking.tripId === id &&
    activeBooking.seatNumber === selectedSeat?.number &&
    (activeBooking.guestName ?? null) === (guestInfo?.name ?? null) &&
    (activeBooking.status === 'SEAT_HELD' || activeBooking.status === 'PENDING');

  const serverPerSeat =
    (bookingIsForThisCheckout ? activeBooking?.fareAmountPesewas : null) ??
    computedFare ??
    selectedTrip?.farePerSeatPesewas ??
    0;
  // Same reasoning as the fare above: an en-route discount belongs to one
  // specific held booking, so a stale row must not annotate this checkout.
  const enRouteRatio: number | null = bookingIsForThisCheckout
    ? (activeBooking as { enRouteRatio?: number })?.enRouteRatio ?? null
    : null;
  const enRouteStopName: string | null = bookingIsForThisCheckout
    ? (activeBooking as { pickupStop?: { name?: string } })?.pickupStop?.name ?? null
    : null;
  // BUGFIX: this used to add a client-computed +GHS 10 on top of serverPerSeat when
  // selectedTrip.heavyCargo was set — but that flag is now persisted server-side
  // (bookings.service.js recomputeBookingAddons) and already baked into
  // activeBooking.fareAmountPesewas (serverPerSeat above). Adding it again here charged
  // the rider what they saw, but it was GHS 10 more than the actual server charge
  // would have been before this fix — the display and the charge are now the same
  // single number, with no client-side fare math at all.
  // "Paying for everyone" means this rider covers the *entire* trip cost — not perSeat × group size.
  // The server attaches `totalTripCostPesewas` to trip detail / group hub responses for this exact purpose.
  const payForEveryone = !!(selectedTrip as { payForEveryone?: boolean })?.payForEveryone;
  const totalTripCostPesewas = (selectedTrip as { totalTripCostPesewas?: number })?.totalTripCostPesewas ?? null;
  const fareAmountPesewas = payForEveryone && totalTripCostPesewas
    ? totalTripCostPesewas
    : serverPerSeat;

  // Free a SEAT_HELD booking immediately on a hard payment failure instead of
  // waiting up to ~15 min for the server seat-hold sweep. Best-effort and
  // idempotent: the backend cancelBooking refuses PAID bookings and re-setting
  // CANCELLED is a no-op, so this is safe to race against the sweep.
  // The booking id THIS attempt is working on. `activeBooking` is React state, so
  // a booking created inside the mutation is not visible to the mutation's own
  // onError closure — which is how a cash booking that had already been created
  // (and often already confirmed) got reported as "Payment Failed": the error
  // handler saw no booking id, skipped the "did it actually go through?" re-read
  // entirely, and went straight to the failure alert. A ref is written
  // synchronously and is therefore always current here.
  const attemptBookingIdRef = useRef<string>('');

  const releaseHeldSeat = async () => {
    const heldId = attemptBookingIdRef.current || activeBooking?.id;
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
      // Declare outside try so the catch block can use the value even if booking was created before the error.
      // Only reuse a persisted activeBooking if it's actually for THIS trip — a
      // leftover booking from an earlier abandoned flow (different trip, possibly
      // since expired/cancelled server-side) was being reused blindly here, so
      // confirmPayment's SEAT_HELD guard rejected it and every payment attempt
      // failed with a generic "initialization failed" error.
      // ROOT CAUSE of "the driver only ever sees one seat booked" (reported as
      // mandatory): this used to reuse `activeBooking` for ANY booking on the
      // same trip. Book a seat for a guest, then come back to book your own on
      // that same trip, and this branch handed back the GUEST's booking id — so
      // no second booking was ever created, the rider paid twice against one
      // row, and the trip stayed at one occupied seat.
      //
      // A held booking may only be resumed by the checkout that created it. That
      // means the same trip, the same seat, the same passenger, and a hold that
      // has not already been paid for — anything else is a different seat and
      // must create its own booking.
      const resumable =
        !!activeBooking &&
        activeBooking.tripId === id &&
        activeBooking.seatNumber === selectedSeat?.number &&
        (activeBooking.guestName ?? null) === (guestInfo?.name ?? null) &&
        (activeBooking.status === 'SEAT_HELD' || activeBooking.status === 'PENDING');
      let bookingId = resumable ? activeBooking?.id ?? '' : '';
      attemptBookingIdRef.current = bookingId;
      try {
        if (!bookingId && id && selectedSeat) {
          const { data: bookingData } = await bookingsApi.create({
            tripId: id,
            seatId: selectedSeat.id,
            seatNumber: selectedSeat.number,
            paymentMethod: (activeTab === 'momo' ? 'MOMO' : activeTab === 'cash' ? 'CASH' : activeTab === 'wallet' ? 'WALLET' : 'CARD') as 'MOMO' | 'CARD' | 'WALLET',
            ...(pickupStopId ? { pickupStopId } : {}),
            ...(guestInfo ? { guestName: guestInfo.name, guestPhone: guestInfo.phone } : {}),
          });
          // ROOT CAUSE of "pay in cash → validation failed / payment
          // initialization failed", which survived several rounds of narrower
          // fixes: POST /bookings answers `created(res, { booking, fareData,
          // holdExpiry })`, but this read `bookingData.data` as if it were the
          // booking itself (the API client's type said so, wrongly — now
          // corrected to CreateBookingResult). So:
          //   • `bookingId` was ALWAYS '' — POST /payments/initiate then failed
          //     its own `body('bookingId').notEmpty()` check, which is literally
          //     where "Validation failed" came from;
          //   • the wrapper was stored as `activeBooking`, so `activeBooking.id`
          //     and `.tripId` were undefined, meaning the next attempt didn't
          //     recognise its own booking and held ANOTHER seat — the "seat is
          //     held but payment failed" pair the rider kept seeing;
          //   • `fareAmountPesewas` lives on `fareData`, not on the wrapper, so the
          //     server-computed fare was silently dropped too.
          // Unwrapped tolerantly (`?? payload`) so either shape works and a
          // future server change can't strand the client again.
          const payload = bookingData.data as any;
          const newBooking = payload?.booking ?? payload;
          bookingId = newBooking?.id ?? '';
          if (!bookingId) {
            throw new Error(
              "We couldn't confirm your seat hold — the booking came back without an id. Please try again.",
            );
          }
          attemptBookingIdRef.current = bookingId;
          // Store booking and server-calculated fare in Zustand so tracking/rating screens have them
          setActiveBooking(newBooking);
          const serverFare = payload?.fareData?.fareAmountPesewas ?? newBooking?.fareAmountPesewas;
          if (serverFare) setComputedFare(serverFare);
        }

        if (bookingId && pendingPromoCode) {
          try {
            const { data: promoData } = await bookingsApi.applyPromo(bookingId, pendingPromoCode);
            // Reflect the discounted fare the server just wrote so the rider
            // isn't shown the pre-discount price for the rest of the flow.
            const discounted = (promoData as any)?.data?.booking;
            if (discounted?.fareAmountPesewas != null) setComputedFare(discounted.fareAmountPesewas);
            if (discounted) setActiveBooking(discounted);
          } catch (promoErr: any) {
            // If a prior attempt applied it but the response was lost, the
            // server 400s "already has a promo" — that's success, continue.
            const promoMsg: string = promoErr?.response?.data?.message ?? '';
            if (!/already has a promo/i.test(promoMsg)) {
              // Abort BEFORE any money moves. Previously this failed silently
              // and the rider was charged the full, undiscounted fare while
              // believing the discount was applied.
              throw new Error(
                promoMsg ||
                  "Your promo code couldn't be applied, so we stopped before charging you. Check the code and try again, or remove it to pay the standard fare."
              );
            }
          }
          setPendingPromoCode(null);
        }

        // Cash still has to hit the backend: initiatePayment's CASH branch is what
        // actually flips the booking from SEAT_HELD → CONFIRMED (confirmPayment with
        // cashOnBoard: true). Previously this short-circuited here and returned a
        // fake success without ever calling the server, so cash bookings stayed at
        // SEAT_HELD forever (invisible to the driver's passenger list) until the
        // seat-hold sweep silently cancelled them — "no passengers yet" even though
        // the rider had booked. Falling through to the same initialize() call below
        // (already branches on method === 'cash' → 'CASH') fixes that.

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
            savedCardId: activeTab === 'card' && useSavedCard ? defaultSavedCard?.id : undefined,
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
        queryClient.invalidateQueries({ queryKey: queryKeys.bookings.myHistory() });
        queryClient.invalidateQueries({ queryKey: queryKeys.bookings.active() });
        socketEvents.emitPaymentConfirmed(data.bookingId ?? activeBooking?.id ?? '', id ?? '');
        const t = setTimeout(() => { if (isMountedRef.current) router.replace('/trip?stage=assigned' as any); }, 1500);
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
        queryClient.invalidateQueries({ queryKey: queryKeys.bookings.myHistory() });
        queryClient.invalidateQueries({ queryKey: queryKeys.bookings.active() });
        socketEvents.emitPaymentConfirmed(data.bookingId ?? activeBooking?.id ?? '', id ?? '');
        const t = setTimeout(() => { if (isMountedRef.current) router.replace('/trip?stage=assigned' as any); }, 1500);
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
    onError: async (err: any) => {
      if (!isMountedRef.current) return;
      isSubmittingRef.current = false;

      // BUGFIX (reported: "cash payment gave me an error but the seat was
      // booked, and the home live-trip card then showed the wrong details").
      //
      // Not every rejection here means the booking failed. The two that don't:
      //   * 409 IDEMPOTENCY_IN_PROGRESS — a concurrent/duplicate submit of the
      //     SAME stable Idempotency-Key. The other request is the one doing the
      //     work and it usually succeeds.
      //   * a request that timed out or lost its response after the server had
      //     already confirmed the booking (cash confirms synchronously).
      // In both cases the old code declared "Payment Failed" AND called
      // releaseHeldSeat(), i.e. it tried to cancel a booking that was live —
      // which is exactly how the rider ended up with a confirmed seat, an error
      // alert, and a half-populated live-trip card on the home screen.
      //
      // So: ask the server what actually happened before deciding anything.
      const bookingId = attemptBookingIdRef.current || activeBooking?.id || '';
      if (bookingId) {
        try {
          const { data } = await bookingsApi.getById(bookingId);
          const fresh = (data as any)?.data?.booking ?? (data as any)?.data;
          // Any settled state counts, not just CONFIRMED: a cash booking lands on
          // CONFIRMED + paymentStatus PENDING, wallet/card land on PAID, and a
          // rider who reached the driver before the response came back can even be
          // BOARDED. Treating only CONFIRMED as success meant the other three
          // showed a failure alert on a booking that had gone through.
          const settled =
            fresh?.status === 'CONFIRMED' ||
            fresh?.status === 'BOARDED' ||
            fresh?.paymentStatus === 'PAID';
          if (settled) {
            // It went through. Treat it as the success it is.
            setActiveBooking(fresh);
            setStatus('success');
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setGuestInfo(null);
            queryClient.invalidateQueries({ queryKey: queryKeys.bookings.myHistory() });
            queryClient.invalidateQueries({ queryKey: queryKeys.bookings.active() });
            socketEvents.emitPaymentConfirmed(bookingId, id ?? '');
            const t = setTimeout(() => { if (isMountedRef.current) router.replace('/trip?stage=assigned' as any); }, 1500);
            pendingTimeoutsRef.current.push(t);
            return;
          }
        } catch {
          // Couldn't verify — fall through and report the failure, but do NOT
          // release the seat below on an unverifiable state.
          setStatus('idle');
          Alert.alert(
            'Payment Status Unclear',
            "We couldn't confirm whether your booking went through. Check My Trips before paying again.",
          );
          return;
        }
      }

      setStatus('idle');
      // Confirmed NOT booked: release the held seat now so it frees immediately
      // rather than waiting for the seat-hold sweep.
      void releaseHeldSeat();
      const errorMsg = err?.response?.data?.message || err?.message || 'Payment could not be processed. Please try again.';
      Alert.alert('Payment Failed', errorMsg);
    },
  });

  // Server-side verification for a card checkout that just redirected back — the
  // redirect itself doesn't distinguish a successful charge from a declined one.
  const verifyCardPayment = async () => {
    if (!isMountedRef.current) return;
    setIsPolling(true);
    setStatus('processing');
    try {
      const reference = paymentRef;
      if (!reference) throw new Error('Missing payment reference');
      await paymentsApi.pollStatus(reference, 2000, MAX_POLL_ATTEMPTS);
      if (!isMountedRef.current) return;
      setIsPolling(false);
      setStatus('success');
      setGuestInfo(null); // clear guest info after successful booking
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.myHistory() });
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.active() });
      socketEvents.emitPaymentConfirmed(activeBooking?.id ?? '', id ?? '');
      const t = setTimeout(() => { if (isMountedRef.current) router.replace('/trip?stage=assigned' as any); }, 1500);
      pendingTimeoutsRef.current.push(t);
    } catch {
      if (!isMountedRef.current) return;
      setIsPolling(false);
      setStatus('idle');
      Alert.alert(
        'Payment Not Confirmed',
        'Your card payment could not be confirmed — it may have been declined. Please try again.',
      );
    }
  };

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

    // Whitelisted domain with reference parameter = the checkout FLOW finished —
    // but Paystack uses this exact redirect shape for both a successful charge AND
    // a declined one. The redirect alone is not proof of payment; verify server-side
    // before ever telling the rider "Payment Confirmed."
    if (hasPaystackReference) {
      setCheckoutUrl(null);
      void verifyCardPayment();
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
      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
      >
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
            <AnimatedFareText pesewas={fareAmountPesewas} variant="fareLarge" />
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
                style={{ gap: spacing.sm }}
              >
                {defaultSavedCard ? (
                  <Pressable
                    onPress={() => setUseSavedCard((v) => !v)}
                    style={[styles.cardInfo, { justifyContent: 'space-between' }]}
                    accessibilityRole="button"
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1, flex: 1 }}>
                      <Ionicons name="card-outline" size={16} color={colors.primary} />
                      <Text variant="bodySmall" color={colors.onSurfaceVariant} numberOfLines={1} style={{ flexShrink: 1 }}>
                        {defaultSavedCard.brand?.toUpperCase()} •••• {defaultSavedCard.last4} (one-tap)
                      </Text>
                    </View>
                    <Ionicons
                      name={useSavedCard ? 'checkmark-circle' : 'ellipse-outline'}
                      size={20}
                      color={useSavedCard ? colors.primary : colors.onSurfaceVariant}
                      style={{ flexShrink: 0 }}
                    />
                  </Pressable>
                ) : null}
                <View style={styles.cardInfo}>
                  <Ionicons name="lock-closed-outline" size={16} color={colors.primary} />
                  <Text variant="bodySmall" color={colors.onSurfaceVariant}>
                    {defaultSavedCard && useSavedCard
                      ? "Charged instantly to your saved card — no redirect needed."
                      : "You'll be redirected to Paystack's secure checkout to enter your card details."}
                  </Text>
                </View>
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
                  You'll pay your driver {formatGhs(fareAmountPesewas)} in cash upon boarding. Highly convenient!
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
                      : walletBalancePesewas >= fareAmountPesewas
                      ? `You have ${formatGhs(walletBalancePesewas)} in your wallet. Sufficient balance!`
                      : `Insufficient wallet balance (${formatGhs(walletBalancePesewas)}). Please top up or use another method.`}
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
                  ? `Pay ${formatGhs(fareAmountPesewas)} with MoMo`
                  : activeTab === 'card'
                  ? `Pay ${formatGhs(fareAmountPesewas)} by Card`
                  : activeTab === 'wallet'
                  ? `Pay ${formatGhs(fareAmountPesewas)} with Wallet`
                  : `Confirm Cash Booking · ${formatGhs(fareAmountPesewas)}`
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
              disabled={activeTab === 'momo' && (momoPhone.length < 8 || momoPhone.length > 12) || activeTab === 'wallet' && walletBalancePesewas < fareAmountPesewas || (activeTab === 'card' && !user?.email)}
            />
          </View>

          {initPayment.isError && (
            <Text variant="caption" color={colors.error} style={{ textAlign: 'center' }}>
              Payment initialisation failed. Please try again.
            </Text>
          )}
      </KeyboardAwareScrollView>
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
    lineHeight: Math.round(fontSizes.titleSmall * 1.3),
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
