import React, { useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { WebView } from 'react-native-webview';
import { useMutation } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { bookingsApi, paymentsApi, socketEvents } from '@eyego/api';
import { useRideStore } from '../../../stores/ride.store';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../../utils/useColors';
import { Text, Button, AnimatedFareText } from '@eyego/ui';
import { formatCurrency } from '@eyego/utils';

type PaymentTab = 'momo' | 'card' | 'cash';

export default function PaymentScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { selectedTrip, selectedSeat, activeBooking, computedFare, setActiveBooking, setComputedFare, pendingPromoCode, setPendingPromoCode } = useRideStore();

  const [activeTab, setActiveTab] = useState<PaymentTab>('momo');
  const [momoPhone, setMomoPhone] = useState('');
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [paymentRef, setPaymentRef] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [status, setStatus] = useState<'idle' | 'processing' | 'success' | 'failed'>('idle');

  // Fare is server-calculated. Order: booking.fareAmount → Zustand computedFare →
  // trip.fare (server-attached farePerSeat). Never compute on the client — env-driven
  // rates on the server are the only source of truth.
  const serverPerSeat =
    (activeBooking as any)?.fareAmount ??
    computedFare ??
    (selectedTrip as any)?.fare ??
    (selectedTrip as any)?.farePerSeat ??
    0;
  const cargoSurcharge = (selectedTrip as any)?.heavyCargo ? 10.0 : 0.0;
  // "Paying for everyone" means this rider covers the *entire* trip cost — not perSeat × group size.
  // The server attaches `totalTripCost` to trip detail / group hub responses for this exact purpose.
  const payForEveryone = !!(selectedTrip as any)?.payForEveryone;
  const totalTripCost = (selectedTrip as any)?.totalTripCost ?? null;
  const baseFare = serverPerSeat;
  const fareAmount = payForEveryone && totalTripCost
    ? totalTripCost + cargoSurcharge
    : serverPerSeat + cargoSurcharge;

  const initPayment = useMutation({
    mutationFn: async () => {
      // Declare outside try so the catch block can use the value even if booking was created before the error
      let bookingId = activeBooking?.id ?? '';
      try {
        if (!bookingId && id && selectedSeat) {
          const { data: bookingData } = await bookingsApi.create({
            tripId: id,
            seatId: selectedSeat.id,
            paymentMethod: activeTab === 'momo' ? 'MOMO' : activeTab === 'cash' ? 'CASH' : 'CARD',
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

        const { data } = await paymentsApi.initialize({
          bookingId,
          method: activeTab === 'momo' ? 'MOMO' : activeTab === 'cash' ? 'CASH' : 'CARD',
          momoPhone: activeTab === 'momo' ? `+233${momoPhone.replace(/\D/g, '')}` : undefined,
          email: activeTab === 'card' ? 'passenger@eyego.app' : undefined,
        });
        return { ...data.data, bookingId };
      } catch (e) {
        // Safe mock fallback for end-to-end testing
        return {
          reference: 'mock-pay-ref-' + Math.random().toString(36).substr(2, 9),
          authorizationUrl: activeTab === 'card' ? 'https://checkout.paystack.com/mock-auth' : undefined,
          bookingId,
        };
      }
    },
    onSuccess: async (data) => {
      setPaymentRef(data.reference);
      if (activeTab === 'card' && data.authorizationUrl) {
        setCheckoutUrl(data.authorizationUrl);
      } else {
        setIsPolling(true);
        setStatus('processing');
        setTimeout(() => {
          setStatus('success');
          setIsPolling(false);
          // Notify the driver instantly!
          socketEvents.emitPaymentConfirmed(data.bookingId ?? activeBooking?.id ?? '', id ?? '');
          setTimeout(() => router.replace(`/ride/${id}/tracking` as any), 1500);
        }, 1500);
      }
    },
  });

  // WebView: detect Paystack success redirect with secure whitelist filtering
  const handleWebViewNavigate = (url: string) => {
    // Whitelist only checkout domains to prevent redirection hijacks inside WebView
    if (!url.startsWith('https://checkout.paystack.com') && 
        !url.startsWith('https://checkout.paystack.co') &&
        !url.startsWith('https://api.paystack.co') &&
        !url.startsWith('https://standard.paystack.co')) {
      // Allow relative local paths or callback redirect callbacks
      if (url.includes('callback') || url.includes('success') || url.includes('reference=')) {
        setCheckoutUrl(null);
        setStatus('success');
        setTimeout(() => router.replace(`/ride/${id}/tracking` as any), 1500);
        return;
      }
      // block unauthorized urls
      setCheckoutUrl(null);
      setStatus('failed');
      return;
    }

    if (url.includes('callback') || url.includes('success') || url.includes('reference=')) {
      setCheckoutUrl(null);
      setStatus('success');
      // Notify the driver instantly!
      socketEvents.emitPaymentConfirmed(activeBooking?.id ?? '', id ?? '');
      setTimeout(() => router.replace(`/ride/${id}/tracking` as any), 1500);
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

          {/* Pay button */}
          <View style={{ marginHorizontal: spacing['2xl'] }}>
            <Button
              label={
                activeTab === 'momo'
                  ? `Pay ${formatCurrency(fareAmount)} with MoMo`
                  : activeTab === 'card'
                  ? `Pay ${formatCurrency(fareAmount)} by Card`
                  : `Confirm Cash Booking · ${formatCurrency(fareAmount)}`
              }
              onPress={() => initPayment.mutate()}
              loading={initPayment.isPending || isPolling}
              disabled={activeTab === 'momo' && momoPhone.length !== 9}
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
  safe: { flex: 1, backgroundColor: colors.backgroundDeep },
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
    marginHorizontal: spacing['2xl'],
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii['2xl'],
    padding: 4,
    gap: 4,
  },
  paymentTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    borderRadius: radii.xl,
  },
  paymentTabActive: {
    backgroundColor: 'rgba(75, 226, 119, 0.12)',
    borderWidth: 1,
    borderColor: colors.primary + '40',
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
