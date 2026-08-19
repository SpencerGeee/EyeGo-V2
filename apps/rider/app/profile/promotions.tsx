import React, { useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { useThemeStore } from '../../stores/theme.store';
import { Text, Button, GlowSearchInput, ShinyText, AppBackground } from '@eyego/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { bookingsApi, apiClient, userApi, type RiderPromotion, type RiderPromotions } from '@eyego/api';
import { formatGhs } from '@eyego/utils';
import { useRideStore } from '../../stores/ride.store';
import { useAuthStore } from '../../stores/auth.store';

/**
 * "When is it going to end", in words rather than a raw date.
 *
 * A promo expiring today and one expiring in three months are read completely
 * differently, and a bare `31/12/2026` makes the reader do that arithmetic
 * themselves. Past dates are still labelled honestly rather than as "in -2
 * days" — the server filters expired promos out, but a page left open across
 * midnight should not start lying.
 */
function expiryLabel(iso: string | null | undefined): string {
  if (!iso) return '';
  const end = new Date(iso).getTime();
  if (!Number.isFinite(end)) return '';
  const days = Math.floor((end - Date.now()) / 86_400_000);
  if (days < 0) return 'Expired';
  if (days === 0) return 'Ends today';
  if (days === 1) return 'Ends tomorrow';
  if (days <= 14) return `Ends in ${days} days`;
  return `Ends ${new Date(end).toLocaleDateString()}`;
}

export default function PromotionsScreen() {
  const colors = useColors();
  const isDark = useThemeStore((s) => s.isDark);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const [promoCode, setPromoCode] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [promoStatus, setPromoStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const { activeBooking, setPendingPromoCode, pendingPromoCode } = useRideStore();
  const { user } = useAuthStore();
  const referralCode = user?.referralCode ?? null;
  const queryClient = useQueryClient();

  const { data: promoData, isLoading: promosLoading } = useQuery({
    queryKey: ['user', 'promotions'],
    queryFn: () => userApi.getPromotions(),
    // ApiResponse<T> double-wraps: axios `.data`, then the envelope's `.data`.
    select: (r: any) => (r?.data?.data ?? null) as RiderPromotions | null,
  });
  const applied = promoData?.applied ?? null;
  const available = promoData?.available ?? [];
  const used = promoData?.used ?? [];

  /**
   * @param codeArg apply THIS code instead of whatever is typed in the field.
   *
   * BUGFIX ("I tapped on the available offers and it said I could use SPEN20").
   * Tapping an offer used to only copy its code into the text box, leaving the
   * rider to scroll back up and press Apply — so the tap looked like it had done
   * something and had not. An offer row is a "use this" affordance; it now uses
   * it.
   */
  const handleApplyPromo = async (codeArg?: string) => {
    const raw = (codeArg ?? promoCode).trim();
    if (!raw) return;
    if (codeArg) setPromoCode(codeArg);
    setIsValidating(true);
    setPromoStatus('idle');
    try {
      if (activeBooking?.id) {
        await bookingsApi.applyPromo(activeBooking.id, raw);
        setPromoStatus('success');
        // So the "active on your ride" card above appears immediately rather
        // than on the next visit to this screen.
        queryClient.invalidateQueries({ queryKey: ['user', 'promotions'] });
      } else {
        // Validate code against backend before saving for next booking
        const res = await apiClient.get<{ success: boolean; data?: { valid: boolean } }>(
          `/bookings/promos/validate?code=${raw.toUpperCase()}`
        );
        if (res.data?.success && res.data?.data?.valid) {
          setPendingPromoCode(raw.toUpperCase());
          setPromoStatus('success');
        } else {
          setPromoStatus('error');
        }
      }
    } catch {
      setPromoStatus('error');
    } finally {
      setIsValidating(false);
    }
  };

  const handleShare = async () => {
    try {
      if (!referralCode) return;
      await Share.share({
        message: `Join me on EyeGo and get GHS 10 off your first ride! Use my invite code: ${referralCode} https://eyego.app/invite/${referralCode}`,
      });
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <AppBackground variant="static" isDark={isDark} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text variant="titleSmall">Promotions</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/*
          WHAT IS ACTUALLY RUNNING, AND WHEN IT ENDS.

          BUGFIX ("on the promotions page it doesn't show if I'm on an active
          promo and when it's going to end — everything is blank and it just
          allows you to enter a promo code").

          The screen had no query at all: a lone text field, and a rider with a
          promo already attached to their ride had no way to know it, no way to
          see what it saved them, and no way to know it was about to expire.
          `GET /user/me/promotions` answers all three (see users.service).
        */}
        {/*
          MY PROMOS — ALWAYS PRESENT, EVEN WHEN THE ANSWER IS "NONE".

          BUGFIX ("it said SPEN20 is applied and saved for next ride, but there's
          no section showing my active promos so I can't tell if I was using it
          already or if I'm now genuinely using it").

          The two cards below existed but were each conditional, so a rider with
          nothing attached saw NOTHING — indistinguishable from a screen that had
          simply not loaded, and no way to confirm what a tap had just done. A
          section that is always there, and states its own emptiness, is what
          makes "am I on a promo?" answerable at a glance. The remove control is
          the other half: a saved code you cannot take off is a code you have to
          guess about.
        */}
        <View style={{ gap: spacing.md }}>
          <Text variant="label" color={colors.onSurfaceVariant} style={styles.sectionLabel}>
            MY PROMOS
          </Text>

          {applied && (
            <View style={[styles.promoStateCard, { borderColor: `${colors.primary}66`, backgroundColor: `${colors.primary}12` }]}>
              <View style={styles.promoStateHead}>
                <Ionicons name="pricetag" size={18} color={colors.primary} />
                <Text variant="label" color={colors.primary} style={{ letterSpacing: 1 }}>ACTIVE ON YOUR RIDE</Text>
              </View>
              <Text variant="titleMedium" style={{ color: colors.onSurface }}>{applied.code}</Text>
              <Text variant="bodySmall" color={colors.onSurfaceVariant}>
                {applied.discountPercent}% off, up to {formatGhs(applied.maxDiscountPesewas)}
              </Text>
              <Text variant="caption" color={colors.onSurfaceVariant}>{expiryLabel(applied.expiry)}</Text>
            </View>
          )}

          {pendingPromoCode && (
            <View style={[styles.promoStateCard, { borderColor: colors.outline }]}>
              <View style={styles.promoStateHead}>
                <Ionicons name="time-outline" size={18} color={colors.onSurfaceVariant} />
                <Text variant="label" color={colors.onSurfaceVariant} style={{ letterSpacing: 1 }}>
                  {applied ? 'SAVED FOR THE RIDE AFTER' : 'SAVED FOR NEXT RIDE'}
                </Text>
              </View>
              <Text variant="titleMedium" style={{ color: colors.onSurface }}>{pendingPromoCode}</Text>
              <Text variant="bodySmall" color={colors.onSurfaceVariant}>
                This code is applied automatically when you book your next trip.
              </Text>
              <Pressable
                onPress={() => { setPendingPromoCode(null); setPromoStatus('idle'); }}
                hitSlop={8}
                style={styles.removePromoBtn}
                accessibilityRole="button"
                accessibilityLabel={`Remove saved promo code ${pendingPromoCode}`}
              >
                <Ionicons name="close-circle-outline" size={14} color={colors.statusError} />
                <Text variant="caption" color={colors.statusError}>Remove</Text>
              </Pressable>
            </View>
          )}

          {!applied && !pendingPromoCode && (
            <View style={[styles.promoStateCard, { borderColor: colors.outline }]}>
              <View style={styles.promoStateHead}>
                <Ionicons name="pricetag-outline" size={18} color={colors.onSurfaceVariant} />
                <Text variant="label" color={colors.onSurfaceVariant} style={{ letterSpacing: 1 }}>NONE ACTIVE</Text>
              </View>
              <Text variant="bodySmall" color={colors.onSurfaceVariant}>
                You are not using a promo right now. Pick one below or enter a code and it will be
                applied to your next ride.
              </Text>
            </View>
          )}
        </View>

        <View
          >
          <Text variant="label" color={colors.onSurfaceVariant} style={styles.sectionLabel}>
            ENTER PROMO CODE
          </Text>
          <View style={styles.promoCard}>
            <GlowSearchInput
              containerStyle={{ flex: 1 }}
              leftIcon={<Ionicons name="ticket-outline" size={20} color={colors.onSurfaceVariant} />}
              placeholder="Enter code here"
              value={promoCode}
              onChangeText={(text) => {
                setPromoCode(text);
                setPromoStatus('idle');
              }}
              autoCapitalize="characters"
            />
            <Button
              label="Apply"
              onPress={handleApplyPromo}
              loading={isValidating}
              disabled={!promoCode.trim()}
              style={styles.applyBtn}
              fullWidth={false}
            />
          </View>
          {promoStatus === 'success' && (
            <Text variant="caption" color={colors.primary} style={styles.statusText}>
              {activeBooking?.id
                ? 'Promo applied to current booking!'
                : 'Promo saved! Will be applied to your next booking.'}
            </Text>
          )}
          {promoStatus === 'error' && (
            <Text variant="caption" color={colors.error} style={styles.statusText}>
              Invalid or expired promo code.
            </Text>
          )}
        </View>

        {/* Available offers — the answer to "what can I actually use?" */}
        <View style={{ marginTop: spacing['2xl'] }}>
          <Text variant="label" color={colors.onSurfaceVariant} style={styles.sectionLabel}>
            AVAILABLE OFFERS
          </Text>
          {promosLoading ? (
            <Text variant="bodySmall" color={colors.onSurfaceVariant}>Loading offers…</Text>
          ) : available.length === 0 ? (
            <View style={styles.emptyOffers}>
              <Ionicons name="pricetags-outline" size={28} color={colors.onSurfaceVariant} />
              <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ textAlign: 'center' }}>
                No offers running right now. Codes you receive by SMS or email still work above.
              </Text>
            </View>
          ) : (
            available.map((p: RiderPromotion) => {
              /*
                Each row states its OWN relationship to this rider — the thing
                the report says was missing ("I can't tell if I was using it
                already or if I'm now genuinely using it"). A row that is already
                on the ride is not tappable: re-applying it would either no-op or
                error, and both read as the app ignoring you.
              */
              const isActive = applied?.code?.toUpperCase() === p.code.toUpperCase();
              const isSaved = !isActive && pendingPromoCode?.toUpperCase() === p.code.toUpperCase();
              const busy = isValidating && promoCode.toUpperCase() === p.code.toUpperCase();
              return (
                <Pressable
                  key={p.id}
                  onPress={() => { if (!isActive && !busy) void handleApplyPromo(p.code); }}
                  disabled={isActive || busy}
                  style={({ pressed }) => [
                    styles.offerRow,
                    (isActive || isSaved) && { borderColor: `${colors.primary}55` },
                    pressed && { opacity: 0.7 },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive || isSaved, disabled: isActive }}
                  accessibilityLabel={
                    isActive
                      ? `Promo code ${p.code} is active on your ride`
                      : isSaved
                        ? `Promo code ${p.code} is saved for your next ride`
                        : `Use promo code ${p.code}`
                  }
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="bodyMedium" style={{ color: colors.onSurface, fontFamily: fonts.semiBold }}>
                      {p.code}
                    </Text>
                    <Text variant="caption" color={colors.onSurfaceVariant}>
                      {p.discountPercent}% off, up to {formatGhs(p.maxDiscountPesewas)}
                    </Text>
                    <Text variant="caption" color={colors.onSurfaceVariant}>
                      {expiryLabel(p.expiry)}
                      {p.redemptionsLeft != null && p.redemptionsLeft <= 20
                        ? ` · only ${p.redemptionsLeft} left`
                        : ''}
                    </Text>
                  </View>
                  {isActive || isSaved ? (
                    <View style={[styles.offerPill, { backgroundColor: `${colors.primary}1F` }]}>
                      <Ionicons name="checkmark" size={11} color={colors.primary} />
                      <Text variant="caption" color={colors.primary}>
                        {isActive ? 'ACTIVE' : 'SAVED'}
                      </Text>
                    </View>
                  ) : (
                    <Text variant="caption" color={colors.primary}>{busy ? 'Applying…' : 'Use'}</Text>
                  )}
                </Pressable>
              );
            })
          )}
        </View>

        {/* Already redeemed — so a used code stops looking like a missed one. */}
        {used.length > 0 && (
          <View style={{ marginTop: spacing['2xl'] }}>
            <Text variant="label" color={colors.onSurfaceVariant} style={styles.sectionLabel}>
              ALREADY USED
            </Text>
            {used.map((p: RiderPromotions["used"][number]) => (
              <View key={`${p.id}-${p.bookingId}`} style={styles.offerRow}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="bodyMedium" color={colors.onSurfaceVariant}>{p.code}</Text>
                  <Text variant="caption" color={colors.onSurfaceVariant}>
                    Used {p.usedAt ? new Date(p.usedAt).toLocaleDateString() : ''}
                  </Text>
                </View>
                <Ionicons name="checkmark-circle" size={18} color={colors.onSurfaceVariant} />
              </View>
            ))}
          </View>
        )}

        <View
          style={{ marginTop: spacing['2xl'] }}
        >
          <Text variant="label" color={colors.onSurfaceVariant} style={styles.sectionLabel}>
            REFER & EARN
          </Text>
          <View style={styles.referCard}>
            <View style={styles.referIconContainer}>
              <Ionicons name="gift-outline" size={32} color={colors.primary} />
            </View>
            <Text variant="titleMedium" style={styles.referTitle}>Get GHS 10 off</Text>
            <Text variant="bodySmall" color={colors.onSurfaceVariant} style={styles.referDesc}>
              Invite friends to EyeGo. They get GHS 10 off their first ride, and you get GHS 10 when they complete it.
            </Text>
            
            {referralCode ? (
              <View style={styles.codeContainer}>
                <Text variant="label" color={colors.onSurfaceVariant}>YOUR CODE</Text>
                <ShinyText
                  baseColor={colors.primary}
                  textStyle={[{ fontFamily: fonts.semiBold, fontSize: fontSizes.titleLarge }, styles.codeText]}
                >
                  {referralCode}
                </ShinyText>
              </View>
            ) : null}

            <Button
              label="Share Invite Link"
              onPress={handleShare}
              variant="secondary"
              disabled={!referralCode}
              style={styles.shareBtn}
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing['2xl'],
    paddingBottom: spacing['3xl'],
  },
  sectionLabel: {
    letterSpacing: 1,
    marginBottom: spacing.base,
  },
  promoCard: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.xl,
    padding: spacing.base,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  inputRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceContainerHigh,
    paddingHorizontal: spacing.md,
    height: 48,
    borderRadius: radii.lg,
  },
  input: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodyMedium,
    lineHeight: Math.round(fontSizes.bodyMedium * 1.4),
    color: colors.onSurface,
  },
  applyBtn: {
    height: 48,
    paddingHorizontal: spacing.xl,
  },
  statusText: {
    marginTop: spacing.sm,
    marginLeft: spacing.sm,
  },
  referCard: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.xl,
    padding: spacing['2xl'],
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    alignItems: 'center',
  },
  referIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  referTitle: {
    marginBottom: spacing.sm,
  },
  referDesc: {
    textAlign: 'center',
    marginBottom: spacing.xl,
    lineHeight: 20,
  },
  codeContainer: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing['2xl'],
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderStyle: 'dashed',
    marginBottom: spacing.xl,
    width: '100%',
  },
  codeText: {
    marginTop: spacing.xs,
    letterSpacing: 2,
  },
  shareBtn: {
    width: '100%',
  },
  /** The "active on your ride" / "saved for next ride" banner. */
  promoStateCard: {
    borderWidth: 1,
    borderRadius: radii.xl,
    padding: spacing.base,
    gap: 4,
    marginBottom: spacing.xl,
  },
  promoStateHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: 2,
  },
  /** One row in the available / already-used lists. */
  offerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.base,
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.base,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    backgroundColor: colors.surfaceContainer,
    marginBottom: spacing.sm,
  },
  emptyOffers: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  removePromoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
  },
  offerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.sm,
  },
});
